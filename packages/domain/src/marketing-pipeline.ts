import {createHash} from 'node:crypto';
import type {SqlExecutor} from '@boran/db';
import {redactAiText, aiInputHash, sanitizeAiRunMetadata, validateRuntimeEvidenceInput, validateRuntimeEvidenceOutput, type AiGatewayResult} from '@boran/ai';
import {validateAiOutput, aiOutputHash, type AiOutput, type AiSemanticContext} from '@boran/contracts';
import {activeRoles, requireActiveRole} from './authz';
import {DomainError, audit, emitOutbox, uuid, stableHash, nowIso, assertVersion, requireRole, type ServiceContext,assertWorkflowFence,type WorkflowFence} from './core';
import {evaluateQualitativePriority,invalidateDependentTopics} from './marketing';

type Row=Record<string,unknown>;
// The model receives a service-built immutable request; callers cannot replace its source text after construction.
const builtRequestDigests=new WeakMap<MarketingAiRequest,string>();
type SourceVersionRef=AiOutput['source_versions'][number];
type Gap=Extract<AiOutput,{workflow:'content_draft'}>['output']['gaps'][number];
export interface MarketingSourceTextRef {sourceVersionId:string;documentId:string;connectionId:string;objectKey:string;textHash:string;mode:'mock'|'live'}
export interface MarketingAiRequest {workflow:'insight_topics'|'content_draft';context:AiSemanticContext;input:Row}
export interface MarketingAiResult {output:AiOutput;metadata:{mode:'mock'|'real';simulation:boolean;model:string;output_hash:string;[key:string]:unknown}}
export interface BuildMarketingAiInput {workflow:MarketingAiRequest['workflow'];sourceVersionIds?:string[];topicId?:string;dataCutoff?:string;cta?:{label:string;href:string;action:'navigate'|'scroll_to_form'|'contact'};loadText:(objectKey:string,source:MarketingSourceTextRef)=>Promise<string>}
export interface PersistMarketingAiInput {workflowRunId?:string;fence?:WorkflowFence;request:MarketingAiRequest;result:MarketingAiResult|AiGatewayResult}
const digest=(text:string)=>createHash('sha256').update(text,'utf8').digest('hex');
const asRows=(value:unknown):Row[]=>Array.isArray(value)?value as Row[]:[];
const iso=(value:unknown)=>new Date(String(value)).toISOString();
const normalized=(value:string)=>value.normalize('NFKC').trim().replace(/\s+/g,' ');
const redact=redactAiText;
function bounded(text:unknown,max:number,label:string):asserts text is string {if(typeof text!=='string'||!text.trim()||text.length>max)throw new DomainError('INVALID_DRAFT',422,`${label}须为非空有界文本`);}
function sourceRef(row:Row):SourceVersionRef {
  const coverage=row['coverage_json'] as Row;
  return {source_version_id:String(row['id']),document_id:String(row['document_id']),source_kind:row['source_kind'] as SourceVersionRef['source_kind'],revision:String(row['revision']),retrieved_at:iso(row['retrieved_at']),coverage:{status:coverage['status'] as SourceVersionRef['coverage']['status'],scope:String(coverage['scope']),start_locator:coverage['start_locator'] as string|null??null,end_locator:coverage['end_locator'] as string|null??null,gaps:Array.isArray(coverage['gaps'])?coverage['gaps'] as string[]:[]}};
}
async function loadSources(ctx:ServiceContext,tx:SqlExecutor,ids:string[],lock=false):Promise<Row[]> {
  if(!ids.length||ids.length>200||new Set(ids).size!==ids.length)throw new DomainError('SOURCE_INPUT_REQUIRED',422,'模型输入须有1至200个不可变来源版本');
  const rows=(await tx.query(`SELECT v.*,d.connection_id,d.source_kind,d.deleted_at,d.provider_file_id,d.source_url,d.conversation_id,c.read_mode,c.access_status,c.scope_json FROM source_versions v JOIN source_documents d ON d.org_id=v.org_id AND d.id=v.document_id JOIN connections c ON c.org_id=d.org_id AND c.id=d.connection_id WHERE v.org_id=$1 AND v.id=ANY($2::uuid[]) ORDER BY v.id${lock?' FOR SHARE OF d,c,v':''}`,[ctx.orgId,ids])).rows;
  if(rows.length!==ids.length||rows.some(row=>row['deleted_at']||row['execution_mode']!==ctx.mode||(row['read_mode']==='mock')!==(ctx.mode==='mock')||ctx.mode==='live'&&row['access_status']!=='connected'))throw new DomainError('SOURCE_INPUT_UNAVAILABLE',409,'来源版本不存在、范围已撤回或运行模式不一致');
  if(ctx.mode==='live')for(const row of rows){
    const scope=row['scope_json'] as Row,coverage=row['coverage_json'] as Row,kind=row['source_kind'];
    const idsAt=(key:string)=>Array.isArray(scope[key])?scope[key] as string[]:[];
    const normalizeUrl=(value:unknown)=>{try{const url=new URL(String(value));url.hash='';return url.toString();}catch{return null;}};
    const inScope=kind==='mac_drive'?idsAt('file_ids').includes(String(row['provider_file_id']))||Array.isArray(coverage['folder_ids'])&&Array.isArray(coverage['ancestor_folder_ids'])&&(coverage['folder_ids'] as string[]).some(root=>idsAt('folder_ids').includes(root)&&(coverage['ancestor_folder_ids'] as string[]).includes(root)):kind==='chatgpt'?idsAt('conversation_ids').includes(String(row['conversation_id']))||idsAt('project_ids').includes(String(coverage['project_id'])):normalizeUrl(row['source_url']??row['provider_file_id'])!==null&&idsAt('urls').some(url=>normalizeUrl(url)===normalizeUrl(row['source_url']??row['provider_file_id']));
    if(!inScope)throw new DomainError('SOURCE_SCOPE_WITHDRAWN',409,'来源当前明确范围已撤回，旧模型输入不能继续处理');
  }
  return rows;
}
/** Service builds every reference, locator, fact and rule from current database state. Source text remains private. */
export async function buildMarketingAiRequest(ctx:ServiceContext,input:BuildMarketingAiInput):Promise<MarketingAiRequest> {
  return buildMarketingAiRequestInternal(ctx,input);
}
async function buildMarketingAiRequestInternal(ctx:ServiceContext,input:BuildMarketingAiInput,frozenSourceVersionIds?:string[]):Promise<MarketingAiRequest> {
  await activeRoles(ctx);requireRole(ctx,'owner','marketer');
  if(input.workflow==='content_draft'&&!input.topicId)throw new DomainError('TOPIC_REQUIRED',422,'草稿生成必须关联推荐主题');
  let topic:Row|undefined;
  if(input.topicId){topic=(await ctx.db.query('SELECT * FROM topics WHERE org_id=$1 AND id=$2',[ctx.orgId,input.topicId])).rows[0];if(!topic||topic['execution_mode']!==ctx.mode)throw new DomainError('TOPIC_NOT_AVAILABLE',404,'主题不存在或不属于当前模式');}
  const claims=topic?(await ctx.db.query('SELECT * FROM evidence_claims WHERE org_id=$1 AND id=ANY($2::uuid[]) ORDER BY id',[ctx.orgId,topic['claim_ids']])).rows:[];
  const changedSourceVersionIds=[...new Set([...(input.sourceVersionIds??[]),...claims.map(claim=>String(claim['source_version_id']))])];
  let ids=[...(frozenSourceVersionIds??changedSourceVersionIds)],sources=await loadSources(ctx,ctx.db,ids);
  if(changedSourceVersionIds.some(id=>!ids.includes(id)))throw new DomainError('PREPARED_AI_INPUT_CONFLICT',409,'已保存输入遗漏变化来源或主题证据');
  if(!frozenSourceVersionIds){
  const related=(await ctx.db.query("SELECT DISTINCT c.source_version_id FROM evidence_claims c JOIN source_versions v ON v.org_id=c.org_id AND v.id=c.source_version_id JOIN source_documents d ON d.org_id=v.org_id AND d.id=v.document_id JOIN connections cn ON cn.org_id=d.org_id AND cn.id=d.connection_id WHERE c.org_id=$1 AND v.execution_mode=$2 AND v.text_hash IS NOT NULL AND v.text_object_key IS NOT NULL AND v.extraction_status='ready' AND d.deleted_at IS NULL AND (cn.read_mode='mock')=$3 AND ($3 OR cn.access_status='connected') AND (d.id=ANY($4::uuid[]) OR c.verification_status='verified') ORDER BY c.source_version_id LIMIT 100",[ctx.orgId,ctx.mode,ctx.mode==='mock',sources.map(source=>source['document_id'])])).rows;
  ids=[...new Set([...ids,...related.map(row=>String(row['source_version_id']))])];sources=await loadSources(ctx,ctx.db,ids);
  }

  const trusted=(await ctx.db.query('SELECT * FROM evidence_claims WHERE org_id=$1 AND source_version_id=ANY($2::uuid[]) AND (execution_mode=$3 OR execution_mode IS NULL) ORDER BY id',[ctx.orgId,ids,ctx.mode])).rows;
  const masters=(await ctx.db.query('SELECT DISTINCT ON(category,business_key) * FROM business_master_versions WHERE org_id=$1 ORDER BY category,business_key,version_no DESC',[ctx.orgId])).rows;
  const cutoff=input.dataCutoff??sources.map(source=>iso(source['source_modified_at']??source['retrieved_at'])).sort().at(-1)!;
  if(!Number.isFinite(Date.parse(cutoff)))throw new DomainError('INVALID_DATE',422,'洞察截止时间无效');
  const policies=(await ctx.db.query("SELECT v.* FROM policy_versions v JOIN execution_policies p ON p.org_id=v.org_id AND p.id=v.policy_id JOIN memberships m ON m.org_id=v.org_id AND m.user_id=v.approved_by JOIN users u ON u.id=m.user_id WHERE v.org_id=$1 AND p.status='active' AND p.active_version_id=v.id AND v.approved_at IS NOT NULL AND m.active AND u.active AND 'owner'=ANY(m.roles) AND v.valid_from<=$2 AND (v.valid_until IS NULL OR v.valid_until>$2) ORDER BY v.id",[ctx.orgId,nowIso(ctx)])).rows;
  const profiles=(await ctx.db.query('SELECT v.*,p.platform_account_id,a.display_name,a.provider FROM platform_profile_versions v JOIN platform_profiles p ON p.org_id=v.org_id AND p.id=v.profile_id JOIN platform_accounts a ON a.org_id=p.org_id AND a.id=p.platform_account_id JOIN connections c ON c.org_id=a.org_id AND c.id=a.connection_id WHERE v.org_id=$1 AND p.current_version_id=v.id AND (c.read_mode=\'mock\')=$2 ORDER BY v.id',[ctx.orgId,ctx.mode==='mock'])).rows;
  const sourceVersions=sources.map(row=>({...sourceRef(row)})),materials:Row[]=[],locators:NonNullable<AiSemanticContext['locators']>[number][]=[],expressions:NonNullable<AiSemanticContext['decisionExpressions']>[number][]=[];
  for(const source of sources){
    if(!source['text_object_key']||!source['text_hash']||source['extraction_status']!=='ready')throw new DomainError('SOURCE_TEXT_UNAVAILABLE',409,'来源原文尚未完成提取，不能产生虚假洞察');
    const ref:MarketingSourceTextRef={sourceVersionId:String(source['id']),documentId:String(source['document_id']),connectionId:String(source['connection_id']),objectKey:String(source['text_object_key']),textHash:String(source['text_hash']),mode:ctx.mode};
    const text=await input.loadText(ref.objectKey,ref);
    if(!text.trim()||digest(text)!==ref.textHash)throw new DomainError('SOURCE_TEXT_HASH_MISMATCH',409,'实际原文正文与不可变来源hash不一致');
    const coverage=source['coverage_json'] as Row;
    type Segment={locator:{kind:string;value:string};text:string;role?:'user'|'assistant';occurred_at?:string|null};
    let segments:Segment[]=text.split(/\n\s*\n/).map(part=>part.trim()).filter(Boolean).map((part,index)=>({locator:{kind:source['source_kind']==='market_public'||source['source_kind']==='competitor_public'?'web':'document',value:`paragraph:${index+1}`},text:redact(part)}));
    if(source['source_kind']==='chatgpt'){
      const headers=[...text.matchAll(/^\[(user|assistant)\] \[([^\]\n]+)\] \[([^\]\n]+)\]\n/gm)];
      if(headers.length){
        const messageIds=coverage['message_ids'] as string[];
        if(!Array.isArray(messageIds)||headers.length!==messageIds.length||new Set(headers.map(header=>header[2])).size!==headers.length||headers.some(header=>!messageIds.includes(header[2]!)))throw new DomainError('SOURCE_MESSAGE_COVERAGE_MISMATCH',409,'来源消息正文与稳定消息身份范围不一致');
        segments=headers.map((header,index)=>({locator:{kind:'message',value:`message:${header[2]}`},text:redact(text.slice(header.index!+header[0].length,headers[index+1]?.index??text.length).trim()),role:header[1] as 'user'|'assistant',occurred_at:Number.isFinite(Date.parse(header[3]!))?header[3]!:null}));
        for(const segment of segments)if(segment.role==='user'){
          const uncertain=/[?？]|是否|能否|可否|要不要|好不好|确认一下|待确认/.test(segment.text);
          const status=uncertain?null:/^(?:我(?:们)?(?:现在)?(?:明确)?(?:撤销|取消|作废)|撤销[:：]|取消[:：])/.test(segment.text)?'revoked':/^(?:我(?:们)?(?:现在)?(?:明确)?(?:确认|批准|同意)|确认[:：]|批准[:：])/.test(segment.text)&&!/(?:不确认|未确认|不批准|未批准|尚未|不要)/.test(segment.text)?'confirmed':null;
          if(status)expressions.push({source_version_id:ref.sourceVersionId,locator:segment.locator,actor:'user',claim_text:segment.text,decision_status:status});
        }
      }
    }

    for(const segment of segments)locators.push({source_version_id:ref.sourceVersionId,locator:segment.locator});
    materials.push({source_version_id:ref.sourceVersionId,revision:source['revision'],text_hash:ref.textHash,segments});
  }
  const trustedClaims=trusted.map(claim=>({claim_id:claim['id'],claim_text:redact(String(claim['claim_text'])),source_version_id:claim['source_version_id'],locator:claim['locator'],assertion_type:claim['assertion_type'],decision_status:claim['decision_status'],decision_evidence_ref:claim['decision_evidence_ref'],supersedes_claim_id:claim['supersedes_claim_id'],inference_rationale:(claim['applicable_scope'] as Row|null)?.['inference_rationale']??null,verification_status:claim['verification_status'],public_permission:claim['public_permission'],valid_until:claim['valid_until']?iso(claim['valid_until']):null}));
  for(const claim of trustedClaims)if(!locators.some(locator=>locator.source_version_id===claim.source_version_id&&stableHash(locator.locator)===stableHash(claim.locator)))locators.push({source_version_id:String(claim.source_version_id),locator:claim.locator});
  const policyRefs=policies.map(policy=>({policy_version_id:policy['id'],policy_id:policy['policy_id'],payload_hash:policy['payload_hash']}));
  const businessKeys={industry_key:masters.filter(row=>row['status']==='confirmed'&&row['category']==='industry').map(row=>String(row['business_key'])),product_family_key:masters.filter(row=>row['status']==='confirmed'&&row['category']==='product_family').map(row=>String(row['business_key'])),domain_keys:masters.filter(row=>row['status']==='confirmed'&&row['category']==='business_domain').map(row=>String(row['business_key']))};
  const accountProfiles=profiles.map(profile=>({platform_account_id:String(profile['platform_account_id']),platform_profile_version_id:String(profile['id']),formats:profile['allowed_formats'] as string[]}));
  const request:MarketingAiRequest={workflow:input.workflow,context:{orgId:ctx.orgId,sourceVersions,policyRefs,businessKeys,locators,decisionExpressions:expressions,trustedClaims,accountProfiles,allowedIds:{topic_id:topic?[String(topic['id'])]:[],asset_id:[]},dataCutoff:cutoff},input:{data_cutoff:cutoff,changed_source_version_ids:changedSourceVersionIds,cta:input.workflow==='content_draft'?(input.cta??{label:'查看服务介绍（待配置）',href:'/',action:'navigate'}):null,cta_configured:Boolean(input.cta),source_versions:sourceVersions,source_materials:materials,trusted_claims:trustedClaims,current_business_master:masters.map(row=>({category:row['category'],business_key:row['business_key'],name:row['name'],aliases:row['aliases'],status:row['status'],version_no:row['version_no'],payload:row['payload_json']})),policy_refs:policyRefs,execution_rules:policies.map(row=>({policy_version_id:row['id'],business_scope:row['business_scope'],allowed_actions:row['allowed_actions'],publish_windows:row['publish_windows'],publish_frequency:row['publish_frequency']})),account_profiles:profiles.map(row=>({platform_account_id:row['platform_account_id'],platform_profile_version_id:row['id'],audience:row['audience'],style_samples:row['style_samples'],allowed_formats:row['allowed_formats'],rules:row['rules_json']})),topic:topic?{topic_id:topic['id'],title:topic['title'],business_line:topic['business_line'],audience:topic['audience'],problem:topic['problem'],offer:topic['offer'],angle:topic['angle'],claim_ids:topic['claim_ids'],gaps:topic['gaps_json']}:null}};
  builtRequestDigests.set(request,stableHash(request));return request;
}
/** Restore a durable, server-prepared request after restart without calling the provider again. */
export async function restorePreparedMarketingAiRequest(ctx:ServiceContext,serialized:unknown,input:{loadText:BuildMarketingAiInput['loadText']}):Promise<MarketingAiRequest> {
  await activeRoles(ctx);requireRole(ctx,'owner','marketer');
  if(!serialized||typeof serialized!=='object')throw new DomainError('INVALID_PREPARED_AI_INPUT',422,'已保存模型请求格式无效');
  const original=structuredClone(serialized) as MarketingAiRequest;
  if(!['insight_topics','content_draft'].includes(original.workflow)||!original.context||original.context.orgId!==ctx.orgId||!original.input||!Array.isArray(original.context.sourceVersions))throw new DomainError('INVALID_PREPARED_AI_INPUT',422,'已保存模型请求的组织或流程无效');
  const topic=original.input['topic'] as Row|null;
  const rebuilt=await buildMarketingAiRequestInternal(ctx,{workflow:original.workflow,sourceVersionIds:Array.isArray(original.input['changed_source_version_ids'])?original.input['changed_source_version_ids'] as string[]:original.context.sourceVersions.map(ref=>String(ref['source_version_id'])),...(topic?{topicId:String(topic['topic_id'])}:{}),...(original.context.dataCutoff?{dataCutoff:original.context.dataCutoff}:{}),...(original.input['cta_configured']?{cta:original.input['cta'] as NonNullable<BuildMarketingAiInput['cta']>}:{}),loadText:input.loadText},original.context.sourceVersions.map(ref=>String(ref['source_version_id'])));
  for(const field of ['source_versions','source_materials','changed_source_version_ids','topic','cta','cta_configured','data_cutoff'])if(stableHash(original.input[field])!==stableHash(rebuilt.input[field]))throw new DomainError('PREPARED_AI_INPUT_CONFLICT',409,'已保存输入的原文、主题或定位与不可变业务对象不一致');
  if(stableHash(original.context.sourceVersions)!==stableHash(rebuilt.context.sourceVersions)||stableHash(original.context.decisionExpressions??[])!==stableHash(rebuilt.context.decisionExpressions??[])||stableHash(original.context.allowedIds)!==stableHash(rebuilt.context.allowedIds))throw new DomainError('PREPARED_AI_INPUT_CONFLICT',409,'已保存输入的来源范围、用户表达或ID集合不一致');
  if(stableHash(original.input['trusted_claims'])!==stableHash(original.context.trustedClaims??[]))throw new DomainError('PREPARED_AI_INPUT_CONFLICT',409,'已保存主张上下文不一致');
  for(const old of original.context.trustedClaims??[]){
    const current=rebuilt.context.trustedClaims?.find(claim=>claim['claim_id']===old['claim_id']);
    if(!current||['claim_id','claim_text','source_version_id','locator','assertion_type','decision_status','decision_evidence_ref','supersedes_claim_id','inference_rationale'].some(field=>stableHash(old[field])!==stableHash(current[field])))throw new DomainError('PREPARED_AI_INPUT_CONFLICT',409,'已保存主张的原文、来源或语义身份不一致');
  }
  const allowedLocators=[...rebuilt.context.locators??[]];
  if((original.context.locators??[]).some(locator=>!allowedLocators.some(current=>stableHash(locator)===stableHash(current))))throw new DomainError('PREPARED_AI_INPUT_CONFLICT',409,'已保存输入包含来源之外的定位');
  for(const master of asRows(original.input['current_business_master'])){
    const row=(await ctx.db.query('SELECT * FROM business_master_versions WHERE org_id=$1 AND category=$2 AND business_key=$3 AND version_no=$4',[ctx.orgId,master['category'],master['business_key'],master['version_no']])).rows[0];
    if(!row||stableHash(master)!==stableHash({category:row['category'],business_key:row['business_key'],name:row['name'],aliases:row['aliases'],status:row['status'],version_no:row['version_no'],payload:row['payload_json']}))throw new DomainError('PREPARED_AI_INPUT_CONFLICT',409,'已保存业务主数据不对应实际不可变版本');
  }
  const masters=asRows(original.input['current_business_master']);
  const businessKeys={industry_key:masters.filter(row=>row['status']==='confirmed'&&row['category']==='industry').map(row=>String(row['business_key'])),product_family_key:masters.filter(row=>row['status']==='confirmed'&&row['category']==='product_family').map(row=>String(row['business_key'])),domain_keys:masters.filter(row=>row['status']==='confirmed'&&row['category']==='business_domain').map(row=>String(row['business_key']))};
  if(stableHash(businessKeys)!==stableHash(original.context.businessKeys))throw new DomainError('PREPARED_AI_INPUT_CONFLICT',409,'已保存业务范围不对应主数据版本');
  if(stableHash(original.input['policy_refs'])!==stableHash(original.context.policyRefs??[]))throw new DomainError('PREPARED_AI_INPUT_CONFLICT',409,'已保存输入与批准规则引用不一致');
  const rules:Row[]=[];
  for(const policy of original.context.policyRefs??[]){const row=(await ctx.db.query('SELECT * FROM policy_versions WHERE org_id=$1 AND id=$2 AND policy_id=$3 AND approved_by IS NOT NULL AND approved_at IS NOT NULL',[ctx.orgId,policy['policy_version_id'],policy['policy_id']])).rows[0];if(!row||row['payload_hash']!==policy['payload_hash'])throw new DomainError('PREPARED_AI_INPUT_CONFLICT',409,'已保存规则未对应负责人批准版本');rules.push({policy_version_id:row['id'],business_scope:row['business_scope'],allowed_actions:row['allowed_actions'],publish_windows:row['publish_windows'],publish_frequency:row['publish_frequency']});}
  if(stableHash(original.input['execution_rules'])!==stableHash(rules))throw new DomainError('PREPARED_AI_INPUT_CONFLICT',409,'已保存执行规则与批准不可变版本不一致');
  const profiles:Row[]=[];
  for(const profile of original.context.accountProfiles??[]){const row=(await ctx.db.query('SELECT v.* FROM platform_profile_versions v JOIN platform_profiles p ON p.org_id=v.org_id AND p.id=v.profile_id WHERE v.org_id=$1 AND v.id=$2 AND p.platform_account_id=$3',[ctx.orgId,profile.platform_profile_version_id,profile.platform_account_id])).rows[0];if(!row||stableHash(row['allowed_formats'])!==stableHash(profile.formats))throw new DomainError('PREPARED_AI_INPUT_CONFLICT',409,'已保存平台档案不对应实际账号版本');profiles.push({platform_account_id:profile.platform_account_id,platform_profile_version_id:row['id'],audience:row['audience'],style_samples:row['style_samples'],allowed_formats:row['allowed_formats'],rules:row['rules_json']});}
  if(stableHash(original.input['account_profiles'])!==stableHash(profiles))throw new DomainError('PREPARED_AI_INPUT_CONFLICT',409,'已保存账号规则与实际不可变版本不一致');
  validateRuntimeEvidenceInput(original);
  builtRequestDigests.set(original,stableHash(original));return original;
}
function assertRunMode(ctx:ServiceContext,result:MarketingAiResult|AiGatewayResult):void {if(result.metadata.mode!==(ctx.mode==='live'?'real':'mock')||result.metadata.simulation!==(ctx.mode==='mock'))throw new DomainError('AI_MODE_MISMATCH',409,'模型运行模式与业务模式不一致');}
async function validateCurrentRequest(ctx:ServiceContext,tx:SqlExecutor,request:MarketingAiRequest):Promise<void> {
  if(builtRequestDigests.get(request)!==stableHash(request))throw new DomainError('AI_INPUT_NOT_SERVICE_BUILT',409,'模型输入须由服务端原文装载器构建且不得改写');
  if(request.context.orgId!==ctx.orgId)throw new DomainError('INVALID_REFERENCE',422,'模型请求跨组织');
  const rows=await loadSources(ctx,tx,request.context.sourceVersions.map(ref=>String(ref['source_version_id'])),true);
  if(stableHash(rows.map(sourceRef))!==stableHash(request.context.sourceVersions))throw new DomainError('SOURCE_INPUT_CONFLICT',409,'模型来源范围与服务端不可变版本不一致');
  if(request.workflow==='content_draft'){
    const topic=request.input['topic'] as Row|null;
    const current=topic&&(await tx.query('SELECT * FROM topics WHERE org_id=$1 AND id=$2',[ctx.orgId,topic['topic_id']])).rows[0];
    if(!current||current['execution_mode']!==ctx.mode||stableHash(current['claim_ids'])!==stableHash(topic?.['claim_ids']))throw new DomainError('TOPIC_INPUT_CONFLICT',409,'生成时的主题证据已变化');
  }
}
async function saveRun(ctx:ServiceContext,tx:SqlExecutor,input:PersistMarketingAiInput):Promise<{id:string;reused:boolean;output:AiOutput}> {
  await requireActiveRole(ctx,tx,'owner','marketer');
  if(input.fence)await assertWorkflowFence(ctx,tx,input.fence,input.workflowRunId);else if(input.workflowRunId&&ctx.actorType==='service'&&ctx.mode==='live')throw new DomainError('WORKFLOW_FENCE_REQUIRED',409,'服务保存模型结果必须绑定当前工作流租约');
  const metadata=sanitizeAiRunMetadata(input.result.metadata,{strict:true});
  assertRunMode(ctx,input.result);await validateCurrentRequest(ctx,tx,input.request);
  validateRuntimeEvidenceInput(input.request);
  const output=validateAiOutput(input.result.output,input.request.context);
  validateRuntimeEvidenceOutput(output,input.request);
  if(output.workflow!==input.request.workflow)throw new DomainError('AI_WORKFLOW_MISMATCH',422,'模型输出与实际流程不一致');
  const requestHash=aiInputHash(input.request);
  if(metadata['input_hash']&&metadata['input_hash']!==requestHash)throw new DomainError('AI_INPUT_HASH_MISMATCH',409,'模型实际调用输入与业务请求摘要不一致');
  const outputHash=aiOutputHash(output);if(metadata['output_hash']!==outputHash)throw new DomainError('AI_OUTPUT_HASH_MISMATCH',409,'模型输出与运行记录摘要不一致');
  const key=stableHash({workflow:input.request.workflow,request:input.request});
  if(input.workflowRunId&&!(await tx.query('SELECT id FROM workflow_runs WHERE org_id=$1 AND id=$2',[ctx.orgId,input.workflowRunId])).rows.length)throw new DomainError('INVALID_REFERENCE',422,'模型运行任务必须来自同组织');
  const usage=metadata['usage'] as Row|undefined;
  const safeCount=(value:unknown)=>typeof value==='number'&&Number.isSafeInteger(value)&&value>=0?value:null;
  const result=await tx.query('INSERT INTO ai_runs(id,org_id,workflow_run_id,provider,model,prompt_version,input_hash,source_ids,output_hash,output_ref,input_tokens,output_tokens,cost_micro,currency,quality_result,latency_ms,workflow_kind,execution_mode,idempotency_key,request_metadata) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20) ON CONFLICT(org_id,execution_mode,workflow_kind,idempotency_key) WHERE idempotency_key IS NOT NULL DO NOTHING RETURNING id',[uuid(),ctx.orgId,input.workflowRunId??null,String(metadata['provider']??(ctx.mode==='mock'?'mock':'unverified_transport')),metadata.model,String(metadata['prompt_version']??'boran-v14-pipeline-v1'),requestHash,input.request.context.sourceVersions.map(ref=>ref['source_version_id']),outputHash,JSON.stringify(output),safeCount(usage?.['input_tokens']??usage?.['prompt_tokens']??metadata['input_tokens']),safeCount(usage?.['output_tokens']??usage?.['completion_tokens']??metadata['output_tokens']),safeCount(metadata['cost_micro']),typeof metadata['currency']==='string'?metadata['currency']:null,JSON.stringify({schema_version:2,schema:'passed',semantic:'passed',mode:ctx.mode,private_candidate:true}),safeCount(metadata['latency_ms']),input.request.workflow,ctx.mode,key,JSON.stringify(metadata)]);
  const row=result.rows[0]??(await tx.query('SELECT id,output_ref FROM ai_runs WHERE org_id=$1 AND execution_mode=$2 AND workflow_kind=$3 AND idempotency_key=$4',[ctx.orgId,ctx.mode,input.request.workflow,key])).rows[0]!;
  return {id:String(row['id']),reused:!result.rows.length,output:result.rows.length?output:row['output_ref'] as AiOutput};
}
async function saveClaims(ctx:ServiceContext,tx:SqlExecutor,runId:string,output:AiOutput):Promise<Map<string,string>> {
  const map=new Map<string,string>();
  for(const claim of output.claims){
    if(claim.claim_id){
      const prior=(await tx.query('SELECT * FROM evidence_claims WHERE org_id=$1 AND id=$2',[ctx.orgId,claim.claim_id])).rows[0];
      if(!prior||prior['execution_mode']&&prior['execution_mode']!==ctx.mode)throw new DomainError('INVALID_REFERENCE',422,'模型引用主张不存在或模式不一致');
      map.set(claim.claim_key,claim.claim_id);continue;
    }
    // A model can propose a fact or decision, never verify it or grant public permission.
    const id=uuid();
    const row=(await tx.query("INSERT INTO evidence_claims(id,org_id,claim_text,source_version_id,locator,verification_status,visibility,public_permission,assertion_type,decision_status,decision_evidence_ref,supersedes_claim_id,content_hash,applicable_scope,ai_run_id,proposal_key,execution_mode) VALUES($1,$2,$3,$4,$5,'unverified','internal','unknown',$6,$7,$8,$9,$10,$11,$12,$13,$14) ON CONFLICT(org_id,ai_run_id,proposal_key) DO NOTHING RETURNING id",[id,ctx.orgId,claim.claim_text,claim.source_version_id,JSON.stringify(claim.locator),claim.assertion_type,claim.decision_status,claim.decision_evidence_ref?JSON.stringify(claim.decision_evidence_ref):null,claim.supersedes_claim_id,stableHash({text:claim.claim_text,sourceVersionId:claim.source_version_id,locator:claim.locator}),JSON.stringify({inference_rationale:claim.inference_rationale}),runId,claim.claim_key,ctx.mode])).rows[0]??(await tx.query('SELECT id FROM evidence_claims WHERE org_id=$1 AND ai_run_id=$2 AND proposal_key=$3',[ctx.orgId,runId,claim.claim_key])).rows[0]!;
    map.set(claim.claim_key,String(row['id']));
    if(claim.assertion_type==='decision'&&['confirmed','revoked'].includes(claim.decision_status??'')&&claim.supersedes_claim_id){
      await tx.query("UPDATE evidence_claims SET verification_status='expired',version=version+1,updated_at=now() WHERE org_id=$1 AND id=$2",[ctx.orgId,claim.supersedes_claim_id]);
      await invalidateDependentTopics(ctx,tx,claim.supersedes_claim_id);
    }

  }
  return map;
}
function privateGaps(claims:Row[],existing:Gap[],at:string):Gap[]{
  const gaps=[...existing];
  for(const claim of claims)if((claim['source_coverage'] as Row)?.['status']!=='complete')gaps.push({kind:'coverage',description:'证据来源的指定读取范围未完整覆盖',reference_key:String(claim['source_version_id']),next_step:'恢复授权或补齐读取范围，保留当前私有候选稿'});
  for(const claim of claims){
    if(claim['verification_status']!=='verified'||claim['decision_status']==='revoked'||claim['decision_status']==='disputed'||claim['superseded']||claim['valid_until']&&Date.parse(String(claim['valid_until']))<=Date.parse(at))gaps.push({kind:'fact',description:'来源提议尚未完成独立事实核实',reference_key:String(claim['id']),next_step:'核对原文并确认事实适用范围'});
    if(claim['public_permission']!=='allowed')gaps.push({kind:'public_permission',description:'该主张未取得公开许可，仅保留于私有候选稿',reference_key:String(claim['id']),next_step:'登记可定位的独立公开许可依据'});
  }
  return [...new Map(gaps.map(gap=>[stableHash(gap),gap])).values()];
}
async function claimsByIds(ctx:ServiceContext,tx:SqlExecutor,ids:string[]):Promise<Row[]> {const claims=(await tx.query("SELECT c.*,d.deleted_at,v.document_id,v.coverage_json AS source_coverage,EXISTS(SELECT 1 FROM evidence_claims successor WHERE successor.org_id=c.org_id AND successor.supersedes_claim_id=c.id AND (successor.decision_status IN ('confirmed','revoked') OR successor.verification_status='verified')) AS superseded FROM evidence_claims c JOIN source_versions v ON v.org_id=c.org_id AND v.id=c.source_version_id JOIN source_documents d ON d.org_id=v.org_id AND d.id=v.document_id WHERE c.org_id=$1 AND c.id=ANY($2::uuid[])",[ctx.orgId,ids])).rows;if(claims.length!==ids.length||claims.some(claim=>claim['deleted_at']||claim['execution_mode']&&claim['execution_mode']!==ctx.mode))throw new DomainError('CLAIM_INPUT_UNAVAILABLE',409,'主张缺失、来源已撤回或模式不一致');return claims;}
function publicationReady(ctx:ServiceContext,claims:Row[]):boolean{return claims.length>0&&claims.every(claim=>claim['verification_status']==='verified'&&claim['public_permission']==='allowed'&&!claim['superseded']&&(claim['source_coverage'] as Row)?.['status']==='complete'&&claim['decision_status']!=='revoked'&&claim['decision_status']!=='disputed'&&(!claim['valid_until']||Date.parse(String(claim['valid_until']))>Date.parse(nowIso(ctx))));}
/** Atomic, deterministic proposal conversion; server assigns all persistent identifiers. */
export async function persistInsightTopics(ctx:ServiceContext,input:PersistMarketingAiInput):Promise<{aiRunId:string;insightIds:string[];topicIds:string[];claimIds:string[];reused:boolean}> {
  requireRole(ctx,'owner','marketer');
  return ctx.db.transaction(async tx=>{
    const run=await saveRun(ctx,tx,input);if(run.output.workflow!=='insight_topics')throw new DomainError('AI_WORKFLOW_MISMATCH',422,'此入口只保存洞察选题');
    if(run.reused){const insightIds=(await tx.query('SELECT id FROM insights WHERE org_id=$1 AND ai_run_id=$2 ORDER BY id',[ctx.orgId,run.id])).rows.map(row=>String(row['id']));const topicIds=(await tx.query('SELECT id FROM topics WHERE org_id=$1 AND ai_run_id=$2 ORDER BY id',[ctx.orgId,run.id])).rows.map(row=>String(row['id']));const claimIds=(await tx.query('SELECT id FROM evidence_claims WHERE org_id=$1 AND ai_run_id=$2 ORDER BY id',[ctx.orgId,run.id])).rows.map(row=>String(row['id']));return {aiRunId:run.id,insightIds,topicIds,claimIds,reused:true};}
    const claimMap=await saveClaims(ctx,tx,run.id,run.output),insightMap=new Map<string,string>(),insightIds:string[]=[],topicIds:string[]=[];
    for(const insight of run.output.output.insights){
      const claimIds=[...new Set(insight.evidence.map(ref=>claimMap.get(ref.claim_key)!))],claims=await claimsByIds(ctx,tx,claimIds),ready=publicationReady(ctx,claims),id=uuid();
      const priority=evaluateQualitativePriority({hardGatesPass:ready,commercialIntent:false,deliverable:false,healthyLanding:false,educational:true});
      await tx.query("INSERT INTO insights(id,org_id,summary,business_line,customer_problem,opportunity,inference_text,priority_score,priority_reason,data_cutoff,state,dedupe_key,priority_label,scoring_mode,ai_run_id,execution_mode,gaps_json,proposal_key) VALUES($1,$2,$3,$4,$5,$6,$7,NULL,$8,$9,$10,$11,$12,'qualitative',$13,$14,$15,$16)",[id,ctx.orgId,insight.summary,insight.business_line,insight.customer_problem,insight.opportunity,insight.inference_text,`${priority.reason}；模型依据：${insight.priority_reason}`,insight.data_cutoff,ready?'ready':'candidate',stableHash({run:run.id,key:insight.proposal_key}),priority.priority,run.id,ctx.mode,JSON.stringify(privateGaps(claims,insight.gaps,nowIso(ctx))),insight.proposal_key]);
      for(const ref of insight.evidence)await tx.query('INSERT INTO insight_evidence(id,org_id,insight_id,claim_id,relation) VALUES($1,$2,$3,$4,$5) ON CONFLICT(org_id,insight_id,claim_id) DO NOTHING',[uuid(),ctx.orgId,id,claimMap.get(ref.claim_key),ref.relation]);
      insightMap.set(insight.proposal_key,id);insightIds.push(id);
    }
    for(const topic of run.output.output.topics){
      const claimIds=[...new Set(topic.claim_keys.map(key=>claimMap.get(key)!))],claims=await claimsByIds(ctx,tx,claimIds),ready=publicationReady(ctx,claims);
      const priority=evaluateQualitativePriority({hardGatesPass:ready,commercialIntent:false,deliverable:false,healthyLanding:false,educational:true});
      const id=uuid();await tx.query('INSERT INTO topics(id,org_id,insight_id,business_line,title,audience,problem,offer,angle,claim_ids,priority,state,dedupe_key,industry_key,product_family_key,domain_keys,execution_mode,ai_run_id,gaps_json,priority_reason,proposal_key) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21)',[id,ctx.orgId,insightMap.get(topic.insight_key),topic.business_line,topic.title,topic.audience,topic.problem,topic.offer,topic.angle,claimIds,Number(priority.priority[1]),ready?'ready':'candidate',stableHash({run:run.id,key:topic.proposal_key}),topic.industry_key,topic.product_family_key,topic.domain_keys,ctx.mode,run.id,JSON.stringify(privateGaps(claims,topic.gaps,nowIso(ctx))),`${priority.reason}；模型依据：${topic.priority_reason}`,topic.proposal_key]);
      topicIds.push(id);await emitOutbox(ctx,tx,'topic.recommended',id,{topicId:id,aiRunId:run.id,sourceVersionIds:run.output.source_versions.map(ref=>ref.source_version_id),mode:ctx.mode,state:ready?'ready':'candidate'});
    }
    await audit(ctx,tx,'marketing.insights.persisted','ai_run',run.id,{insightCount:insightIds.length,topicCount:topicIds.length,mode:ctx.mode});
    return {aiRunId:run.id,insightIds,topicIds,claimIds:[...claimMap.values()],reused:false};
  });
}
export interface PrivateDraftBody {schema:'boran.private-draft.v1';title:string;topic_id:string;body_blocks:{type:'paragraph'|'bullet'|'heading';text:string}[];claim_refs:{block_index:number;claim_id:string}[];cta:{label:string;href:string;action:'navigate'|'scroll_to_form'|'contact'}|null;gaps:Gap[];warnings:string[];origin:'ai'|'manual';parent_version_id:string|null}
export interface PrivateDraftView {id:string;topicId:string;contentVersionId:string;version:number;title:string;bodyBlocks:PrivateDraftBody['body_blocks'];claimRefs:{blockIndex:number;claimId:string}[];cta:PrivateDraftBody['cta'];gaps:Gap[];warnings:string[];aiRunId:string|null;sourceVersionIds:string[];mode:'mock'|'live';payloadHash:string;state:'private_candidate';origin:'ai'|'manual';parentVersionId:string|null}
function draftView(row:Row):PrivateDraftView {const body=row['body_json'] as PrivateDraftBody;return {id:String(row['content_item_id']),topicId:body.topic_id,contentVersionId:String(row['id']),version:Number(row['version_no']),title:body.title,bodyBlocks:body.body_blocks,claimRefs:body.claim_refs.map(ref=>({blockIndex:ref.block_index,claimId:ref.claim_id})),cta:body.cta,gaps:body.gaps,warnings:body.warnings,aiRunId:row['ai_run_id'] as string|null,sourceVersionIds:row['source_version_ids'] as string[],mode:row['execution_mode'] as 'mock'|'live',payloadHash:String(row['payload_hash']),state:'private_candidate',origin:body.origin,parentVersionId:body.parent_version_id};}
function validateDraftBody(body:PrivateDraftBody):void {
  bounded(body.title,300,'草稿标题');if(!Array.isArray(body.body_blocks)||!body.body_blocks.length||body.body_blocks.length>60)throw new DomainError('INVALID_DRAFT',422,'草稿须有1至60个正文段落');
  for(const block of body.body_blocks){if(!['paragraph','bullet','heading'].includes(block.type))throw new DomainError('INVALID_DRAFT',422,'正文段落类型无效');bounded(block.text,12000,'草稿正文');}
  if(body.claim_refs.some(ref=>!Number.isInteger(ref.block_index)||ref.block_index<0||ref.block_index>=body.body_blocks.length))throw new DomainError('INVALID_DRAFT',422,'草稿逐段证据引用越界');
  if(body.cta){bounded(body.cta.label,200,'CTA');let url:URL;try{url=new URL(body.cta.href,'https://private.invalid');}catch{throw new DomainError('INVALID_DRAFT',422,'CTA地址无效');}if(!['https:','http:'].includes(url.protocol)||url.username||url.password||body.cta.href.startsWith('//'))throw new DomainError('INVALID_DRAFT',422,'私有草稿CTA地址不安全');}
}
export async function persistPrivateDraft(ctx:ServiceContext,input:PersistMarketingAiInput):Promise<{aiRunId:string;contentItemId:string;contentVersionId:string;version:number;reused:boolean}> {
  requireRole(ctx,'owner','marketer');return ctx.db.transaction(async tx=>{
    const run=await saveRun(ctx,tx,input);if(run.output.workflow!=='content_draft')throw new DomainError('AI_WORKFLOW_MISMATCH',422,'此入口只保存私有草稿');
    const versionKey=stableHash({runId:run.id,mode:ctx.mode});
    const existing=(await tx.query('SELECT * FROM content_versions WHERE org_id=$1 AND generation_key=$2',[ctx.orgId,versionKey])).rows[0];if(existing)return {aiRunId:run.id,contentItemId:String(existing['content_item_id']),contentVersionId:String(existing['id']),version:Number(existing['version_no']),reused:true};
    const output=run.output.output,claimMap=await saveClaims(ctx,tx,run.id,run.output),claimIds=[...new Set([...output.claim_refs.map(ref=>ref.claim_id),...output.source_claim_keys.map(key=>claimMap.get(key)!)])];
    const claims=await claimsByIds(ctx,tx,claimIds);const topic=(await tx.query('SELECT * FROM topics WHERE org_id=$1 AND id=$2 FOR UPDATE',[ctx.orgId,output.topic_id])).rows[0];if(!topic||topic['execution_mode']!==ctx.mode)throw new DomainError('TOPIC_NOT_AVAILABLE',404,'草稿主题不存在或模式不一致');
    // Source-document lineage links automatic revisions, while every manual version remains immutable.
    const documents=[...new Set(claims.length?claims.map(claim=>claim['document_id']):input.request.context.sourceVersions.map(ref=>ref['document_id']))].sort();
    const generationKey=stableHash({documents,businessLine:topic['business_line'],title:normalized(String(topic['title'])),problem:normalized(String(topic['problem']))});
    const created=(await tx.query("INSERT INTO content_items(id,org_id,kind,business_line,owner_user_id,title,topic_id,execution_mode,generation_key) VALUES($1,$2,'mother_draft',$3,$4,$5,$6,$7,$8) ON CONFLICT(org_id,execution_mode,generation_key) WHERE generation_key IS NOT NULL DO NOTHING RETURNING id",[uuid(),ctx.orgId,topic['business_line'],ctx.actorId,output.title,output.topic_id,ctx.mode,generationKey])).rows[0];
    const item=created??(await tx.query('SELECT id FROM content_items WHERE org_id=$1 AND execution_mode=$2 AND generation_key=$3 AND deleted_at IS NULL FOR UPDATE',[ctx.orgId,ctx.mode,generationKey])).rows[0];if(!item)throw new DomainError('CONTENT_ARCHIVED',409,'相同来源草稿已归档，须由负责人恢复');
    await tx.query('SELECT id FROM content_items WHERE org_id=$1 AND id=$2 FOR UPDATE',[ctx.orgId,item['id']]);
    const prior=(await tx.query('SELECT id,version_no FROM content_versions WHERE org_id=$1 AND content_item_id=$2 ORDER BY version_no DESC LIMIT 1',[ctx.orgId,item['id']])).rows[0];
    const refs=[...output.claim_refs];
    // Newly proposed draft claims have no UUID on the wire. Preserve their paragraph locator mapping.
    for(const key of output.source_claim_keys){const claim=run.output.claims.find(value=>value.claim_key===key);if(!claim)continue;const matching=output.body_blocks.map((block,index)=>normalized(block.text).includes(normalized(claim.claim_text))?index:-1).filter(index=>index>=0);for(const index of matching)refs.push({block_index:index,claim_id:claimMap.get(key)!});}
    const body:PrivateDraftBody={schema:'boran.private-draft.v1',title:output.title,topic_id:output.topic_id,body_blocks:output.body_blocks,claim_refs:[...new Map(refs.map(ref=>[`${ref.block_index}:${ref.claim_id}`,ref])).values()],cta:output.cta,gaps:privateGaps(claims,[...output.gaps,...(input.request.input['cta_configured']?[]:[{kind:'other' as const,description:'CTA为私有候选占位，正式入口尚未校准',reference_key:null,next_step:'使用已确认的实际承接页替换CTA并独立验证'}])],nowIso(ctx)),warnings:[...new Set([...output.warnings,'私有候选草稿；事实核实、公开许可和发布审核需独立通过'])],origin:'ai',parent_version_id:prior?String(prior['id']):null};validateDraftBody(body);
    const id=uuid(),version=Number(prior?.['version_no']??0)+1;
    await tx.query("INSERT INTO content_versions(id,org_id,content_item_id,version_no,body_json,claim_ids,payload_hash,review_status,ai_run_id,warnings,draft_state,source_version_ids,generation_key) VALUES($1,$2,$3,$4,$5,$6,$7,'draft',$8,$9,'private_candidate',$10,$11)",[id,ctx.orgId,item['id'],version,JSON.stringify(body),claimIds,stableHash(body),run.id,JSON.stringify(body.warnings),run.output.source_versions.map(source=>source.source_version_id),versionKey]);
    await audit(ctx,tx,'content.private_candidate.created','content_version',id,{topicId:output.topic_id,aiRunId:run.id,mode:ctx.mode,version});await emitOutbox(ctx,tx,'content.private_draft.created',String(item['id']),{contentItemId:item['id'],contentVersionId:id,topicId:output.topic_id,mode:ctx.mode});
    return {aiRunId:run.id,contentItemId:String(item['id']),contentVersionId:id,version,reused:false};
  });
}
export async function listPrivateDrafts(ctx:ServiceContext,filters:{topicId?:string;limit?:number}={}):Promise<PrivateDraftView[]> {
  await activeRoles(ctx);const limit=filters.limit??100;if(!Number.isInteger(limit)||limit<1||limit>500)throw new DomainError('INVALID_LIMIT',422,'草稿数量须为1至500');
  const rows=(await ctx.db.query("SELECT v.*,i.execution_mode FROM content_versions v JOIN content_items i ON i.org_id=v.org_id AND i.id=v.content_item_id WHERE v.org_id=$1 AND i.execution_mode=$2 AND i.deleted_at IS NULL AND v.draft_state='private_candidate' AND v.version_no=(SELECT max(latest.version_no) FROM content_versions latest WHERE latest.org_id=v.org_id AND latest.content_item_id=v.content_item_id) AND ($3::text IS NULL OR v.body_json->>'topic_id'=$3) ORDER BY v.created_at DESC,v.id LIMIT $4",[ctx.orgId,ctx.mode,filters.topicId??null,limit])).rows;return rows.map(draftView);
}
export async function getPrivateDraft(ctx:ServiceContext,id:string):Promise<PrivateDraftView> {
  await activeRoles(ctx);const row=(await ctx.db.query("SELECT v.*,i.execution_mode FROM content_versions v JOIN content_items i ON i.org_id=v.org_id AND i.id=v.content_item_id WHERE v.org_id=$1 AND i.id=$2 AND i.execution_mode=$3 AND i.deleted_at IS NULL AND v.draft_state='private_candidate' ORDER BY v.version_no DESC LIMIT 1",[ctx.orgId,id,ctx.mode])).rows[0];if(!row)throw new DomainError('NOT_FOUND',404,'私有候选草稿不存在');return draftView(row);
}
export interface EditPrivateDraftInput {expectedVersion:number;title:string;bodyBlocks:PrivateDraftBody['body_blocks'];claimRefs?:{blockIndex:number;claimId:string}[];cta?:PrivateDraftBody['cta'];warnings?:string[];gaps?:Gap[]}
export async function editPrivateDraft(ctx:ServiceContext,id:string,input:EditPrivateDraftInput):Promise<PrivateDraftView> {
  requireRole(ctx,'owner','marketer');return ctx.db.transaction(async tx=>{
    await requireActiveRole(ctx,tx,'owner','marketer');const item=(await tx.query('SELECT * FROM content_items WHERE org_id=$1 AND id=$2 AND execution_mode=$3 AND deleted_at IS NULL FOR UPDATE',[ctx.orgId,id,ctx.mode])).rows[0];if(!item)throw new DomainError('NOT_FOUND',404,'私有候选草稿不存在');
    const prior=(await tx.query("SELECT * FROM content_versions WHERE org_id=$1 AND content_item_id=$2 AND draft_state='private_candidate' ORDER BY version_no DESC LIMIT 1",[ctx.orgId,id])).rows[0];if(!prior)throw new DomainError('NOT_FOUND',404,'私有候选草稿不存在');assertVersion(Number(prior['version_no']),input.expectedVersion);
    const old=prior['body_json'] as PrivateDraftBody,refs=input.claimRefs?input.claimRefs.map(ref=>({block_index:ref.blockIndex,claim_id:ref.claimId})):old.claim_refs,claimIds=[...new Set(refs.map(ref=>ref.claim_id))],claims=await claimsByIds(ctx,tx,claimIds);
    const body:PrivateDraftBody={...old,title:input.title,body_blocks:input.bodyBlocks,claim_refs:refs,cta:input.cta===undefined?old.cta:input.cta,gaps:privateGaps(claims,[...(input.gaps??old.gaps),{kind:'fact',description:'人工编辑版本需独立核对修改内容及证据',reference_key:String(prior['id']),next_step:'核对改写文本、数值和承诺后另建可公开的验证版本'}],nowIso(ctx)),warnings:input.warnings??old.warnings,origin:'manual',parent_version_id:String(prior['id'])};validateDraftBody(body);
    const versionId=uuid();const row=(await tx.query("INSERT INTO content_versions(id,org_id,content_item_id,version_no,body_json,claim_ids,payload_hash,review_status,ai_run_id,warnings,draft_state,source_version_ids) VALUES($1,$2,$3,$4,$5,$6,$7,'draft',$8,$9,'private_candidate',$10) RETURNING *",[versionId,ctx.orgId,id,input.expectedVersion+1,JSON.stringify(body),claimIds,stableHash(body),prior['ai_run_id'],JSON.stringify(body.warnings),prior['source_version_ids']])).rows[0]!;
    await audit(ctx,tx,'content.private_candidate.edited','content_version',versionId,{parentVersionId:prior['id'],mode:ctx.mode});return draftView({...row,execution_mode:ctx.mode});
  });
}
export async function listMarketingAiRuns(ctx:ServiceContext,limit=100):Promise<Row[]> {await activeRoles(ctx);if(!Number.isInteger(limit)||limit<1||limit>500)throw new DomainError('INVALID_LIMIT',422,'模型运行数量须为1至500');return (await ctx.db.query('SELECT id,workflow_run_id,workflow_kind,provider,model,prompt_version,input_hash,source_ids,output_hash,input_tokens,output_tokens,cost_micro,currency,quality_result,latency_ms,execution_mode,request_metadata,created_at FROM ai_runs WHERE org_id=$1 AND execution_mode=$2 ORDER BY created_at DESC,id LIMIT $3',[ctx.orgId,ctx.mode,limit])).rows;}
