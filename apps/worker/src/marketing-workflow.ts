import type {Database} from '@boran/db';
import {aiInputHash,AiProviderError,sanitizeAiRunMetadata,validateAiRunReceipt,type AiGateway, type AiGatewayResult} from '@boran/ai';
import {SourceObjectStore} from '@boran/connectors/source-content';
import {DomainError, stableHash, type ServiceContext} from '@boran/domain/core';
import {buildMarketingAiRequest, restorePreparedMarketingAiRequest, persistInsightTopics, persistPrivateDraft, type MarketingAiRequest, type MarketingSourceTextRef} from '@boran/domain/pipeline';
import {createConfiguredAiGateway} from './automation-runtime';
import {LeaseError, type StepClaim} from './queue';

type Row=Record<string,unknown>;
export interface MarketingWorkflowDependencies {
  gateway?:(ctx:ServiceContext)=>Promise<AiGateway>;
  loadText?:(key:string,source:MarketingSourceTextRef)=>Promise<string>;
  now?:()=>Date;
}
function loader(ctx:ServiceContext,dependency?:MarketingWorkflowDependencies['loadText']) {
  if(dependency)return dependency;
  if(!process.env.BORAN_SOURCE_ROOT)throw new DomainError('SOURCE_STORAGE_NOT_CONFIGURED',503,'私有来源存储尚未配置');
  const store=new SourceObjectStore(process.env.BORAN_SOURCE_ROOT);
  return (key:string,source:MarketingSourceTextRef)=>store.readText({orgId:ctx.orgId,connectionId:source.connectionId,objectKey:key,expectedHash:source.textHash});
}
async function fencedStep(db:Database,claim:StepClaim):Promise<Row> {
  const row=(await db.query("SELECT input_ref,output_ref FROM workflow_steps WHERE org_id=$1 AND id=$2 AND run_id=$3 AND state='running' AND lease_owner=$4 AND fencing_token=$5 AND lease_until>now()",[claim.orgId,claim.stepId,claim.runId,claim.workerId,claim.token])).rows[0];
  if(!row)throw new LeaseError('Stale worker cannot perform a model call');return row;
}
async function saveFenced(db:Database,claim:StepClaim,column:'input_ref'|'output_ref',value:Row) {
  const result=await db.query(`UPDATE workflow_steps SET ${column}=$6,updated_at=now() WHERE org_id=$1 AND id=$2 AND run_id=$3 AND state='running' AND lease_owner=$4 AND fencing_token=$5 AND lease_until>now()`,[claim.orgId,claim.stepId,claim.runId,claim.workerId,claim.token,JSON.stringify(value)]);
  if(result.rowCount!==1)throw new LeaseError('Stale worker cannot persist a model receipt');
}
function errorCode(error:unknown) {const code=error&&typeof error==='object'&&'code' in error?String(error.code):'';return /^[A-Z][A-Z0-9_]{0,99}$/.test(code)?code:'AI_PROVIDER_FAILED';}
function safeDelay(error:unknown):{limit_kind:'minute'|'day';retry_after:string}|undefined {
  if(errorCode(error)!=='AI_CALL_LIMIT'||!error||typeof error!=='object'||!('details' in error)||!error.details||typeof error.details!=='object')return;
  const details=error.details as Row,metadata=details.metadata as Row|undefined;
  if(details.safe_not_submitted!==true||!metadata||!Array.isArray(metadata.attempts)||metadata.attempts.length!==0||!['minute','day'].includes(String(details.limit_kind))||typeof details.retry_after!=='string')return;
  const time=Date.parse(details.retry_after);if(!Number.isFinite(time)||new Date(time).toISOString()!==details.retry_after||time>Date.now()+86400000+60000)return;
  return {limit_kind:details.limit_kind as 'minute'|'day',retry_after:details.retry_after};
}
async function markCalling(ctx:ServiceContext,claim:StepClaim,request:MarketingAiRequest,requestHash:string){
  await ctx.db.transaction(async tx=>{
    const fence=(await tx.query("SELECT id FROM workflow_steps WHERE org_id=$1 AND id=$2 AND run_id=$3 AND state='running' AND lease_owner=$4 AND fencing_token=$5 AND lease_until>now() FOR UPDATE",[ctx.orgId,claim.stepId,claim.runId,claim.workerId,claim.token])).rows[0];
    if(!fence)throw new LeaseError('Stale worker cannot prepare a paid model call');
    // Historical evidence may be retained in context. The changed inputs initiating this unpaid task must still be current.
    const ids=Array.isArray(request.input.changed_source_version_ids)?request.input.changed_source_version_ids.map(String):request.context.sourceVersions.map(ref=>ref.source_version_id);
    const versions=(await tx.query('SELECT v.id,d.current_version_id,d.deleted_at FROM source_versions v JOIN source_documents d ON d.org_id=v.org_id AND d.id=v.document_id WHERE v.org_id=$1 AND v.id=ANY($2::uuid[]) FOR SHARE OF d',[ctx.orgId,ids])).rows;
    if(new Set(versions.map(row=>String(row.id))).size!==new Set(ids).size||versions.some(row=>row.deleted_at||row.current_version_id!==row.id))throw new DomainError('AI_SOURCE_INPUT_SUPERSEDED',409,'来源已有新版本；旧任务尚未付费，等待最新资料任务');
    await tx.query("UPDATE workflow_steps SET output_ref=$6,updated_at=now() WHERE org_id=$1 AND id=$2 AND run_id=$3 AND state='running' AND lease_owner=$4 AND fencing_token=$5 AND lease_until>now()",[ctx.orgId,claim.stepId,claim.runId,claim.workerId,claim.token,JSON.stringify({_ai_execution:{status:'calling',request_hash:requestHash,started_at:new Date().toISOString()}})]);
  });
}
async function recordFailure(ctx:ServiceContext,claim:StepClaim,request:MarketingAiRequest,error:unknown) {
  const details=error&&typeof error==='object'&&'details' in error?(error.details as Row):{};
  const metadata=sanitizeAiRunMetadata(details?.metadata??{});
  const code=errorCode(error),key=`failed:${claim.stepId}:${claim.token}`;
  // Persist classified usage and provider IDs only. Request bodies, credentials and raw provider errors stay out of audit records.
  const count=(value:unknown)=>typeof value==='number'&&Number.isSafeInteger(value)&&value>=0?value:null;
  const usage=(metadata.usage??{}) as Row;
  await ctx.db.transaction(async tx=>{
    const fence=(await tx.query("SELECT id FROM workflow_steps WHERE org_id=$1 AND id=$2 AND run_id=$3 AND state='running' AND lease_owner=$4 AND fencing_token=$5 AND lease_until>now() FOR UPDATE",[ctx.orgId,claim.stepId,claim.runId,claim.workerId,claim.token])).rows[0];
    if(!fence)throw new LeaseError('Stale worker cannot persist a failure audit');
    await tx.query("INSERT INTO ai_runs(org_id,workflow_run_id,provider,model,prompt_version,input_hash,source_ids,input_tokens,output_tokens,cost_micro,currency,quality_result,latency_ms,workflow_kind,execution_mode,idempotency_key,request_metadata) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17) ON CONFLICT(org_id,execution_mode,workflow_kind,idempotency_key) WHERE idempotency_key IS NOT NULL DO NOTHING",[ctx.orgId,claim.runId,metadata.provider??'unconfigured',metadata.model??'unconfigured',metadata.prompt_version??`boran.${request.workflow}.v2`,aiInputHash(request),request.context.sourceVersions.map(ref=>ref.source_version_id),count(usage.input_tokens),count(usage.output_tokens),count(metadata.cost_micro),typeof metadata.currency==='string'?metadata.currency:null,JSON.stringify({validated:false,code,simulation:ctx.mode==='mock'}),count(metadata.latency_ms),request.workflow,ctx.mode,key,JSON.stringify(metadata)]);
  });
}

/** Freeze the service-built request and the paid response before business conversion. A lost receipt never triggers a blind second call. */
export async function executeMarketingWorkflow(ctx:ServiceContext,claim:StepClaim,workflow:MarketingAiRequest['workflow'],dependencies:MarketingWorkflowDependencies={}) {
  if(ctx.mode!=='live'||claim.mode!=='read_only')throw new DomainError('AI_MODE_MISMATCH',409,'真实营销自动化需要独立真实任务');
  const loadText=loader(ctx,dependencies.loadText),step=await fencedStep(ctx.db,claim),storedInput=(step.input_ref??{}) as Row;
  const prepared=storedInput._prepared_ai as {request?:MarketingAiRequest;request_hash?:string;mode?:string}|undefined;
  let request:MarketingAiRequest;
  if(prepared){
    if(prepared.mode!==ctx.mode||!prepared.request||prepared.request_hash!==stableHash(prepared.request)||prepared.request.workflow!==workflow)throw new DomainError('AI_PREPARED_INPUT_INVALID',409,'持久模型请求与任务不一致');
    request=await restorePreparedMarketingAiRequest(ctx,prepared.request,{loadText});
  }else{
    const sourceVersionIds=Array.isArray(claim.input.source_version_ids)?claim.input.source_version_ids.map(String):undefined;
    const topicId=typeof claim.input.topic_id==='string'?claim.input.topic_id:undefined;
    request=await buildMarketingAiRequest(ctx,{workflow,...(sourceVersionIds?{sourceVersionIds}:{}),...(topicId?{topicId}:{}),...(typeof claim.input.data_cutoff==='string'?{dataCutoff:claim.input.data_cutoff}:{}),loadText});
    await saveFenced(ctx.db,claim,'input_ref',{...storedInput,_prepared_ai:{schema_version:1,mode:ctx.mode,request_hash:stableHash(request),request}});
  }
  const output=(step.output_ref??{}) as Row,execution=output._ai_execution as {status?:string;request_hash?:string;result?:AiGatewayResult;code?:string}|undefined;
  const requestHash=stableHash(request);let result:AiGatewayResult;
  if(execution?.status==='received'){
    if(execution.request_hash!==requestHash||!execution.result)throw new DomainError('AI_RECEIPT_INPUT_MISMATCH',409,'模型回执与冻结原文不一致');
    result=validateAiRunReceipt(request,execution.result);
  }else{
    if(execution?.status==='calling')throw new DomainError('AI_CALL_RESULT_UNKNOWN',409,'上次模型调用缺少回执；需要核对用量，禁止自动重复付费');
    if(execution?.status==='failed')throw new DomainError(execution.code??'AI_CALL_FAILED',503,'原模型调用已失败，请处理对应配置或质量缺口');
    if(execution?.status==='safe_not_submitted'){
      const delayed=execution as Row;
      if(delayed.request_hash!==requestHash||!['minute','day'].includes(String(delayed.limit_kind))||typeof delayed.retry_after!=='string'||!Number.isFinite(Date.parse(delayed.retry_after)))throw new DomainError('AI_PREPARED_INPUT_INVALID',409,'未提交模型任务的延迟证据无效');
      if(Date.parse(delayed.retry_after)>(dependencies.now?.()??new Date()).getTime())throw new AiProviderError('AI_CALL_LIMIT','等待模型调用配额恢复',{safe_not_submitted:true,limit_kind:delayed.limit_kind,retry_after:delayed.retry_after,metadata:{attempts:[]}});
    }
    const gateway=await (dependencies.gateway??createConfiguredAiGateway)(ctx);
    // Construction and authorization failures occur before this marker; only a potentially paid call leaves an unknown result.
    await markCalling(ctx,claim,request,requestHash);
    try{
      result=await gateway.generate(request);
      result=validateAiRunReceipt(request,result);
      await saveFenced(ctx.db,claim,'output_ref',{_ai_execution:{status:'received',request_hash:requestHash,result}});
    }catch(error){
      // If the lease was lost after the provider replied, the original calling marker remains for reconciliation.
      if(error instanceof LeaseError)throw error;
      const delayed=safeDelay(error);
      if(delayed){await saveFenced(ctx.db,claim,'output_ref',{_ai_execution:{status:'safe_not_submitted',request_hash:requestHash,code:'AI_CALL_LIMIT',...delayed}});throw error;}
      await saveFenced(ctx.db,claim,'output_ref',{_ai_execution:{status:'failed',request_hash:requestHash,code:errorCode(error)}});
      await recordFailure(ctx,claim,request,error);throw error;
    }
  }
  await fencedStep(ctx.db,claim);
  const input={workflowRunId:claim.runId,request,result,fence:{stepId:claim.stepId,leaseOwner:claim.workerId,fencingToken:claim.token}};
  const saved=workflow==='insight_topics'?await persistInsightTopics(ctx,input):await persistPrivateDraft(ctx,input);
  return {output:{mock:false,mode:'live',simulation:false,real_integration_accepted:false,workflow,...saved,source_version_ids:request.context.sourceVersions.map(ref=>ref.source_version_id),_ai_execution:{status:'received',request_hash:requestHash,result},external_execution_authorized:false}};
}
