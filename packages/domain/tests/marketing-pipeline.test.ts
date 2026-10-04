import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {createTestDatabase,openDatabase,migrateDatabase,seedDemo,DEMO_ORG_ID,DEMO_OWNER_ID,type Database} from '@boran/db';
import {aiOutputHash,validateAiOutput,type AiOutput} from '@boran/contracts';
import {uuid,stableHash,type ServiceContext} from '../src/core';
import {initializeBusinessMaster,ingestSourceRead,verifyEvidenceClaim,createEvidenceClaim,listSources,getSource,listSourceVersions,listClaims,listInsights,listTopics,getTopic} from '../src/marketing';
import {buildMarketingAiRequest,restorePreparedMarketingAiRequest,persistInsightTopics,persistPrivateDraft,getPrivateDraft,editPrivateDraft,listPrivateDrafts,type MarketingAiRequest,type MarketingAiResult} from '../src/marketing-pipeline';
import {createContentVersion,reviewContentVersion} from '../src/content';
import {createPolicy} from '../src/execution';
import {getWorkspaceThemes} from '../src/workspace';
import type {SourceSnapshot} from '@boran/connectors/sources';
async function testDatabase():Promise<Database>{
 if(!process.env.BORAN_TEST_PG_URL)return createTestDatabase();
 const admin=await openDatabase({url:process.env.BORAN_TEST_PG_URL,mode:'live'}),schema=`pipeline_test_${uuid().replace(/-/g,'')}`;
 await admin.query(`CREATE SCHEMA ${schema}`);
 const scoped=new URL(process.env.BORAN_TEST_PG_URL);scoped.searchParams.set('options',`-csearch_path=${schema}`);
 let db:Database|undefined;
 try{db=await openDatabase({url:scoped.toString(),mode:'live'});await migrateDatabase(db);await seedDemo(db);}catch(error){await db?.close();await admin.query(`DROP SCHEMA ${schema} CASCADE`);await admin.close();throw error;}
 const close=db.close;db.close=async()=>{try{await close();await admin.query(`DROP SCHEMA ${schema} CASCADE`);}finally{await admin.close();}};return db;
}
const hash=(text:string)=>createHash('sha256').update(text).digest('hex');
function fixtureResult(request:MarketingAiRequest,output:unknown):MarketingAiResult {const parsed=validateAiOutput(output,request.context);return {output:parsed,metadata:{mode:'mock',simulation:true,model:'fixture-not-business-evidence',output_hash:aiOutputHash(parsed),provider:'fixture',prompt_version:'fixture-v1',usage:{input_tokens:42,output_tokens:64},latency_ms:1}};}
function insights(request:MarketingAiRequest):MarketingAiResult {
  const changed=(request.input['changed_source_version_ids'] as string[])[0]!,source=request.context.sourceVersions.find(source=>source['source_version_id']===changed)!,material=(request.input['source_materials'] as {source_version_id:string;segments:{text:string}[]}[]).find(source=>source.source_version_id===changed)!;
  const locator=request.context.locators!.find(locator=>locator.source_version_id===changed)!.locator;
  return fixtureResult(request,{workflow:'insight_topics',schema_version:2,source_versions:request.context.sourceVersions,claims:[{claim_key:'source_fact',claim_id:null,claim_text:material.segments[0]!.text,source_version_id:source['source_version_id'],locator,assertion_type:'fact',decision_status:null,decision_evidence_ref:null,supersedes_claim_id:null,inference_rationale:null}],policy_refs:[],output:{data_cutoff:request.context.dataCutoff,insights:[{proposal_key:'insight',insight_id:null,summary:'经营资料出现服务范围更新',business_line:'shared',customer_problem:'客户需要了解服务边界',opportunity:'解释最新服务范围',inference_text:null,priority_score:null,priority_reason:'新来源支持客户教育',data_cutoff:request.context.dataCutoff,evidence:[{claim_key:'source_fact',relation:'supports'}],candidate_state:'candidate',gaps:[],next_step:'生成私有候选稿'}],topics:[{proposal_key:'topic',topic_id:null,insight_key:'insight',business_line:'shared',title:'企业应用服务范围说明',audience:'企业信息负责人',problem:'了解实施边界',offer:'服务范围说明',angle:'解答客户常见疑问',keywords:['服务范围'],claim_keys:['source_fact'],targets:[],priority:0,priority_reason:'模型建议高优先级（仍由服务端判定）',policy_version_id:null,proposed_scheduled_at:null,auto_schedule_candidate:false,gaps:[{kind:'account',description:'尚未选择实际发布账号',reference_key:null,next_step:'先保留私有草稿'}],metric_keys:['inquiries'],industry_key:null,product_family_key:null,domain_keys:[]}],source_gaps:[]}});
}
function draft(request:MarketingAiRequest):MarketingAiResult {
 const topic=request.input['topic'] as Record<string,unknown>;const claim=request.context.trustedClaims!.find(claim=>(topic['claim_ids'] as string[]).includes(String(claim['claim_id'])))!;const sourceClaim={claim_key:'existing',claim_id:claim['claim_id'],claim_text:claim['claim_text'],source_version_id:claim['source_version_id'],locator:claim['locator'],assertion_type:claim['assertion_type'],decision_status:claim['decision_status'],decision_evidence_ref:claim['decision_evidence_ref'],supersedes_claim_id:claim['supersedes_claim_id'],inference_rationale:claim['inference_rationale']};
 return fixtureResult(request,{workflow:'content_draft',schema_version:2,source_versions:request.context.sourceVersions,claims:[sourceClaim],policy_refs:[],output:{title:'企业应用服务范围说明',body_blocks:[{type:'paragraph',text:claim['claim_text']}],claim_refs:[{block_index:0,claim_id:claim['claim_id']}],cta:request.input['cta'],warnings:['主张待核实，仅作私有候选'],topic_id:(request.input['topic'] as Record<string,unknown>)['topic_id'],source_claim_keys:['existing'],gaps:[{kind:'fact',description:'资料待核实',reference_key:null,next_step:'核对原文'}]}});
}
test('source changes persist traceable private drafts, survive duplicate tasks and retain operator versions',async t=>{
 const db=await testDatabase(),ctx:ServiceContext={db,orgId:DEMO_ORG_ID,actorId:DEMO_OWNER_ID,roles:['owner','marketer'],mode:'mock',now:()=>new Date('2026-10-04T02:00:00Z')};
 const connectionId=uuid(),texts=new Map<string,string>();let cursor:unknown=null;
 try{
  await initializeBusinessMaster(ctx);
  await db.query("INSERT INTO connections(id,org_id,provider,account_external_id,display_name,timezone,currency,source_kind,read_mode,scope_json) VALUES($1,$2,'mock',$3,'Synthetic source fixture','Asia/Shanghai','CNY','mac_drive','mock','{}')",[connectionId,ctx.orgId,uuid()]);
  async function ingest(revision:string,text:string):Promise<string>{const objectKey=`mock-private/${revision}`,snapshot:SourceSnapshot={providerFileId:'fixture-document',title:'合成工程来源',revision,contentHash:hash(text),objectKey,mimeType:'text/plain',textObjectKey:objectKey,textHash:hash(text),retrievedAt:`2026-10-04T0${revision==='r1'?'0':'1'}:00:00Z`,sourceModifiedAt:`2026-10-04T0${revision==='r1'?'0':'1'}:00:00Z`,visibility:'internal',coverage:{status:'complete',scope:'synthetic test only',start_locator:'paragraph:1',end_locator:'paragraph:1'}};texts.set(objectKey,text);const next={revision};const result=await ingestSourceRead(ctx,{connectionId,expectedCursorHash:stableHash(cursor),result:{status:'changed',mode:'mock',snapshots:[snapshot],nextCursor:next,gaps:[]}});cursor=next;return result.sourceVersionIds[0]!;}
  const v1=await ingest('r1','泊冉提供企业应用实施服务。');
  const build=(input:Omit<Parameters<typeof buildMarketingAiRequest>[1],'loadText'>)=>buildMarketingAiRequest(ctx,{...input,loadText:async key=>texts.get(key)!});
  const request1=await build({workflow:'insight_topics',sourceVersionIds:[v1]});
  let topic1='',itemId='',manualVersionId='';
  await t.test('invented facts and overwritten model source input are rejected atomically',async()=>{
   const fake=insights(request1);fake.output.claims[0]!.claim_text='资料未支持的99%保证';fake.metadata.output_hash=aiOutputHash(fake.output);
   await assert.rejects(persistInsightTopics(ctx,{request:request1,result:fake}),/copy the cited source excerpt/);
   assert.equal(Number((await db.query('SELECT count(*) AS n FROM ai_runs')).rows[0]!['n']),0);
   const replaced={...request1,input:{...request1.input}};
   await assert.rejects(persistInsightTopics(ctx,{request:replaced,result:insights(request1)}),{code:'AI_INPUT_NOT_SERVICE_BUILT'});
  });
  await t.test('an expired or superseded workflow lease cannot persist paid model output',async()=>{
   const runId=uuid(),stepId=uuid();
   await db.query("INSERT INTO workflow_runs(id,org_id,kind,period_key,status,input_ref) VALUES($1,$2,'insight_topics',$3,'running','{}')",[runId,ctx.orgId,uuid()]);
   await db.query("INSERT INTO workflow_steps(id,org_id,run_id,step_key,state,input_ref,lease_owner,fencing_token,lease_until) VALUES($1,$2,$3,'insights','running','{}','worker-new',2,$4)",[stepId,ctx.orgId,runId,'2026-10-04T03:00:00Z']);
   await assert.rejects(persistInsightTopics(ctx,{workflowRunId:runId,fence:{runId,stepId,leaseOwner:'worker-old',fencingToken:1},request:request1,result:insights(request1)}),{code:'STALE_WORKFLOW_LEASE'});
   await db.query('UPDATE workflow_steps SET lease_until=$2 WHERE id=$1',[stepId,'2026-10-04T01:00:00Z']);
   await assert.rejects(persistInsightTopics(ctx,{workflowRunId:runId,fence:{runId,stepId,leaseOwner:'worker-new',fencingToken:2},request:request1,result:insights(request1)}),{code:'STALE_WORKFLOW_LEASE'});
   assert.equal(Number((await db.query('SELECT count(*) AS n FROM ai_runs')).rows[0]!['n']),0);
   assert.equal(Number((await db.query('SELECT count(*) AS n FROM evidence_claims')).rows[0]!['n']),0);
  });
  await t.test('provider bodies or secret fields in model run metadata are rejected before persistence',async()=>{
   for(const extra of [{apiKey:'synthetic-secret-never-log'},{usage:{input_tokens:42,output_tokens:64,provider_body:'synthetic-secret-never-log'}},{attempts:[{raw_response:'synthetic-secret-never-log'}]}]){
    const result=insights(request1);Object.assign(result.metadata,extra);
    await assert.rejects(persistInsightTopics(ctx,{request:request1,result}),(error:unknown)=>{assert.equal((error as {code:string}).code,'AI_RUN_METADATA_INVALID');assert.ok(!String(error).includes('synthetic-secret-never-log'));return true;});
   }
   assert.equal(Number((await db.query('SELECT count(*) AS n FROM ai_runs')).rows[0]!['n']),0);
  });
  await t.test('real text and current master/rules populate semantic context rather than empty references',()=>{assert.equal(request1.context.sourceVersions.length,1);assert.equal((request1.input['current_business_master'] as unknown[]).length,53);assert.equal((request1.input['source_materials'] as {segments:{text:string}[]}[])[0]!.segments[0]!.text,'泊冉提供企业应用实施服务。');assert.equal(request1.context.locators!.length,1);});
  await t.test('model high priority and new facts remain unverified candidates with server UUIDs',async()=>{
   const saved=await persistInsightTopics(ctx,{request:request1,result:insights(request1)});topic1=saved.topicIds[0]!;assert.equal(saved.insightIds.length,1);assert.equal(saved.claimIds.length,1);
   const claim=(await db.query('SELECT * FROM evidence_claims WHERE id=$1',[saved.claimIds[0]])).rows[0]!;assert.equal(claim['verification_status'],'unverified');assert.equal(claim['public_permission'],'unknown');assert.equal(claim['visibility'],'internal');
   const topic=(await db.query('SELECT * FROM topics WHERE id=$1',[topic1])).rows[0]!;assert.equal(topic['state'],'candidate');assert.equal(topic['priority'],2);assert.equal((topic['gaps_json'] as unknown[]).length,3);
   const repeat=await persistInsightTopics(ctx,{request:request1,result:insights(request1)});assert.equal(repeat.reused,true);assert.deepEqual(repeat.topicIds,saved.topicIds);assert.equal(Number((await db.query('SELECT count(*) AS n FROM insights')).rows[0]!['n']),1);
  });
  await t.test('durable prepared request restoration reuses the provider output and rejects altered source text',async()=>{
   const restored=await restorePreparedMarketingAiRequest(ctx,JSON.parse(JSON.stringify(request1)),{loadText:async key=>texts.get(key)!});
   const saved=await persistInsightTopics(ctx,{request:restored,result:insights(request1)});assert.equal(saved.reused,true);assert.equal(saved.topicIds[0],topic1);
   const altered=JSON.parse(JSON.stringify(request1));altered.input.source_materials[0].segments[0].text='伪造原文';
   await assert.rejects(restorePreparedMarketingAiRequest(ctx,altered,{loadText:async key=>texts.get(key)!}),{code:'PREPARED_AI_INPUT_CONFLICT'});
   const forgedRules=JSON.parse(JSON.stringify(request1));forgedRules.input.execution_rules=[{allowed_actions:['external.publish']}];
   await assert.rejects(restorePreparedMarketingAiRequest(ctx,forgedRules,{loadText:async key=>texts.get(key)!}),{code:'PREPARED_AI_INPUT_CONFLICT'});
  });
  await t.test('unverified evidence can generate an editable private draft without relaxing public review',async()=>{
   const request=await build({workflow:'content_draft',topicId:topic1});const result=draft(request);const saved=await persistPrivateDraft(ctx,{request,result});itemId=saved.contentItemId;
   const view=await getPrivateDraft(ctx,itemId);assert.equal(view.state,'private_candidate');assert.equal(view.version,1);assert.equal(view.aiRunId,saved.aiRunId);assert.deepEqual(view.sourceVersionIds,[v1]);assert.ok(view.gaps.some(gap=>gap.kind==='public_permission'));
   const repeat=await persistPrivateDraft(ctx,{request,result});assert.equal(repeat.reused,true);assert.equal(repeat.contentVersionId,saved.contentVersionId);
   await assert.rejects(reviewContentVersion(ctx,saved.contentVersionId,{review_status:'approved'}),{code:'CONTENT_VERSION_NOT_VALIDATED'});
   await assert.rejects(db.query("UPDATE content_versions SET review_status='approved' WHERE id=$1",[saved.contentVersionId]));
   await assert.rejects(createContentVersion(ctx,itemId,{title:'未经核实公开稿',modules:[{type:'hero',schema_version:1,data:{headline:'实施服务',description:'候选',cta:{label:'了解',href:'/services',action:'navigate'}}}],claim_ids:view.claimRefs.map(ref=>ref.claimId)},1),{code:'CLAIM_NOT_PUBLIC'});
  });
  await t.test('operator edits append immutable versions and reject stale edits',async()=>{
   const edited=await editPrivateDraft(ctx,itemId,{expectedVersion:1,title:'运营编辑后的草稿',bodyBlocks:[{type:'paragraph',text:'泊冉提供企业应用实施服务。另请内部核实适用范围。'}]});manualVersionId=edited.contentVersionId;assert.equal(edited.version,2);assert.equal(edited.origin,'manual');assert.ok(edited.parentVersionId);assert.ok(edited.gaps.some(gap=>gap.kind==='public_permission'));
   await assert.rejects(editPrivateDraft(ctx,itemId,{expectedVersion:1,title:'陈旧编辑',bodyBlocks:[{type:'paragraph',text:'陈旧编辑'}]}),{code:'VERSION_CONFLICT'});
   await assert.rejects(db.query("UPDATE content_versions SET body_json='{}' WHERE id=$1",[manualVersionId]));
  });
  await t.test('a second change generates a new AI version and retains the manual version and initial lineage',async()=>{
   const v2=await ingest('r2','泊冉提供企业应用实施与应用集成服务。');const request=await build({workflow:'insight_topics',sourceVersionIds:[v2]});const saved=await persistInsightTopics(ctx,{request,result:insights(request)});const draftRequest=await build({workflow:'content_draft',topicId:saved.topicIds[0]!});const generated=await persistPrivateDraft(ctx,{request:draftRequest,result:draft(draftRequest)});
   assert.equal(generated.contentItemId,itemId);assert.equal(generated.version,3);const current=await getPrivateDraft(ctx,itemId);assert.ok(current.sourceVersionIds.includes(v2));assert.equal(current.parentVersionId,manualVersionId);assert.equal(current.bodyBlocks[0]!.text,'泊冉提供企业应用实施与应用集成服务。');
   const old=(await db.query('SELECT body_json FROM content_versions WHERE id=$1',[manualVersionId])).rows[0]!;assert.equal((old['body_json'] as {title:string}).title,'运营编辑后的草稿');
   assert.equal((await listPrivateDrafts(ctx)).length,1);assert.equal((await listPrivateDrafts({...ctx,mode:'live'})).length,0);
   const count=Number((await db.query("SELECT count(*) AS n FROM outbox_events WHERE event_type='source.changed' AND aggregate_id=$1",[connectionId])).rows[0]!['n']);assert.equal(count,2);
  });
  await t.test('only explicit owner/reviewer confirmation can convert a fact to public visibility',async()=>{
   const claim=(await db.query('SELECT * FROM evidence_claims WHERE source_version_id=$1 ORDER BY id',[v1])).rows[0]!;
   const permission={kind:'synthetic-owner-public-proof'};
   await assert.rejects(verifyEvidenceClaim({...ctx,actorType:'service'},String(claim['id']),{expectedVersion:Number(claim['version']),verificationStatus:'verified',publicPermission:'allowed',permissionEvidenceRef:permission,visibility:'public'}),{code:'PUBLIC_FACT_CONFIRMATION_REQUIRED'});
   const confirmed=await verifyEvidenceClaim(ctx,String(claim['id']),{expectedVersion:Number(claim['version']),verificationStatus:'verified',publicPermission:'allowed',permissionEvidenceRef:permission,visibility:'public'});assert.equal(confirmed['visibility'],'public');
   const restored=await restorePreparedMarketingAiRequest(ctx,JSON.parse(JSON.stringify(request1)),{loadText:async key=>texts.get(key)!});assert.deepEqual(restored.context.trustedClaims,request1.context.trustedClaims);
  });
  await t.test('hash mismatches, withdrawal and source mode conflicts cannot create false model results',async()=>{
   const source=(await db.query("SELECT v.* FROM source_versions v JOIN source_documents d ON d.current_version_id=v.id WHERE d.connection_id=$1",[connectionId])).rows[0]!;
   await assert.rejects(buildMarketingAiRequest(ctx,{workflow:'insight_topics',sourceVersionIds:[String(source['id'])],loadText:async()=> 'tampered'}),{code:'SOURCE_TEXT_HASH_MISMATCH'});
   await assert.rejects(buildMarketingAiRequest({...ctx,mode:'live'},{workflow:'insight_topics',sourceVersionIds:[String(source['id'])],loadText:async key=>texts.get(key)!}),{code:'SOURCE_INPUT_UNAVAILABLE'});
   const remove:SourceSnapshot={providerFileId:'fixture-document',title:'已移出',revision:'removed',contentHash:'a'.repeat(64),objectKey:'fixture-tombstone',mimeType:'text/plain',retrievedAt:'2026-10-04T02:00:00Z',sourceModifiedAt:null,visibility:'internal',removed:true,coverage:{status:'complete',scope:'synthetic removal',start_locator:null,end_locator:null}};
   const revoked=await ingestSourceRead(ctx,{connectionId,expectedCursorHash:stableHash(cursor),result:{status:'changed',mode:'mock',snapshots:[remove],nextCursor:{revision:'removed'},gaps:[]}});assert.deepEqual(revoked.sourceVersionIds,[]);
   await assert.rejects(buildMarketingAiRequest(ctx,{workflow:'insight_topics',sourceVersionIds:[String(source['id'])],loadText:async key=>texts.get(key)!}),{code:'SOURCE_INPUT_UNAVAILABLE'});
   assert.equal(Number((await db.query('SELECT count(*) AS n FROM source_versions WHERE document_id=$1',[source['document_id']])).rows[0]!['n']),2);
  });
 }finally{await db.close();}
});
test('first live source verification freezes configuration and objects; old workflow leases cannot advance the cursor',async()=>{
 const db=await testDatabase(),ctx:ServiceContext={db,orgId:DEMO_ORG_ID,actorId:DEMO_OWNER_ID,roles:['owner'],mode:'live',now:()=>new Date('2026-10-04T02:00:00Z')},service={...ctx,actorType:'service' as const};
 try{
  const id=uuid(),scope={file_ids:['first-file']},text='Synthetic source protocol: real bytes in an isolated test.';
  await db.query("INSERT INTO connections(id,org_id,provider,account_external_id,display_name,timezone,currency,source_kind,read_mode,scope_json) VALUES($1,$2,'drive',$3,'Bootstrap engineering fixture','Asia/Shanghai','CNY','mac_drive','drive_sync',$4)",[id,ctx.orgId,uuid(),JSON.stringify(scope)]);
  const snapshot:SourceSnapshot={providerFileId:'first-file',title:'Synthetic file',revision:'r1',contentHash:hash(text),objectKey:'private/first-source.txt',textObjectKey:'private/first-source.txt',textHash:hash(text),mimeType:'text/plain',retrievedAt:'2026-10-04T00:00:00Z',sourceModifiedAt:null,visibility:'internal',coverage:{status:'complete',scope:'one explicitly selected file',start_locator:'paragraph:1',end_locator:'paragraph:1'}};
  (snapshot.coverage as unknown as Record<string,unknown>)['user_expressions']=[{actor:'user',claim_text:'我确认这是人工声称的用户表达',decision_status:'confirmed',locator:{kind:'message',value:'message:forged'}}];
  const read={status:'changed' as const,mode:'live' as const,snapshots:[snapshot],nextCursor:'r1',gaps:[]},base={connectionId:id,expectedCursorHash:stableHash(null),result:read};
  await assert.rejects(ingestSourceRead(ctx,base),{code:'SOURCE_UNVERIFIED'});
  await assert.rejects(ingestSourceRead(service,base),{code:'SOURCE_UNVERIFIED'});
  await ingestSourceRead(service,{connectionId:id,expectedCursorHash:stableHash(null),result:{status:'failed',mode:'live',snapshots:[],errorCode:'AUTH_REQUIRED',gaps:['credential unavailable']}});
  assert.equal((await db.query('SELECT access_status FROM connections WHERE id=$1',[id])).rows[0]!['access_status'],'auth_required');
  const priorConfigurationHash=stableHash({scope,readMode:'drive_sync',secretRef:null});
  await db.query("UPDATE connections SET secret_ref='local:key-generation-2' WHERE id=$1",[id]);
  let verified=0;
  const verifySnapshot=async(value:SourceSnapshot)=>{verified++;assert.equal(value.contentHash,hash(text));assert.equal(value.textHash,hash(text));};
  await assert.rejects(ingestSourceRead(service,{...base,expectedConfigurationHash:priorConfigurationHash,verifySnapshot}),{code:'SOURCE_CONFIGURATION_CONFLICT'});assert.equal(verified,0);
  const expectedConfigurationHash=stableHash({scope,readMode:'drive_sync',secretRef:'local:key-generation-2'});
  await assert.rejects(ingestSourceRead(service,{...base,expectedConfigurationHash,verifySnapshot:async()=>{throw new Error('synthetic object hash mismatch');}}),/object hash mismatch/);
  assert.equal(Number((await db.query('SELECT count(*) AS n FROM source_versions')).rows[0]!['n']),0);
  assert.equal((await db.query('SELECT access_status FROM connections WHERE id=$1',[id])).rows[0]!['access_status'],'auth_required');
  const runId=uuid(),stepId=uuid();
  await db.query("INSERT INTO workflow_runs(id,org_id,kind,period_key,status,input_ref) VALUES($1,$2,'source_watch',$3,'running','{}')",[runId,ctx.orgId,uuid()]);
  await db.query("INSERT INTO workflow_steps(id,org_id,run_id,step_key,state,input_ref,lease_owner,fencing_token,lease_until) VALUES($1,$2,$3,'source-read','running','{}','current-worker',2,$4)",[stepId,ctx.orgId,runId,'2026-10-04T03:00:00Z']);
  await assert.rejects(ingestSourceRead(service,{...base,expectedConfigurationHash,verifySnapshot,workflowFence:{runId,stepId,leaseOwner:'previous-worker',fencingToken:1}}),{code:'STALE_WORKFLOW_LEASE'});
  assert.equal(verified,0);
  const done=await ingestSourceRead(service,{...base,expectedConfigurationHash,verifySnapshot,workflowFence:{runId,stepId,leaseOwner:'current-worker',fencingToken:2}});assert.equal(done.sourceVersionIds.length,1);assert.equal(verified,1);
  await assert.rejects(createEvidenceClaim(ctx,{claimText:'我确认这是人工声称的用户表达',sourceVersionId:done.sourceVersionIds[0]!,locator:{kind:'message',value:'message:forged'},assertionType:'decision',decisionStatus:'confirmed',decisionEvidenceRef:{sourceVersionId:done.sourceVersionIds[0]!,locator:{kind:'message',value:'message:forged'},actor:'user'}}),{code:'USER_EXPRESSION_REQUIRED'});
  const connection=(await db.query('SELECT * FROM connections WHERE id=$1',[id])).rows[0]!;
  assert.equal(connection['access_status'],'connected');assert.ok(connection['capabilities_verified_at']);assert.equal((connection['capabilities'] as Record<string,unknown>)['source_read'],true);assert.equal(connection['cursor'],'r1');
 }finally{await db.close();}
});
test('actual user revocation expires a prior fact and blocks pending work while retaining successful history',async()=>{
 const db=await testDatabase(),ctx:ServiceContext={db,orgId:DEMO_ORG_ID,actorId:DEMO_OWNER_ID,roles:['owner'],mode:'mock',now:()=>new Date('2026-10-04T02:00:00Z')},texts=new Map<string,string>();
 try{
  await initializeBusinessMaster(ctx);
  const drive=uuid(),chat=uuid();
  for(const [id,kind] of [[drive,'mac_drive'],[chat,'chatgpt']])await db.query("INSERT INTO connections(id,org_id,provider,account_external_id,display_name,timezone,currency,source_kind,read_mode,scope_json) VALUES($1,$2,'mock',$3,'Synthetic decision source','Asia/Shanghai','CNY',$4,'mock','{}')",[id,ctx.orgId,uuid(),kind]);
  const original='泊冉提供企业应用实施服务。',message='我撤销此前的企业应用实施服务范围说明，请先重新核实。',body=`[assistant] [assistant-1] [2026-10-04T00:00:00Z]\n我确认这是助手推测的批准。\n\n[user] [question-confirm] [2026-10-04T00:30:00Z]\n我确认是否继续沿用先前服务范围。\n\n[user] [question-revoke] [2026-10-04T00:40:00Z]\n我撤销之前的服务范围，可以吗？\n\n[user] [user-1] [2026-10-04T01:00:00Z]\n${message}`;
  async function ingest(connectionId:string,key:string,text:string,chatSource=false){texts.set(key,text);const result=await ingestSourceRead(ctx,{connectionId,expectedCursorHash:stableHash(null),result:{status:'changed',mode:'mock',snapshots:[{providerFileId:key,title:'Synthetic evidence',revision:'r1',objectKey:key,textObjectKey:key,contentHash:hash(text),textHash:hash(text),mimeType:'text/plain',retrievedAt:'2026-10-04T01:00:00Z',sourceModifiedAt:null,visibility:'internal',...(chatSource?{conversationId:'conversation-fixture'}:{}),coverage:{status:'complete',scope:'synthetic isolated decision source',start_locator:null,end_locator:null,...(chatSource?{conversation_id:'conversation-fixture',message_ids:['assistant-1','question-confirm','question-revoke','user-1'],branch:'active'}:{})}}],nextCursor:'r1',gaps:[]}});return result.sourceVersionIds[0]!;}
  const build=(sourceVersionId:string)=>buildMarketingAiRequest(ctx,{workflow:'insight_topics',sourceVersionIds:[sourceVersionId],loadText:async key=>texts.get(key)!});
  const first=await build(await ingest(drive,'original',original)),saved=await persistInsightTopics(ctx,{request:first,result:insights(first)}),oldClaim=saved.claimIds[0]!,oldTopic=saved.topicIds[0]!;
  await verifyEvidenceClaim(ctx,oldClaim,{expectedVersion:1,verificationStatus:'verified',publicPermission:'allowed',permissionEvidenceRef:{kind:'synthetic independent permission'},visibility:'public'});
  await db.query("UPDATE topics SET state='scheduled',scheduled_at=$2 WHERE id=$1",[oldTopic,'2026-10-05T01:00:00Z']);
  const policy=await createPolicy(ctx,{name:'Synthetic pending action policy',businessScope:{business_lines:['shared']},accountIds:[],allowedActions:['external.publish'],stopConditions:{owner_stop:true}}),policyVersionId=String((await db.query('SELECT id FROM policy_versions WHERE policy_id=$1',[policy.id])).rows[0]!['id']);
  const queued=uuid(),successful=uuid();
  for(const [id,state] of [[queued,'queued'],[successful,'succeeded']])await db.query('INSERT INTO execution_actions(id,org_id,idempotency_key,request_hash,state,before_snapshot,policy_version_id,action_type,target,payload,payload_hash,verified_at,verification_evidence_ref) VALUES($1,$2,$3,$4,$5,\'{}\',$6,\'external.publish\',$7,\'{}\',$8,$9,$10)',[id,ctx.orgId,uuid(),stableHash({id}),state,policyVersionId,JSON.stringify({topic_id:oldTopic}),stableHash({}),state==='succeeded'?'2026-10-04T00:00:00Z':null,state==='succeeded'?JSON.stringify({synthetic:true}):null]);
  const request=await build(await ingest(chat,'actual-messages',body,true));
  assert.deepEqual(request.context.decisionExpressions?.map(expression=>expression.claim_text),[message]);assert.ok(request.context.trustedClaims?.some(claim=>claim['claim_id']===oldClaim));
  const output=structuredClone(insights(request).output);assert.equal(output.workflow,'insight_topics');
  const expression=request.context.decisionExpressions![0]!;
  output.claims[0]={claim_key:'source_fact',claim_id:null,claim_text:message,source_version_id:expression.source_version_id,locator:expression.locator as {kind:'message';value:string},assertion_type:'decision',decision_status:'revoked',decision_evidence_ref:{source_version_id:expression.source_version_id,locator:expression.locator as {kind:'message';value:string},actor:'user'},supersedes_claim_id:oldClaim,inference_rationale:null};
  const assistant=structuredClone(output);assistant.claims[0]!.claim_text='我确认这是助手推测的批准。';assistant.claims[0]!.decision_status='confirmed';assistant.claims[0]!.locator={kind:'message',value:'message:assistant-1'};assistant.claims[0]!.decision_evidence_ref!.locator=assistant.claims[0]!.locator;
  assert.throws(()=>fixtureResult(request,assistant),/matching user expression/);
  for(const [locator,text,status] of [['message:question-confirm','我确认是否继续沿用先前服务范围。','confirmed'],['message:question-revoke','我撤销之前的服务范围，可以吗？','revoked']] as const){const question=structuredClone(output);question.claims[0]!.claim_text=text;question.claims[0]!.decision_status=status;question.claims[0]!.locator={kind:'message',value:locator};question.claims[0]!.decision_evidence_ref!.locator=question.claims[0]!.locator;assert.throws(()=>fixtureResult(request,question),/matching user expression/);}
  await persistInsightTopics(ctx,{request,result:fixtureResult(request,output)});
  assert.equal((await db.query('SELECT verification_status FROM evidence_claims WHERE id=$1',[oldClaim])).rows[0]!['verification_status'],'expired');
  assert.equal((await db.query('SELECT state,scheduled_at FROM topics WHERE id=$1',[oldTopic])).rows[0]!['state'],'blocked');assert.equal((await db.query('SELECT scheduled_at FROM topics WHERE id=$1',[oldTopic])).rows[0]!['scheduled_at'],null);
  assert.equal((await db.query('SELECT state FROM execution_actions WHERE id=$1',[queued])).rows[0]!['state'],'blocked');assert.equal((await db.query('SELECT state FROM execution_actions WHERE id=$1',[successful])).rows[0]!['state'],'succeeded');
 }finally{await db.close();}
});
test('live folder descendants require stable ancestry; partial and duplicate reads preserve recovery watermarks',async()=>{
 const db=await testDatabase(),ctx:ServiceContext={db,orgId:DEMO_ORG_ID,actorId:DEMO_OWNER_ID,roles:['owner'],mode:'live'};
 try{
  const id=uuid();await db.query("INSERT INTO connections(id,org_id,provider,account_external_id,display_name,timezone,currency,source_kind,read_mode,access_status,capabilities_verified_at,scope_json) VALUES($1,$2,'drive',$3,'Synthetic live protocol fixture','Asia/Shanghai','CNY','mac_drive','drive_sync','connected',now(),$4)",[id,ctx.orgId,uuid(),JSON.stringify({folder_ids:['authorized-root']})]);
  const snapshot:SourceSnapshot={providerFileId:'child-file',title:'Synthetic file',revision:'r1',contentHash:'a'.repeat(64),objectKey:'private-fixture/r1',mimeType:'text/plain',retrievedAt:'2026-10-04T00:00:00Z',sourceModifiedAt:null,visibility:'internal',coverage:{status:'complete',scope:'synthetic folder',start_locator:null,end_locator:null}};
  await assert.rejects(ingestSourceRead(ctx,{connectionId:id,expectedCursorHash:stableHash(null),result:{status:'changed',mode:'live',snapshots:[snapshot],nextCursor:'r1',gaps:[]}}),{code:'SOURCE_SCOPE_MISMATCH'});
  const allowed={...snapshot,scopeFolderIds:['authorized-root'],ancestorFolderIds:['authorized-root','child-folder'],coverage:{...snapshot.coverage,folder_ids:['authorized-root'],ancestor_folder_ids:['authorized-root','child-folder']}};
  const first=await ingestSourceRead(ctx,{connectionId:id,expectedCursorHash:stableHash(null),result:{status:'changed',mode:'live',snapshots:[allowed],nextCursor:'r1',gaps:[]}});assert.equal(first.sourceVersionIds.length,1);
  const repeat=await ingestSourceRead(ctx,{connectionId:id,expectedCursorHash:stableHash('r1'),result:{status:'changed',mode:'live',snapshots:[allowed],nextCursor:'r1',gaps:[]}});assert.equal(repeat.status,'no_change');assert.deepEqual(repeat.sourceVersionIds,[]);assert.equal(Number((await db.query("SELECT count(*) AS n FROM outbox_events WHERE event_type='source.changed' AND aggregate_id=$1",[id])).rows[0]!['n']),1);
  const partial=await ingestSourceRead(ctx,{connectionId:id,expectedCursorHash:stableHash('r1'),result:{status:'partial',mode:'live',snapshots:[],nextCursor:'ignored-new-watermark',gaps:['nested folder unavailable']}});assert.equal(partial.cursorAdvanced,false);assert.equal((await db.query('SELECT cursor FROM connections WHERE id=$1',[id])).rows[0]!['cursor'],'r1');
  await assert.rejects(db.query('UPDATE source_versions SET text_hash=$2 WHERE id=$1',[first.sourceVersionIds[0],'b'.repeat(64)]));
  await assert.rejects(ingestSourceRead(ctx,{connectionId:id,expectedCursorHash:stableHash('r1'),result:{status:'failed',mode:'mock',snapshots:[],errorCode:'READ_FAILED',gaps:[]}}),{code:'SOURCE_MODE_MISMATCH'});
 }finally{await db.close();}
});
test('mock reads exclude real private provenance while authenticated live reads retain unchanged manual and mock history',async()=>{
 const db=await testDatabase(),mock:ServiceContext={db,orgId:DEMO_ORG_ID,actorId:DEMO_OWNER_ID,roles:['owner'],mode:'mock'},live={...mock,mode:'live' as const};
 try{
  const mockConnection=uuid(),realConnection=uuid();
  for(const [id,readMode] of [[mockConnection,'mock'],[realConnection,'drive_sync']])await db.query("INSERT INTO connections(id,org_id,provider,account_external_id,display_name,timezone,currency,read_mode) VALUES($1,$2,'drive',$3,'Read privacy fixture','Asia/Shanghai','CNY',$4)",[id,mock.orgId,uuid(),readMode]);
  async function lineage(label:string,connectionId:string|null,versionMode:'live'|'mock'|null,recordMode:'live'|'mock'|null){
   const sourceId=uuid(),versionId=uuid(),claimId=uuid(),insightId=uuid(),topicId=uuid(),text=`${label}: private claim text`;
   await db.query("INSERT INTO source_documents(id,org_id,provider,title,visibility,connection_id,owner_user_id) VALUES($1,$2,'upload',$3,'internal',$4,$5)",[sourceId,mock.orgId,label,connectionId,mock.actorId]);
   await db.query("INSERT INTO source_versions(id,org_id,document_id,revision,content_hash,object_key,mime_type,extraction_status,retrieved_at,execution_mode) VALUES($1,$2,$3,'r1',$4,$5,'text/plain','queued',now(),$6)",[versionId,mock.orgId,sourceId,hash(text),`private/${label}`,versionMode]);
   await db.query('UPDATE source_documents SET current_version_id=$2 WHERE id=$1',[sourceId,versionId]);
   await db.query("INSERT INTO evidence_claims(id,org_id,claim_text,source_version_id,locator,execution_mode,verification_status,visibility,public_permission) VALUES($1,$2,$3,$4,'{\"kind\":\"document\",\"value\":\"paragraph:1\"}',$5,'unverified','internal','unknown')",[claimId,mock.orgId,text,versionId,recordMode]);
   await db.query("INSERT INTO insights(id,org_id,summary,business_line,customer_problem,opportunity,priority_reason,data_cutoff,dedupe_key,execution_mode) VALUES($1,$2,$3,'shared','客户问题','机会','来源说明',now(),$4,$5)",[insightId,mock.orgId,`${label}: private insight`,hash(insightId),recordMode]);
   await db.query('INSERT INTO insight_evidence(id,org_id,insight_id,claim_id) VALUES($1,$2,$3,$4)',[uuid(),mock.orgId,insightId,claimId]);
   await db.query("INSERT INTO topics(id,org_id,insight_id,title,business_line,audience,problem,offer,angle,claim_ids,dedupe_key,execution_mode) VALUES($1,$2,$3,$4,'shared','客户','问题','服务','说明',$5,$6,$7)",[topicId,mock.orgId,insightId,`${label}: private topic`,[claimId],hash(topicId),recordMode]);
   return {sourceId,versionId,claimId,insightId,topicId,text};
  }
  const manual=await lineage('legacy-manual',null,null,null),history=await lineage('mock-history',mockConnection,'mock','mock'),real=await lineage('real-private',realConnection,'live','live'),nullFromRealConnection=await lineage('null-record-real-connection',realConnection,null,null),nullFromRealVersion=await lineage('null-record-real-version',null,'live',null);
  const hidden=[real,nullFromRealConnection,nullFromRealVersion],visible=[manual,history];
  assert.deepEqual((await listSources(mock)).map(row=>row['id']).sort(),visible.map(row=>row.sourceId).sort());
  assert.deepEqual((await listClaims(mock)).map(row=>row['id']).sort(),visible.map(row=>row.claimId).sort());
  assert.deepEqual((await listInsights(mock)).map(row=>row['id']).sort(),visible.map(row=>row.insightId).sort());
  assert.deepEqual((await listTopics(mock)).map(row=>row.id).sort(),visible.map(row=>row.topicId).sort());
  assert.deepEqual((await getWorkspaceThemes(mock)).map(row=>row.id).sort(),visible.map(row=>row.topicId).sort());
  for(const row of hidden){await assert.rejects(getSource(mock,row.sourceId),{code:'NOT_FOUND'});await assert.rejects(listSourceVersions(mock,row.sourceId),{code:'NOT_FOUND'});await assert.rejects(getTopic(mock,row.topicId),{code:'NOT_FOUND'});}
  for(const row of visible){assert.equal((await getSource(mock,row.sourceId))['id'],row.sourceId);assert.equal((await listSourceVersions(mock,row.sourceId))[0]!['id'],row.versionId);assert.equal((await getTopic(mock,row.topicId)).id,row.topicId);}
  const mockWire=JSON.stringify([await listSources(mock),await listClaims(mock),await listInsights(mock),await listTopics(mock),await getWorkspaceThemes(mock)]);
  for(const row of hidden)for(const value of [row.sourceId,row.versionId,row.claimId,row.insightId,row.topicId,row.text])assert.ok(!mockWire.includes(value));
  assert.equal((await listSources(live)).length,5);assert.equal((await listClaims(live)).length,5);assert.equal((await listInsights(live)).length,5);assert.equal((await listTopics(live)).length,5);
  assert.equal((await getWorkspaceThemes(live)).length,5);
  assert.equal((await getTopic(live,history.topicId)).id,history.topicId);assert.equal((await getSource(live,manual.sourceId))['id'],manual.sourceId);
  assert.equal((await db.query('SELECT execution_mode FROM evidence_claims WHERE id=$1',[manual.claimId])).rows[0]!['execution_mode'],null);
  assert.equal((await db.query('SELECT execution_mode FROM source_versions WHERE id=$1',[manual.versionId])).rows[0]!['execution_mode'],null);
 }finally{await db.close();}
});
