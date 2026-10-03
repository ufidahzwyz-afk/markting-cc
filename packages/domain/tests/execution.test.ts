import assert from "node:assert/strict";
import test from "node:test";
import { createTestDatabase, DEMO_ORG_ID, DEMO_OWNER_ID, DEMO_MARKETER_ID, type Database } from "@boran/db";
import { uuid, stableHash, type ServiceContext } from "../src/core";
import { assertLeadAccess } from "../src/authz";
import { createPolicy,activatePolicy,revokePolicy,createExecutionAction,claimExecutionAction,completeExecutionAction,recoverExpiredActions,assertActionExecutable,createApproval,decideApproval, type PolicyInput } from "../src/execution";

function context(db:Database):ServiceContext{return{db,orgId:DEMO_ORG_ID,actorId:DEMO_OWNER_ID,roles:["owner","marketer"],mode:"mock"};}
async function account(ctx:ServiceContext):Promise<string>{
  const connectionId=uuid(),accountId=uuid();
  await ctx.db.query("INSERT INTO connections(id,org_id,provider,account_external_id,display_name,timezone,currency,read_mode) VALUES($1::uuid,$2,'mock',$1::text,'anonymous mock','Asia/Shanghai','CNY','mock')",[connectionId,ctx.orgId]);
  await ctx.db.query("INSERT INTO platform_accounts(id,org_id,connection_id,provider,account_external_id,display_name) VALUES($1::uuid,$2,$3,'mock',$1::text,'anonymous account')",[accountId,ctx.orgId,connectionId]);return accountId;
}
async function activePolicy(ctx:ServiceContext,accountId:string,overrides:Partial<PolicyInput>={}){
  const policy=await createPolicy(ctx,{name:"isolated test policy",businessScope:{business_lines:["shared"]},accountIds:[accountId],allowedActions:["external.publish"],publishFrequency:{daily_max:20,weekly_max:50,min_interval_minutes:0},publishWindows:[{days:[0,1,2,3,4,5,6],start:"00:00",end:"24:00"}],stopConditions:{max_errors:1},...overrides});
  const version=(await ctx.db.query("SELECT id FROM policy_versions WHERE org_id=$1 AND policy_id=$2",[ctx.orgId,policy.id])).rows[0]!;
  await activatePolicy(ctx,String(policy.id),String(version.id),1);return{policyId:String(policy.id),versionId:String(version.id)};
}
function publishInput(accountId:string,policyVersionId:string,key:string){return{idempotencyKey:key,actionType:"external.publish" as const,target:{platform_account_id:accountId,business_line:"shared"},payload:{text:"anonymous fixture"},beforeSnapshot:{version:1},policyVersionId};}

test("canonical hashing, active memberships and capability union resist client-role escalation",async()=>{
  assert.equal(stableHash({b:2,a:1}),stableHash({a:1,b:2}));
  const db=await createTestDatabase();try{
    const ctx=context(db);await assertLeadAccess({...ctx,actorId:DEMO_MARKETER_ID,roles:["marketer","sales"]},DEMO_OWNER_ID);
    await assert.rejects(()=>createPolicy({...ctx,actorId:DEMO_MARKETER_ID,roles:["owner"]},{name:"invalid",businessScope:{x:1},accountIds:[],allowedActions:["content.publish"],stopConditions:{x:1}}),/角色/);
    await assert.rejects(()=>createPolicy({...ctx,actorType:"service"},{name:"invalid",businessScope:{x:1},accountIds:[],allowedActions:["content.publish"],stopConditions:{x:1}}),/服务身份/);
    await db.query("UPDATE memberships SET active=false WHERE user_id=$1",[DEMO_MARKETER_ID]);
    await assert.rejects(()=>assertLeadAccess({...ctx,actorId:DEMO_MARKETER_ID},DEMO_MARKETER_ID),/停用/);
  }finally{await db.close();}
});

test("concurrent same action key returns one intent and changed payload conflicts",async()=>{
  const db=await createTestDatabase();try{const ctx=context(db),id=await account(ctx),policy=await activePolicy(ctx,id),input=publishInput(id,policy.versionId,"same");
    const actions=await Promise.all(Array.from({length:6},()=>createExecutionAction(ctx,input)));assert.equal(new Set(actions.map((a)=>a.id)).size,1);
    assert.equal((await db.query("SELECT id FROM outbox_events WHERE event_type='execution.queued'")).rows.length,1);
    await assert.rejects(()=>createExecutionAction(ctx,{...input,payload:{text:"different"}}),/幂等键/);
  }finally{await db.close();}
});

test("policy revoke blocks queued action immediately and unknown effects never blindly retry",async()=>{
  const db=await createTestDatabase();try{const ctx=context(db),id=await account(ctx),policy=await activePolicy(ctx,id),a=await createExecutionAction(ctx,publishInput(id,policy.versionId,"lease"));
    const claim=await claimExecutionAction(ctx,String(a.id),"worker-old");
    await db.query("UPDATE execution_actions SET lease_until=now()-interval '1 second' WHERE id=$1",[a.id]);
    await assert.rejects(()=>completeExecutionAction(ctx,String(a.id),claim.token,{state:"submitted"}),/旧执行/);
    assert.equal(await recoverExpiredActions(ctx),1);
    await assert.rejects(()=>claimExecutionAction(ctx,String(a.id),"worker-new"),/核对/);
    const queued=await createExecutionAction(ctx,publishInput(id,policy.versionId,"revoked"));await revokePolicy(ctx,policy.policyId,2);
    assert.equal((await db.query("SELECT state FROM execution_actions WHERE id=$1",[queued.id])).rows[0]!.state,"blocked");
    await assert.rejects(()=>createExecutionAction(ctx,publishInput(id,policy.versionId,"new-after-revoke")),/规则已撤销/);
  }finally{await db.close();}
});

test("concurrent budget reservations cannot exceed daily or total policy limits",async()=>{
  const db=await createTestDatabase();try{const ctx=context(db),id=await account(ctx),policy=await activePolicy(ctx,id,{allowedActions:["ads.update"],dailyBudgetMinor:100,totalBudgetMinor:100,allowedAdOperations:["update"],allowedAdEntityLevels:["keyword"]});
    const result=await Promise.allSettled(["budget-1","budget-2"].map((key)=>createExecutionAction(ctx,{idempotencyKey:key,actionType:"ads.update",target:{platform_account_id:id,business_line:"shared"},payload:{operation:"update",entity_level:"keyword"},beforeSnapshot:{version:1},policyVersionId:policy.versionId,budgetImpactMinor:60})));
    assert.equal(result.filter((r)=>r.status==="fulfilled").length,1);assert.equal(result.filter((r)=>r.status==="rejected").length,1);
  }finally{await db.close();}
});

test("publish daily frequency uses account local day during Beijing 00-08 window",async()=>{
  const db=await createTestDatabase();try{const ctx={...context(db),now:()=>new Date("2026-10-03T00:30:00Z")},id=await account(ctx),policy=await activePolicy(ctx,id,{publishFrequency:{daily_max:1,weekly_max:7,min_interval_minutes:0}});
    const first=await createExecutionAction(ctx,publishInput(id,policy.versionId,"local-1"));await db.query("UPDATE execution_actions SET created_at='2026-10-02T17:00:00Z' WHERE id=$1",[first.id]);
    await assert.rejects(()=>createExecutionAction(ctx,publishInput(id,policy.versionId,"local-2")),/发布频次/);
  }finally{await db.close();}
});

test("live write gate fails closed; mock cannot claim a real platform account",async()=>{
  const db=await createTestDatabase();try{const ctx=context(db),id=await account(ctx),policy=await activePolicy(ctx,id),a=await createExecutionAction(ctx,publishInput(id,policy.versionId,"gate"));
    await assert.rejects(()=>db.transaction((tx)=>assertActionExecutable({...ctx,mode:"live"},tx,String(a.id))),/真实外部写入/);
    await db.query("UPDATE connections SET provider='wechat' WHERE id=(SELECT connection_id FROM platform_accounts WHERE id=$1)",[id]);
    await assert.rejects(()=>claimExecutionAction(ctx,String(a.id),"worker"),/模拟执行/);
  }finally{await db.close();}
});

test("publication rechecks account-local execution time and persists a delayed intent as blocked",async()=>{
  const db=await createTestDatabase();try{
    let clock="2026-10-02T23:00:00Z"; // Saturday 07:00 in Shanghai; scheduling may precede its window.
    const ctx={...context(db),now:()=>new Date(clock)},id=await account(ctx),policy=await activePolicy(ctx,id,{publishWindows:[{platform_account_id:id,timezone:"Asia/Shanghai",weekdays:[6],start_time:"08:00",end_time:"08:15"}]});
    const timely=await createExecutionAction(ctx,publishInput(id,policy.versionId,"window-timely"));
    await db.query("UPDATE execution_actions SET created_at=$1 WHERE id=$2",[clock,timely.id]);
    const delayed=await createExecutionAction(ctx,publishInput(id,policy.versionId,"window-delayed"));
    clock="2026-10-03T00:00:00Z";
    assert.equal((await claimExecutionAction(ctx,String(timely.id),"at-window-start")).action.state,"executing");
    clock="2026-10-03T00:15:00Z";
    await assert.rejects(()=>claimExecutionAction(ctx,String(delayed.id),"late-worker"),{code:"PUBLISH_WINDOW_CLOSED"});
    const row=(await db.query("SELECT state,last_error,lease_owner FROM execution_actions WHERE id=$1",[delayed.id])).rows[0]!;
    assert.equal(row.state,"blocked");assert.deepEqual(row.last_error,{code:"PUBLISH_WINDOW_CLOSED"});assert.equal(row.lease_owner,null);
    assert.equal((await db.query("SELECT id FROM action_attempts WHERE action_id=$1",[delayed.id])).rows.length,0);
    assert.equal((await db.query("SELECT id FROM audit_logs WHERE target_id=$1 AND action='execution.blocked'",[delayed.id])).rows.length,1);
    assert.equal((await createExecutionAction(ctx,publishInput(id,policy.versionId,"window-delayed"))).id,delayed.id);
  }finally{await db.close();}
});

test("mock publication still enforces weekday, matching account and timezone and explicit valid windows",async()=>{
  const db=await createTestDatabase();try{
    const ctx={...context(db),now:()=>new Date("2026-10-03T00:30:00Z")},id=await account(ctx),other=await account(ctx);
    const forbidden=[[],[{days:[5],start:"08:00",end:"09:00"}],[{days:[6],start:"08:00",end:"09:00",account_id:other}],[{days:[6],start:"08:00",end:"09:00",timezone:"UTC"}],[{days:[6],start:"08:70",end:"09:00"}]];
    for(const [index,publishWindows] of forbidden.entries()){
      const policy=await activePolicy(ctx,id,{publishWindows}),action=await createExecutionAction(ctx,publishInput(id,policy.versionId,`invalid-window-${index}`));
      await assert.rejects(()=>claimExecutionAction(ctx,String(action.id),"mock-worker"),{code:"PUBLISH_WINDOW_CLOSED"});
      assert.equal((await db.query("SELECT state FROM execution_actions WHERE id=$1",[action.id])).rows[0]!.state,"blocked");
    }
    const midnightCtx={...ctx,now:()=>new Date("2026-10-02T16:30:00Z")};
    // Start the policy before the test instant, rather than bypass its lifetime gate.
    const earlier=await activePolicy(midnightCtx,id,{publishWindows:[{days:[5],start:"23:00",end:"01:00",account_ids:[id]}]});
    const action=await createExecutionAction(midnightCtx,publishInput(id,earlier.versionId,"overnight"));
    assert.equal((await claimExecutionAction(midnightCtx,String(action.id),"overnight-worker")).action.state,"executing");
  }finally{await db.close();}
});

test("an immutable single approval authorizes publication without a continuing policy window",async()=>{
  const db=await createTestDatabase();try{
    const ctx={...context(db),now:()=>new Date("2026-10-03T01:30:00Z")},id=await account(ctx),target={platform_account_id:id},payload={text:"anonymous approved fixture"};
    const approval=await createApproval(ctx,{actionType:"external.publish",target,payload,expiresAt:"2026-10-03T02:30:00Z"});
    await decideApproval(ctx,String(approval.id),{decision:"approved",expectedPayloadHash:stableHash(payload),expectedVersion:1});
    const action=await createExecutionAction(ctx,{idempotencyKey:"single-window-exemption",actionType:"external.publish",target,payload,beforeSnapshot:approval.before_snapshot as Record<string,unknown>,approvalId:String(approval.id)});
    assert.equal((await claimExecutionAction(ctx,String(action.id),"single-approved")).action.state,"executing");
  }finally{await db.close();}
});
