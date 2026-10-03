import { DEMO_ORG_ID, type Database, type SqlExecutor } from '@boran/db';
import { audit, emitOutbox, DomainError, nowIso, type ServiceContext } from '@boran/domain/core';
import { assertActionExecutable, claimExecutionAction, completeExecutionAction, recoverExpiredActions } from '@boran/domain/execution';
import { createBrowserService, type BrowserCommandRow, type BrowserServiceDependencies } from './service';

export interface BrowserDispatchReadiness {
  /** Deployment-owned allowlist; never supplied by a public request or command body. */
  orgIds: readonly string[];
  identityConfigured: boolean;
  configuredPlatforms: readonly string[];
  writeEnabled: boolean;
  publishEnabled: boolean;
  adsWriteEnabled: boolean;
}
const writes = new Set(['publish', 'ad_write']);
const uuidPattern=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const transient = new Set(['account_busy','manual_login_active','browser_capacity_exhausted','command_not_queued','ALREADY_CLAIMED']);
const codeOf = (error: unknown) => error instanceof DomainError ? error.code : 'BROWSER_DISPATCH_FAILED';
function txContext(ctx: ServiceContext, tx: SqlExecutor): ServiceContext { return { ...ctx, db: { query: tx.query.bind(tx), transaction: fn => fn(tx), close: async () => undefined } }; }
function allowed(ctx: ServiceContext, config: BrowserDispatchReadiness) { if (!config.orgIds.includes(ctx.orgId)) throw new DomainError('DISPATCH_ORGANIZATION_FORBIDDEN',403,'Dispatcher organization is outside its deployment binding'); }
/** Current local publication window is checked again at dispatch/mutation time, after core authorization. */
export async function assertPublicationWindow(ctx:ServiceContext,tx:SqlExecutor,actionId:string){
  const action=(await tx.query("SELECT e.action_type,e.policy_version_id,v.publish_windows,a.timezone FROM execution_actions e LEFT JOIN policy_versions v ON v.org_id=e.org_id AND v.id=e.policy_version_id LEFT JOIN platform_accounts a ON a.org_id=e.org_id AND a.id=COALESCE(e.target->>'platform_account_id',e.target->>'account_id')::uuid WHERE e.org_id=$1 AND e.id=$2",[ctx.orgId,actionId])).rows[0];
  if(action?.action_type!=='external.publish'||!action.policy_version_id)return;
  const parts=new Intl.DateTimeFormat('en-GB',{timeZone:String(action.timezone),weekday:'short',hour:'2-digit',minute:'2-digit',hourCycle:'h23'}).formatToParts(new Date(nowIso(ctx)));
  const value=(part:string)=>parts.find(item=>item.type===part)?.value??'';
  const weekday=['Sun','Mon','Tue','Wed','Thu','Fri','Sat'].indexOf(value('weekday')),minute=Number(value('hour'))*60+Number(value('minute'));
  const time=(input:unknown)=>typeof input==='string'&&/^\d{2}:\d{2}$/.test(input)&&(Number(input.slice(0,2))<24||input==='24:00')&&Number(input.slice(3))<60?Number(input.slice(0,2))*60+Number(input.slice(3)):-1;
  const windows=Array.isArray(action.publish_windows)?action.publish_windows as Record<string,unknown>[]:[];
  if(!windows.some(window=>{const days=window.days??window.weekdays,start=time(window.start??window.start_time),end=time(window.end??window.end_time);return Array.isArray(days)&&days.includes(weekday)&&start>=0&&end>start&&minute>=start&&minute<end;}))throw new DomainError('PUBLISH_WINDOW_CLOSED',409,'Current account-local time is outside the approved publication window');
}
export function browserDispatchEnvironment(env:NodeJS.ProcessEnv=process.env,registeredPlatforms:readonly string[]=[]){
  const mode=env.BORAN_MODE==='live'?'live':'mock';
  const raw=env.BROWSER_SERVICE_ORGS?JSON.parse(env.BROWSER_SERVICE_ORGS) as unknown:{};
  if(!raw||typeof raw!=='object'||Array.isArray(raw)||Object.values(raw).some(ids=>!Array.isArray(ids)||ids.some(id=>typeof id!=='string'||!uuidPattern.test(id))))throw new DomainError('INVALID_SERVICE_ORGANIZATIONS',500,'Service organization binding is invalid');
  const serviceOrganizations=raw as Record<string,string[]>;
  const bound=[...new Set(Object.values(serviceOrganizations).flat())];
  const requested=env.BROWSER_DISPATCH_ORGS?.split(',').map(id=>id.trim()).filter(Boolean);
  const orgIds=requested??(bound.length?bound:mode==='mock'?[DEMO_ORG_ID]:[]);
  if(orgIds.some(id=>!uuidPattern.test(id)||mode==='live'&&!bound.includes(id)))throw new DomainError('DISPATCH_ORGANIZATION_FORBIDDEN',403,'Live dispatch requires the service OIDC organization binding');
  const readiness:BrowserDispatchReadiness={orgIds,identityConfigured:!!env.BROWSER_OIDC_AUDIENCE&&bound.length>0,configuredPlatforms:registeredPlatforms,writeEnabled:env.WRITE_ENABLED==='true',publishEnabled:env.PUBLISH_ENABLED==='true',adsWriteEnabled:env.ADS_WRITE_ENABLED==='true'};
  return{mode:mode as 'mock'|'live',readiness,serviceOrganizations};
}
function gaps(ctx: ServiceContext, config: BrowserDispatchReadiness, type: string, channel: string | null): string[] {
  const missing: string[] = [];
  if (!config.identityConfigured) missing.push('service_oidc');
  if (ctx.mode === 'mock') missing.push('real_platform_integration');
  if (!channel || !config.configuredPlatforms.includes(channel)) missing.push('reviewed_platform_hook');
  if (writes.has(type)) { if (!config.writeEnabled) missing.push('global_write_enabled'); if (type === 'publish' && !config.publishEnabled) missing.push('publish_enabled'); if (type === 'ad_write' && !config.adsWriteEnabled) missing.push('ads_write_enabled'); }
  return missing;
}
async function blocked(ctx: ServiceContext, tx: SqlExecutor, command: BrowserCommandRow, missing: string[], code = 'INTEGRATION_REQUIRED') {
  const changed = await tx.query("UPDATE browser_commands SET state='blocked',last_error=$3,result_ref=$4,finished_at=$5,updated_at=$5 WHERE org_id=$1 AND id=$2 AND state='queued' RETURNING id",[ctx.orgId,command.id,JSON.stringify({code,missing_capabilities:missing}),JSON.stringify({status:'blocked',reason:code,missingCapabilities:missing,verified:false,mode:ctx.mode}),nowIso(ctx)]);
  if (!changed.rowCount) return false;
  if(command.execution_action_id)await tx.query("UPDATE execution_actions SET state='blocked',last_error=$3,version=version+1,updated_at=$4 WHERE org_id=$1 AND id=$2 AND state IN ('queued','retry_wait')",[ctx.orgId,command.execution_action_id,JSON.stringify({code,missing_capabilities:missing,mode:ctx.mode}),nowIso(ctx)]);
  if (command.workflow_run_id) await tx.query("UPDATE workflow_runs SET status='needs_human',error=$3,updated_at=$4 WHERE org_id=$1 AND id=$2 AND status IN ('queued','running','retry_wait')",[ctx.orgId,command.workflow_run_id,JSON.stringify({code,missing_capabilities:missing}),nowIso(ctx)]);
  await audit(ctx,tx,'browser.dispatch.blocked','browser_command',command.id,{code,missingCapabilities:missing,mode:ctx.mode});
  await emitOutbox(ctx,tx,'alert.browser_integration_required',command.id,{commandId:command.id,code,missingCapabilities:missing,mode:ctx.mode});
  return true;
}
async function settleJob(ctx: ServiceContext, command: BrowserCommandRow) {
  const evidence = (command.result_ref as {evidence?:Record<string,unknown>}|null)?.evidence;
  if (!command.execution_action_id) return;
  const action=(await ctx.db.query("SELECT state FROM execution_actions WHERE org_id=$1 AND id=$2",[ctx.orgId,command.execution_action_id])).rows[0];
  const state = command.state === 'succeeded' ? action?.state==='succeeded'?'published_verified':'unknown' : command.state === 'unknown' ? 'unknown' : command.state === 'running' ? 'executing' : command.state === 'failed' ? 'failed' : command.state === 'cancelled' ? 'cancelled' : 'blocked';
  await ctx.db.query("UPDATE publish_jobs SET delivery_state=$3,verification_status=$4,verification_evidence_ref=$5,verified_at=$6,submission_receipt=$7,updated_at=$8 WHERE org_id=$1 AND execution_action_id=$2 AND delivery_state NOT IN ('published_verified','cancelled')",[ctx.orgId,command.execution_action_id,state,state==='published_verified'?'verified':state==='unknown'?'unknown':'unverified',evidence?JSON.stringify(evidence):null,state==='published_verified'?nowIso(ctx):null,JSON.stringify({browser_command_id:command.id,state:command.state,mode:ctx.mode}),nowIso(ctx)]);
}

/** Queue only persisted, already-authorized intents. Unique action/approval/budget allocation remains in domain execution. */
export async function queueBrowserActions(ctx: ServiceContext, config: BrowserDispatchReadiness, dependencies: BrowserServiceDependencies): Promise<{queued:number;blocked:number}> {
  allowed(ctx,config); let queued=0,blockedCount=0;
  const actions=(await ctx.db.query("SELECT e.id,e.target,e.action_type FROM execution_actions e WHERE e.org_id=$1 AND e.state IN ('queued','retry_wait') AND (e.action_type='external.publish' OR e.action_type IN ('ads.update','ads.pause')) AND EXISTS(SELECT 1 FROM outbox_events o WHERE o.org_id=e.org_id AND o.aggregate_id=e.id AND o.event_type='execution.queued' AND o.dispatched_at IS NULL AND o.payload->>'mode'=$2) ORDER BY e.created_at,e.id LIMIT 20",[ctx.orgId,ctx.mode])).rows;
  for(const candidate of actions){
    const outcome=await ctx.db.transaction(async tx=>{
      const target=candidate.target as Record<string,unknown>,accountId=target.platform_account_id??target.account_id;
      const account=(await tx.query("SELECT * FROM platform_accounts WHERE org_id=$1 AND id=$2 FOR UPDATE",[ctx.orgId,accountId])).rows[0];
      const action=(await tx.query("SELECT * FROM execution_actions WHERE org_id=$1 AND id=$2 FOR UPDATE",[ctx.orgId,candidate.id])).rows[0];
      if(!action||!['queued','retry_wait'].includes(String(action.state)))return 'skip';
      if(!(await tx.query("SELECT id FROM outbox_events WHERE org_id=$1 AND aggregate_id=$2 AND event_type='execution.queued' AND dispatched_at IS NULL AND payload->>'mode'=$3 FOR UPDATE",[ctx.orgId,action.id,ctx.mode])).rowCount)return 'skip';
      const job=(await tx.query("SELECT * FROM publish_jobs WHERE org_id=$1 AND execution_action_id=$2 FOR UPDATE",[ctx.orgId,action.id])).rows[0];
      if(job&&(Date.parse(String(job.scheduled_at))>Date.parse(nowIso(ctx))||job.next_attempt_at&&Date.parse(String(job.next_attempt_at))>Date.parse(nowIso(ctx))))return 'skip';
      if(job&&!['scheduled','queued','retry_wait'].includes(String(job.delivery_state)))return 'skip';
      const type=action.action_type==='external.publish'?'publish':'ad_write';
      const missing=gaps(ctx,config,type,account?String(account.channel_id??account.provider):null);
      if(!account)missing.push('bound_platform_account');
      if(type==='publish'&&!job)missing.push('bound_publish_job');
      if(type==='publish'&&job){
        const variant=(await tx.query("SELECT v.platform_account_id,v.content_version_id,v.validated_payload_hash,c.payload_hash FROM content_variants v JOIN content_versions c ON c.org_id=v.org_id AND c.id=v.content_version_id WHERE v.org_id=$1 AND v.id=$2",[ctx.orgId,job.content_variant_id])).rows[0];
        if(!variant||job.platform_account_id!==accountId||target.content_variant_id!==job.content_variant_id||action.version_id!==variant.content_version_id||action.payload_hash!==variant.payload_hash||variant.validated_payload_hash!==variant.payload_hash)missing.push('publish_job_action_content_binding');
      }
      let error='INTEGRATION_REQUIRED';
      if(!missing.length){
        try{
          const context=txContext(ctx,tx);
          await assertActionExecutable(context,tx,String(action.id));
          await assertPublicationWindow(context,tx,String(action.id));
          const command=await createBrowserService(context,dependencies).enqueue({command_type:type,idempotency_key:`action:${action.id}`,platform_account_id:String(account!.id),execution_action_id:String(action.id),adapter_version:String(account!.adapter_version??'unconfigured-v1'),session_version:Number(account!.session_version),input_ref:type==='publish'&&action.version_id?{content_version_id:String(action.version_id)}:{action_snapshot_id:String(action.id)}});
          if(job)await tx.query("UPDATE publish_jobs SET delivery_state='queued',submission_receipt=$3,updated_at=$4 WHERE org_id=$1 AND id=$2",[ctx.orgId,job.id,JSON.stringify({browser_command_id:command.id,mode:ctx.mode}),nowIso(ctx)]);
          await tx.query("UPDATE outbox_events SET dispatched_at=$3 WHERE org_id=$1 AND aggregate_id=$2 AND event_type='execution.queued' AND dispatched_at IS NULL",[ctx.orgId,action.id,nowIso(ctx)]);
          await audit(ctx,tx,'execution.browser_queued','execution_action',String(action.id),{commandId:command.id,mode:ctx.mode});return 'queued';
        }catch(err){error=codeOf(err);if(transient.has(error))return 'skip';missing.push(error);}
      }
      await tx.query("UPDATE execution_actions SET state='blocked',last_error=$3,version=version+1,updated_at=$4 WHERE org_id=$1 AND id=$2 AND state IN ('queued','retry_wait')",[ctx.orgId,action.id,JSON.stringify({code:error,missing_capabilities:missing,mode:ctx.mode}),nowIso(ctx)]);
      if(job)await tx.query("UPDATE publish_jobs SET delivery_state='blocked',submission_receipt=$3,updated_at=$4 WHERE org_id=$1 AND id=$2",[ctx.orgId,job.id,JSON.stringify({code:error,missing_capabilities:missing,verified:false,mode:ctx.mode}),nowIso(ctx)]);
      await tx.query("UPDATE outbox_events SET dispatched_at=$3 WHERE org_id=$1 AND aggregate_id=$2 AND event_type='execution.queued' AND dispatched_at IS NULL",[ctx.orgId,action.id,nowIso(ctx)]);
      await audit(ctx,tx,'execution.browser_blocked','execution_action',String(action.id),{code:error,missingCapabilities:missing,mode:ctx.mode});
      await emitOutbox(ctx,tx,'alert.execution_blocked',String(action.id),{actionId:action.id,code:error,missingCapabilities:missing,mode:ctx.mode});return 'blocked';
    });
    if(outcome==='queued')queued++;if(outcome==='blocked')blockedCount++;
  }
  return{queued,blocked:blockedCount};
}

/** One durable polling iteration. Unknown/submitted writes are never selected for submission. */
export async function dispatchBrowserCommands(ctx: ServiceContext, config: BrowserDispatchReadiness, dependencies: BrowserServiceDependencies, workerId:string):Promise<{executed:number;blocked:number;deferred:number;recovered:number}> {
  allowed(ctx,config);const service=createBrowserService(ctx,dependencies);const recovered=await service.recoverExpired();await recoverExpiredActions(ctx);
  for(const command of recovered){await settleJob(ctx,command);}
  let executed=0,blockedCount=0,deferred=0;
  const commands=(await ctx.db.query<BrowserCommandRow>("SELECT * FROM browser_commands WHERE org_id=$1 AND state='queued' AND (next_attempt_at IS NULL OR next_attempt_at<=$2) ORDER BY created_at,id LIMIT 20",[ctx.orgId,nowIso(ctx)])).rows;
  // At most two in flight; database/profile fencing also guards independent dispatcher processes.
  async function process(command:BrowserCommandRow){
    const account=command.platform_account_id?(await ctx.db.query("SELECT channel_id,provider FROM platform_accounts WHERE org_id=$1 AND id=$2",[ctx.orgId,command.platform_account_id])).rows[0]:null;
    const missing=gaps(ctx,config,command.command_type,account?String(account.channel_id??account.provider):dependencies.sourceAdapter?.channelId??null);
    if(missing.length){const changed=await ctx.db.transaction(tx=>blocked(ctx,tx,command,missing));if(changed){blockedCount++;await settleJob(ctx,await service.get(command.id));}return;}
    let actionClaim:Awaited<ReturnType<typeof claimExecutionAction>>|undefined;
    let heartbeat:ReturnType<typeof setInterval>|undefined;
    try{
      if(writes.has(command.command_type)&&command.execution_action_id){actionClaim=await claimExecutionAction(ctx,command.execution_action_id,workerId,300);}
      if(command.command_type==='publish'&&command.execution_action_id)await ctx.db.transaction(tx=>assertPublicationWindow(ctx,tx,command.execution_action_id!));
      heartbeat=setInterval(()=>{void (async()=>{const current=await service.get(command.id);if(current.state==='running'&&current.lease_owner===workerId)await service.heartbeat(command.id,workerId,Number(current.fencing_token));if(actionClaim)await ctx.db.query("UPDATE execution_actions SET lease_until=$4 WHERE org_id=$1 AND id=$2 AND fencing_token=$3 AND lease_owner=$5 AND state='executing' AND lease_until>$6",[ctx.orgId,command.execution_action_id,actionClaim.token,new Date(Date.parse(nowIso(ctx))+300000).toISOString(),workerId,nowIso(ctx)]);})().catch(()=>undefined);},20000);heartbeat.unref();
      const result=await service.execute(command.id,workerId);executed++;
      if(actionClaim){
        const evidence=(result.result_ref as {evidence?:Record<string,unknown>}|null)?.evidence;
        if(result.state==='blocked'){
          await ctx.db.query("UPDATE execution_actions SET state='blocked',last_error=$4,lease_owner=NULL,lease_until=NULL,version=version+1,updated_at=$5 WHERE org_id=$1 AND id=$2 AND fencing_token=$3 AND lease_owner=$6 AND state='executing'",[ctx.orgId,command.execution_action_id,actionClaim.token,JSON.stringify({code:'BROWSER_COMMAND_BLOCKED',command_id:command.id,mode:ctx.mode}),nowIso(ctx),workerId]);
        }else await completeExecutionAction(ctx,command.execution_action_id!,actionClaim.token,{state:result.state==='succeeded'?'succeeded':result.state==='unknown'?'unknown':'failed',...(evidence?{afterSnapshot:{browser_command_id:result.id,...evidence},evidence:{...evidence,mode:ctx.mode}}:{})});
      }
      await settleJob(ctx,result);
    }catch(error){const code=codeOf(error);if(transient.has(code)){
        if(actionClaim){const current=await service.get(command.id);if(current.state==='queued')await ctx.db.query("UPDATE execution_actions SET state='queued',lease_owner=NULL,lease_until=NULL,version=version+1,updated_at=$4 WHERE org_id=$1 AND id=$2 AND fencing_token=$3 AND lease_owner=$5 AND state='executing'",[ctx.orgId,command.execution_action_id,actionClaim.token,nowIso(ctx),workerId]);}
        deferred++;return;
      }
      const current=await service.get(command.id);
      if(current.state==='queued'){
        const actionState=command.execution_action_id?(await ctx.db.query("SELECT state FROM execution_actions WHERE org_id=$1 AND id=$2",[ctx.orgId,command.execution_action_id])).rows[0]?.state:null;
        if(actionState==='unknown'){await ctx.db.query("UPDATE browser_commands SET state='unknown',last_error=$3,updated_at=$4 WHERE org_id=$1 AND id=$2 AND state='queued'",[ctx.orgId,command.id,JSON.stringify({code:'EXECUTION_RECONCILIATION_REQUIRED'}),nowIso(ctx)]);}else await ctx.db.transaction(tx=>blocked(ctx,tx,current,[code],code));
        blockedCount++;await settleJob(ctx,await service.get(command.id));
        if(actionClaim)await ctx.db.query("UPDATE execution_actions SET state='blocked',last_error=$4,lease_owner=NULL,lease_until=NULL,version=version+1,updated_at=$5 WHERE org_id=$1 AND id=$2 AND fencing_token=$3 AND lease_owner=$6 AND state='executing'",[ctx.orgId,command.execution_action_id,actionClaim.token,JSON.stringify({code,mode:ctx.mode}),nowIso(ctx),workerId]);
      }else if(current.state==='running'){
        // No second submit is possible after an interrupted owned execution. Preserve uncertainty and fence late callbacks.
        await ctx.db.query("UPDATE browser_commands SET state='unknown',last_error=$4,lease_owner=NULL,lease_until=NULL,updated_at=$5 WHERE org_id=$1 AND id=$2 AND lease_owner=$3 AND state='running'",[ctx.orgId,current.id,workerId,JSON.stringify({code}),nowIso(ctx)]);await settleJob(ctx,await service.get(command.id));
      }
      if(actionClaim&&current.state!=='queued')await ctx.db.query("UPDATE execution_actions SET state='unknown',last_error=$4,lease_owner=NULL,lease_until=NULL,version=version+1,updated_at=$5 WHERE org_id=$1 AND id=$2 AND fencing_token=$3 AND lease_owner=$6 AND state='executing'",[ctx.orgId,command.execution_action_id,actionClaim.token,JSON.stringify({code,mode:ctx.mode}),nowIso(ctx),workerId]);
      await settleJob(ctx,await service.get(command.id));
    }finally{if(heartbeat)clearInterval(heartbeat);}
  }
  for(let index=0;index<commands.length;index+=2)await Promise.all(commands.slice(index,index+2).map(process));
  return{executed,blocked:blockedCount,deferred,recovered:recovered.length};
}

export function startBrowserDispatcher(options:{db:Database;mode:'mock'|'live';readiness:BrowserDispatchReadiness;dependencies:BrowserServiceDependencies;workerId:string;intervalMs?:number;onError?:(code:string)=>void}){
  let stopping=false,inFlight:Promise<void>|undefined;
  const tick=()=>{if(stopping||inFlight)return;inFlight=(async()=>{for(const orgId of options.readiness.orgIds){const ctx:ServiceContext={db:options.db,orgId,actorId:options.workerId,actorType:'service',roles:['service'],mode:options.mode};await dispatchBrowserCommands(ctx,options.readiness,options.dependencies,options.workerId);}})().catch(error=>options.onError?.(codeOf(error))).finally(()=>{inFlight=undefined;});};
  const interval=setInterval(tick,options.intervalMs??1000);interval.unref();tick();
  return{async stop(){stopping=true;clearInterval(interval);await inFlight;}};
}
