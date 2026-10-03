import assert from "node:assert/strict";
import test from "node:test";
import { createTestDatabase,DEMO_ORG_ID } from "@boran/db";
import { scheduleRun,claimStep,completeStep,heartbeatStep,recoverExpiredSteps } from "../src/queue";
import { runOnce,registerHandler } from "../src/runner";

registerHandler("archive",async()=>({output:{mock:true,archive:"fixed-anonymous-example"}}));

test("schedule idempotency, ordered steps, finished steps and durable outbox survive a restart",async()=>{
  const db=await createTestDatabase();try{
    const input={orgId:DEMO_ORG_ID,kind:"source_watch" as const,periodKey:"mock-source",steps:[{key:"source_sync",mode:"mock" as const},{key:"archive",mode:"mock" as const}]};
    const runs=await Promise.all([scheduleRun(db,input),scheduleRun(db,input)]);assert.equal(runs[0]!.id,runs[1]!.id);
    const first=await claimStep(db,{workerId:"worker-1"});assert.ok(first);assert.equal(first.stepKey,"source_sync");
    assert.equal(await claimStep(db,{workerId:"worker-2"}),null);
    await completeStep(db,first,{mock:true},"changed");await assert.rejects(()=>completeStep(db,first,{mock:true}),/Stale/);
    const restarted=await runOnce(db,"worker-after-restart");assert.equal(restarted.processed,true);
    assert.equal((await db.query("SELECT status FROM workflow_runs")).rows[0]!.status,"succeeded");
    assert.equal((await db.query("SELECT attempts FROM workflow_steps WHERE step_key='source_sync'")).rows[0]!.attempts,1);
    assert.equal((await runOnce(db)).processed,false);
  }finally{await db.close();}
});

test("expired lease increments fencing token and old worker completion/heartbeat are rejected",async()=>{
  const db=await createTestDatabase();try{
    await scheduleRun(db,{orgId:DEMO_ORG_ID,kind:"source_watch",periodKey:"recover",steps:[{key:"source_sync",mode:"mock"}]});
    const old=await claimStep(db,{workerId:"old"});assert.ok(old);
    await db.query("UPDATE workflow_steps SET lease_until=now()-interval '1 second'");
    const fresh=await claimStep(db,{workerId:"fresh"});assert.ok(fresh);assert.ok(BigInt(fresh.token)>BigInt(old.token));
    await assert.rejects(()=>completeStep(db,old,{mock:true}),/Stale/);await assert.rejects(()=>heartbeatStep(db,old),/Stale/);
    await completeStep(db,fresh,{mock:true},"changed");
  }finally{await db.close();}
});

test("uncertain external-write step recovery preserves unknown and stops automatic resubmission",async()=>{
  const db=await createTestDatabase();try{
    await assert.rejects(()=>scheduleRun(db,{orgId:DEMO_ORG_ID,kind:"publish_content",periodKey:"blocked",steps:[{key:"publish",mode:"external_write"}]}),/disabled/);
    await db.query("UPDATE organizations SET write_enabled=true WHERE id=$1",[DEMO_ORG_ID]);
    const run=await scheduleRun(db,{orgId:DEMO_ORG_ID,kind:"publish_content",periodKey:"unknown",steps:[{key:"publish",mode:"external_write"}]});
    await db.query("UPDATE workflow_steps SET state='running',lease_until=now()-interval '1 second',lease_owner='dead-worker'");
    assert.equal(await recoverExpiredSteps(db),1);assert.equal(await claimStep(db,{workerId:"new"}),null);
    assert.equal((await db.query("SELECT state FROM workflow_steps")).rows[0]!.state,"unknown");assert.equal((await db.query("SELECT status FROM workflow_runs WHERE id=$1",[run.id])).rows[0]!.status,"needs_human");
  }finally{await db.close();}
});

test("unregistered mock steps and permanent handler failure remain visible without fake completion",async()=>{
 const db=await createTestDatabase();try{await scheduleRun(db,{orgId:DEMO_ORG_ID,kind:"platform_assets",periodKey:"missing-handler",steps:[{key:"model_generation_unconfigured",mode:"mock"}]});
 const result=await runOnce(db);assert.equal(result.blocked,true);assert.equal((await db.query("SELECT state FROM workflow_steps")).rows[0]!.state,"needs_human");assert.equal((await db.query("SELECT output_ref FROM workflow_steps")).rows[0]!.output_ref,null);assert.equal((await runOnce(db)).processed,false);
 }finally{await db.close();}
});
