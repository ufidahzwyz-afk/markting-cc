import test from 'node:test';
import assert from 'node:assert/strict';
import {createServer,type Server} from 'node:http';
import {once} from 'node:events';
import React from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import {createTestDatabase,DEMO_OWNER_ID,DEMO_MARKETER_ID,type Database} from '@boran/db';
import {PageRenderer} from '@boran/ui/page-renderer';
import {tsImport} from 'tsx/esm/api';
const {LeadForm}=await tsImport('../../apps/public-site/src/app/lead-form.tsx',{parentURL:import.meta.url,tsconfig:new URL('../../apps/public-site/tsconfig.json',import.meta.url).pathname}) as typeof import('../../apps/public-site/src/app/lead-form');
import {DomainError,uuid,type ServiceContext} from '@boran/domain/core';
import {activatePolicy,createPolicy,createExecutionAction} from '@boran/domain/execution';
import {createContentItem,createContentVersion,createPage,getPagePreview,publishPage,readPublishedPage,reviewContentVersion,rollbackPage,verifyPageRelease,type SitePolicy} from '@boran/domain/content';
import {submitPublicLead,confirmCapture,listLeads,updateLead,type LeadSubmit} from '@boran/domain/leads';
import {validatePrivacyConfiguration} from '@boran/domain/privacy';
const modules=(headline='跨模块集成服务说明',form=false):unknown[]=>[
 {type:'hero',schema_version:1,data:{headline,description:'先梳理企业实际需求，再讨论应用集成范围。',cta:{label:'查看服务说明',href:'/articles/fixture',action:'navigate'}}},
 {type:'solution',schema_version:1,data:{heading:'集成准备',body:[{type:'paragraph',text:'按实际业务确认数据责任人与范围。'}],claim_ids:[]}},
 ...(form?[{type:'lead_form',schema_version:1,data:{heading:'咨询集成范围',form_schema_id:'lead_form_v1',privacy_notice_version:'mock-v1',submit_label:'提交咨询'}}]:[]),
 {type:'cta',schema_version:1,data:{heading:'后续准备',button:{label:'服务说明',href:'/articles/fixture',action:'navigate'}}},
];
async function setup(form=false){
 const db=await createTestDatabase();const orgId=uuid();await db.query("INSERT INTO organizations(id,name,timezone,base_currency,write_enabled,created_at,updated_at) VALUES($1,'独立内容与线索质检组织','Asia/Shanghai','CNY',false,now(),now())",[orgId]);
 for(const [id,roles]of [[DEMO_OWNER_ID,['owner','marketer']],[DEMO_MARKETER_ID,['marketer','sales']]] as const)await db.query('INSERT INTO memberships(org_id,user_id,roles,active) VALUES($1,$2,$3,true)',[orgId,id,[...roles]]);
 const ctx:ServiceContext={db,orgId,actorId:DEMO_OWNER_ID,roles:['owner','marketer'],mode:'mock'};
 const server=createServer();server.listen(0,'127.0.0.1');await once(server,'listening');const address=server.address();if(!address||typeof address==='string')throw new Error('Server did not listen');
 const origin=`http://127.0.0.1:${address.port}`;const policy:SitePolicy={publicOrigin:origin,allowedPathPrefixes:['/articles']};
 const rule=await createPolicy(ctx,{name:'独立跨模块页面规则',businessScope:{business_lines:['shared']},accountIds:[],allowedActions:['content.publish'],approvedPathPrefixes:['/articles'],stopConditions:{manual_stop:true}});const versionId=String((await db.query('SELECT id FROM policy_versions WHERE policy_id=$1',[rule.id])).rows[0]!.id);await activatePolicy(ctx,String(rule.id),versionId,1);
 const item=await createContentItem(ctx,{title:'跨模块集成服务',business_line:'shared',kind:'article'});const version=await createContentVersion(ctx,item.id,{title:'跨模块集成服务',modules:modules(undefined,form),claim_ids:[]},0);await reviewContentVersion(ctx,version.id,{review_status:'approved'});
 const page=await createPage(ctx,{host:new URL(origin).host,path:'/articles/fixture',business_line:'shared',template_key:'article',content_item_id:item.id,seo_title:'跨模块集成服务说明',description:'独立质检服务页面与联系方式接收的关联。',canonical_url:`${origin}/articles/fixture`,index_policy:'noindex',...(form?{form_schema_id:'lead_form_v1'}:{})},policy);
 server.on('request',async(request,response)=>{try{
  const published=await readPublishedPage(db,orgId,new URL(origin).host,request.url ?? '/');if(!published){response.writeHead(404);response.end('Not found');return;}
  const html=renderToStaticMarkup(React.createElement('article',{'data-release-id':published.release.id,'data-content-hash':published.content.payload_hash,'data-mode':'mock'},React.createElement(PageRenderer,{modules:published.modules,renderLeadForm:data=>React.createElement(LeadForm,{pageId:published.page.id,releaseId:published.release.id,noticeVersion:data.privacy_notice_version,submitLabel:data.submit_label,enabled:false,mock:true})})));
  response.writeHead(200,{'Content-Type':'text/html; charset=utf-8'});response.end(html);
 }catch{response.writeHead(503);response.end('Unavailable');}});
 async function action(contentId=version.id){const body=(await db.query('SELECT body_json FROM content_versions WHERE id=$1',[contentId])).rows[0]!.body_json as Record<string,unknown>;return createExecutionAction(ctx,{idempotencyKey:`qa-publish:${uuid()}`,actionType:'content.publish',target:{page_id:page.page_id,business_line:'shared'},versionId:contentId,payload:body,beforeSnapshot:{},policyVersionId:versionId});}
 async function close(){server.close();await once(server,'close');await db.close();}
 return {db,ctx,server,origin,policy,item,version,page,action,close};
}
async function configure(value:Awaited<ReturnType<typeof setup>>){
 const configuration=await validatePrivacyConfiguration(value.ctx,{enabled:true,notice_version:'mock-v1',notice_text:'这是脱敏验收环境。仅处理指定测试邮箱。本次咨询许可与营销同意分开，可申请删除、撤回、导出。',consultation_purpose:'合成咨询验收',lawful_basis:'synthetic_test_only',retention_days:1,allowed_contact_channels:['email'],pii_access_roles:['owner','marketer'],responsible_user_id:value.ctx.actorId,deletion_policy:'删除测试派生副本与到期备份',export_policy:'本人与受理人核验后私有导出',cross_border_assessment:'not_applicable'});
 await value.db.query("INSERT INTO settings(org_id,key,value,schema_version,updated_by) VALUES($1,'privacy_configuration',$2,1,$3)",[value.ctx.orgId,JSON.stringify(configuration),value.ctx.actorId]);return configuration;
}
const code=(expected:string)=>(error:unknown)=>error instanceof DomainError&&error.code===expected;

test('T3 independent: anonymous published read never exposes draft; rollback restores body and canonical through actual HTTP',async()=>{
 const value=await setup();try{
  assert.equal((await fetch(`${value.origin}/articles/fixture`)).status,404);const preview=await getPagePreview(value.ctx,value.page.page_id);assert.ok(preview.preview);
  const firstAction=await value.action();const first=await publishPage(value.ctx,{pageId:value.page.page_id,contentVersionId:value.version.id,actionId:String(firstAction.id),expectedVersion:1},value.policy);const firstHttp=await fetch(`${value.origin}/articles/fixture`);assert.equal(firstHttp.status,200);assert.match(await firstHttp.text(),/跨模块集成服务说明/);
  const second=await createContentVersion(value.ctx,value.item.id,{title:'新草稿标题',modules:modules('尚未发布的私有草稿'),claim_ids:[]},1);assert.doesNotMatch(await(await fetch(`${value.origin}/articles/fixture`)).text(),/尚未发布的私有草稿/);
  await reviewContentVersion(value.ctx,second.id,{review_status:'approved'});const action=await value.action(second.id);const published=await publishPage(value.ctx,{pageId:value.page.page_id,contentVersionId:second.id,actionId:String(action.id),expectedVersion:2},value.policy);assert.match(await(await fetch(`${value.origin}/articles/fixture`)).text(),/尚未发布的私有草稿/);
  const rollbackAction=await value.action();const rollback=await rollbackPage(value.ctx,{pageId:value.page.page_id,releaseId:first.release_id,actionId:String(rollbackAction.id),expectedVersion:3},value.policy);assert.notEqual(rollback.release_id,first.release_id);assert.notEqual(rollback.release_id,published.release_id);const restored=await readPublishedPage(value.db,value.ctx.orgId,new URL(value.origin).host,'/articles/fixture');assert.equal(restored?.release.seo_snapshot.canonical,`${value.origin}/articles/fixture`);assert.doesNotMatch(await(await fetch(`${value.origin}/articles/fixture`)).text(),/尚未发布的私有草稿/);
 }finally{await value.close();}
});
test('T3 independent: readback must match actual visible body, not just current data attributes; mock stays excluded',async()=>{
 const value=await setup();try{
  const action=await value.action();const release=await publishPage(value.ctx,{pageId:value.page.page_id,contentVersionId:value.version.id,actionId:String(action.id),expectedVersion:1},value.policy);
  await assert.rejects(verifyPageRelease(value.ctx,release.release_id,value.policy,async()=>new Response(`<article data-release-id="${release.release_id}" data-content-hash="${value.version.payload_hash}"><h1>错误的正文</h1></article>`,{headers:{'Content-Type':'text/html'}})),code('PAGE_READBACK_CONTENT_MISMATCH'));
  const verified=await verifyPageRelease(value.ctx,release.release_id,value.policy);assert.equal(verified.state,'mock_verified');assert.equal(verified.real_integration_accepted,false);
  const persisted=(await value.db.query('SELECT state,verified_at FROM execution_actions WHERE id=$1',[action.id])).rows[0]!;assert.equal(persisted.state,'verification_pending');assert.equal(persisted.verified_at,null);
 }finally{await value.close();}
});
test('T3/T6 independent: owner privacy approval schema unlocks only explicit synthetic form, then capture and two-user optimistic update',async()=>{
 const value=await setup(true);const names=['PUBLIC_SITE_ALLOW_MOCK_FORMS','APP_ENV','AUTH_MODE','BORAN_MODE'] as const;const previous=Object.fromEntries(names.map(name=>[name,process.env[name]]));process.env.APP_ENV='test';process.env.AUTH_MODE='mock';process.env.BORAN_MODE='mock';process.env.PUBLIC_SITE_ALLOW_MOCK_FORMS='false';try{
  const action=await value.action();await assert.rejects(publishPage(value.ctx,{pageId:value.page.page_id,contentVersionId:value.version.id,actionId:String(action.id),expectedVersion:1},value.policy),error=>error instanceof DomainError&&['FORM_NOT_READY','privacy_configuration_required'].includes(error.code));
  const config=await configure(value);assert.equal(config.approved_by,value.ctx.actorId);assert.equal('approved' in config,false);process.env.PUBLIC_SITE_ALLOW_MOCK_FORMS='true';
  const release=await publishPage(value.ctx,{pageId:value.page.page_id,contentVersionId:value.version.id,actionId:String(action.id),expectedVersion:1},value.policy);
  const input:LeadSubmit={submission_id:uuid(),page_id:value.page.page_id,release_id:release.release_id,contact_email:'integration@example.invalid',company:'脱敏集成企业',need:'核验ERP与协同系统集成需求',privacy_notice_version:'mock-v1',consent:true};
  const receipts=await Promise.all([submitPublicLead(value.ctx,input,{internalTest:true}),submitPublicLead(value.ctx,input,{internalTest:true})]);assert.equal(receipts[0]!.data.receipt_id,receipts[1]!.data.receipt_id);const submission=(await value.db.query('SELECT * FROM lead_submissions WHERE submission_id=$1',[input.submission_id])).rows[0]!;assert.equal(submission.lead_id,null);
  const real=await confirmCapture(value.ctx,String(submission.capture_id),{reachable_evidence_ref:{kind:'synthetic_verified_delivery'},company:'脱敏集成企业',commercial_intent:'系统集成',intent_evidence_ref:{kind:'synthetic_form_need',submission_id:input.submission_id}},1);
  const b={...value.ctx,actorId:DEMO_MARKETER_ID,roles:['marketer','sales']};const lead=(await listLeads(b)).data.find(row=>row.id===real.data.lead_id)!;assert.equal(lead.business_line,'shared');assert.equal((lead.first_touch as Record<string,unknown>).page_id,value.page.page_id);
  const races=await Promise.allSettled([updateLead(value.ctx,String(real.data.lead_id),{status:'contacted'},1),updateLead(b,String(real.data.lead_id),{status:'contacted'},1)]);assert.equal(races.filter(result=>result.status==='fulfilled').length,1);assert.equal(races.filter(result=>result.status==='rejected').length,1);
  const html=await(await fetch(`${value.origin}/articles/fixture`)).text();assert.match(html,/本地测试仅允许/);assert.match(html,/name="marketing_consent"/);assert.doesNotMatch(html,/name="marketing_consent"[^>]*checked/);
 }finally{for(const name of names){if(previous[name]===undefined)delete process.env[name];else process.env[name]=previous[name];}await value.close();}
});
test('T3 independent: inactive membership cannot read private page preview through cached roles',async()=>{
 const value=await setup();try{
  await value.db.query('UPDATE memberships SET active=false WHERE org_id=$1 AND user_id=$2',[value.ctx.orgId,value.ctx.actorId]);await assert.rejects(getPagePreview(value.ctx,value.page.page_id),code('FORBIDDEN'));
 }finally{await value.close();}
});
test('T3/T6 independent: PII default-off, honeypot and stale release protect current anonymous form',async()=>{
 const value=await setup();try{
  const action=await value.action();const release=await publishPage(value.ctx,{pageId:value.page.page_id,contentVersionId:value.version.id,actionId:String(action.id),expectedVersion:1},value.policy);
  const input:LeadSubmit={submission_id:uuid(),page_id:value.page.page_id,release_id:release.release_id,contact_email:'disabled@example.invalid',privacy_notice_version:'mock-v1',consent:true};await assert.rejects(submitPublicLead({...value.ctx,mode:'live'},input),code('privacy_configuration_required'));
  await assert.rejects(submitPublicLead(value.ctx,{...input,honeypot:'spam'},{internalTest:true}),code('INVALID_SUBMISSION'));
  const another=await value.action();await publishPage(value.ctx,{pageId:value.page.page_id,contentVersionId:value.version.id,actionId:String(another.id),expectedVersion:2},value.policy);await assert.rejects(submitPublicLead(value.ctx,input,{internalTest:true}),code('INVALID_PUBLISHED_PAGE'));
  assert.equal((await value.db.query('SELECT count(*)::int count FROM lead_submissions WHERE org_id=$1',[value.ctx.orgId])).rows[0]!.count,0);
 }finally{await value.close();}
});

test('T3 independent: scroll-to-form CTA survives contract validation while unrelated fragments stay blocked',async()=>{
 const value=await setup();try{
  const anchored=modules('留资入口联调',true) as Array<{type:string;schema_version:number;data:Record<string,unknown>}>;anchored[0]!.data.cta={label:'咨询集成范围',href:'#lead-form',action:'scroll_to_form'};
  const result=await createContentVersion(value.ctx,value.item.id,{title:'本页留资入口',modules:anchored,claim_ids:[]},1);assert.equal(result.version,2);
  const malicious=structuredClone(anchored);malicious[0]!.data.cta={label:'未授权锚点',href:'#admin',action:'scroll_to_form'};await assert.rejects(createContentVersion(value.ctx,value.item.id,{title:'拒绝非表单锚点',modules:malicious,claim_ids:[]},2),code('INVALID_PAGE_MODULES'));
 }finally{await value.close();}
});
