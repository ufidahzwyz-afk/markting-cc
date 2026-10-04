import {createAiGateway} from '@boran/ai';
import {activeRoles,requireActiveRole} from '@boran/domain/authz';
import {DomainError, audit, stableHash, type ServiceContext} from '@boran/domain/core';
import {getBusinessMaster,ingestSourceRead} from '@boran/domain/marketing';
import {createReportSnapshot} from '@boran/domain/reporting';
import {getAdMetrics} from '@boran/domain/ads';
import {type SourceReadRequest} from '@boran/connectors/sources';
import {SourceObjectStore} from '@boran/connectors/source-content';
import {createConfiguredSourceReaders} from './automation-runtime';
import {executeMarketingWorkflow} from './marketing-workflow';
import {processReceptionFollowup} from '@boran/domain/reception';
import {registerHandler, registeredHandlers, type WorkflowHandler} from './runner';
import type {Database} from '@boran/db';

async function context(db:Database,orgId:string,runId:string,stepMode?:string):Promise<ServiceContext>{
  const run=(await db.query('SELECT input_ref FROM workflow_runs WHERE org_id=$1 AND id=$2',[orgId,runId])).rows[0];
  const input=(run?.input_ref??{}) as Record<string,unknown>;
  const actorId=String(input.requested_by??input.actor_id??'');
  if(!actorId)throw new DomainError('WORKFLOW_ACTOR_MISSING',409,'工作流缺少请求成员');
  if(stepMode&&stepMode!=='mock'&&process.env.BORAN_MODE!=='live')throw new DomainError('WORKFLOW_MODE_MISMATCH',409,'真实任务需要真实服务部署');
  const ctx:ServiceContext={db,orgId,actorId,roles:[],actorType:'service',mode:stepMode==='mock'?'mock':process.env.BORAN_MODE==='live'?'live':'mock'};
  ctx.roles=await activeRoles(ctx);
  await requireActiveRole(ctx,db,'owner','marketer');
  return ctx;
}
const derive:WorkflowHandler=async({db,claim})=>{
  const ctx=await context(db,claim.orgId,claim.runId,claim.mode);
  if(ctx.mode==='live'){
    if(claim.stepKey==='draft_plan')throw new DomainError('WEEKLY_PLANNING_NOT_CONNECTED',503,'周计划仍需接通真实选题排序与排期，当前可先生成私有洞察及草稿');
    return executeMarketingWorkflow(ctx,claim,'insight_topics');
  }

  const master=await getBusinessMaster(ctx);
  const workflow=claim.stepKey==='draft_plan'?'weekly_plan':'insight_topics';
  const cutoff=typeof claim.input.data_cutoff==='string'?claim.input.data_cutoff:new Date().toISOString();
  let result:Awaited<ReturnType<ReturnType<typeof createAiGateway>['generate']>>;
  const started=Date.now(),inputHash=stableHash(claim.input),promptVersion=`boran.${workflow}.v2`;
  try {
    if(ctx.mode!=='mock'||claim.mode!=='mock')throw new DomainError('AI_NOT_CONFIGURED',503,'真实模型网关尚未接通');
    result=await createAiGateway({aiMode:'mock'}).generate({workflow,input:claim.input,context:{orgId:ctx.orgId,sourceVersions:[],dataCutoff:cutoff,businessKeys:{industry_key:master.filter(row=>row.category==='industry').map(row=>row.businessKey),product_family_key:master.filter(row=>row.category==='product_family').map(row=>row.businessKey),domain_keys:master.filter(row=>row.category==='business_domain').map(row=>row.businessKey)}}});
  }catch(error){
    const code=error instanceof DomainError?error.code:'AI_VALIDATION_FAILED';
    await db.query('INSERT INTO ai_runs(org_id,workflow_run_id,provider,model,prompt_version,input_hash,source_ids,quality_result,latency_ms) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9)',[ctx.orgId,claim.runId,ctx.mode==='mock'?'mock':'unconfigured',ctx.mode==='mock'?'boran-mock-v2':'unconfigured',promptVersion,inputHash,claim.input.source_version_ids??[],JSON.stringify({validated:false,code,simulation:ctx.mode==='mock'}),Date.now()-started]);
    throw error;
  }
  const aiRun=(await db.query('INSERT INTO ai_runs(org_id,workflow_run_id,provider,model,prompt_version,input_hash,source_ids,output_hash,output_ref,quality_result,latency_ms) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) RETURNING id',[ctx.orgId,claim.runId,'mock',result.metadata.model,promptVersion,inputHash,claim.input.source_version_ids??[],result.metadata.output_hash,JSON.stringify(result.output),JSON.stringify({schema_valid:true,semantic_valid:true,simulation:true}),Date.now()-started])).rows[0]!;

  let planId:string|undefined;
  if(workflow==='weekly_plan'){
    const week=String(claim.input.week_start??'');
    if(!/^\d{4}-\d{2}-\d{2}$/.test(week))throw new DomainError('INVALID_PLAN_DATE',422,'周计划日期无效');
    planId=await db.transaction(async tx=>{
      await tx.query('SELECT id FROM organizations WHERE id=$1 FOR UPDATE',[ctx.orgId]);
      const existing=(await tx.query('SELECT id FROM plan_cycles WHERE org_id=$1 AND generated_by_run_id=$2',[ctx.orgId,claim.runId])).rows[0];
      if(existing)return String(existing.id);
      const revision=Number((await tx.query('SELECT COALESCE(max(revision),0)+1 AS revision FROM plan_cycles WHERE org_id=$1 AND week_start=$2',[ctx.orgId,week])).rows[0]!.revision);
      const row=(await tx.query("INSERT INTO plan_cycles(org_id,week_start,revision,goal_ids,status,assumptions,source_snapshot,generated_by_run_id) VALUES($1,$2,$3,$4,'draft',$5,$6,$7) RETURNING id",[ctx.orgId,week,revision,claim.input.goal_ids??[],JSON.stringify({simulation:true,assumptions:['模拟模型输出'],evidence_gaps:['尚未接入真实来源，不生成执行任务']}),JSON.stringify({mock:true,source_versions:[]}),claim.runId])).rows[0]!;
      await audit(ctx,tx,'plan.draft_generated','plan_cycle',String(row.id),{simulation:true,realIntegrationAccepted:false});
      return String(row.id);
    });
  }
  return {output:{mock:true,simulation:true,real_integration_accepted:false,ai_run_id:aiRun.id,...(planId?{plan_cycle_id:planId}:{}),ai:result.output,metadata:result.metadata}};
};
export function registerDomainHandlers(){
  for(const key of ['derive_insights','draft_plan'])if(!registeredHandlers().includes(key))registerHandler(key,derive,{modes:['mock','read_only']});
  if(!registeredHandlers().includes('content_generate'))registerHandler('content_generate',async({db,claim})=>{
    const ctx=await context(db,claim.orgId,claim.runId,claim.mode);
    if(ctx.mode==='mock')throw new DomainError('CONTENT_GENERATION_GATEWAY_NOT_CONFIGURED',503,'模拟流程不生成冒充真实业务的草稿');
    return executeMarketingWorkflow(ctx,claim,'content_draft');
  },{modes:['mock','read_only']});
  if(!registeredHandlers().includes('source_sync'))registerHandler('source_sync',async({db,claim})=>{
    const ctx=await context(db,claim.orgId,claim.runId,claim.mode);
    const connection=(await db.query('SELECT * FROM connections WHERE org_id=$1 AND id=$2',[ctx.orgId,claim.input.connection_id])).rows[0];
    if(!connection||connection.access_status==='disabled')throw new DomainError('SOURCE_NOT_CONFIGURED',503,'来源连接不存在或已停用');
    if((connection.read_mode==='mock')!==(ctx.mode==='mock'))throw new DomainError('SOURCE_MODE_MISMATCH',409,'当前任务不能改写历史来源的模式');
    const kind=connection.source_kind as SourceReadRequest['sourceKind'];
    if(!['market_public','competitor_public','mac_drive','chatgpt'].includes(kind))throw new DomainError('SOURCE_KIND_INVALID',422,'此连接不是授权来源');
    const stored=(connection.scope_json??{}) as Record<string,unknown>;
    const list=(key:string)=>Array.isArray(stored[key])?(stored[key] as unknown[]).filter((value):value is string=>typeof value==='string'):[];
    const scopes:SourceReadRequest['scope']={urls:list('urls'),fileIds:list('file_ids'),folderIds:list('folder_ids'),conversationIds:list('conversation_ids'),projectIds:list('project_ids')};
    const readers=await createConfiguredSourceReaders(ctx,{workflowRunId:claim.runId});
    const result=await readers[kind].read({orgId:ctx.orgId,connectionId:String(connection.id),sourceKind:kind,scope:scopes,cursor:connection.cursor,...(typeof connection.secret_ref==='string'?{credentialRef:connection.secret_ref}:{})});
    const store=ctx.mode==='live'&&process.env.BORAN_SOURCE_ROOT?new SourceObjectStore(process.env.BORAN_SOURCE_ROOT):undefined;
    await ingestSourceRead(ctx,{connectionId:String(connection.id),workflowFence:{stepId:claim.stepId,runId:claim.runId,leaseOwner:claim.workerId,fencingToken:claim.token},expectedCursorHash:stableHash(connection.cursor??null),expectedConfigurationHash:stableHash({scope:connection.scope_json,readMode:connection.read_mode,secretRef:connection.secret_ref??null}),result,...(store?{verifySnapshot:async(snapshot:import('@boran/connectors/sources').SourceSnapshot)=>{await store.readBytes({orgId:ctx.orgId,connectionId:String(connection.id),objectKey:snapshot.objectKey,expectedHash:snapshot.contentHash});if(snapshot.textObjectKey&&snapshot.textHash)await store.readText({orgId:ctx.orgId,connectionId:String(connection.id),objectKey:snapshot.textObjectKey,expectedHash:snapshot.textHash});}}:{})});
    return {output:{mock:ctx.mode==='mock',mode:ctx.mode,source_result:result.status,gaps:result.gaps,...(result.status==='failed'?{error_code:result.errorCode}:{})},sourceResult:result.status};
  },{modes:['mock','read_only']});
  for(const key of ['metrics_collect','metrics_snapshot','daily_report'])if(!registeredHandlers().includes(key))registerHandler(key,async({db,claim})=>{
    const ctx=await context(db,claim.orgId,claim.runId,claim.mode);const start=String(claim.input.period_start),end=String(claim.input.period_end);
    if(key==='metrics_collect')throw new DomainError('LIVE_METRICS_COLLECTOR_NOT_CONFIGURED',503,'实际推广指标读取器尚未配置');
    if(key==='metrics_snapshot'){const metrics=await getAdMetrics(ctx,{start,end});return {output:{mock:ctx.mode==='mock',mode:ctx.mode,external_collection:false,metrics,quality_snapshot:true}};}
    const report=await createReportSnapshot(ctx,{kind:'daily',start,end});return {output:{mock:ctx.mode==='mock',mode:ctx.mode,report,in_app_report:'persisted',external_notifications:'not_configured',drive_archive:'not_configured'}};
  },{modes:['mock','read_only']});
  for(const key of ['archive_reports','seo_review','geo_review'])if(!registeredHandlers().includes(key))registerHandler(key,async()=>{throw new DomainError('CONNECTOR_NOT_CONFIGURED',503,'真实读取、通知或归档适配器尚未配置');},{modes:['mock','read_only']});
}
/** Durable ten-second timers; conversation generation and authorization are rechecked by the domain. */
export async function processReceptionTimers(db:Database,orgId?:string,mode:'mock'|'live'=process.env.BORAN_MODE==='live'?'live':'mock'){
  const events=(await db.query("SELECT id,org_id,payload FROM outbox_events WHERE event_type='reception.silent_followup' AND dispatched_at IS NULL AND next_attempt_at<=now() AND ($1::uuid IS NULL OR org_id=$1) AND payload->>'synthetic'=$2 ORDER BY next_attempt_at LIMIT 20",[orgId??null,mode==='mock'?'true':'false'])).rows;
  for(const event of events){
    try{
      const owner=(await db.query("SELECT m.user_id,m.roles FROM memberships m JOIN users u ON u.id=m.user_id WHERE m.org_id=$1 AND m.active AND u.active AND 'owner'=ANY(m.roles) ORDER BY m.created_at LIMIT 1",[event.org_id])).rows[0];
      if(!owner)continue;
      const ctx:ServiceContext={db,orgId:String(event.org_id),actorId:String(owner.user_id),actorType:'service',roles:owner.roles as string[],mode};
      await processReceptionFollowup(ctx,String(event.id));
    }catch(error){
      const code=error instanceof DomainError?error.code:'FOLLOWUP_PROCESSING_FAILED';
      await db.query("UPDATE outbox_events SET attempts=attempts+1,next_attempt_at=now()+interval '30 seconds',payload=payload||$1::jsonb WHERE id=$2 AND dispatched_at IS NULL",[JSON.stringify({processing_error:code}),event.id]);
    }
  }
}

export async function markUnconfiguredPrivacyRequests(db:Database,orgId?:string){
  // Withdrawal/cancellation was applied atomically at intake. Erasure/export completion still needs downstream receipts.
  await db.transaction(async tx=>{
    const runs=(await tx.query("SELECT id,org_id FROM workflow_runs WHERE kind='privacy_request' AND status='queued' AND ($1::uuid IS NULL OR org_id=$1) ORDER BY created_at FOR UPDATE SKIP LOCKED LIMIT 20",[orgId??null])).rows;
    for(const run of runs){
      await tx.query("UPDATE workflow_runs SET status='needs_human',error=$3,updated_at=now() WHERE org_id=$1 AND id=$2",[run.org_id,run.id,JSON.stringify({code:'PRIVACY_DOWNSTREAM_ADAPTER_NOT_CONFIGURED',missing:['downstream_privacy_receipts']})]);
      await tx.query("INSERT INTO audit_logs(org_id,actor_type,actor_id,action,target_type,target_id,request_id,details) VALUES($1,'service','persistent-worker','privacy.downstream_missing','workflow_run',$2,gen_random_uuid()::text,$3)",[run.org_id,run.id,JSON.stringify({code:'PRIVACY_DOWNSTREAM_ADAPTER_NOT_CONFIGURED'})]);
    }
  });
}
