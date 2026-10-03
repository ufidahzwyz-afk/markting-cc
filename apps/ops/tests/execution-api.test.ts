import assert from "node:assert/strict";
import test from "node:test";
import { createTestDatabase,DEMO_ORG_ID,DEMO_OWNER_ID,DEMO_MARKETER_ID } from "@boran/db";
import { stableHash,uuid,type ServiceContext } from "@boran/domain/core";
import { handleExecution } from "../src/lib/handlers/execution";
function request(path:string,key:string,version?:number){return new Request(`http://localhost/api/v1/${path}`,{method:"POST",headers:{"content-type":"application/json","idempotency-key":key,...(version?{"if-match":String(version)}:{})}});}
async function fixture(){const db=await createTestDatabase(),ctx:ServiceContext={db,orgId:DEMO_ORG_ID,actorId:DEMO_OWNER_ID,roles:["owner","marketer"],mode:"mock"},connection=uuid(),account=uuid();await db.query("INSERT INTO connections(id,org_id,provider,account_external_id,display_name,timezone,currency,read_mode) VALUES($1,$2,'mock','fixture','fixture','Asia/Shanghai','CNY','mock')",[connection,ctx.orgId]);await db.query("INSERT INTO platform_accounts(id,org_id,connection_id,provider,account_external_id,display_name) VALUES($1,$2,$3,'mock','fixture','fixture')",[account,ctx.orgId,connection]);return{db,ctx,account};}

test("execution API consumes immutable approval once, replays idempotency and refuses client success proof",async()=>{
  const {db,ctx,account}=await fixture();try{
    const body={action_type:"external.publish",target:{platform_account_id:account},payload:{text:"anonymous fixture"},expires_at:new Date(Date.now()+3600000).toISOString()};
    const first=await handleExecution(ctx,request("approvals","create-approval"),["approvals"],body);assert.equal(first!.status,201);const approval=(await first!.json()).data;
    const replay=await handleExecution(ctx,request("approvals","create-approval"),["approvals"],body);assert.equal((await replay!.json()).meta.idempotency_replay,true);
    await assert.rejects(()=>handleExecution({...ctx,actorId:DEMO_MARKETER_ID,roles:["owner"]},request(`approvals/${approval.id}/decisions`,"spoof-decision",1),["approvals",approval.id,"decisions"],{decision:"approved",expected_payload_hash:approval.payload_hash}),/角色/);
    const decision=await handleExecution(ctx,request(`approvals/${approval.id}/decisions`,"approve",1),["approvals",approval.id,"decisions"],{decision:"approved",expected_payload_hash:approval.payload_hash});assert.equal(decision!.status,200);
    const actionResponse=await handleExecution(ctx,request("actions","action-1"),["actions"],{approval_id:approval.id,expected_payload_hash:stableHash(body.payload)});assert.equal(actionResponse!.status,202);const action=(await actionResponse!.json()).data;
    await assert.rejects(()=>handleExecution(ctx,request("actions","action-2"),["actions"],{approval_id:approval.id,expected_payload_hash:stableHash(body.payload)}),/消费/);
    await assert.rejects(()=>handleExecution(ctx,request(`actions/${action.id}/reconcile`,"reconcile"),["actions",action.id,"reconcile"],{outcome:"found",evidence:{verified:true}}),/不支持的字段/);
    const receipt=await handleExecution(ctx,request(`actions/${action.id}/manual-receipt`,"receipt",1),["actions",action.id,"manual-receipt"],{executed_at:new Date().toISOString(),url:"https://example.invalid/fixture"});assert.equal((await receipt!.json()).data.state,"externally_completed");assert.equal((await db.query("SELECT verified_at FROM execution_actions WHERE id=$1",[action.id])).rows[0]!.verified_at,null);
  }finally{await db.close();}
});

test("task API persists mutations, requires correct version, and never exposes another organization",async()=>{
  const {db,ctx}=await fixture();try{
    const response=await handleExecution(ctx,request("tasks","task"),["tasks"],{title:"核对协同办公模拟资料",type:"source_watch",business_line:"shared",due_at:new Date().toISOString(),priority:"P1"});assert.equal(response!.status,201);const task=(await response!.json()).data;
    const update=new Request(`http://localhost/api/v1/tasks/${task.id}`,{method:"PATCH",headers:{"idempotency-key":"task-update","if-match":"1"}});
    const patched=await handleExecution(ctx,update,["tasks",task.id],{status:"done"});assert.equal((await patched!.json()).data.version,2);
    await assert.rejects(()=>handleExecution(ctx,new Request(update.url,{method:"PATCH",headers:{"idempotency-key":"task-stale","if-match":"1"}}),["tasks",task.id],{status:"todo"}),/已被修改/);
    await assert.rejects(()=>handleExecution({...ctx,orgId:uuid()},new Request(update.url),["tasks",task.id]),{code:"FORBIDDEN"});
  }finally{await db.close();}
});

test("execution reads use current business membership, so a cached marketer cannot become an organization-wide sales reader",async()=>{
  const {db,ctx}=await fixture();try{
    const former={...ctx,actorId:DEMO_MARKETER_ID,roles:["owner","marketer"]};
    await db.query("UPDATE memberships SET roles=ARRAY['sales'] WHERE org_id=$1 AND user_id=$2",[ctx.orgId,DEMO_MARKETER_ID]);
    for(const area of ["tasks","runs","approvals","actions","execution-policies"]){
      for(const parts of [[area],[area,uuid()]])await assert.rejects(()=>handleExecution(former,new Request(`http://localhost/api/v1/${parts.join('/')}`),parts),{code:"FORBIDDEN"});
    }
    const accepted=await handleExecution(ctx,new Request("http://localhost/api/v1/tasks"),["tasks"]);assert.equal(accepted!.status,200);
    await db.query("UPDATE memberships SET active=false WHERE org_id=$1 AND user_id=$2",[ctx.orgId,ctx.actorId]);
    await assert.rejects(()=>handleExecution(ctx,new Request("http://localhost/api/v1/tasks"),["tasks"]),{code:"FORBIDDEN"});
  }finally{await db.close();}
});

test("task briefs reject nested personal contacts and credentials before persistence, while IDs and provenance remain usable",async()=>{
  const {db,ctx}=await fixture();try{
    const base={title:"梳理应用集成准备",type:"source_watch",business_line:"shared",due_at:new Date().toISOString(),priority:"P1"};
    const forbidden=[{notes:[{text:"请联系 synthetic@example.invalid"}]},{nested:{phone:"13800000000"}},{reference:{contact_id:"13800000000"}},{nested:{api_key:"PRIVATE_SENTINEL"}},{nested:{"ａｐｉ＿ｋｅｙ":"PRIVATE_SENTINEL"}},{notes:"Ｂｅａｒｅｒ PRIVATE_SENTINEL"},{notes:"%42earer%20PRIVATE_SENTINEL"},{headers:{authorization:"Bearer PRIVATE_SENTINEL"}},{notes:"password=PRIVATE_SENTINEL"},{url:"https://example.invalid/read?access_token=PRIVATE_SENTINEL"},{url:"https://example.invalid/read?%74%6f%6b%65%6e=PRIVATE_SENTINEL"},{url:"https://user:PRIVATE_SENTINEL@example.invalid/read"},{request_id:"eyJaaaaaaaaaaaaa.bbbbbbbbbbbbbbb.ccccccccccccccc"}];
    for(const brief of forbidden)await assert.rejects(()=>handleExecution(ctx,request("tasks",`private-${uuid()}`),["tasks"],{...base,brief}),(error:unknown)=>{assert.equal((error as {code:string}).code,"SENSITIVE_TASK_BRIEF");assert.equal(String(error).includes("PRIVATE_SENTINEL"),false);assert.equal(String(error).includes("synthetic@example.invalid"),false);return true;});
    assert.equal((await db.query("SELECT id FROM tasks")).rows.length,0);assert.equal((await db.query("SELECT id FROM idempotency_records")).rows.length,0);
    const reference={contact_id:"00000000-0000-4000-8000-000000000003",source_version_ids:[uuid()],payload_hash:"a".repeat(64),provenance:{kind:"synthetic_reference",source_locator:{message_id:"msg-00000001"}}};
    const created=(await(await handleExecution(ctx,request("tasks","safe-reference"),["tasks"],{...base,brief:reference}))!.json()).data;
    assert.deepEqual(created.brief,reference);
    const mutation=new Request(`http://localhost/api/v1/tasks/${created.id}`,{method:"PATCH",headers:{"idempotency-key":"sensitive-patch","if-match":"1"}});
    await assert.rejects(()=>handleExecution(ctx,mutation,["tasks",created.id],{brief:{notes:"微信：synthetic_wechat"}}),{code:"SENSITIVE_TASK_BRIEF"});
    const stored=(await db.query("SELECT brief,version FROM tasks WHERE id=$1",[created.id])).rows[0]!;assert.equal(stored.version,1);assert.deepEqual(stored.brief,reference);
  }finally{await db.close();}
});
