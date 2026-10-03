import assert from 'node:assert/strict';
import {createHmac} from 'node:crypto';
import {after,before,test} from 'node:test';
import {createTestDatabase,DEMO_ORG_ID,DEMO_OWNER_ID,type Database} from '@boran/db';
import {validateApiRequest} from '@boran/contracts';
import {uuid,type ServiceContext} from '../src/core';
import {activatePolicy,createPolicy,revokePolicy} from '../src/execution';
import {createContactCapture} from '../src/leads';
import {privacyRequest} from '../src/privacy';
import {generateReceptionReply,getReceptionConversation,handoffReception,ingestReceptionEvent,processReceptionFollowup,verifyReceptionSignature,type ReceptionAdapter,type ReceptionEventIngest} from '../src/reception';
let db:Database;let ctx:ServiceContext;let time=new Date('2026-10-03T00:00:00Z');let connectionId:string;let policyId:string;let versionId:string;
let sends=0;let handoffs=0;let sendUnknown=false;
const secret='synthetic-connector-secret';
const adapter:ReceptionAdapter={kind:'mock',verifyEvent:({rawBody,signature,timestamp})=>verifyReceptionSignature(secret,rawBody,signature,timestamp,time),async sendReply(){sends++;if(sendUnknown)throw new Error('unknown after remote submit');return {external_message_id:`mock-reply-${sends}`};},async readDelivery({external_message_id}){return {verified:true,external_message_id,occurred_at:time.toISOString(),evidence_ref:{synthetic:true}};},async handoff(){handoffs++;return {external_handoff_id:`mock-handoff-${handoffs}`};},async readHandoff(){return {verified:true,evidence_ref:{synthetic:true}};}};
const options={adapter,internalTest:true};
before(async()=>{
 db=await createTestDatabase();ctx={db,orgId:DEMO_ORG_ID,actorId:DEMO_OWNER_ID,roles:['owner','marketer'],mode:'mock',now:()=>time};connectionId=uuid();
 await db.query("INSERT INTO connections(id,org_id,provider,account_external_id,display_name,timezone,currency,capabilities,health,read_mode,access_status) VALUES($1,$2,'mock','test-reception','脱敏接待测试','Asia/Shanghai','CNY','{}','unknown','mock','not_configured')",[connectionId,ctx.orgId]);
 const policy=await createPolicy(ctx,{name:'脱敏接待验收规则',businessScope:{purpose:'synthetic_test'},accountIds:[],allowedActions:['reception.reply'],stopConditions:{stop_on_contact:true,stop_on_handoff:true},receptionScope:{connection_ids:[connectionId],sop_version:'test-sop-v1',allowed_reply_classes:['useful_answer','identity_disclosure','silent_followup','contact_captured_acknowledgement'],approved_templates:{useful_answer:'可以先判断现有系统与业务需求的适配。你关注财务协同还是业务流程？',identity_disclosure:'我是泊冉软件的 AI 在线顾问，可以继续为你梳理需求。',silent_followup:'你可以补充最想改善的业务环节？',contact_captured_acknowledgement:'联系方式已记录，后续安排以实际接手为准。'}}});policyId=String(policy.id);versionId=String((await db.query('SELECT id FROM policy_versions WHERE policy_id=$1',[policyId])).rows[0]!.id);await activatePolicy(ctx,policyId,versionId,1);
});after(async()=>{await db?.close();});
function event(text:string,conversation=uuid(),eventId=uuid()):ReceptionEventIngest{return {connection_id:connectionId,external_event_id:eventId,external_conversation_id:conversation,external_message_id:`visitor:${eventId}`,event_type:'visitor_message',occurred_at:time.toISOString(),sanitized_text:text};}
async function ingest(input:ReceptionEventIngest){const rawBody=JSON.stringify(input);const timestamp=String(time.getTime());const signature=createHmac('sha256',secret).update(`${timestamp}.${rawBody}`).digest('hex');return ingestReceptionEvent(ctx,input,{...options,rawBody,timestamp,signature,policyVersionId:versionId});}
function resultData(result:unknown):Record<string,unknown>{return (result as {data:Record<string,unknown>}).data;}

test('private connector signature, exact event bytes and replay window are required before persistence',async()=>{
 const input=event('了解ERP');await assert.rejects(ingestReceptionEvent(ctx,input,options),{code:'VERIFIED_CONNECTOR_REQUIRED'});
 const rawBody=JSON.stringify(input);const timestamp=String(time.getTime());const signature=createHmac('sha256',secret).update(`${timestamp}.${rawBody}`).digest('hex');
 await assert.rejects(ingestReceptionEvent(ctx,{...input,sanitized_text:'伪造事件'},{...options,rawBody,timestamp,signature}),{code:'INVALID_CONNECTOR_SIGNATURE'});
 assert.equal(verifyReceptionSignature(secret,rawBody,signature,timestamp,new Date(time.getTime()+6*60000)),false);assert.equal(verifyReceptionSignature(secret,rawBody,'f'.repeat(64),timestamp,time),false);
 assert.equal((await db.query('SELECT count(*)::int count FROM reception_conversations')).rows[0]!.count,0);
});
test('AC41: immediate identity answer is truthful without human handoff; duplicate event/message never resends',async()=>{
 const input=event('你是AI吗？我的邮箱identity@example.invalid');const beforeSends=sends;const result=await ingest(input);validateApiRequest('ReceptionEventAccepted',result);validateApiRequest('ReceptionReplyAccepted',{data:result.reply,meta:result.meta});assert.equal(result.gap,null);assert.equal(sends,beforeSends+1);assert.equal(result.sla_verified,false);
 const id=String(resultData(result).conversation_id);const conversation=await getReceptionConversation(ctx,id);assert.equal(conversation.data.handoff_status,'none');assert.equal(conversation.data.first_response_at,null);assert.ok(conversation.data.messages.some(m=>String(m.sanitized_text).includes('AI 在线顾问')));assert.equal(JSON.stringify(conversation).includes('@example.invalid'),false);
 const replay=await ingest(input);validateApiRequest('ReceptionEventAccepted',replay);assert.equal(sends,beforeSends+1);
 await ingest({...input,external_event_id:uuid()});assert.equal(sends,beforeSends+1);
 const actions=(await db.query("SELECT state FROM execution_actions WHERE target->>'conversation_id'=$1",[id])).rows;assert.deepEqual(actions.map(a=>a.state),['submitted']);
});
test('AC41: silence jobs persist for 10 seconds, run at most twice and repeated task delivery is idempotent',async()=>{
 const result=await ingest(event('了解财务与业务协同'));const id=String(resultData(result).conversation_id);
 const first=(await db.query("SELECT id FROM outbox_events WHERE aggregate_id=$1 AND event_type='reception.silent_followup' AND dispatched_at IS NULL",[id])).rows[0]!;assert.ok(first);
 await assert.rejects(processReceptionFollowup(ctx,String(first.id),options),{code:'FOLLOWUP_NOT_DUE'});
 time=new Date(time.getTime()+10000);const initial=sends;await processReceptionFollowup(ctx,String(first.id),options);assert.equal(sends,initial+1);await processReceptionFollowup(ctx,String(first.id),options);assert.equal(sends,initial+1);
 const second=(await db.query("SELECT id FROM outbox_events WHERE aggregate_id=$1 AND event_type='reception.silent_followup' AND dispatched_at IS NULL",[id])).rows[0]!;time=new Date(time.getTime()+10000);await processReceptionFollowup(ctx,String(second.id),options);
 assert.equal((await getReceptionConversation(ctx,id)).data.silent_followup_count,2);assert.equal((await db.query("SELECT count(*)::int count FROM outbox_events WHERE aggregate_id=$1 AND event_type='reception.silent_followup' AND dispatched_at IS NULL",[id])).rows[0]!.count,0);
 const assistant=(await getReceptionConversation(ctx,id)).data.messages.filter(m=>m.role==='assistant');assert.ok(assistant.every(m=>(String(m.sanitized_text).match(/[?？]/g) ?? []).length<=1));
});
test('visitor reply cancels old generation before a delayed retry; captured contact stops further requests',async()=>{
 const firstInput=event('协同系统选型');const result=await ingest(firstInput);const id=String(resultData(result).conversation_id);const old=(await db.query("SELECT id FROM outbox_events WHERE aggregate_id=$1 AND event_type='reception.silent_followup' AND dispatched_at IS NULL",[id])).rows[0]!;
 await ingest(event('我们关注流程审批',firstInput.external_conversation_id));time=new Date(time.getTime()+10000);const initial=sends;assert.equal((await processReceptionFollowup(ctx,String(old.id),options) as {cancelled:boolean}).cancelled,true);assert.equal(sends,initial);
 const cap=await createContactCapture(ctx,{event_key:uuid(),contact_type:'email',contact_value:'reception-contact@example.invalid',source_channel:'reception',conversation_id:id,privacy_notice_version:'mock-v1',consent:true,allowed_contact_channels:['email']},{internalTest:true});assert.equal(cap.data.classification,'contact_capture');
 const pending=(await db.query("SELECT count(*)::int count FROM outbox_events WHERE aggregate_id=$1 AND event_type='reception.silent_followup' AND dispatched_at IS NULL",[id])).rows[0]!.count;assert.equal(pending,0);
 await ingest(event('联系方式已经给你了',firstInput.external_conversation_id));const conversation=await getReceptionConversation(ctx,id);const last=conversation.data.messages.filter(m=>m.role==='assistant').at(-1)!;assert.ok(String(last.sanitized_text).includes('联系方式已记录'));assert.equal((String(last.sanitized_text).match(/[?？]/g) ?? []).length,0);
 const contact=(await db.query('SELECT version FROM lead_contacts WHERE id=$1',[cap.data.contact_id])).rows[0]!;await privacyRequest(ctx,cap.data.contact_id,{request_type:'withdraw'},Number(contact.version),'withdraw-reception-test');const before=sends;await ingest(event('还在吗',firstInput.external_conversation_id));assert.equal(sends,before);
});
test('explicit human request makes existing operator task and actual adapter handoff; mock never claims live completion',async()=>{
 const before=handoffs;const result=await ingest(event('请帮我转人工客服'));validateApiRequest('ReceptionEventAccepted',result);const id=String(resultData(result).conversation_id);assert.equal(handoffs,before+1);
 const conversation=await getReceptionConversation(ctx,id);assert.equal(conversation.data.state,'handoff_requested');assert.equal(conversation.data.handoff_status,'assigned');
 const tasks=(await db.query("SELECT owner_user_id FROM tasks WHERE brief->>'conversation_id'=$1 AND brief->>'handoff'='true'",[id])).rows;assert.equal(tasks.length,1);assert.equal(tasks[0]!.owner_user_id,DEMO_OWNER_ID);
 const normal=await ingest(event('财务系统需求'));await assert.rejects(handoffReception(ctx,String(resultData(normal).conversation_id),{owner_user_id:DEMO_OWNER_ID,reason:'凭模型猜测'},Number((await getReceptionConversation(ctx,String(resultData(normal).conversation_id))).data.version),'not-explicit-handoff',options),{code:'EXPLICIT_HANDOFF_REQUIRED'});
});
test('unknown submit result remains unknown and replay cannot send again',async()=>{
 sendUnknown=true;const input=event('咨询ERP实施');const before=sends;const result=await ingest(input);const id=String(resultData(result).conversation_id);const action=(await db.query("SELECT * FROM execution_actions WHERE target->>'conversation_id'=$1",[id])).rows[0]!;assert.equal(action.state,'unknown');assert.equal(sends,before+1);sendUnknown=false;
 await generateReceptionReply(ctx,id,{conversation_version:Number((action.payload as Record<string,unknown>).conversation_version),reason:'visitor_message',policy_version_id:versionId},String(action.idempotency_key),options);assert.equal(sends,before+1);
});
test('policy revocation blocks new reception send with a visible gap, and no fabricated success',async()=>{
 await revokePolicy(ctx,policyId,2);const before=sends;const result=await ingest(event('撤销后咨询'));validateApiRequest('ReceptionEventAccepted',result);assert.equal(result.gap,'RECEPTION_POLICY_REQUIRED');assert.equal(sends,before);assert.equal(result.sla_verified,false);
});
