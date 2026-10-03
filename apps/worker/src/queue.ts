import { randomUUID } from "node:crypto";
import type { Database, SqlExecutor } from "@boran/db";

export const workflowKinds = ["source_watch","insight_topics","weekly_plan","platform_assets","publish_content","baidu_execute","metrics_collect","daily_report","seo_review","geo_review","import","archive","reception_reply","privacy_request"] as const;
export interface WorkflowInput {
  orgId: string; kind: (typeof workflowKinds)[number]; periodKey: string; scheduleVersion?: number;
  input?: Record<string, unknown>;
  steps: { key: string; mode: "mock" | "read_only" | "external_write"; input?: Record<string, unknown> }[];
}
export interface StepClaim { orgId: string; runId: string; stepId: string; stepKey: string; kind: string; workerId: string; token: string; mode: string; input: Record<string, unknown>; attempts: number }
export class LeaseError extends Error {}

export async function scheduleRun(db: Database, input: WorkflowInput): Promise<Record<string, unknown>> {
  if (!workflowKinds.includes(input.kind) || !input.periodKey || input.periodKey.length>60 || !input.steps.length || new Set(input.steps.map((s)=>s.key)).size!==input.steps.length || input.steps.some((s)=>!s.key || s.key.length>80) || !Number.isInteger(input.scheduleVersion??1) || (input.scheduleVersion??1)<1) throw new Error("Invalid workflow schedule");
  return db.transaction(async(tx)=>{
    const org=(await tx.query("SELECT * FROM organizations WHERE id=$1 FOR UPDATE",[input.orgId])).rows[0];
    if(!org)throw new Error("Organization not found");
    if(input.steps.some((s)=>s.mode==="external_write")&&!org.write_enabled)throw new Error("External writes are disabled");
    const existing=(await tx.query("SELECT * FROM workflow_runs WHERE org_id=$1 AND kind=$2 AND period_key=$3 AND schedule_version=$4",[input.orgId,input.kind,input.periodKey,input.scheduleVersion??1])).rows[0];
    if(existing)return existing;
    // JSON connection references are checked before persistence; the JSON is not a bypass for org isolation.
    const connectionIds=[input.input?.connection_id,...input.steps.map((s)=>s.input?.connection_id)].filter((value):value is string=>typeof value==="string");
    for(const connectionId of connectionIds)if(!(await tx.query("SELECT id FROM connections WHERE org_id=$1 AND id=$2",[input.orgId,connectionId])).rows.length)throw new Error("Connection not found in organization");
    const run=(await tx.query("INSERT INTO workflow_runs(id,org_id,kind,period_key,schedule_version,status,input_ref) VALUES($1,$2,$3,$4,$5,'queued',$6) RETURNING *",[randomUUID(),input.orgId,input.kind,input.periodKey,input.scheduleVersion??1,JSON.stringify(input.input??{})])).rows[0]!;
    for(const [ordinal,step] of input.steps.entries())await tx.query("INSERT INTO workflow_steps(id,org_id,run_id,step_key,state,attempts,input_ref,ordinal,execution_mode,external_write) VALUES($1,$2,$3,$4,'queued',0,$5,$6,$7,$8)",[randomUUID(),input.orgId,run.id,step.key,JSON.stringify(step.input??{}),ordinal,step.mode,step.mode==="external_write"]);
    await tx.query("INSERT INTO outbox_events(id,org_id,event_id,event_type,aggregate_id,schema_version,payload,occurred_at,attempts,next_attempt_at) VALUES($1,$2,$3,'workflow.queued',$4,1,$5,now(),0,now())",[randomUUID(),input.orgId,randomUUID(),run.id,JSON.stringify({runId:run.id,kind:input.kind})]);
    await serviceAudit(tx,input.orgId,"workflow.scheduled",String(run.id),{kind:input.kind});return run;
  });
}
async function serviceAudit(tx:SqlExecutor,orgId:string,action:string,runId:string,details:unknown):Promise<void>{await tx.query("INSERT INTO audit_logs(id,org_id,actor_type,actor_id,action,target_type,target_id,request_id,details) VALUES($1,$2,'service','persistent-worker',$3,'workflow_run',$4,$5,$6)",[randomUUID(),orgId,action,runId,randomUUID(),JSON.stringify(details)]);}

export async function recoverExpiredSteps(db:Database):Promise<number>{
  return db.transaction(async(tx)=>{
    const unsafe=await tx.query("UPDATE workflow_steps SET state='unknown',fencing_token=fencing_token+1,lease_owner=NULL,lease_until=NULL,error=$1 WHERE state='running' AND external_write AND lease_until<=now() RETURNING org_id,run_id",[JSON.stringify({code:"EXTERNAL_RESULT_UNKNOWN",requires:"reconcile"})]);
    for(const step of unsafe.rows)await tx.query("UPDATE workflow_runs SET status='needs_human',lease_until=NULL,updated_at=now() WHERE org_id=$1 AND id=$2",[step.org_id,step.run_id]);
    return unsafe.rowCount;
  });
}
export async function claimStep(db:Database,options:{workerId:string;orgId?:string;leaseSeconds?:number;modes?:('mock'|'read_only')[]}):Promise<StepClaim|null>{
  const seconds=options.leaseSeconds??300,modes=options.modes??["mock"];
  if(!options.workerId||options.workerId.length>200||!Number.isInteger(seconds)||seconds<1||seconds>900||modes.some((m)=>!["mock","read_only"].includes(m)))throw new Error("Invalid claim options");
  return db.transaction(async(tx)=>{
    const row=(await tx.query(`SELECT s.*,r.kind FROM workflow_steps s JOIN workflow_runs r ON r.org_id=s.org_id AND r.id=s.run_id WHERE ($1::uuid IS NULL OR s.org_id=$1) AND s.execution_mode=ANY($2::text[]) AND NOT s.external_write AND r.status IN ('queued','running') AND (s.state='queued' OR (s.state='running' AND s.lease_until<=now())) AND NOT EXISTS(SELECT 1 FROM workflow_steps prior WHERE prior.org_id=s.org_id AND prior.run_id=s.run_id AND prior.ordinal<s.ordinal AND prior.state<>'succeeded') ORDER BY s.created_at,s.ordinal,s.id FOR UPDATE OF s SKIP LOCKED LIMIT 1`,[options.orgId??null,modes])).rows[0];
    if(!row)return null;
    const claimed=(await tx.query("UPDATE workflow_steps SET state='running',attempts=attempts+1,lease_owner=$1,fencing_token=fencing_token+1,lease_until=now()+($2::text||' seconds')::interval,heartbeat_at=now(),updated_at=now() WHERE org_id=$3 AND id=$4 RETURNING *",[options.workerId,seconds,row.org_id,row.id])).rows[0]!;
    await tx.query("UPDATE workflow_runs SET status='running',started_at=COALESCE(started_at,now()),heartbeat_at=now(),lease_until=$1,updated_at=now() WHERE org_id=$2 AND id=$3",[claimed.lease_until,claimed.org_id,claimed.run_id]);
    return {orgId:String(claimed.org_id),runId:String(claimed.run_id),stepId:String(claimed.id),stepKey:String(claimed.step_key),kind:String(row.kind),workerId:options.workerId,token:String(claimed.fencing_token),mode:String(claimed.execution_mode),input:claimed.input_ref as Record<string,unknown>,attempts:Number(claimed.attempts)};
  });
}
export async function heartbeatStep(db:Database,claim:StepClaim,leaseSeconds=300):Promise<void>{
  if(!Number.isInteger(leaseSeconds)||leaseSeconds<1||leaseSeconds>900)throw new LeaseError("Invalid heartbeat interval");
  const result=await db.query("UPDATE workflow_steps SET lease_until=now()+($1::text||' seconds')::interval,heartbeat_at=now() WHERE org_id=$2 AND id=$3 AND fencing_token=$4 AND lease_owner=$5 AND state='running' AND lease_until>now()",[leaseSeconds,claim.orgId,claim.stepId,claim.token,claim.workerId]);
  if(result.rowCount!==1)throw new LeaseError("Stale worker cannot extend lease");
}
export async function completeStep(db:Database,claim:StepClaim,output:Record<string,unknown>,sourceResult?:"changed"|"no_change"|"partial"|"failed"):Promise<void>{
  await db.transaction(async(tx)=>{
    const row=(await tx.query("SELECT s.*,r.kind FROM workflow_steps s JOIN workflow_runs r ON r.org_id=s.org_id AND r.id=s.run_id WHERE s.org_id=$1 AND s.id=$2 FOR UPDATE OF s",[claim.orgId,claim.stepId])).rows[0];
    if(!row||String(row.fencing_token)!==claim.token||row.lease_owner!==claim.workerId||row.state!=="running"||!row.lease_until||Date.parse(String(row.lease_until))<=Date.now())throw new LeaseError("Stale worker cannot commit result");
    if(row.external_write)throw new LeaseError("External steps require independent readback before completion");
    if(sourceResult&&(row.kind!=="source_watch"||row.step_key!=="source_sync"))throw new Error("Source result only applies to source sync");
    if(claim.mode==="mock"&&output.mock!==true)throw new Error("Mock output must be explicitly labeled");
    const state=sourceResult==="failed"?"failed":sourceResult==="partial"?"partial":"succeeded";
    await tx.query("UPDATE workflow_steps SET state=$1,output_ref=$2,source_result=$3,lease_until=NULL,lease_owner=NULL,updated_at=now() WHERE org_id=$4 AND id=$5",[state,JSON.stringify(output),sourceResult??null,claim.orgId,claim.stepId]);
    if(state!=="succeeded")await tx.query("UPDATE workflow_runs SET status=$1,output_ref=$2,finished_at=now(),lease_until=NULL,updated_at=now() WHERE org_id=$3 AND id=$4",[state,JSON.stringify({mock:claim.mode==="mock",lastStep:claim.stepKey}),claim.orgId,claim.runId]);
    const unfinished=(await tx.query("SELECT id FROM workflow_steps WHERE org_id=$1 AND run_id=$2 AND state<>'succeeded' LIMIT 1",[claim.orgId,claim.runId])).rows.length;
    if(!unfinished)await tx.query("UPDATE workflow_runs SET status='succeeded',output_ref=$1,finished_at=now(),lease_until=NULL,updated_at=now() WHERE org_id=$2 AND id=$3",[JSON.stringify({mock:claim.mode==="mock",lastStep:claim.stepKey}),claim.orgId,claim.runId]);
    await serviceAudit(tx,claim.orgId,"workflow.step_completed",claim.runId,{stepKey:claim.stepKey,mock:claim.mode==="mock"});
  });
}
export async function dispatchWorkflowOutbox(db:Database):Promise<number>{
  return db.transaction(async(tx)=>{
    const events=(await tx.query("SELECT * FROM outbox_events WHERE event_type='workflow.queued' AND dispatched_at IS NULL AND next_attempt_at<=now() ORDER BY created_at FOR UPDATE SKIP LOCKED LIMIT 50")).rows;
    for(const event of events){if(!(await tx.query("SELECT id FROM workflow_runs WHERE org_id=$1 AND id=$2",[event.org_id,event.aggregate_id])).rows.length)throw new Error("Outbox workflow reference is invalid");await tx.query("UPDATE outbox_events SET dispatched_at=now(),attempts=attempts+1 WHERE org_id=$1 AND id=$2",[event.org_id,event.id]);}return events.length;
  });
}

export async function failStep(db:Database,claim:StepClaim,failure:{code:string;transient?:boolean;unknown?:boolean;needsHuman?:boolean}):Promise<void>{
  await db.transaction(async(tx)=>{
    const row=(await tx.query("SELECT * FROM workflow_steps WHERE org_id=$1 AND id=$2 FOR UPDATE",[claim.orgId,claim.stepId])).rows[0];
    if(!row||String(row.fencing_token)!==claim.token||row.lease_owner!==claim.workerId||row.state!=="running"||!row.lease_until||Date.parse(String(row.lease_until))<=Date.now())throw new LeaseError("Stale worker cannot persist failure");
    const retry=failure.transient===true&&!row.external_write&&Number(row.attempts)<3;
    const state=failure.unknown||row.external_write?"unknown":retry?"queued":failure.needsHuman?"needs_human":"failed";
    await tx.query("UPDATE workflow_steps SET state=$1,error=$2,lease_owner=NULL,lease_until=NULL,fencing_token=fencing_token+1,updated_at=now() WHERE org_id=$3 AND id=$4",[state,JSON.stringify({code:failure.code.slice(0,100),retryable:retry}),claim.orgId,claim.stepId]);
    await tx.query("UPDATE workflow_runs SET status=$1,error=$2,lease_until=NULL,updated_at=now() WHERE org_id=$3 AND id=$4",[retry?"queued":state==="unknown"?"needs_human":state,JSON.stringify({code:failure.code.slice(0,100)}),claim.orgId,claim.runId]);
  });
}
export async function needsHuman(db:Database,claim:StepClaim,code:string):Promise<void>{await failStep(db,claim,{code,needsHuman:true});}
