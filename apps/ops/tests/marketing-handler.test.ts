import test from 'node:test';
import assert from 'node:assert/strict';
import {createTestDatabase,DEMO_ORG_ID,DEMO_OWNER_ID} from '@boran/db';
import {uuid,type ServiceContext} from '@boran/domain/core';
import {handleMarketing} from '../src/lib/handlers/marketing';
const request=(method:string,path:string,key='marketing-test-001',version?:number)=>new Request(`http://localhost:3000/api/v1/${path}`,{method,headers:{'content-type':'application/json','idempotency-key':key,...(version?{'if-match':String(version)}:{})}});
test('marketing HTTP routes retain organization state and expose honest integration gaps',async t=>{
 const db=await createTestDatabase();const ctx:ServiceContext={db,orgId:DEMO_ORG_ID,actorId:DEMO_OWNER_ID,roles:['owner','marketer'],mode:'mock'};
 try{
  await t.test('public master initialization is idempotent and returns source references',async()=>{
   const first=await handleMarketing(ctx,request('POST','business-master/initialize'),['business-master','initialize'],{});assert.equal(first?.status,200);
   const repeated=await handleMarketing(ctx,request('POST','business-master/initialize'),['business-master','initialize'],{});assert.equal((await repeated!.json()).meta.idempotency_replay,true);
   const master=await handleMarketing(ctx,request('GET','business-master?category=industry'),['business-master']);const result=await master!.json();assert.equal(result.data.items.length,7);assert.ok(result.data.items.every((item:{source_version_id:string})=>item.source_version_id));
  });
  await t.test('unknown properties and client confirmation proof cannot expand authority',async()=>{
   const body={title:'Mock topic',business_line:'shared',audience:'客户',problem:'采购',offer:'服务',angle:'说明',claim_ids:[],policy_status:'active'};
   await assert.rejects(handleMarketing(ctx,request('POST','topics','bad-topic'),['topics'],body),{code:'CONTRACT_INVALID'});
   await assert.rejects(handleMarketing(ctx,request('POST','claims','bad-claim'),['claims'],{claim_text:'我已确认',source_version_id:uuid(),locator:{message_id:'fake'},public_permission:'unknown',assertion_type:'decision',decision_status:'confirmed',decision_evidence_ref:{actor:'user'}}),{code:'USER_EXPRESSION_REQUIRED'});
  });
  await t.test('manual source sync queues durable worker work with actor and preserves the cursor',async()=>{
   const connection=uuid();await db.query("INSERT INTO connections(id,org_id,provider,account_external_id,display_name,timezone,currency,source_kind,read_mode,scope_json) VALUES($1,$2,'chatgpt_authorized',$3,'Authorized conversation','Asia/Shanghai','CNY','chatgpt','authorized_browser',$4)",[connection,ctx.orgId,uuid(),JSON.stringify({conversation_ids:['approved-only']})]);
   await assert.rejects(handleMarketing(ctx,request('POST',`connections/${connection}/sync`,'mock-real-sync-rejected'),['connections',connection,'sync'],{mode:'incremental'}),{code:'LIVE_IDENTITY_REQUIRED'});
   const result=await handleMarketing({...ctx,mode:'live'},request('POST',`connections/${connection}/sync`,'chatgpt-sync'),['connections',connection,'sync'],{mode:'incremental'});assert.equal(result?.status,202);const payload=await result!.json();assert.equal(payload.data.status,'queued');
   const row=(await db.query('SELECT cursor,access_status FROM connections WHERE org_id=$1 AND id=$2',[ctx.orgId,connection])).rows[0]!;assert.equal(row['cursor'],null);assert.equal(row['access_status'],'not_configured');assert.equal((await db.query('SELECT status FROM workflow_runs WHERE id=$1',[payload.data.run_id])).rows[0]?.['status'],'queued');const step=(await db.query('SELECT input_ref FROM workflow_steps WHERE run_id=$1',[payload.data.run_id])).rows[0]!;assert.equal((step.input_ref as Record<string,unknown>).requested_by,ctx.actorId);assert.equal((step.input_ref as Record<string,unknown>).mode,'live');const repeated=await handleMarketing({...ctx,mode:'live'},request('POST',`connections/${connection}/sync`,'chatgpt-sync'),['connections',connection,'sync'],{mode:'incremental'});assert.equal((await repeated!.json()).meta.idempotency_replay,true);assert.equal((await db.query('SELECT id FROM workflow_steps WHERE run_id=$1',[payload.data.run_id])).rows.length,1);
  });
  await t.test('public facts require explicit human owner verification and independent permission proof',async()=>{
   const sourceVersion=(await db.query('SELECT source_version_id FROM business_master_versions WHERE org_id=$1 LIMIT 1',[ctx.orgId])).rows[0]!.source_version_id;
   const registered=await handleMarketing(ctx,request('POST','claims','public-fact-register'),['claims'],{claim_text:'仅供工程验证的事实',source_version_id:sourceVersion,locator:{kind:'document',value:'qa-fact'},public_permission:'unknown',assertion_type:'fact'});const claim=(await registered!.json()).data;
   const path=`claims/${claim.claim_id}/verify`,parts=['claims',claim.claim_id,'verify'];
   const input={verification_status:'verified',public_permission:'allowed',visibility:'public',permission_evidence_ref:{kind:'synthetic-independent-permission'}};
   await assert.rejects(handleMarketing({...ctx,actorType:'service'},request('POST',path,'service-public-fact',1),parts,input),{code:'PUBLIC_FACT_CONFIRMATION_REQUIRED'});
   const verified=await handleMarketing(ctx,request('POST',path,'owner-public-fact',1),parts,input);const result=(await verified!.json()).data;assert.equal(result.visibility,'public');assert.equal(result.verification_status,'verified');assert.equal(result.public_permission,'allowed');
  });
  await t.test('weekly plan generation is a persisted simulated workflow, without fabricated themes',async()=>{
   const result=await handleMarketing(ctx,request('POST','plans/generate','plan-generation'),['plans','generate'],{week_start:'2026-10-05',business_lines:['shared'],goal_ids:[]});assert.equal(result?.status,202);const payload=await result!.json();assert.equal(payload.data.simulation,true);assert.equal(payload.data.status,'queued');assert.ok((await db.query('SELECT id FROM workflow_steps WHERE run_id=$1',[payload.data.run_id])).rows.length);
  });
  await t.test('unsupported paths return null for the remaining composed handlers',async()=>{assert.equal(await handleMarketing(ctx,request('GET','leads'),['leads']),null);});
 }finally{await db.close();}
});
