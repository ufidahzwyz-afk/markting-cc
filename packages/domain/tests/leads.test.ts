import assert from 'node:assert/strict';
import { after,before,test } from 'node:test';
import { createTestDatabase,DEMO_ORG_ID,DEMO_OWNER_ID,DEMO_MARKETER_ID,type Database } from '@boran/db';
import { DomainError,stableHash,uuid,type ServiceContext } from '../src/core';
import { createContactCapture,confirmCapture,listLeads,submitPublicLead,transitionLead,updateLead,type ContactCaptureCreate,type LeadSubmit } from '../src/leads';
import { decryptContact,privacyKeys,sanitizeAttribution,sanitizePrivateText,privacyRequest,completePrivacyRequest,validatePrivacyConfiguration,requirePrivacyConfiguration } from '../src/privacy';
let db:Database;let ctx:ServiceContext;let time=new Date('2026-10-03T00:00:00Z');
const synthetic={internalTest:true};
before(async()=>{db=await createTestDatabase();ctx={db,orgId:DEMO_ORG_ID,actorId:DEMO_OWNER_ID,roles:['owner','marketer'],mode:'mock',now:()=>time};});
after(async()=>{await db?.close();});
function capture(event=uuid(),email='capture@example.invalid'):ContactCaptureCreate{return {event_key:event,contact_type:'email',contact_value:email,source_channel:'test',privacy_notice_version:'mock-v1',consent:true,allowed_contact_channels:['email']};}
async function realLead(email:string){const cap=await createContactCapture(ctx,capture(uuid(),email),synthetic);const result=await confirmCapture(ctx,cap.data.capture_id,{reachable_evidence_ref:{kind:'synthetic_verified_delivery'},company:'脱敏测试企业',commercial_intent:'ERP需求',intent_evidence_ref:{kind:'synthetic_test_request'}},1);return {cap,result};}
async function publishedPage(){
 const item=uuid(),version=uuid(),page=uuid(),approval=uuid(),action=uuid(),release=uuid();
 await db.query("INSERT INTO content_items(id,org_id,kind,business_line,owner_user_id,title) VALUES($1,$2,'landing_page','yonyou',$3,'脱敏验收页')",[item,ctx.orgId,ctx.actorId]);
 await db.query("INSERT INTO content_versions(id,org_id,content_item_id,version_no,body_json,claim_ids,payload_hash,review_status,warnings) VALUES($1,$2,$3,1,'{}','{}',$4,'approved','[]')",[version,ctx.orgId,item,stableHash({})]);
 await db.query("INSERT INTO pages(id,org_id,host,path,owner_system,business_line,canonical_url,index_policy,owner_user_id) VALUES($1,$2,'example.invalid',$3,'marketing','yonyou',$4,'noindex',$5)",[page,ctx.orgId,`/test/${page}`,`https://example.invalid/test/${page}`,ctx.actorId]);
 await db.query("INSERT INTO approvals(id,org_id,action_type,target,version_id,payload,payload_hash,before_snapshot,after_preview,budget_impact,requested_by,decision,decided_by,decided_at,expires_at,version) VALUES($1,$2,'content.publish',$3,$4,'{}',$5,'{}','{}','{}',$6,'consumed',$6,now(),now()+interval '1 day',1)",[approval,ctx.orgId,JSON.stringify({page_id:page}),version,stableHash({}),ctx.actorId]);
 await db.query("INSERT INTO execution_actions(id,org_id,approval_id,idempotency_key,request_hash,state,before_snapshot,version,action_type,target,version_id,payload,payload_hash) VALUES($1::uuid,$2,$3,$1::text,$4,'submitted','{}',1,'content.publish',$5,$6,'{}',$4)",[action,ctx.orgId,approval,stableHash({}),JSON.stringify({page_id:page}),version]);
 await db.query("INSERT INTO releases(id,org_id,page_id,content_version_id,action_id,published_at,seo_snapshot,route_config_version) VALUES($1,$2,$3,$4,$5,now(),'{}','test-v1')",[release,ctx.orgId,page,version,action]);
 await db.query('UPDATE pages SET published_release_id=$3 WHERE org_id=$1 AND id=$2',[ctx.orgId,page,release]);return {page,release};
}

test('AC13: concurrent identical submissions persist one capture and identical receipt; changed data conflicts',async()=>{
 const page=await publishedPage();const input:LeadSubmit={submission_id:uuid(),page_id:page.page,release_id:page.release,contact_email:'form@example.invalid',company:'脱敏测试公司',need:'了解ERP系统',privacy_notice_version:'mock-v1',consent:true,attribution:{utm_source:'baidu',query:'邮箱 form@example.invalid',referrer_origin:'https://example.invalid/path?phone=hidden',password:'drop'}};
 const receipts=await Promise.all([submitPublicLead(ctx,input,synthetic),submitPublicLead(ctx,input,synthetic),submitPublicLead(ctx,input,synthetic)]);assert.equal(new Set(receipts.map(r=>r.data.receipt_id)).size,1);
 const row=(await db.query('SELECT * FROM lead_submissions WHERE submission_id=$1',[input.submission_id])).rows;assert.equal(row.length,1);assert.equal(row[0]!.lead_id,null);assert.equal(row[0]!.test_record,true);assert.equal((row[0]!.attribution as Record<string,string>).referrer_origin,'https://example.invalid');assert.equal(JSON.stringify(row).includes(input.contact_email!),false);
 await assert.rejects(submitPublicLead(ctx,{...input,company:'改变企业'},synthetic),{code:'IDEMPOTENCY_CONFLICT'});
 const records=(await db.query('SELECT * FROM lead_contacts WHERE id=$1',[row[0]!.contact_id])).rows[0]!;assert.equal(records.reachable_status,'unknown');assert.equal(records.marketing_consent_status,'denied');assert.ok(String(records.contact_ciphertext).startsWith('v1:'));assert.equal(decryptContact(String(records.contact_ciphertext),privacyKeys(ctx,synthetic).encryption),input.contact_email);
});
test('anonymous form fails closed without privacy config; client cannot mark real PII as a test',async()=>{
 const base:LeadSubmit={submission_id:uuid(),page_id:uuid(),release_id:uuid(),contact_email:'sample@example.invalid',privacy_notice_version:'mock-v1',consent:true};
 await assert.rejects(submitPublicLead({...ctx,mode:'live'},base),{code:'privacy_configuration_required'});
 await assert.rejects(submitPublicLead(ctx,{...base,contact_phone:'1234567',test_record:true},synthetic),{code:'SYNTHETIC_TEST_CONTACT_REQUIRED'});
 await assert.rejects(submitPublicLead(ctx,{...base,honeypot:'bot'},synthetic),{code:'INVALID_SUBMISSION'});
 await assert.rejects(submitPublicLead(ctx,{...base,consent:false} as unknown as LeadSubmit,synthetic),{code:'CONSENT_REQUIRED'});
 await assert.rejects(submitPublicLead(ctx,base,synthetic),{code:'INVALID_PUBLISHED_PAGE'});
});
test('public form rate limit persists across calls; successful receipt retries do not consume another slot',async()=>{
 const page=await publishedPage();const base:LeadSubmit={submission_id:uuid(),page_id:page.page,release_id:page.release,contact_email:'rate@example.invalid',privacy_notice_version:'mock-v1',consent:true};
 const rateOptions={...synthetic,rateLimitKey:'test-peer-only'};await submitPublicLead(ctx,base,rateOptions);for(let i=0;i<9;i++)await submitPublicLead(ctx,{...base,submission_id:uuid()},rateOptions);await submitPublicLead(ctx,base,rateOptions);await assert.rejects(submitPublicLead(ctx,{...base,submission_id:uuid()},rateOptions),{code:'RATE_LIMITED'});
});
test('AC42: capture is not a real lead; reachable plus enterprise intent creates one; 31 days reuses master contact',async()=>{
 time=new Date('2026-10-03T00:00:00Z');const first=await createContactCapture(ctx,capture(uuid(),'dedupe@example.invalid'),synthetic);assert.equal(first.data.classification,'contact_capture');assert.equal(first.data.lead_id,null);
 const confirmed=await confirmCapture(ctx,first.data.capture_id,{reachable_evidence_ref:{kind:'synthetic_delivery'},company:'脱敏企业',commercial_intent:'ERP咨询',intent_evidence_ref:{kind:'test_need'}},1);assert.equal(confirmed.data.deduplicated,false);
 time=new Date('2026-10-31T00:00:00Z');const repeat=await createContactCapture(ctx,{...capture(uuid(),'dedupe@example.invalid'),company:'脱敏企业',commercial_intent:'ERP咨询',intent_evidence_ref:{kind:'second_need'}},synthetic);assert.equal(repeat.data.contact_id,first.data.contact_id);assert.equal(repeat.data.lead_id,confirmed.data.lead_id);assert.equal(repeat.data.deduplicated,true);
 time=new Date('2026-11-03T00:00:00Z');const later=await createContactCapture(ctx,{...capture(uuid(),'dedupe@example.invalid'),company:'脱敏企业',commercial_intent:'ERP咨询',intent_evidence_ref:{kind:'third_need'}},synthetic);assert.equal(later.data.contact_id,first.data.contact_id);assert.notEqual(later.data.lead_id,confirmed.data.lead_id);
 const counts=await db.query('SELECT counted_real_lead,test_record FROM contact_captures WHERE contact_id=$1 ORDER BY captured_at',[first.data.contact_id]);assert.equal(counts.rows.filter(r=>r.counted_real_lead).length,2);assert.ok(counts.rows.every(r=>r.test_record));
 const lead=(await db.query('SELECT last_non_direct_touch FROM leads WHERE id=$1',[later.data.lead_id])).rows[0]!;assert.equal((lead.last_non_direct_touch as Record<string,string>).source,'unknown');time=new Date('2026-10-03T00:00:00Z');
});
test('AC14/34: capability union preserves marketer+sales sharing; pure sales filters and stale If-Match cannot overwrite',async()=>{
 const {result}=await realLead('roles@example.invalid');const id=String(result.data.lead_id);
 const ownerChange=await updateLead(ctx,id,{owner_user_id:DEMO_OWNER_ID,status:'assigned'},1);assert.equal(ownerChange.data.version,2);
 await db.query('UPDATE memberships SET roles=$3 WHERE org_id=$1 AND user_id=$2',[ctx.orgId,DEMO_MARKETER_ID,['marketer','sales']]);const b={...ctx,actorId:DEMO_MARKETER_ID,roles:['marketer','sales']};assert.ok((await listLeads(b)).data.some(l=>l.id===id));
 const races=await Promise.allSettled([updateLead(ctx,id,{status:'contacted'},2),updateLead(b,id,{status:'contacted'},2)]);assert.equal(races.filter(r=>r.status==='fulfilled').length,1);assert.equal((races.find(r=>r.status==='rejected') as PromiseRejectedResult).reason.code,'VERSION_CONFLICT');
 await db.query('UPDATE memberships SET roles=$3 WHERE org_id=$1 AND user_id=$2',[ctx.orgId,DEMO_MARKETER_ID,['sales']]);assert.equal((await listLeads(b)).data.some(l=>l.id===id),false);await assert.rejects(updateLead(b,id,{status:'contacted'},3),{code:'FORBIDDEN'});
 await db.query('UPDATE memberships SET roles=$3 WHERE org_id=$1 AND user_id=$2',[ctx.orgId,DEMO_MARKETER_ID,['marketer','sales']]);
 const stranger={...ctx,actorId:uuid(),roles:['owner']};await assert.rejects(listLeads(stranger),{code:'FORBIDDEN'});
});
test('AC44: no fabricated WON; qualification and complete sales evidence permit skipping unperformed demo/quote',async()=>{
 const {result}=await realLead('funnel@example.invalid');const id=String(result.data.lead_id);
 await assert.rejects(transitionLead(ctx,id,{funnel_stage:'WON',evidence_ref:{kind:'test'},next_step:'履行合同',opportunity_id:null},1),{code:'SALES_QUALIFICATION_REQUIRED'});
 await assert.rejects(updateLead(ctx,id,{status:'qualified'},1),{code:'QUALIFICATION_EVIDENCE_REQUIRED'});
 await updateLead(ctx,id,{owner_user_id:DEMO_OWNER_ID,need:'已确认ERP部署需求',feedback:{next_step:'核验销售接收'},quality_level:'qualified_lead',qualification_evidence_ref:{kind:'sales_confirmation'}},1);
 await assert.rejects(transitionLead(ctx,id,{funnel_stage:'WON',evidence_ref:{kind:'test'},next_step:'履行合同',opportunity_id:null,opportunity_details:{problem:'系统协同',product_or_scope:'ERP',sales_acceptance_evidence:{kind:'accepted'}}},2),{code:'CONTRACT_EVIDENCE_REQUIRED'});
 const won=await transitionLead(ctx,id,{funnel_stage:'WON',evidence_ref:{kind:'synthetic_order'},next_step:'履行合同',opportunity_id:null,opportunity_details:{problem:'系统协同',product_or_scope:'ERP',sales_acceptance_evidence:{kind:'accepted'},contract_or_order_ref:{kind:'synthetic_order',id:'TEST-ORDER'},amount_minor:100,currency:'CNY',won_at:time.toISOString()}},2,'test-won-001') as {data:{funnel_stage:string;version:number}};assert.equal(won.data.funnel_stage,'WON');assert.equal(won.data.version,3);
 const events=(await db.query('SELECT * FROM lead_status_events WHERE lead_id=$1 ORDER BY occurred_at,id',[id])).rows;assert.equal(events.length,2);assert.ok(events.every(e=>e.actor_id===DEMO_OWNER_ID));
});
test('AC45: withdrawal cancels marketing synchronously and each request keeps its own audit and downstream receipt',async()=>{
 const {cap}=await realLead('privacy@example.invalid');const contactId=cap.data.contact_id;const contact=(await db.query('SELECT version FROM lead_contacts WHERE id=$1',[contactId])).rows[0]!;
 await db.query("INSERT INTO tasks(org_id,type,title,brief,business_line,owner_user_id,due_at,priority,status,version) VALUES($1,'followup','模拟营销',$2,'unknown',$3,now(),'P1','todo',1)",[ctx.orgId,JSON.stringify({contact_id:contactId,marketing:true}),ctx.actorId]);
 const withdraw=await privacyRequest(ctx,contactId,{request_type:'withdraw'},Number(contact.version),'privacy-withdraw-001') as {data:{request_id:string;contact_version:number}};
 assert.equal((await db.query("SELECT status FROM tasks WHERE brief->>'contact_id'=$1",[contactId])).rows[0]!.status,'cancelled');assert.equal((await db.query('SELECT marketing_consent_status FROM lead_contacts WHERE id=$1',[contactId])).rows[0]!.marketing_consent_status,'withdrawn');
 await assert.rejects(completePrivacyRequest(ctx,withdraw.data.request_id,{async process(){return {verified:false,evidence_ref:{}};}}),{code:'PRIVACY_VERIFICATION_REQUIRED'});
 const exported=await privacyRequest(ctx,contactId,{request_type:'export'},withdraw.data.contact_version,'privacy-export-001') as {data:{request_id:string}};
 await completePrivacyRequest(ctx,withdraw.data.request_id,{async process(){return {verified:true,evidence_ref:{kind:'synthetic_stop_receipt'}};}});
 await completePrivacyRequest(ctx,exported.data.request_id,{async process(){return {verified:true,evidence_ref:{kind:'synthetic_export_receipt'}};}});
 assert.equal((await db.query("SELECT count(*)::int count FROM workflow_runs WHERE kind='privacy_request' AND input_ref->>'contact_id'=$1",[contactId])).rows[0]!.count,2);assert.equal((await db.query("SELECT count(*)::int count FROM audit_logs WHERE target_id=$1 AND action LIKE 'contact.%.verified'",[contactId])).rows[0]!.count,2);
});
test('privacy approval completeness, query/attribution redaction and secret-safe HMAC storage',async()=>{
 await assert.rejects(validatePrivacyConfiguration(ctx,{enabled:true}),{code:'INVALID_PRIVACY_CONFIGURATION'});await assert.rejects(validatePrivacyConfiguration({...ctx,actorId:DEMO_MARKETER_ID,roles:['owner']},{enabled:false}),{code:'FORBIDDEN'});
 const valid=await validatePrivacyConfiguration(ctx,{enabled:true,notice_version:'v1',notice_text:'咨询处理告知：目的、保留期与权利申请流程',consultation_purpose:'咨询处理',lawful_basis:'consultation_consent',retention_days:30,allowed_contact_channels:['email'],pii_access_roles:['owner','marketer'],responsible_user_id:ctx.actorId,deletion_policy:'删除派生副本和到期备份',export_policy:'本人核验后私有导出',cross_border_assessment:'not_applicable'});assert.equal(valid.approved_by,ctx.actorId);
 assert.equal(sanitizePrivateText('联系我 test@example.invalid 微信: test_user'), '联系我 [邮箱已脱敏] 微信: [联系方式已脱敏]');
 const safe=sanitizeAttribution({utm_source:'baidu',password:'secret',referrer_origin:'https://example.invalid/path?email=hidden',query:'邮箱:test@example.invalid'});assert.equal(safe.password,undefined);assert.equal(safe.referrer_origin,'https://example.invalid');assert.equal(String(safe.query).includes('@'),false);
 const audit=JSON.stringify((await db.query('SELECT details FROM audit_logs')).rows);assert.equal(audit.includes('@example.invalid'),false);
});
test('privacy config rejects hidden fields and cached approval cannot survive approver or recipient deactivation',async()=>{
 const configuration={enabled:true,notice_version:'active-gate-v1',notice_text:'脱敏权限撤销验收配置，不接收实际咨询',consultation_purpose:'权限验证',lawful_basis:'synthetic_test_only',retention_days:1,allowed_contact_channels:['email'],pii_access_roles:['owner'],responsible_user_id:DEMO_MARKETER_ID,deletion_policy:'测试删除',export_policy:'测试导出',cross_border_assessment:'not_applicable'};
 await assert.rejects(validatePrivacyConfiguration(ctx,{...configuration,password:'must-never-persist'}),{code:'INVALID_PRIVACY_CONFIGURATION'});
 await assert.rejects(validatePrivacyConfiguration(ctx,{...configuration,approved_by:ctx.actorId}),{code:'INVALID_PRIVACY_CONFIGURATION'});
 await assert.rejects(validatePrivacyConfiguration(ctx,{...configuration,notice_text:'x'.repeat(20001)}),{code:'INVALID_PRIVACY_CONFIGURATION'});
 const config=await validatePrivacyConfiguration(ctx,configuration);await db.query("INSERT INTO settings(org_id,key,value,schema_version,updated_by) VALUES($1,'privacy_configuration',$2,1,$3) ON CONFLICT(org_id,key) DO UPDATE SET value=EXCLUDED.value",[ctx.orgId,JSON.stringify(config),ctx.actorId]);
 const enabled=process.env.PRODUCTION_PII_AUTOMATION_ENABLED;process.env.PRODUCTION_PII_AUTOMATION_ENABLED='true';const options={encryptionKey:'11'.repeat(32),hmacKey:'22'.repeat(32)};const live={...ctx,mode:'live' as const};
 try{
  await requirePrivacyConfiguration(live,options);
  await db.query('UPDATE users SET active=false WHERE id=$1',[ctx.actorId]);
  await assert.rejects(requirePrivacyConfiguration(live,options),{code:'privacy_configuration_required'});await assert.rejects(validatePrivacyConfiguration(ctx,{enabled:false}),{code:'FORBIDDEN'});
  await db.query('UPDATE users SET active=true WHERE id=$1',[ctx.actorId]);await db.query('UPDATE memberships SET active=false WHERE org_id=$1 AND user_id=$2',[ctx.orgId,DEMO_MARKETER_ID]);
  await assert.rejects(requirePrivacyConfiguration(live,options),{code:'privacy_configuration_required'});
  await db.query('UPDATE memberships SET active=true WHERE org_id=$1 AND user_id=$2',[ctx.orgId,DEMO_MARKETER_ID]);await db.query('UPDATE users SET active=false WHERE id=$1',[DEMO_MARKETER_ID]);
  await assert.rejects(requirePrivacyConfiguration(live,options),{code:'privacy_configuration_required'});
 }finally{
  await db.query('UPDATE users SET active=true WHERE id=ANY($1::uuid[])',[[ctx.actorId,DEMO_MARKETER_ID]]);await db.query('UPDATE memberships SET active=true WHERE org_id=$1 AND user_id=$2',[ctx.orgId,DEMO_MARKETER_ID]);if(enabled===undefined)delete process.env.PRODUCTION_PII_AUTOMATION_ENABLED;else process.env.PRODUCTION_PII_AUTOMATION_ENABLED=enabled;
 }
});
test('freeform capture intent and evidence never persist raw contacts or embedded credentials; disabled members cannot own leads',async()=>{
 const cap=await createContactCapture(ctx,{...capture(uuid(),'redaction@example.invalid'),company:'脱敏质检企业',commercial_intent:'邮箱 intent@example.invalid',intent_evidence_ref:{kind:'synthetic_confirmation',api_key:'synthetic-secret-marker',nested:{authorization:'synthetic-auth-marker',description:'请联系 evidence@example.invalid'}}},{...synthetic,reachableEvidence:{kind:'synthetic_verified_delivery'}});
 const id=String(cap.data.lead_id);assert.ok(id);const lead=(await db.query('SELECT commercial_intent,need,intent_evidence_ref FROM leads WHERE id=$1',[id])).rows[0]!;const captureRow=(await db.query('SELECT intent_type,intent_evidence_ref FROM contact_captures WHERE id=$1',[cap.data.capture_id])).rows[0]!;
 const freeform=JSON.stringify({lead,captureRow});assert.equal(freeform.includes('@example.invalid'),false);assert.equal(freeform.includes('synthetic-secret-marker'),false);assert.equal(freeform.includes('synthetic-auth-marker'),false);
 await db.query('UPDATE users SET active=false WHERE id=$1',[DEMO_MARKETER_ID]);try{await assert.rejects(updateLead(ctx,id,{owner_user_id:DEMO_MARKETER_ID},1),{code:'INVALID_OWNER'});}finally{await db.query('UPDATE users SET active=true WHERE id=$1',[DEMO_MARKETER_ID]);}
});
