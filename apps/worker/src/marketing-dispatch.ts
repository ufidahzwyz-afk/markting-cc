import {DEMO_ORG_ID,type Database,type SqlExecutor} from '@boran/db';
import {DomainError,stableHash,uuid,type ServiceContext} from '@boran/domain/core';
import {SourceObjectStore} from '@boran/connectors/sources';
import {getRuntimeModelConfiguration} from './automation-runtime';
import {scheduleRun} from './queue';

type Row=Record<string,unknown>;
const uuidPattern=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const sourceKinds=['market_public','competitor_public','mac_drive','chatgpt'];
function transactionDatabase(tx:SqlExecutor):Database{return {query:tx.query.bind(tx),transaction:async fn=>fn(tx),close:async()=>undefined};}
export function marketingDeploymentOrg():string {
 const configured=process.env.BORAN_ORG_ID;
 if(configured&&uuidPattern.test(configured))return configured;
 if(!configured&&process.env.BORAN_MODE==='mock'&&['development','test'].includes(process.env.APP_ENV??''))return DEMO_ORG_ID;
 throw new DomainError('WORKER_ORGANIZATION_NOT_CONFIGURED',503,'来源编排需要部署配置中的固定组织');
}
export function sourceDerivationPeriod(connectionId:string,sourceVersionIds:string[]):string {return `source:${stableHash({connectionId,sourceVersionIds:[...sourceVersionIds].sort()}).slice(0,53)}`;}
function canonicalUrl(value:unknown):string|null {try{const url=new URL(String(value));if(!['http:','https:'].includes(url.protocol)||url.username||url.password)return null;url.hash='';return url.toString();}catch{return null;}}
export function marketingSourceInScope(connection:Row,version:Row):boolean {
 const scope=(connection['scope_json']??{}) as Row,coverage=(version['coverage_json']??{}) as Row,kind=String(connection['source_kind']);
 const ids=(key:string)=>Array.isArray(scope[key])?scope[key] as unknown[]:[];
 if(kind==='mac_drive')return ids('file_ids').includes(version['provider_file_id'])||Array.isArray(coverage['folder_ids'])&&Array.isArray(coverage['ancestor_folder_ids'])&&(coverage['folder_ids'] as unknown[]).some(root=>ids('folder_ids').includes(root)&&(coverage['ancestor_folder_ids'] as unknown[]).includes(root));
 if(kind==='chatgpt')return ids('conversation_ids').includes(version['conversation_id'])||ids('project_ids').includes(coverage['project_id'])&&typeof coverage['project_id']==='string';
 const url=canonicalUrl(version['source_url']??version['provider_file_id']);return url!==null&&ids('urls').some(allowed=>canonicalUrl(allowed)===url);
}
async function actor(tx:SqlExecutor,orgId:string,originRunId?:unknown):Promise<Row|undefined> {
 if(typeof originRunId==='string'&&uuidPattern.test(originRunId)){const original=(await tx.query("SELECT m.user_id,m.roles FROM workflow_runs r JOIN memberships m ON m.org_id=r.org_id AND m.user_id::text=r.input_ref->>'requested_by' JOIN users u ON u.id=m.user_id WHERE r.org_id=$1 AND r.id=$2 AND m.active AND u.active AND ('owner'=ANY(m.roles) OR 'marketer'=ANY(m.roles))",[orgId,originRunId])).rows[0];if(original)return original;}
 const configured=(await tx.query("SELECT value FROM settings WHERE org_id=$1 AND key='operating_schedule'",[orgId])).rows[0]?.['value'] as Row|undefined;
 const requested=typeof configured?.['requested_by']==='string'&&uuidPattern.test(configured['requested_by'])?configured['requested_by']:null;
 return (await tx.query("SELECT m.user_id,m.roles FROM memberships m JOIN users u ON u.id=m.user_id WHERE m.org_id=$1 AND m.active AND u.active AND 'owner'=ANY(m.roles) ORDER BY CASE WHEN m.user_id=$2::uuid THEN 0 ELSE 1 END,m.user_id LIMIT 1",[orgId,requested])).rows[0];
}
async function modelAvailable(tx:SqlExecutor,orgId:string,mode:'mock'|'live',member:Row|undefined):Promise<boolean> {
 if(mode==='mock')return process.env.AI_MODE==='mock';if(!member)return false;
 const ctx:ServiceContext={db:transactionDatabase(tx),orgId,actorId:String(member['user_id']),roles:member['roles'] as string[],mode,actorType:'service'};
 try{return (await getRuntimeModelConfiguration(ctx)).readiness.configured;}catch{return false;}
}
async function finish(tx:SqlExecutor,orgId:string,event:Row,run:Row,gaps:string[],input:Row,stepKey:string):Promise<void> {
 const step=(await tx.query('SELECT attempts,output_ref FROM workflow_steps WHERE org_id=$1 AND run_id=$2 AND step_key=$3',[orgId,run['id'],stepKey])).rows[0];
 const safe=step&&Number(step['attempts'])===0&&!Object.prototype.hasOwnProperty.call((step['output_ref']??{}) as Row,'_ai_execution');
 if(safe&&gaps.length&&(run['status']==='queued'||run['status']==='needs_human'&&(run['error'] as Row|undefined)?.['code']==='MARKETING_DERIVATION_NEEDS_HUMAN')){
   const error={code:'MARKETING_DERIVATION_NEEDS_HUMAN',missing:[...new Set(gaps)],source_event_id:event['id']};
   await tx.query("UPDATE workflow_runs SET status='needs_human',error=$3,updated_at=now() WHERE org_id=$1 AND id=$2",[orgId,run['id'],JSON.stringify(error)]);
   await tx.query("UPDATE workflow_steps SET state='needs_human',error=$3,updated_at=now() WHERE org_id=$1 AND run_id=$2 AND state IN('queued','needs_human')",[orgId,run['id'],JSON.stringify(error)]);
 }
 await tx.query("INSERT INTO audit_logs(id,org_id,actor_type,actor_id,action,target_type,target_id,request_id,details) VALUES($1,$2,'service','marketing-dispatch','marketing.event_dispatched','workflow_run',$3,$4,$5)",[uuid(),orgId,run['id'],uuid(),JSON.stringify({event_type:event['event_type'],needs_human:gaps.length>0,missing:[...new Set(gaps)]})]);
}
async function resumeConfiguredPrivateRuns(tx:SqlExecutor,orgId:string):Promise<number> {
 const root=process.env.BORAN_SOURCE_ROOT??process.env.BORAN_SOURCE_STORE_ROOT;if(!root?.startsWith('/'))return 0;
 const store=new SourceObjectStore(root),runs=(await tx.query("SELECT r.id,r.input_ref,r.error,s.id AS step_id,s.input_ref AS step_input,s.output_ref FROM workflow_runs r JOIN workflow_steps s ON s.org_id=r.org_id AND s.run_id=r.id WHERE r.org_id=$1 AND r.kind IN('insight_topics','platform_assets') AND r.status='needs_human' AND r.error->>'code'='MARKETING_DERIVATION_NEEDS_HUMAN' AND s.state='needs_human' AND s.step_key IN('derive_insights','content_generate') AND s.execution_mode='read_only' AND NOT s.external_write AND s.attempts=0 AND NOT (COALESCE(s.output_ref,'{}'::jsonb) ? '_ai_execution') AND NOT EXISTS(SELECT 1 FROM ai_runs a WHERE a.org_id=r.org_id AND a.workflow_run_id=r.id) AND EXISTS(SELECT 1 FROM memberships m JOIN users u ON u.id=m.user_id WHERE m.org_id=r.org_id AND m.user_id::text=r.input_ref->>'requested_by' AND m.active AND u.active AND ('owner'=ANY(m.roles) OR 'marketer'=ANY(m.roles))) AND NOT EXISTS(SELECT 1 FROM jsonb_array_elements_text(CASE WHEN jsonb_typeof(r.input_ref->'source_version_ids')='array' THEN r.input_ref->'source_version_ids' ELSE '[]'::jsonb END) ref LEFT JOIN source_versions v ON v.org_id=r.org_id AND v.id::text=ref.value LEFT JOIN source_documents d ON d.org_id=v.org_id AND d.id=v.document_id LEFT JOIN connections c ON c.org_id=d.org_id AND c.id=d.connection_id WHERE v.id IS NULL OR v.execution_mode IS DISTINCT FROM 'live' OR d.current_version_id IS DISTINCT FROM v.id OR d.deleted_at IS NOT NULL OR c.read_mode='mock' OR c.health='disabled' OR c.access_status IS DISTINCT FROM 'connected') ORDER BY r.created_at,r.id FOR UPDATE OF r,s SKIP LOCKED LIMIT 50",[orgId])).rows;let resumed=0;
 for(const run of runs){
  const missing=(run['error'] as Row)?.['missing'];if(!Array.isArray(missing)||missing.length!==1||missing[0]!=='AI_NOT_CONFIGURED')continue;
  const input=(run['input_ref']??{}) as Row,stepInput=(run['step_input']??{}) as Row,actorId=input['requested_by'];
  if(typeof actorId!=='string'||!uuidPattern.test(actorId)||stepInput['requested_by']!==actorId)continue;
  const member=(await tx.query("SELECT m.user_id,m.roles FROM memberships m JOIN users u ON u.id=m.user_id WHERE m.org_id=$1 AND m.user_id=$2 AND m.active AND u.active AND ('owner'=ANY(m.roles) OR 'marketer'=ANY(m.roles))",[orgId,actorId])).rows[0];if(!member||!await modelAvailable(tx,orgId,'live',member))continue;
  const ids=input['source_version_ids'];if(!Array.isArray(ids)||!ids.length||ids.length>200||ids.some(id=>typeof id!=='string'||!uuidPattern.test(id))||stableHash(ids)!==stableHash(stepInput['source_version_ids']??null))continue;
  const versions=(await tx.query('SELECT v.id,v.execution_mode,v.coverage_json,v.object_key,v.content_hash,v.text_object_key,v.text_hash,v.extraction_status,d.current_version_id,d.deleted_at,d.connection_id,d.source_url,d.provider_file_id,d.conversation_id,c.source_kind,c.read_mode,c.access_status,c.capabilities_verified_at,c.scope_json,c.health FROM source_versions v JOIN source_documents d ON d.org_id=v.org_id AND d.id=v.document_id JOIN connections c ON c.org_id=d.org_id AND c.id=d.connection_id WHERE v.org_id=$1 AND v.id=ANY($2::uuid[])',[orgId,ids])).rows;
  if(versions.length!==ids.length||versions.some(version=>{const coverage=(version['coverage_json']??{}) as Row;return version['execution_mode']!=='live'||version['current_version_id']!==version['id']||version['deleted_at']||version['read_mode']==='mock'||version['health']==='disabled'||version['access_status']!=='connected'||!version['capabilities_verified_at']||!sourceKinds.includes(String(version['source_kind']))||!marketingSourceInScope(version,version)||coverage['status']!=='complete'||Array.isArray(coverage['gaps'])&&coverage['gaps'].length>0||version['extraction_status']!=='ready'||!version['text_object_key']||!version['text_hash'];}))continue;
  if(typeof input['topic_id']==='string'){const topic=(await tx.query("SELECT t.id FROM topics t JOIN ai_runs a ON a.org_id=t.org_id AND a.id=t.ai_run_id WHERE t.org_id=$1 AND t.id=$2 AND t.execution_mode='live' AND a.execution_mode='live'",[orgId,input['topic_id']])).rows[0];if(!topic)continue;}
  try{for(const version of versions){await store.readText({orgId,connectionId:String(version['connection_id']),objectKey:String(version['text_object_key']),expectedHash:String(version['text_hash'])});await store.readBytes({orgId,connectionId:String(version['connection_id']),objectKey:String(version['object_key']),expectedHash:String(version['content_hash'])});}}catch{continue;}
  await tx.query("UPDATE workflow_runs SET status='queued',error=NULL,updated_at=now() WHERE org_id=$1 AND id=$2 AND status='needs_human'",[orgId,run['id']]);await tx.query("UPDATE workflow_steps SET state='queued',error=NULL,updated_at=now() WHERE org_id=$1 AND id=$2 AND state='needs_human' AND attempts=0",[orgId,run['step_id']]);
  await tx.query("INSERT INTO audit_logs(id,org_id,actor_type,actor_id,action,target_type,target_id,request_id,details) VALUES($1,$2,'service','marketing-dispatch','marketing.private_resumed','workflow_run',$3,$4,$5)",[uuid(),orgId,run['id'],uuid(),JSON.stringify({mode:'live',source_version_ids:ids,reason:'configuration_available_before_first_model_attempt'})]);resumed++;
 }return resumed;
}
export async function queueCurrentSourceInsight(db:Database,input:{orgId:string;mode:'mock'|'live';connectionId:string;sourceVersionIds:string[];actorId:string;roles:string[];dataCutoff:string;generationGaps?:string[];policyVersionId?:string}):Promise<Row> {
 return db.transaction(async tx=>{
  const member={user_id:input.actorId,roles:input.roles},gaps=await modelAvailable(tx,input.orgId,input.mode,member)?[]:['AI_NOT_CONFIGURED'];
  const payload:Row={requested_by:input.actorId,connection_id:input.connectionId,source_version_ids:input.sourceVersionIds,data_cutoff:input.dataCutoff,generation_gaps:input.generationGaps??[],...(input.policyVersionId?{policy_version_id:input.policyVersionId}:{})};
  const run=await scheduleRun(transactionDatabase(tx),{orgId:input.orgId,kind:'insight_topics',periodKey:sourceDerivationPeriod(input.connectionId,input.sourceVersionIds),input:payload,steps:[{key:'derive_insights',mode:input.mode==='mock'?'mock':'read_only',input:payload}]});
  await finish(tx,input.orgId,{id:input.sourceVersionIds[0],event_type:'source.periodic_recovery'},run,gaps,payload,'derive_insights');return run;
 });
}

/** Fixed deployment organization and DB references determine scope, actor and mode; event payloads grant no authority. */
export async function dispatchMarketing(db:Database):Promise<number> {
 const orgId=marketingDeploymentOrg(),mode=process.env.BORAN_MODE==='mock'?'mock':'live';
 return db.transaction(async tx=>{
  await tx.query('SELECT id FROM organizations WHERE id=$1 FOR UPDATE',[orgId]);
  if(mode==='live')await resumeConfiguredPrivateRuns(tx,orgId);
  // Legacy simulations remain pending for their own worker, rather than starving or being relabeled by a live worker.
  const events=(await tx.query("SELECT e.* FROM outbox_events e WHERE e.org_id=$1 AND e.event_type IN('source.changed','topic.recommended') AND e.dispatched_at IS NULL AND e.next_attempt_at<=now() AND ((e.event_type='source.changed' AND (NOT EXISTS(SELECT 1 FROM connections c WHERE c.org_id=e.org_id AND c.id=e.aggregate_id) OR EXISTS(SELECT 1 FROM connections c WHERE c.org_id=e.org_id AND c.id=e.aggregate_id AND (c.read_mode='mock')=$2))) OR (e.event_type='topic.recommended' AND (NOT EXISTS(SELECT 1 FROM topics t WHERE t.org_id=e.org_id AND t.id=e.aggregate_id) OR EXISTS(SELECT 1 FROM topics t WHERE t.org_id=e.org_id AND t.id=e.aggregate_id AND t.execution_mode=$3)))) ORDER BY e.created_at,e.id FOR UPDATE OF e SKIP LOCKED LIMIT 50",[orgId,mode==='mock',mode])).rows;
  for(const event of events){
   const payload=(event['payload']??{}) as Row;
   if(event['event_type']==='topic.recommended'){
    const topicId=String(event['aggregate_id']),topic=uuidPattern.test(topicId)?(await tx.query('SELECT t.*,r.workflow_run_id,r.execution_mode AS ai_execution_mode FROM topics t LEFT JOIN ai_runs r ON r.org_id=t.org_id AND r.id=t.ai_run_id WHERE t.org_id=$1 AND t.id=$2',[orgId,topicId])).rows[0]:undefined;
    const member=await actor(tx,orgId,topic?.['workflow_run_id']),gaps:string[]=[],claimIds=Array.isArray(topic?.['claim_ids'])?topic['claim_ids'] as string[]:[];
    const versions=claimIds.length?(await tx.query('SELECT DISTINCT v.id,v.execution_mode,v.coverage_json,d.current_version_id,d.deleted_at,d.connection_id,d.source_url,d.provider_file_id,d.conversation_id,c.source_kind,c.read_mode,c.access_status,c.capabilities_verified_at,c.scope_json,c.health FROM evidence_claims e JOIN source_versions v ON v.org_id=e.org_id AND v.id=e.source_version_id JOIN source_documents d ON d.org_id=v.org_id AND d.id=v.document_id JOIN connections c ON c.org_id=d.org_id AND c.id=d.connection_id WHERE e.org_id=$1 AND e.id=ANY($2::uuid[])',[orgId,claimIds])).rows:[];
    if(!member)gaps.push('WORKFLOW_ACTOR_MISSING');if(!topic||topic['execution_mode']!==mode||topic['ai_execution_mode']!==mode)gaps.push('TOPIC_REFERENCE_INVALID');if(!versions.length)gaps.push('SOURCE_REFERENCE_INVALID');
    if(versions.some(version=>version['execution_mode']!==mode||version['deleted_at']||version['current_version_id']!==version['id']))gaps.push('SOURCE_VERSION_NOT_CURRENT');
    if(mode==='live'&&versions.some(version=>version['read_mode']==='mock'||version['health']==='disabled'||version['access_status']!=='connected'||!version['capabilities_verified_at']||!marketingSourceInScope(version,version)))gaps.push('SOURCE_SCOPE_REVOKED');
    if(!(await modelAvailable(tx,orgId,mode,member)))gaps.push('AI_NOT_CONFIGURED');
    const sourceIds=versions.filter(version=>version['execution_mode']===mode&&!version['deleted_at']).map(version=>String(version['id'])).sort();
    const input:Row={requested_by:member?String(member['user_id']):null,...(topic?{topic_id:topicId}:{}),source_version_ids:sourceIds,data_cutoff:new Date().toISOString()};
    const periodKey=`draft:${stableHash({topicId,aiRunId:topic?.['ai_run_id']??null,...(!topic?{invalidEvent:event['id']}:{})}).slice(0,54)}`;
    const run=await scheduleRun(transactionDatabase(tx),{orgId,kind:'platform_assets',periodKey,input,steps:[{key:'content_generate',mode:mode==='mock'?'mock':'read_only',input}]});await finish(tx,orgId,event,run,gaps,input,'content_generate');
   }else {
    const rawIds=payload['sourceVersionIds'],validIds=Array.isArray(rawIds)&&rawIds.length>0&&rawIds.length<=5000&&rawIds.every(id=>typeof id==='string'&&uuidPattern.test(id))&&new Set(rawIds).size===rawIds.length;
    const sourceIds=validIds?[...(rawIds as string[])].sort():[],connectionId=String(event['aggregate_id']);
    const connection=uuidPattern.test(connectionId)?(await tx.query('SELECT source_kind,read_mode,access_status,capabilities_verified_at,scope_json,health FROM connections WHERE org_id=$1 AND id=$2',[orgId,connectionId])).rows[0]:undefined;
    const versions=sourceIds.length?(await tx.query('SELECT v.id,v.execution_mode,v.coverage_json,v.source_modified_at,v.retrieved_at,d.current_version_id,d.deleted_at,d.connection_id,d.source_url,d.provider_file_id,d.conversation_id FROM source_versions v JOIN source_documents d ON d.org_id=v.org_id AND d.id=v.document_id WHERE v.org_id=$1 AND v.id=ANY($2::uuid[])',[orgId,sourceIds])).rows:[];
    const member=await actor(tx,orgId),sharedGaps:string[]=[];
    if(!member)sharedGaps.push('WORKFLOW_ACTOR_MISSING');if(!validIds||versions.length!==sourceIds.length||!connection)sharedGaps.push('SOURCE_REFERENCE_INVALID');
    if(!connection||!sourceKinds.includes(String(connection['source_kind'])))sharedGaps.push('SOURCE_KIND_INVALID');
    if(connection&&(connection['health']==='disabled'||connection['access_status']==='disabled'||(mode==='live'?(connection['read_mode']==='mock'||connection['access_status']!=='connected'||!connection['capabilities_verified_at']):connection['read_mode']!=='mock')))sharedGaps.push('SOURCE_ACCESS_NOT_VERIFIED');
    const config=(await tx.query("SELECT value FROM settings WHERE org_id=$1 AND key='operating_schedule'",[orgId])).rows[0]?.['value'] as Row|undefined;
    const selectedPolicy=typeof config?.['policy_version_id']==='string'&&uuidPattern.test(config['policy_version_id'])?config['policy_version_id']:null;
    const policies=(await tx.query("SELECT v.id FROM policy_versions v JOIN execution_policies p ON p.org_id=v.org_id AND p.id=v.policy_id JOIN memberships m ON m.org_id=v.org_id AND m.user_id=v.approved_by JOIN users u ON u.id=m.user_id WHERE v.org_id=$1 AND p.status='active' AND p.active_version_id=v.id AND v.approved_at IS NOT NULL AND v.valid_from<=now() AND (v.valid_until IS NULL OR v.valid_until>now()) AND m.active AND u.active AND 'owner'=ANY(m.roles) AND ($2::uuid IS NULL OR v.id=$2) ORDER BY v.id",[orgId,selectedPolicy])).rows;
    const policy=policies.length===1?policies[0]:undefined,policyGap=policy?null:policies.length>1?'POLICY_SELECTION_REQUIRED':'POLICY_NOT_ACTIVE';
    if(mode==='mock'&&policyGap)sharedGaps.push(policyGap);if(!(await modelAvailable(tx,orgId,mode,member)))sharedGaps.push('AI_NOT_CONFIGURED');
    // A large Drive inventory is analyzed per immutable file; no evidence is silently truncated to fit a model call.
    const batches=validIds?sourceIds.map(id=>[id]):[[]];
    for(const batch of batches){
     const current=versions.filter(version=>batch.includes(String(version['id']))),gaps=[...sharedGaps];
     if(current.some(version=>version['connection_id']!==connectionId||version['current_version_id']!==version['id']||version['deleted_at']||version['execution_mode']!==mode))gaps.push('SOURCE_VERSION_NOT_CURRENT');
     if(mode==='live'&&connection&&current.some(version=>!marketingSourceInScope(connection,version)))gaps.push('SOURCE_SCOPE_REVOKED');
     if(current.some(version=>{const coverage=(version['coverage_json']??{}) as Row;return coverage['status']!=='complete'||Array.isArray(coverage['gaps'])&&coverage['gaps'].length>0;})||mode==='mock'&&Array.isArray(payload['gaps'])&&payload['gaps'].length>0)gaps.push('SOURCE_COVERAGE_INCOMPLETE');
     const trustedIds=current.filter(version=>version['connection_id']===connectionId&&version['current_version_id']===version['id']&&!version['deleted_at']&&version['execution_mode']===mode).map(version=>String(version['id'])).sort();
     const cutoff=current[0]?.['source_modified_at']??current[0]?.['retrieved_at'],dataCutoff=cutoff&&Number.isFinite(Date.parse(String(cutoff)))?new Date(String(cutoff)).toISOString():new Date().toISOString();
     const input:Row={requested_by:member?String(member['user_id']):null,source_version_ids:trustedIds,...(connection?{connection_id:connectionId}:{}),data_cutoff:dataCutoff,...(policy?{policy_version_id:policy['id']}:{}),generation_gaps:[...(mode==='live'&&policyGap?[policyGap]:[]),...(mode==='live'&&Array.isArray(payload['gaps'])?payload['gaps']:[])]};
     const modeConflict=current.some(version=>version['execution_mode']!==mode);
     const periodKey=validIds&&!modeConflict?sourceDerivationPeriod(connectionId,batch):`source:${stableHash({invalidEventId:event['id'],mode}).slice(0,53)}`;
     const run=await scheduleRun(transactionDatabase(tx),{orgId,kind:'insight_topics',periodKey,input,steps:[{key:'derive_insights',mode:mode==='mock'?'mock':'read_only',input}]});await finish(tx,orgId,event,run,gaps,input,'derive_insights');
    }
   }
   await tx.query('UPDATE outbox_events SET dispatched_at=now(),attempts=attempts+1 WHERE org_id=$1 AND id=$2',[orgId,event['id']]);
  }
  return events.length;
 });
}
