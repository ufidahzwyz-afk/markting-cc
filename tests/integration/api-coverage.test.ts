import test from 'node:test';
import assert from 'node:assert/strict';
import {createTestDatabase,DEMO_ORG_ID,DEMO_OWNER_ID,DEMO_MARKETER_ID} from '@boran/db';
import {openapi,validateApiRequest,type components} from '@boran/contracts';
import {uuid,type ServiceContext} from '@boran/domain/core';
import {createHmac} from 'node:crypto';
import {initializeBusinessMaster} from '@boran/domain/marketing';
import {createPolicy,activatePolicy} from '@boran/domain/execution';
import {createContactCapture} from '@boran/domain/leads';
import {privacyRequest,validatePrivacyConfiguration} from '@boran/domain/privacy';
import {saveWorkspaceTheme} from '@boran/domain/workspace';
import {tsImport} from 'tsx/esm/api';
const {handleContent}=await tsImport('../../apps/ops/src/lib/handlers/content.ts',{parentURL:import.meta.url,tsconfig:new URL('../../apps/ops/tsconfig.json',import.meta.url).pathname}) as typeof import('../../apps/ops/src/lib/handlers/content');
import {handleMarketing} from '../../apps/ops/src/lib/handlers/marketing';
import {handleBrowser} from '../../apps/ops/src/lib/handlers/browser';
import {handleExecution} from '../../apps/ops/src/lib/handlers/execution';
import {scheduleRun} from '../../apps/worker/src/queue';
import {runOnce} from '../../apps/worker/src/runner';
import {registerDomainHandlers,markUnconfiguredPrivacyRequests} from '../../apps/worker/src/handlers';
import {scheduleDueWorkflows} from '../../apps/worker/src/scheduler';
import {ingestReceptionEvent,getReceptionConversation,generateReceptionReply,verifyReceptionSignature,type ReceptionAdapter} from '@boran/domain/reception';

type Row=Record<string,unknown>;
const request=(path:string,method='GET',version?:number,key=uuid())=>new Request(`http://localhost:3000/api/v1/${path}`,{method,headers:{'Content-Type':'application/json','Idempotency-Key':key,...(version!==undefined?{'If-Match':String(version)}:{})}});
function context(db:ServiceContext['db']):ServiceContext{return {db,orgId:DEMO_ORG_ID,actorId:DEMO_OWNER_ID,roles:['owner','marketer'],mode:'mock'};}
async function check(response:Response|null,method:string,path:string):Promise<Row>{
 assert.ok(response,`${method} ${path} was not routed`);
 type ResponseDefinition={content?:Record<string,{schema?:{$ref?:string}}>};
 const paths=openapi.paths as unknown as Record<string,Record<string,{responses:Record<string,ResponseDefinition>}>>;
 const declared=paths[path]?.[method.toLowerCase()]?.responses[String(response.status)];
 assert.ok(declared,`${method} ${path}: actual ${response.status} is absent from OpenAPI`);
 const body=await response.json();const schema=declared.content?.['application/json']?.schema?.$ref?.split('/').at(-1);
 assert.ok(schema,`${method} ${path}: no response schema`);
 validateApiRequest(schema as keyof components['schemas'],body);
 return body.data as Row;
}
const modules=[{type:'hero',schema_version:1,data:{headline:'集成范围准备',description:'先确认业务问题与应用范围。',cta:{label:'了解服务',href:'/articles/qa',action:'navigate'}}},{type:'solution',schema_version:1,data:{heading:'准备事项',body:[{type:'paragraph',text:'梳理组织、人员与基础业务数据责任。'}],claim_ids:[]}}];

test('actual source, topic and business-master responses satisfy the published contract',async t=>{
 const db=await createTestDatabase(),ctx=context(db);try{
  await initializeBusinessMaster(ctx);
  await t.test('source registration is synchronous and has no fabricated workflow',async()=>{await check(await handleMarketing(ctx,request('sources','POST'),['sources'],{provider:'url',source_url:'https://example.invalid/approved',title:'公开集成参考',visibility:'public'}),'POST','/sources');});
  await t.test('topic registration and list have the same DTO',async()=>{await check(await handleMarketing(ctx,request('topics','POST'),['topics'],{title:'集成准备事项',business_line:'shared',audience:'企业应用管理团队',problem:'数据责任待梳理',offer:'集成规划',angle:'实施准备',claim_ids:[]}),'POST','/topics');await check(await handleMarketing(ctx,request('topics'),['topics']),'GET','/topics');});
  await t.test('master source references remain explicit',async()=>{await check(await handleMarketing(ctx,request('business-master'),['business-master']),'GET','/business-master');});
  await t.test('distribution manifest is an honest per-channel array',async()=>{const rows=await check(await handleMarketing(ctx,request('distribution-manifest'),['distribution-manifest']),'GET','/distribution-manifest') as unknown as Row[];assert.equal(rows.length,16);assert.ok(rows.every(row=>row.enabled===false&&row.credentialConfigured===false));});
 }finally{await db.close();}
});

test('content editor versions and action responses follow their actual immutable identifiers',async t=>{
 const db=await createTestDatabase(),ctx=context(db);const prior=process.env.PUBLIC_ALLOWED_PATH_PREFIXES;process.env.PUBLIC_ALLOWED_PATH_PREFIXES='/articles';
 try{
  const itemResponse=await handleContent(ctx,request('content','POST'),['content'],{title:'集成准备事项',kind:'article',business_line:'shared'});const item=(await itemResponse!.json()).data as Row;
  let version:Row={},page:Row={};
  await t.test('save returns its real immutable version and read gives full editor data',async()=>{
   version=await check(await handleContent(ctx,request(`content/${item.id}/versions`,'POST',0),['content',String(item.id),'versions'],{title:'集成准备事项',modules,claim_ids:[]}),'POST','/content/{id}/versions');
   const read=(await(await handleContent(ctx,request(`content/${item.id}/versions`),['content',String(item.id),'versions']))!.json()).data as Row[];assert.equal(read[0]!.id,version.id);assert.equal(read[0]!.version_no,1);assert.deepEqual((read[0]!.body_json as Row).modules,modules);
  });
  // Continue through the stored record even if a response-contract subtest fails.
  version=(await db.query('SELECT * FROM content_versions WHERE org_id=$1 AND content_item_id=$2',[ctx.orgId,item.id])).rows[0]!;
  await handleContent(ctx,request(`content/versions/${version.id}/review`,'POST',1),['content','versions',String(version.id),'review'],{review_status:'approved'});
  await t.test('page creation returns page_id without inventing an editor row',async()=>{page=await check(await handleContent(ctx,request('pages','POST'),['pages'],{host:'localhost:3001',path:'/articles/qa',business_line:'shared',template_key:'article',content_item_id:item.id,seo_title:'集成准备事项',description:'范围准备说明',canonical_url:'http://localhost:3001/articles/qa',index_policy:'noindex',owner_user_id:ctx.actorId}),'POST','/pages');});
  const policy=await createPolicy(ctx,{name:'内容QA规则',businessScope:{business_lines:['shared']},accountIds:[],allowedActions:['content.publish'],stopConditions:{manual_stop:true},approvedPathPrefixes:['/articles']});const policyVersion=(await db.query('SELECT id FROM policy_versions WHERE policy_id=$1',[policy.id])).rows[0]!;await activatePolicy(ctx,String(policy.id),String(policyVersion.id),1);
  await t.test('content publish rejects client payload and derives it from version_id',async()=>{
   const body={action_type:'content.publish',target:{page_id:page.page_id},version_id:version.id,policy_version_id:policyVersion.id,expected_payload_hash:version.payload_hash};
   await assert.rejects(()=>handleExecution(ctx,request('actions','POST'),['actions'],{...body,payload:version.body_json}),{code:'CONTRACT_INVALID'});
   const action=await check(await handleExecution(ctx,request('actions','POST'),['actions'],body),'POST','/actions');assert.equal(action.state,'queued');assert.equal(action.run_id,undefined);
  });
 }finally{if(prior===undefined)delete process.env.PUBLIC_ALLOWED_PATH_PREFIXES;else process.env.PUBLIC_ALLOWED_PATH_PREFIXES=prior;await db.close();}
});

test('browser health, session and login DTOs satisfy contracts and never persist raw tickets',async t=>{
 const db=await createTestDatabase(),ctx=context(db),connection=uuid(),account=uuid();
 try{
  await db.query("INSERT INTO connections(id,org_id,provider,account_external_id,display_name,timezone,currency,read_mode,secret_ref,capabilities) VALUES($1,$2,'wechat_mp','synthetic','模拟公众号','Asia/Shanghai','CNY','mock','PRIVATE_SECRET_REFERENCE',$3)",[connection,ctx.orgId,JSON.stringify({publish:false,session_verify:false})]);
  await db.query("INSERT INTO platform_accounts(id,org_id,connection_id,provider,channel_id,account_external_id,display_name) VALUES($1,$2,$3,'wechat_mp','wechat_mp','synthetic','模拟公众号')",[account,ctx.orgId,connection]);
  await t.test('connection health uses the contracted credential-free DTO',async()=>{const response=await handleBrowser(ctx,request(`connections/${connection}/health`),['connections',connection,'health']);const copy=response!.clone();await check(response,'GET','/connections/{id}/health');assert.equal((await copy.text()).includes('PRIVATE_SECRET_REFERENCE'),false);});
  await t.test('account session reports unconfigured capability truthfully',async()=>{await check(await handleBrowser(ctx,request(`platform-accounts/${account}/session`),['platform-accounts',account,'session']),'GET','/platform-accounts/{id}/session');});
  let login:Row={};const key=uuid();
  await t.test('first login response and replay preserve one-use ticket semantics',async()=>{
   const first=await handleBrowser(ctx,request(`platform-accounts/${account}/login-sessions`,'POST',undefined,key),['platform-accounts',account,'login-sessions'],{});const copy=first!.clone();login=(await copy.json()).data;
   await check(first,'POST','/platform-accounts/{id}/login-sessions');const raw=String(login.interaction_ticket);assert.ok(raw&&raw!=='undefined');const persisted=await db.query('SELECT response_json FROM idempotency_records WHERE org_id=$1 AND key=$2',[ctx.orgId,key]);assert.equal(JSON.stringify(persisted.rows).includes(raw),false);
   const replay=await handleBrowser(ctx,request(`platform-accounts/${account}/login-sessions`,'POST',undefined,key),['platform-accounts',account,'login-sessions'],{});const body=await replay!.json();assert.equal(body.data.interaction_ticket,null);assert.equal(body.data.id,login.id);
  });
  await t.test('login state omits ticket hash and redemption yields the documented state',async()=>{await check(await handleBrowser(ctx,request(`login-sessions/${login.id}`),['login-sessions',String(login.id)]),'GET','/login-sessions/{id}');await check(await handleBrowser(ctx,request(`login-sessions/${login.id}/redeem`,'POST'),['login-sessions',String(login.id),'redeem'],{platform_account_id:account,interaction_ticket:login.interaction_ticket}),'POST','/login-sessions/{id}/redeem');});
 }finally{await db.close();}
});

test('workspace task identities cannot silently omit a task and privacy settings reject hidden secrets',async()=>{
 const db=await createTestDatabase(),ctx=context(db);try{
  await initializeBusinessMaster(ctx);const theme=await saveWorkspaceTheme(ctx,{title:'任务集合QA',businessLine:'集成服务',status:'草稿',audience:'企业团队',goal:'梳理范围',channels:['官网'],owner:'运营 A',tasks:[{id:'first',label:'第一项',done:false},{id:'second',label:'第二项',done:false}]});
  await assert.rejects(()=>saveWorkspaceTheme(ctx,{...theme,tasks:[theme.tasks[0]!,theme.tasks[0]!]},{id:theme.id,expectedVersion:theme.version}),{code:'INVALID_THEME'});
  await assert.rejects(()=>validatePrivacyConfiguration(ctx,{enabled:false,api_key:'PRIVATE_SENTINEL'}),{code:'INVALID_PRIVACY_CONFIGURATION'});
 }finally{await db.close();}
});

test('signed reception events and actual reply receipts use their own response contracts',async t=>{
 const db=await createTestDatabase(),ctx=context(db),connection=uuid(),secret='synthetic-reception-QA-only';
 const adapter:ReceptionAdapter={kind:'mock',verifyEvent:args=>verifyReceptionSignature(secret,args.rawBody,args.signature,args.timestamp),async sendReply(){return {external_message_id:'synthetic-reply-QA'};},async readDelivery(){return {verified:true,external_message_id:'synthetic-reply-QA',evidence_ref:{synthetic:true}};},async handoff(){throw new Error('not used');},async readHandoff(){return {verified:false,evidence_ref:{}};}};
 try{
  await db.query("INSERT INTO connections(id,org_id,provider,account_external_id,display_name,timezone,currency,read_mode) VALUES($1,$2,'mock','reception-QA','模拟接待','Asia/Shanghai','CNY','mock')",[connection,ctx.orgId]);
  const input={connection_id:connection,external_event_id:uuid(),external_conversation_id:uuid(),external_message_id:uuid(),event_type:'visitor_message' as const,occurred_at:new Date().toISOString(),sanitized_text:'咨询集成准备，联系 qa-private@example.invalid'};const rawBody=JSON.stringify(input),timestamp=String(Date.now()),signature=createHmac('sha256',secret).update(`${timestamp}.${rawBody}`).digest('hex');
  const accepted=await ingestReceptionEvent(ctx,input,{adapter,internalTest:true,rawBody,timestamp,signature});
  await t.test('single event acceptance is not a public batch count',async()=>{await check(Response.json(accepted,{status:202}),'POST','/reception/events');assert.equal(JSON.stringify(accepted).includes('qa-private@example.invalid'),false);});
  const conversation=await getReceptionConversation(ctx,accepted.data.conversation_id);await check(Response.json(conversation),'GET','/reception/conversations/{id}');
  const policy=await createPolicy(ctx,{name:'接待QA规则',businessScope:{purpose:'synthetic'},accountIds:[],allowedActions:['reception.reply'],stopConditions:{stop_on_contact:true},receptionScope:{connection_ids:[connection],sop_version:'synthetic-QA',allowed_reply_classes:['useful_answer'],approved_templates:{useful_answer:'可以先梳理应用与数据范围。你关注哪个业务环节？'}}});const version=(await db.query('SELECT id FROM policy_versions WHERE policy_id=$1',[policy.id])).rows[0]!;await activatePolicy(ctx,String(policy.id),String(version.id),1);
  await t.test('reply exposes submitted mock receipt without an invented workflow',async()=>{const reply=await generateReceptionReply(ctx,accepted.data.conversation_id,{conversation_version:conversation.data.version,reason:'visitor_message',policy_version_id:String(version.id)},'reception-response-QA',{adapter,internalTest:true});await check(Response.json({data:reply,meta:{request_id:uuid()}},{status:202}),'POST','/reception/conversations/{id}/reply');assert.equal(reply.delivery_status,'submitted');assert.equal(reply.state,'submitted');});
 }finally{await db.close();}
});

test('worker rechecks current business roles and a live job has no mock fallback',async()=>{
 const db=await createTestDatabase(),ctx=context(db);const oldMode=process.env.BORAN_MODE;process.env.BORAN_MODE='mock';try{
  registerDomainHandlers();await initializeBusinessMaster(ctx);
  const run=await scheduleRun(db,{orgId:ctx.orgId,kind:'weekly_plan',periodKey:'role-revoked-plan',input:{requested_by:DEMO_MARKETER_ID},steps:[{key:'draft_plan',mode:'mock',input:{week_start:'2026-10-05',goal_ids:[]}}]});
  await db.query("UPDATE memberships SET roles=ARRAY['sales'] WHERE org_id=$1 AND user_id=$2",[ctx.orgId,DEMO_MARKETER_ID]);await runOnce(db,'role-QA');
  assert.equal((await db.query('SELECT status FROM workflow_runs WHERE id=$1',[run.id])).rows[0]!.status,'needs_human');assert.equal((await db.query('SELECT id FROM plan_cycles WHERE generated_by_run_id=$1',[run.id])).rows.length,0);
  const good=await scheduleRun(db,{orgId:ctx.orgId,kind:'weekly_plan',periodKey:'authorized-plan',input:{requested_by:ctx.actorId},steps:[{key:'draft_plan',mode:'mock',input:{week_start:'2026-10-05',goal_ids:[]}}]});await runOnce(db,'authorized-QA');const ai=(await db.query('SELECT * FROM ai_runs WHERE workflow_run_id=$1',[good.id])).rows[0]!;assert.ok(ai);assert.equal(ai.provider,'mock');assert.equal(ai.model,'boran-mock-v2');assert.equal(ai.input_tokens,null);assert.equal(ai.cost_micro,null);assert.ok(/^[a-f0-9]{64}$/.test(String(ai.input_hash)));assert.ok(/^[a-f0-9]{64}$/.test(String(ai.output_hash)));assert.equal((await db.query("SELECT actor_type FROM audit_logs WHERE target_type='plan_cycle'")).rows[0]!.actor_type,'service');
  process.env.BORAN_MODE='live';const live=await scheduleRun(db,{orgId:ctx.orgId,kind:'weekly_plan',periodKey:'live-plan',input:{requested_by:ctx.actorId},steps:[{key:'draft_plan',mode:'read_only',input:{week_start:'2026-10-05',goal_ids:[]}}]});await runOnce(db,'live-QA');const state=(await db.query('SELECT status,output_ref FROM workflow_runs WHERE id=$1',[live.id])).rows[0]!;assert.equal(state.status,'needs_human');assert.equal(JSON.stringify(state.output_ref).includes('boran-mock'),false);
 }finally{if(oldMode===undefined)delete process.env.BORAN_MODE;else process.env.BORAN_MODE=oldMode;await db.close();}
});

test('privacy background processing preserves immediate withdrawal but never invents completion',async()=>{
 const db=await createTestDatabase(),ctx=context(db);try{
  const capture=await createContactCapture(ctx,{event_key:uuid(),contact_type:'email',contact_value:'qa-privacy@example.invalid',source_channel:'test',privacy_notice_version:'mock-v1',consent:true},{internalTest:true});
  const run=await privacyRequest(ctx,capture.data.contact_id,{request_type:'delete'},1,'api-qa-privacy') as {data:{request_id:string}};await markUnconfiguredPrivacyRequests(db);await markUnconfiguredPrivacyRequests(db);
  const state=(await db.query('SELECT status,error FROM workflow_runs WHERE id=$1',[run.data.request_id])).rows[0]!;assert.equal(state.status,'needs_human');assert.equal((state.error as Row).code,'PRIVACY_DOWNSTREAM_ADAPTER_NOT_CONFIGURED');const contact=(await db.query('SELECT marketing_consent_status,deletion_status FROM lead_contacts WHERE id=$1',[capture.data.contact_id])).rows[0]!;assert.equal(contact.marketing_consent_status,'withdrawn');assert.equal(contact.deletion_status,'requested');assert.equal((await db.query("SELECT id FROM audit_logs WHERE target_id=$1 AND action='privacy.downstream_missing'",[run.data.request_id])).rows.length,1);
 }finally{await db.close();}
});

test('periodic scheduler uses Shanghai business days, 08:00 deadlines and idempotent recovery',async()=>{
 const db=await createTestDatabase(),ctx=context(db);try{
  await db.query("INSERT INTO settings(org_id,key,value,schema_version,updated_by) VALUES($1,'operating_schedule',$2,1,$3)",[ctx.orgId,JSON.stringify({enabled:true,timezone:'Asia/Shanghai',workflows:['metrics_collect','daily_report','weekly_plan'],business_lines:['shared'],goal_ids:[],revision:1,requested_by:ctx.actorId}),ctx.actorId]);
  await scheduleDueWorkflows(db,new Date('2026-10-04T23:19:00Z'));assert.equal((await db.query('SELECT id FROM workflow_runs')).rows.length,0);
  await scheduleDueWorkflows(db,new Date('2026-10-04T23:20:00Z'));assert.equal((await db.query('SELECT id FROM workflow_runs')).rows.length,1);
  await scheduleDueWorkflows(db,new Date('2026-10-04T23:50:00Z'));assert.equal((await db.query('SELECT id FROM workflow_runs')).rows.length,2);
  await scheduleDueWorkflows(db,new Date('2026-10-05T00:00:00Z'));await scheduleDueWorkflows(db,new Date('2026-10-05T00:01:00Z'));
  const runs=(await db.query('SELECT kind,period_key,input_ref FROM workflow_runs ORDER BY kind')).rows;assert.equal(runs.filter(run=>run.kind==='weekly_plan').length,1);assert.equal(runs.filter(run=>run.kind==='daily_report').length,1);assert.equal(runs.filter(run=>run.kind==='metrics_collect').length,2);
  assert.equal((runs.find(run=>run.kind==='daily_report')!.input_ref as Row).period_start,'2026-10-04');assert.equal((runs.find(run=>run.kind==='metrics_collect')!.input_ref as Row).period_end,'2026-10-04');
  await scheduleDueWorkflows(db,new Date('2026-10-05T04:00:00Z'));assert.equal((await db.query("SELECT id FROM workflow_runs WHERE kind='daily_report'")).rows.length,2);
  await scheduleDueWorkflows(db,new Date('2026-10-06T00:00:00Z'));const weeks=(await db.query("SELECT period_key FROM workflow_runs WHERE kind='weekly_plan'")).rows;assert.equal(weeks.length,1);assert.equal(weeks[0]!.period_key,'2026-10-05');
 }finally{await db.close();}
});

test('real Next batch API rejects duplicate IDs and rolls back every member on a stale version',{skip:!process.env.BORAN_TEST_OPS_URL},async()=>{
 const base=process.env.BORAN_TEST_OPS_URL!,sessionResponse=await fetch(`${base}/api/v1/session`);assert.equal(sessionResponse.status,200);const session=await sessionResponse.json() as {data:{csrf_token:string;actor_id:string}};
 const cookie=sessionResponse.headers.getSetCookie().find(value=>value.startsWith('boran_csrf='))?.split(';')[0];assert.ok(cookie);
 async function call(path:string,method='GET',body?:unknown){const headers:Record<string,string>={cookie:cookie!};if(method!=='GET')Object.assign(headers,{'Content-Type':'application/json','Origin':new URL(base).origin,'X-CSRF-Token':session.data.csrf_token,'Idempotency-Key':uuid()});return fetch(`${base}/api/v1${path}`,{method,headers,...(body!==undefined?{body:JSON.stringify(body)}:{})});}
 const created:Row[]=[];
 try{
  for(let i=0;i<2;i++){const response=await call('/workspace/themes','POST',{title:`独立批量QA ${uuid().slice(0,8)}`,businessLine:'集成服务',status:'草稿',audience:'匿名企业团队',goal:'检查批量事务，验收后暂停。',channels:['官网'],owner:'运营 A',ownerId:session.data.actor_id,tasks:[{id:uuid(),label:'批量事务检查',done:false}]});assert.equal(response.status,201);created.push((await response.json() as {data:Row}).data);}
  const updates=created.map(theme=>({id:theme.id,version:theme.version,theme:{...theme,status:'已暂停'}}));
  const duplicated=await call('/workspace/themes/batch','POST',{updates:[updates[0],updates[0]]});assert.equal(duplicated.status,400);
  const stale=await call('/workspace/themes/batch','POST',{updates:[updates[0],{...updates[1],version:999}]});assert.equal(stale.status,409);
  const after=(await(await call('/workspace/themes')).json() as {data:Row[]}).data;for(const theme of created){const row=after.find(item=>item.id===theme.id)!;assert.equal(row.version,theme.version);assert.equal(row.status,'草稿');}
  const valid=await call('/workspace/themes/batch','POST',{updates});assert.equal(valid.status,200);const saved=(await valid.json() as {data:Row[]}).data;assert.equal(saved.length,2);for(const theme of saved){assert.equal(theme.status,'已暂停');assert.equal(theme.version,Number(created.find(item=>item.id===theme.id)!.version)+1);}
 }finally{
  // Retain only anonymous QA fixtures; never delete or alter pre-existing workspace records.
  const after=(await(await call('/workspace/themes')).json() as {data:Row[]}).data;const unfinished=after.filter(theme=>created.some(item=>item.id===theme.id)&&theme.status!=='已暂停');if(unfinished.length)await call('/workspace/themes/batch','POST',{updates:unfinished.map(theme=>({id:theme.id,version:theme.version,theme:{...theme,status:'已暂停'}}))});
 }
});
