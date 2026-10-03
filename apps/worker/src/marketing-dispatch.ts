import {DEMO_ORG_ID,type Database,type SqlExecutor} from '@boran/db';
import {DomainError,stableHash,uuid} from '@boran/domain/core';
import {scheduleRun} from './queue';

type Row=Record<string,unknown>;
const uuidPattern=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
function transactionDatabase(tx:SqlExecutor):Database{return {query:tx.query.bind(tx),transaction:async fn=>fn(tx),close:async()=>undefined};}
function deploymentOrg():string{
 const configured=process.env.BORAN_ORG_ID;
 if(configured&&uuidPattern.test(configured))return configured;
 if(!configured&&process.env.BORAN_MODE==='mock'&&['development','test'].includes(process.env.APP_ENV??''))return DEMO_ORG_ID;
 throw new DomainError('WORKER_ORGANIZATION_NOT_CONFIGURED',503,'来源编排需要部署配置中的固定组织');
}

/** Consumes only fixed-deployment-org source events. Payloads cannot supply actors, transports or authority. */
export async function dispatchMarketing(db:Database):Promise<number>{
 const orgId=deploymentOrg();const mode=process.env.BORAN_MODE==='mock'?'mock':'live';
 return db.transaction(async tx=>{
  await tx.query('SELECT id FROM organizations WHERE id=$1 FOR UPDATE',[orgId]);
  const events=(await tx.query("SELECT * FROM outbox_events WHERE org_id=$1 AND event_type='source.changed' AND dispatched_at IS NULL AND next_attempt_at<=now() ORDER BY created_at,id FOR UPDATE SKIP LOCKED LIMIT 50",[orgId])).rows;
  for(const event of events){
   const payload=(event['payload']??{}) as Row;const rawIds=payload['sourceVersionIds'];
   const validIds=Array.isArray(rawIds)&&rawIds.length>0&&rawIds.length<=500&&rawIds.every(id=>typeof id==='string'&&uuidPattern.test(id))&&new Set(rawIds).size===rawIds.length;
   const sourceIds=validIds?[...(rawIds as string[])].sort():[];const connectionId=String(event['aggregate_id']);
   const connection=(await tx.query('SELECT source_kind,read_mode,access_status,capabilities_verified_at,scope_json FROM connections WHERE org_id=$1 AND id=$2',[orgId,connectionId])).rows[0];
   const versions=sourceIds.length?(await tx.query('SELECT v.id,v.coverage_json,d.current_version_id,d.deleted_at,d.connection_id,d.source_url,d.provider_file_id,d.conversation_id FROM source_versions v JOIN source_documents d ON d.org_id=v.org_id AND d.id=v.document_id WHERE v.org_id=$1 AND v.id=ANY($2::uuid[])',[orgId,sourceIds])).rows:[];
   const member=(await tx.query("SELECT m.user_id,m.roles FROM memberships m JOIN users u ON u.id=m.user_id WHERE m.org_id=$1 AND m.active AND u.active AND ('owner'=ANY(m.roles) OR 'marketer'=ANY(m.roles)) ORDER BY CASE WHEN 'owner'=ANY(m.roles) THEN 0 ELSE 1 END,m.user_id LIMIT 1",[orgId])).rows[0];
   const config=(await tx.query("SELECT value FROM settings WHERE org_id=$1 AND key='operating_schedule'",[orgId])).rows[0]?.['value'] as Row|undefined;
   const selectedPolicy=typeof config?.['policy_version_id']==='string'&&uuidPattern.test(config['policy_version_id'])?config['policy_version_id']:null;
   const policies=(await tx.query("SELECT v.id,v.approved_by FROM policy_versions v JOIN execution_policies p ON p.org_id=v.org_id AND p.id=v.policy_id JOIN memberships m ON m.org_id=v.org_id AND m.user_id=v.approved_by JOIN users u ON u.id=m.user_id WHERE v.org_id=$1 AND p.status='active' AND p.active_version_id=v.id AND v.approved_at IS NOT NULL AND v.valid_from<=now() AND (v.valid_until IS NULL OR v.valid_until>now()) AND m.active AND u.active AND 'owner'=ANY(m.roles) AND ($2::uuid IS NULL OR v.id=$2) ORDER BY v.id",[orgId,selectedPolicy])).rows;
   const policy=policies.length===1?policies[0]:undefined;
   const gaps:string[]=[];
   if(!member)gaps.push('WORKFLOW_ACTOR_MISSING');
   if(!validIds||versions.length!==sourceIds.length||!connection)gaps.push('SOURCE_REFERENCE_INVALID');
   if(versions.some(version=>version['connection_id']!==connectionId||version['current_version_id']!==version['id']||version['deleted_at']))gaps.push('SOURCE_VERSION_NOT_CURRENT');
   if(!connection||!['market_public','competitor_public','mac_drive','chatgpt'].includes(String(connection['source_kind'])))gaps.push('SOURCE_KIND_INVALID');
   if(connection&&(mode==='live'?(connection['read_mode']==='mock'||connection['access_status']!=='connected'||!connection['capabilities_verified_at']):connection['read_mode']!=='mock'))gaps.push('SOURCE_ACCESS_NOT_VERIFIED');
   if(mode==='live'&&connection&&versions.some(version=>{
    const scope=(connection['scope_json']??{}) as Row;const coverage=(version['coverage_json']??{}) as Row;const kind=String(connection['source_kind']);
    const key=kind==='chatgpt'?'conversation_ids':kind==='mac_drive'?'file_ids':'urls';const identity=kind==='chatgpt'?version['conversation_id']:kind==='mac_drive'?version['provider_file_id']:version['source_url']??version['provider_file_id'];
    const project=kind==='chatgpt'&&Array.isArray(scope['project_ids'])&&(scope['project_ids'] as unknown[]).includes(coverage['project_id']);
    return !project&&(!Array.isArray(scope[key])||!(scope[key] as unknown[]).includes(identity));
   }))gaps.push('SOURCE_SCOPE_REVOKED');
   if(versions.some(version=>{const coverage=version['coverage_json'] as Row;return coverage['status']!=='complete'||Array.isArray(coverage['gaps'])&&coverage['gaps'].length>0;})||Array.isArray(payload['gaps'])&&payload['gaps'].length>0)gaps.push('SOURCE_COVERAGE_INCOMPLETE');
   if(!policy)gaps.push(policies.length>1?'POLICY_SELECTION_REQUIRED':'POLICY_NOT_ACTIVE');
   // Only the explicitly simulated local workflow has a gateway. There is no provider fallback.
   if(mode==='live'||process.env.AI_MODE!=='mock')gaps.push('AI_NOT_CONFIGURED');
   const actorId=member?String(member['user_id']):null;
   const trustedSourceIds=versions.filter(version=>version['connection_id']===connectionId&&version['current_version_id']===version['id']&&!version['deleted_at']).map(version=>String(version['id'])).sort();
   const input={requested_by:actorId,source_version_ids:trustedSourceIds,connection_id:connectionId,data_cutoff:new Date().toISOString(),...(policy?{policy_version_id:policy['id']}:{})};
   // Identity is independent of event ids, policy revisions and render time: a repeated source revision schedules once.
   const periodKey=`source:${stableHash({connectionId,sourceVersionIds:sourceIds,...(!validIds?{invalidEventId:event['id']}:{})}).slice(0,53)}`;
   // Missing connection references stay in the error record, never in the scheduler's trusted input references.
   if(!connection)delete (input as Row)['connection_id'];
   const run=await scheduleRun(transactionDatabase(tx),{orgId,kind:'insight_topics',periodKey,input,steps:[{key:'derive_insights',mode:mode==='mock'?'mock':'read_only',input}]});
   if(gaps.length&&['queued','needs_human'].includes(String(run['status']))){
    const error={code:'MARKETING_DERIVATION_NEEDS_HUMAN',missing:[...new Set(gaps)],source_event_id:event['id']};
    await tx.query("UPDATE workflow_runs SET status='needs_human',error=$3,updated_at=now() WHERE org_id=$1 AND id=$2",[orgId,run['id'],JSON.stringify(error)]);
    await tx.query("UPDATE workflow_steps SET state='needs_human',error=$3,updated_at=now() WHERE org_id=$1 AND run_id=$2 AND state IN('queued','needs_human')",[orgId,run['id'],JSON.stringify(error)]);
   }
   await tx.query('UPDATE outbox_events SET dispatched_at=now(),attempts=attempts+1 WHERE org_id=$1 AND id=$2',[orgId,event['id']]);
   await tx.query("INSERT INTO audit_logs(id,org_id,actor_type,actor_id,action,target_type,target_id,request_id,details) VALUES($1,$2,'service','marketing-dispatch','source.change_dispatched','workflow_run',$3,$4,$5)",[uuid(),orgId,run['id'],uuid(),JSON.stringify({mode,source_version_ids:trustedSourceIds,needs_human:gaps.length>0,missing:gaps})]);
  }
  return events.length;
 });
}
