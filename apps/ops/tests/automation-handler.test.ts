import test from 'node:test';
import assert from 'node:assert/strict';
import { createTestDatabase, DEMO_ORG_ID, DEMO_OWNER_ID } from '@boran/db';
import { stableHash, uuid, type ServiceContext } from '@boran/domain/core';
import { handleAutomation } from '../src/lib/handlers/automation';
const request=(method:string,path:string,key='automation-qa',version?:number)=>new Request(`http://localhost/api/v1/${path}`,{method,headers:{'idempotency-key':key,...(version?{'if-match':String(version)}:{})}});
test('automation evidence separates modes, omits provider secrets, and edits private immutable versions', async () => {
  const db=await createTestDatabase(),ctx:ServiceContext={db,orgId:DEMO_ORG_ID,actorId:DEMO_OWNER_ID,roles:['owner'],mode:'live'};
  try {
    const topicId=uuid(),itemId=uuid(),oldVersionId=uuid(),runId=uuid();
    await db.query("INSERT INTO topics(id,org_id,business_line,title,audience,problem,offer,angle,dedupe_key,execution_mode) VALUES($1,$2,'shared','QA topic','QA audience','QA problem','QA offer','QA angle',$3,'live')",[topicId,ctx.orgId,stableHash('qa-topic')]);
    for(const mode of ['mock','live'])await db.query("INSERT INTO ai_runs(id,org_id,provider,model,prompt_version,input_hash,source_ids,quality_result,execution_mode,request_metadata) VALUES($1,$2,'deepseek',$3,'qa-v1',$4,'{}',$5,$6,$7)",[mode==='live'?runId:uuid(),ctx.orgId,mode==='live'?'qa-live-model':'qa-mock-model',stableHash(mode),JSON.stringify({schema:'passed',mode,password:'synthetic-provider-secret'}),mode,JSON.stringify({request_id:'synthetic-safe-request',api_key:'synthetic-provider-secret'})]);
    await db.query("INSERT INTO content_items(id,org_id,kind,business_line,owner_user_id,title,topic_id,execution_mode) VALUES($1,$2,'mother_draft','shared',$3,'QA private draft',$4,'live')",[itemId,ctx.orgId,ctx.actorId,topicId]);
    const original={schema:'boran.private-draft.v1',title:'QA private draft',topic_id:topicId,body_blocks:[{type:'paragraph',text:'Synthetic private text'}],claim_refs:[],cta:null,gaps:[{kind:'public_permission',description:'QA permission missing',reference_key:'qa',next_step:'QA verify'}],warnings:['QA review required'],origin:'ai',parent_version_id:null};
    await db.query("INSERT INTO content_versions(id,org_id,content_item_id,body_json,claim_ids,payload_hash,review_status,ai_run_id,warnings,draft_state) VALUES($1,$2,$3,$4,'{}',$5,'draft',$6,$7,'private_candidate')",[oldVersionId,ctx.orgId,itemId,JSON.stringify(original),stableHash(original),runId,JSON.stringify(original.warnings)]);
    await assert.rejects(handleAutomation({...ctx,mode:'mock'},request('GET','automation/status?mode=live'),['automation','status']),{code:'LIVE_IDENTITY_REQUIRED'});
    await assert.rejects(handleAutomation({...ctx,mode:'mock'},request('GET',`automation/drafts/${itemId}?mode=live`),['automation','drafts',itemId]),{code:'LIVE_IDENTITY_REQUIRED'});
    await assert.rejects(handleAutomation({...ctx,mode:'mock'},request('PATCH',`automation/drafts/${itemId}?mode=live`,'mock-escalation',1),['automation','drafts',itemId],{title:'Rejected',body_blocks:[{type:'paragraph',text:'Rejected'}],claim_refs:[]}),{code:'LIVE_IDENTITY_REQUIRED'});
    assert.equal((await db.query('SELECT count(*) AS n FROM content_versions WHERE content_item_id=$1',[itemId])).rows[0]!.n,1);
    const status=await handleAutomation(ctx,request('GET','automation/status?mode=live'),['automation','status']);const data=(await status!.json()).data;
    assert.equal(data.ai_runs.length,1);assert.equal(data.ai_runs[0].model,'qa-live-model');assert.equal(JSON.stringify(data).includes('synthetic-provider-secret'),false);assert.equal(data.drafts.length,1);assert.equal(data.acceptance.requires_business_review,true);
    const mock=await handleAutomation(ctx,request('GET','automation/status?mode=mock'),['automation','status']);assert.equal((await mock!.json()).data.drafts.length,0);
    await assert.rejects(handleAutomation(ctx,request('GET',`automation/drafts/${itemId}?mode=mock`),['automation','drafts',itemId]),{code:'NOT_FOUND'});
    const edit={title:'QA edited private draft',body_blocks:[{type:'paragraph',text:'Edited synthetic text'}],claim_refs:[]};
    const result=await handleAutomation(ctx,request('PATCH',`automation/drafts/${itemId}?mode=live`,'qa-private-edit',1),['automation','drafts',itemId],edit);const saved=(await result!.json()).data;assert.equal(saved.version,2);assert.ok(saved.gaps.some((gap:{description:string})=>gap.description===original.gaps[0]!.description));assert.ok(saved.gaps.some((gap:{description:string})=>gap.description.includes('人工编辑')));assert.equal(saved.aiRunId,runId);assert.equal(saved.state,'private_candidate');
    const repeated=await handleAutomation(ctx,request('PATCH',`automation/drafts/${itemId}?mode=live`,'qa-private-edit',1),['automation','drafts',itemId],edit);assert.equal((await repeated!.json()).meta.idempotency_replay,true);
    assert.deepEqual((await db.query('SELECT body_json FROM content_versions WHERE id=$1',[oldVersionId])).rows[0]!.body_json,original);
    await assert.rejects(handleAutomation(ctx,request('PATCH',`automation/drafts/${itemId}?mode=live`,'qa-clear-gates',2),['automation','drafts',itemId],{...edit,gaps:[],review_status:'approved'}),{code:'INVALID_REQUEST'});
    await assert.rejects(handleAutomation({...ctx,orgId:uuid()},request('GET','automation/status'),['automation','status']),{code:'FORBIDDEN'});
  } finally {await db.close();}
});
