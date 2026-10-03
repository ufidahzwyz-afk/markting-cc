import test from 'node:test';
import assert from 'node:assert/strict';
import {createTestDatabase,DEMO_ORG_ID,DEMO_OWNER_ID} from '@boran/db';
import {uuid,stableHash,type ServiceContext} from '@boran/domain/core';
import {createPolicy,activatePolicy} from '@boran/domain/execution';
import {ingestSourceRead} from '@boran/domain/marketing';
import {dispatchMarketing} from '../src/marketing-dispatch';

test('source changes create durable, scope checked and revision-idempotent derivation',async t=>{
 const names=['BORAN_ORG_ID','BORAN_MODE','APP_ENV','AI_MODE'] as const;const previous=Object.fromEntries(names.map(name=>[name,process.env[name]]));
 Object.assign(process.env,{BORAN_ORG_ID:DEMO_ORG_ID,BORAN_MODE:'mock',APP_ENV:'test',AI_MODE:'mock'});
 const db=await createTestDatabase();const ctx:ServiceContext={db,orgId:DEMO_ORG_ID,actorId:DEMO_OWNER_ID,roles:['owner','marketer'],mode:'mock'};const connectionId=uuid();
 await db.query("INSERT INTO connections(id,org_id,provider,account_external_id,display_name,timezone,currency,source_kind,read_mode) VALUES($1,$2,'mock',$3,'QA source change','Asia/Shanghai','CNY','market_public','mock')",[connectionId,ctx.orgId,uuid()]);
 let cursor:unknown=null;
 async function read(revision:string,coverage:'complete'|'partial'='complete'){
  const snapshot={providerFileId:'qa-source',title:'Synthetic source',revision,contentHash:stableHash({revision}),objectKey:`mock://qa/${revision}`,mimeType:'text/plain',retrievedAt:'2026-10-03T00:00:00Z',sourceModifiedAt:null,visibility:'internal' as const,coverage:{status:coverage,scope:'QA synthetic source',start_locator:'p1',end_locator:'p1'}};
  const result=await ingestSourceRead(ctx,{connectionId,expectedCursorHash:stableHash(cursor),result:{status:'changed',mode:'mock',snapshots:[snapshot],nextCursor:{revision},gaps:[]}});if(result.cursorAdvanced)cursor={revision};return result.sourceVersionIds[0]!;
 }
 try{
  let firstId='';
  await t.test('missing policy persists needs_human and retains the current same-org source reference',async()=>{
   firstId=await read('r1');assert.equal(await dispatchMarketing(db),1);const run=(await db.query("SELECT * FROM workflow_runs WHERE org_id=$1 AND kind='insight_topics'",[ctx.orgId])).rows[0]!;assert.equal(run.status,'needs_human');assert.ok((run.error as {missing:string[]}).missing.includes('POLICY_NOT_ACTIVE'));assert.deepEqual((run.input_ref as {source_version_ids:string[]}).source_version_ids,[firstId]);assert.equal((await db.query('SELECT state FROM workflow_steps WHERE run_id=$1',[run.id])).rows[0]!.state,'needs_human');
  });
  await t.test('repeated immutable source revisions schedule once even with a new event id',async()=>{
   assert.equal(await read('r1'),firstId);assert.equal(await dispatchMarketing(db),1);assert.equal((await db.query("SELECT count(*)::integer AS n FROM workflow_runs WHERE org_id=$1 AND kind='insight_topics'",[ctx.orgId])).rows[0]!.n,1);assert.equal(await dispatchMarketing(db),0);assert.equal((await db.query('SELECT count(*)::integer AS n FROM evidence_claims')).rows[0]!.n,0);
  });
  await t.test('a current approved policy and explicit mock gateway enqueue a simulated derivation',async()=>{
   const policy=await createPolicy(ctx,{name:'QA current source policy',businessScope:{business_lines:['shared']},accountIds:[],allowedActions:['content.publish'],stopConditions:{on_error:true}});const version=String((await db.query('SELECT id FROM policy_versions WHERE policy_id=$1',[policy.id])).rows[0]!.id);await activatePolicy(ctx,String(policy.id),version,1);
   const source=await read('r2');assert.equal(await dispatchMarketing(db),1);const run=(await db.query("SELECT * FROM workflow_runs WHERE org_id=$1 AND status='queued'",[ctx.orgId])).rows[0]!;assert.ok(run);assert.equal((run.input_ref as Record<string,unknown>).policy_version_id,version);assert.deepEqual((run.input_ref as Record<string,unknown>).source_version_ids,[source]);assert.equal((await db.query('SELECT execution_mode FROM workflow_steps WHERE run_id=$1',[run.id])).rows[0]!.execution_mode,'mock');
  });
  await t.test('partial source coverage and missing real gateway cannot fake completed derivation',async()=>{
   await read('r3','partial');await dispatchMarketing(db);const run=(await db.query("SELECT * FROM workflow_runs WHERE org_id=$1 AND error->'missing' ? 'SOURCE_COVERAGE_INCOMPLETE'",[ctx.orgId])).rows[0]!;assert.equal(run.status,'needs_human');
   process.env.AI_MODE='real';await read('r4');await dispatchMarketing(db);assert.equal((await db.query("SELECT status FROM workflow_runs WHERE org_id=$1 AND error->'missing' ? 'AI_NOT_CONFIGURED'",[ctx.orgId])).rows[0]!.status,'needs_human');assert.equal((await db.query('SELECT count(*)::integer AS n FROM ai_runs')).rows[0]!.n,0);
  });
  await t.test('inactive members, foreign references and foreign-org events do not grant worker authority',async()=>{
   await db.query('UPDATE memberships SET active=false WHERE org_id=$1',[ctx.orgId]);const foreignId=uuid();await db.query("INSERT INTO outbox_events(org_id,event_id,event_type,aggregate_id,schema_version,payload,occurred_at,attempts,next_attempt_at) VALUES($1,$2,'source.changed',$3,1,$4,now(),0,now())",[ctx.orgId,uuid(),connectionId,JSON.stringify({sourceVersionIds:[foreignId],requested_by:ctx.actorId,policy_version_id:uuid(),transport:'client-injected'})]);await dispatchMarketing(db);
   const run=(await db.query("SELECT * FROM workflow_runs WHERE org_id=$1 AND error->'missing' ? 'WORKFLOW_ACTOR_MISSING'",[ctx.orgId])).rows[0]!;assert.equal(run.status,'needs_human');assert.deepEqual((run.input_ref as Record<string,unknown>).source_version_ids,[]);assert.equal((run.input_ref as Record<string,unknown>).transport,undefined);
   const foreignOrg=uuid(),foreignEvent=uuid();await db.query("INSERT INTO organizations(id,name,timezone,base_currency) VALUES($1,'QA ignored organization','Asia/Shanghai','CNY')",[foreignOrg]);await db.query("INSERT INTO outbox_events(id,org_id,event_id,event_type,aggregate_id,schema_version,payload,occurred_at,attempts,next_attempt_at) VALUES($1,$2,$3,'source.changed',$4,1,'{}',now(),0,now())",[foreignEvent,foreignOrg,uuid(),uuid()]);assert.equal(await dispatchMarketing(db),0);assert.equal((await db.query('SELECT dispatched_at FROM outbox_events WHERE id=$1',[foreignEvent])).rows[0]!.dispatched_at,null);
   delete process.env.BORAN_ORG_ID;process.env.BORAN_MODE='live';process.env.APP_ENV='production';await assert.rejects(dispatchMarketing(db),{code:'WORKER_ORGANIZATION_NOT_CONFIGURED'});
  });
  await t.test('revoked live source scope is rechecked before derivation, including after a previously valid read',async()=>{
   process.env.BORAN_ORG_ID=ctx.orgId;await db.query('UPDATE memberships SET active=true WHERE org_id=$1',[ctx.orgId]);
   await db.query("UPDATE connections SET read_mode='authorized_browser',access_status='connected',capabilities_verified_at=now(),scope_json='{}' WHERE org_id=$1 AND id=$2",[ctx.orgId,connectionId]);const current=(await db.query('SELECT current_version_id FROM source_documents WHERE org_id=$1 AND connection_id=$2',[ctx.orgId,connectionId])).rows[0]!.current_version_id;
   // A duplicate event must still observe the revoked current scope without creating another revision workflow.
   const event=uuid();await db.query("INSERT INTO outbox_events(id,org_id,event_id,event_type,aggregate_id,schema_version,payload,occurred_at,attempts,next_attempt_at) VALUES($1,$2,$3,'source.changed',$4,1,$5,now(),0,now())",[event,ctx.orgId,uuid(),connectionId,JSON.stringify({sourceVersionIds:[String(current)]})]);await dispatchMarketing(db);
   const run=(await db.query("SELECT status,error FROM workflow_runs WHERE org_id=$1 AND error->'missing' ? 'SOURCE_SCOPE_REVOKED'",[ctx.orgId])).rows[0]!;assert.equal(run.status,'needs_human');assert.ok((run.error as {missing:string[]}).missing.includes('AI_NOT_CONFIGURED'));
  });
 }finally{await db.close();for(const name of names){if(previous[name]===undefined)delete process.env[name];else process.env[name]=previous[name];}}
});
