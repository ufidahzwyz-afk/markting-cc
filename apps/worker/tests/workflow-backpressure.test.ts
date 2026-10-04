import test from 'node:test';
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {randomUUID} from 'node:crypto';
import {mkdtemp,rm} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {createTestDatabase,openDatabase,migrateDatabase,seedDemo,DEMO_ORG_ID,DEMO_OWNER_ID,type Database} from '@boran/db';
import {DeepSeekAiGateway,aiQuotaKeys,type AiRequest} from '@boran/ai';
import {SourceObjectStore} from '@boran/connectors/source-content';
import {ingestSourceRead,initializeBusinessMaster} from '@boran/domain/marketing';
import {stableHash,type ServiceContext} from '@boran/domain/core';
import {DatabaseAiLimitLedger} from '../src/ai-usage';
import {executeMarketingWorkflow} from '../src/marketing-workflow';
import {scheduleRun,claimStep,deferStep} from '../src/queue';
import {registerHandler,runOnce} from '../src/runner';

type Row=Record<string,any>;
/** Real PostgreSQL uses an isolated schema; the fallback uses an isolated on-disk database to prove reconnect persistence. */
test('eleven source-change tasks obey 10/min across restart; only proven unsubmitted work waits and resumes once',async t=>{
  const root=await mkdtemp(join(tmpdir(),'boran-rate-queue-'));let admin:Database|undefined,schema:string|undefined,scopedUrl:string|undefined,db:Database;
  if(process.env.BORAN_QA_TEST_PG_URL){
    admin=await openDatabase({url:process.env.BORAN_QA_TEST_PG_URL,mode:'live'});schema=`test_backpressure_${randomUUID().replaceAll('-','')}`;await admin.query(`CREATE SCHEMA ${schema}`);
    const url=new URL(process.env.BORAN_QA_TEST_PG_URL);url.searchParams.set('options',`-csearch_path=${schema}`);scopedUrl=url.toString();db=await openDatabase({url:scopedUrl,mode:'live'});await migrateDatabase(db);await seedDemo(db);
  }else db=await openDatabase({dataDir:join(root,'pg'),mode:'mock'});
  const context=(database:Database):ServiceContext=>({db:database,orgId:DEMO_ORG_ID,actorId:DEMO_OWNER_ID,roles:['owner','marketer'],actorType:'service',mode:'live'});
  const objects=new SourceObjectStore(join(root,'sources')),connectionId=randomUUID();
  let providerNow=Math.floor(Date.now()/60000)*60000+60000,posts=0,replyMode:'normal'|'invalid'='normal';
  const server=createServer(async(request,response)=>{
    if(request.url!=='/chat/completions'){response.writeHead(404);response.end();return;}
    const chunks=[];for await(const chunk of request)chunks.push(Buffer.from(chunk));posts++;
    const body=JSON.parse(Buffer.concat(chunks).toString()),content=String(body.messages[1].content);
    const input=JSON.parse(content.slice(content.indexOf('\n')+1,content.lastIndexOf('\n'))),semantic=input.semantic_context;
    const output={workflow:'insight_topics',schema_version:2,source_versions:semantic.sourceVersions,claims:[],policy_refs:semantic.policyRefs,output:{data_cutoff:semantic.dataCutoff,insights:[],topics:[],source_gaps:[{kind:'source',description:'合成限流验收，不是实际业务洞察',reference_key:null,next_step:'接入实际来源及模型'}]}};
    response.setHeader('content-type','application/json');response.end(JSON.stringify({id:`synthetic-rate-${posts}`,model:body.model,choices:[{finish_reason:'stop',message:{content:replyMode==='invalid'?'{invalid-json':JSON.stringify(output)}}],usage:{prompt_tokens:10,completion_tokens:20,total_tokens:30}}));
  });await new Promise<void>(resolve=>server.listen(0,'127.0.0.1',resolve));
  const endpoint=`http://127.0.0.1:${(server.address() as {port:number}).port}`;
  const makeGateway=(database:Database,minuteCap=10)=>new DeepSeekAiGateway({env:{APP_ENV:'test',AI_MODE:'real',DEEPSEEK_API_KEY_SECRET_REF:'synthetic-only-reference',DEEPSEEK_VERIFY_MODELS:'false',AI_MAX_CALLS_PER_MINUTE:String(minuteCap)},resolveSecret:async()=> 'synthetic-only-key',limitLedger:new DatabaseAiLimitLedger(database,DEMO_ORG_ID),now:()=>providerNow,fetch:(input,init)=>{const url=new URL(input instanceof Request?input.url:String(input));return fetch(`${endpoint}${url.pathname}`,init);}});
  const dependencies=(database:Database,minuteCap=10)=>({gateway:async()=>makeGateway(database,minuteCap),now:()=>new Date(providerNow),loadText:(key:string,source:{connectionId:string;textHash:string})=>objects.readText({orgId:DEMO_ORG_ID,connectionId:source.connectionId,objectKey:key,expectedHash:source.textHash})});
  registerHandler('qa_rate_insights',async({db:database,claim})=>executeMarketingWorkflow(context(database),claim,'insight_topics',dependencies(database)),{modes:['read_only']});
  registerHandler('qa_paid_repair_limit',async({db:database,claim})=>executeMarketingWorkflow(context(database),claim,'insight_topics',dependencies(database,1)),{modes:['read_only']});
  try{
    await initializeBusinessMaster(context(db));
    await db.query("INSERT INTO connections(id,org_id,provider,account_external_id,display_name,timezone,currency,source_kind,read_mode,scope_json,access_status,capabilities_verified_at) VALUES($1,$2,'google_drive','synthetic-quota','合成限流来源','Asia/Shanghai','CNY','mac_drive','drive_sync',$3,'connected',now())",[connectionId,DEMO_ORG_ID,JSON.stringify({folder_ids:['synthetic-folder']})]);
    const original='泊冉业务资料，仅用于协议和限流验收。',stored=await objects.put(DEMO_ORG_ID,connectionId,Buffer.from(original),original);
    const source=await ingestSourceRead(context(db),{connectionId,expectedCursorHash:stableHash(null),verifySnapshot:async value=>{await objects.readBytes({orgId:DEMO_ORG_ID,connectionId,objectKey:value.objectKey,expectedHash:value.contentHash});},result:{status:'changed',mode:'live',snapshots:Array.from({length:11},(_,index)=>({providerFileId:`synthetic-source-${index}`,title:'合成来源',revision:'r1',...stored,mimeType:'text/plain',retrievedAt:new Date().toISOString(),sourceModifiedAt:null,visibility:'internal' as const,scopeFolderIds:['synthetic-folder'],ancestorFolderIds:['synthetic-folder'],coverage:{status:'complete' as const,scope:'synthetic authorized folder',start_locator:'text:1',end_locator:'text:1',folder_ids:['synthetic-folder'],ancestor_folder_ids:['synthetic-folder']}})),nextCursor:{revision:'r1'},gaps:[]}});
    for(let index=0;index<11;index++)await scheduleRun(db,{orgId:DEMO_ORG_ID,kind:'insight_topics',periodKey:`quota-task-${index}`,input:{requested_by:DEMO_OWNER_ID},steps:[{key:'qa_rate_insights',mode:'read_only',input:{source_version_ids:[source.sourceVersionIds[index]!]}}]});
    await t.test('first ten jobs pay once each; eleventh durable no-submit receipt is queued until the Shanghai minute boundary',async()=>{
      for(let index=0;index<11;index++)assert.equal((await runOnce(db,`worker-${index}`,{orgId:DEMO_ORG_ID,modes:['read_only']})).processed,true);
      assert.equal(posts,10);assert.equal(Number((await db.query('SELECT count(*) AS n FROM ai_usage_reservations')).rows[0]!.n),10);assert.equal(Number((await db.query('SELECT count(*) AS n FROM ai_runs')).rows[0]!.n),10);
      const waiting=(await db.query("SELECT * FROM workflow_steps WHERE state='queued'")).rows;assert.equal(waiting.length,1);const marker=(waiting[0]!.output_ref as Row)._ai_execution;
      const quota=aiQuotaKeys(providerNow),nextMinute=new Date(Date.parse(`${quota.minute}:00+08:00`)+60000).toISOString();assert.equal(marker.status,'safe_not_submitted');assert.equal(marker.limit_kind,'minute');assert.equal(marker.retry_after,nextMinute);assert.equal(new Date(String(waiting[0]!.next_attempt_at)).toISOString(),nextMinute);
      assert.equal(await claimStep(db,{workerId:'too-early',orgId:DEMO_ORG_ID,modes:['read_only']}),null);
    });
    await t.test('reconnecting the worker retains deferred input/receipt; the next window submits exactly one HTTP request',async()=>{
      const waiting=(await db.query("SELECT * FROM workflow_steps WHERE state='queued'")).rows[0]!,marker=(waiting.output_ref as Row)._ai_execution,hash=marker.request_hash;
      await db.close();db=scopedUrl?await openDatabase({url:scopedUrl,mode:'live'}):await openDatabase({dataDir:join(root,'pg'),mode:'mock',initialize:false});
      assert.equal((await runOnce(db,'restart-before-due',{orgId:DEMO_ORG_ID,modes:['read_only']})).processed,false);assert.equal(posts,10);
      // Advance the protocol clock and make the persisted DB timer due, without a wall-clock minute sleep.
      providerNow=Date.parse(marker.retry_after)+1000;await db.query("UPDATE workflow_steps SET next_attempt_at=now()-interval '1 second' WHERE id=$1",[waiting.id]);
      assert.equal((await runOnce(db,'restart-after-due',{orgId:DEMO_ORG_ID,modes:['read_only']})).blocked,undefined);assert.equal(posts,11);
      const done=(await db.query('SELECT state,output_ref FROM workflow_steps WHERE id=$1',[waiting.id])).rows[0]!;assert.equal(done.state,'succeeded');assert.equal((done.output_ref as Row)._ai_execution.request_hash,hash);
      assert.equal(Number((await db.query('SELECT count(*) AS n FROM ai_usage_reservations')).rows[0]!.n),11);assert.equal((await runOnce(db,'idle',{orgId:DEMO_ORG_ID,modes:['read_only']})).processed,false);
    });
    await t.test('a paid JSON repair exhausting quota remains needs-human; forging no-submit details cannot defer a calling receipt',async()=>{
      providerNow+=180000;replyMode='invalid';const before=posts;
      const run=await scheduleRun(db,{orgId:DEMO_ORG_ID,kind:'insight_topics',periodKey:'paid-repair-no-retry',input:{requested_by:DEMO_OWNER_ID},steps:[{key:'qa_paid_repair_limit',mode:'read_only',input:{source_version_ids:source.sourceVersionIds}}]});
      assert.equal((await runOnce(db,'paid-repair',{orgId:DEMO_ORG_ID,modes:['read_only']})).blocked,true);assert.equal(posts,before+1);
      const step=(await db.query('SELECT state,output_ref FROM workflow_steps WHERE run_id=$1',[run.id])).rows[0]!;assert.equal(step.state,'needs_human');assert.equal((step.output_ref as Row)._ai_execution.status,'failed');assert.equal((await runOnce(db,'must-not-pay-again',{orgId:DEMO_ORG_ID,modes:['read_only']})).processed,false);assert.equal(posts,before+1);
      const manual=await scheduleRun(db,{orgId:DEMO_ORG_ID,kind:'insight_topics',periodKey:'calling-cannot-defer',steps:[{key:'manual-check',mode:'read_only'}]});const claim=await claimStep(db,{workerId:'untrusted-delay',orgId:DEMO_ORG_ID,modes:['read_only']});assert.ok(claim);assert.equal(claim.runId,manual.id);
      await db.query('UPDATE workflow_steps SET output_ref=$2 WHERE id=$1',[claim.stepId,JSON.stringify({_ai_execution:{status:'calling',request_hash:'a'.repeat(64)}})]);
      await assert.rejects(deferStep(db,claim,{limitKind:'minute',retryAfter:new Date(Date.now()+60000).toISOString()}),/durable unsubmitted/);
      assert.equal((await db.query('SELECT state FROM workflow_steps WHERE id=$1',[claim.stepId])).rows[0]!.state,'running');
      assert.ok(!JSON.stringify((await db.query('SELECT request_metadata FROM ai_runs')).rows).includes('synthetic-only-key'));
    });
  }finally{await new Promise<void>(resolve=>server.close(()=>resolve()));await db.close();if(admin&&schema){await admin.query(`DROP SCHEMA ${schema} CASCADE`);await admin.close();}await rm(root,{recursive:true,force:true});}
});

test('a live worker polls only its org and mode; foreign outbox and expired external writes stay untouched',async()=>{
  const db=await createTestDatabase(),foreign=randomUUID();
  registerHandler('qa_scope_live',async()=>({output:{mock:false,simulation:false}}),{modes:['read_only']});
  try{
    await db.query("INSERT INTO organizations(id,name,timezone,base_currency,write_enabled) VALUES($1,'Synthetic foreign org','Asia/Shanghai','CNY',true)",[foreign]);
    const mock=await scheduleRun(db,{orgId:DEMO_ORG_ID,kind:'archive',periodKey:'legacy-mock',steps:[{key:'qa_scope_live',mode:'mock'}]});
    const foreignRun=await scheduleRun(db,{orgId:foreign,kind:'archive',periodKey:'foreign-live',steps:[{key:'qa_scope_live',mode:'read_only'}]});
    const foreignWrite=await scheduleRun(db,{orgId:foreign,kind:'publish_content',periodKey:'foreign-write',steps:[{key:'publish',mode:'external_write'}]});
    await db.query("UPDATE workflow_steps SET state='running',lease_until=now()-interval '1 second',lease_owner='foreign-expired' WHERE run_id=$1",[foreignWrite.id]);
    const live=await scheduleRun(db,{orgId:DEMO_ORG_ID,kind:'archive',periodKey:'own-live',steps:[{key:'qa_scope_live',mode:'read_only'}]});
    assert.equal((await runOnce(db,'scoped-live',{orgId:DEMO_ORG_ID,modes:['read_only']})).processed,true);
    const states=(await db.query('SELECT id,status FROM workflow_runs')).rows;const status=(id:unknown)=>states.find(row=>row.id===id)!.status;
    assert.equal(status(live.id),'succeeded');assert.equal(status(mock.id),'queued');assert.equal(status(foreignRun.id),'queued');assert.equal((await db.query('SELECT state FROM workflow_steps WHERE run_id=$1',[foreignWrite.id])).rows[0]!.state,'running');
    assert.equal((await db.query('SELECT dispatched_at FROM outbox_events WHERE aggregate_id=$1',[foreignRun.id])).rows[0]!.dispatched_at,null);assert.equal((await runOnce(db,'own-idle',{orgId:DEMO_ORG_ID,modes:['read_only']})).processed,false);
  }finally{await db.close();}
});
