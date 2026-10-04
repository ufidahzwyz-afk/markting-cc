import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm,writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createTestDatabase,DEMO_ORG_ID,DEMO_OWNER_ID} from '@boran/db';
import {uuid,stableHash,type ServiceContext} from '@boran/domain/core';
import {ingestSourceRead} from '@boran/domain/marketing';
import {SourceObjectStore,type SourceSnapshot} from '@boran/connectors/sources';
import {defaultModelConfiguration} from '../src/automation-runtime';
import {dispatchMarketing,sourceDerivationPeriod} from '../src/marketing-dispatch';
import {scheduleDueWorkflows,validateOperatingSchedule} from '../src/scheduler';

type Row=Record<string,unknown>;
/** Synthetic source files and configuration prove queue behavior; they do not count as real business acceptance. */
test('live private derivation resumes safe configuration blocks and preserves source/mode/paid-call boundaries',async t=>{
 const db=await createTestDatabase(),root=await mkdtemp(join(tmpdir(),'boran-dispatch-'));
 const names=['BORAN_ORG_ID','BORAN_MODE','APP_ENV','AI_MODE','BORAN_SOURCE_ROOT','BORAN_ALLOWED_SECRET_ENV_KEYS','SYNTHETIC_DISPATCH_KEY'] as const,previous=Object.fromEntries(names.map(name=>[name,process.env[name]]));
 Object.assign(process.env,{BORAN_ORG_ID:DEMO_ORG_ID,BORAN_MODE:'live',APP_ENV:'test',AI_MODE:'mock',BORAN_SOURCE_ROOT:join(root,'sources'),BORAN_ALLOWED_SECRET_ENV_KEYS:'SYNTHETIC_DISPATCH_KEY',SYNTHETIC_DISPATCH_KEY:'synthetic-key-for-engineering-only'});
 const ctx:ServiceContext={db,orgId:DEMO_ORG_ID,actorId:DEMO_OWNER_ID,roles:['owner','marketer'],mode:'live',actorType:'service'},objects=new SourceObjectStore(process.env.BORAN_SOURCE_ROOT!);
 const sourceId=uuid(),modelId=uuid(),legacyId=uuid(),foreignOrg=uuid();
 const modelValue={configuration:{...defaultModelConfiguration,connection_id:modelId}};
 const setModel=()=>db.query("INSERT INTO settings(org_id,key,value,schema_version,updated_by) VALUES($1,'ai_configuration',$2,1,$3) ON CONFLICT(org_id,key) DO UPDATE SET value=EXCLUDED.value",[ctx.orgId,JSON.stringify(modelValue),ctx.actorId]);
 const clearModel=()=>db.query("DELETE FROM settings WHERE org_id=$1 AND key='ai_configuration'",[ctx.orgId]);
 const runFor=async(connection:string,version:string)=>(await db.query("SELECT * FROM workflow_runs WHERE org_id=$1 AND kind='insight_topics' AND period_key=$2",[ctx.orgId,sourceDerivationPeriod(connection,[version])])).rows[0]!;
 async function sync(connection:string,revision:string,text:string,mode:'mock'|'live'='live'){
  const stored=await objects.put(ctx.orgId,connection,Buffer.from(text),text),cursor=(await db.query('SELECT cursor FROM connections WHERE id=$1',[connection])).rows[0]!.cursor;
  const snapshot:SourceSnapshot={providerFileId:'synthetic-file',title:'合成资料',revision,...stored,mimeType:'text/plain',retrievedAt:'2026-10-04T01:00:00Z',sourceModifiedAt:null,visibility:'internal',scopeFolderIds:['synthetic-root'],ancestorFolderIds:['synthetic-root'],coverage:{status:'complete',scope:'synthetic-authorized-folder',start_locator:'text:1',end_locator:'text:1',folder_ids:['synthetic-root'],ancestor_folder_ids:['synthetic-root']}};
  const result=await ingestSourceRead({...ctx,mode},{connectionId:connection,expectedCursorHash:stableHash(cursor??null),verifySnapshot:async value=>{await objects.readBytes({orgId:ctx.orgId,connectionId:connection,objectKey:value.objectKey,expectedHash:value.contentHash});},result:{status:'changed',mode,snapshots:[snapshot],nextCursor:{revision},gaps:[]}});return {result,snapshot};
 }
 try{
  await db.query("INSERT INTO connections(id,org_id,provider,account_external_id,display_name,timezone,currency,source_kind,read_mode,scope_json,access_status,capabilities_verified_at) VALUES($1,$2,'google_drive','synthetic-source','Synthetic live source','Asia/Shanghai','CNY','mac_drive','drive_sync',$3,'connected',now())",[sourceId,ctx.orgId,JSON.stringify({folder_ids:['synthetic-root']})]);
  await db.query("INSERT INTO connections(id,org_id,provider,account_external_id,display_name,timezone,currency,read_mode,secret_ref) VALUES($1,$2,'deepseek','synthetic-model','Synthetic model','Asia/Shanghai','CNY','native_api','env:SYNTHETIC_DISPATCH_KEY')",[modelId,ctx.orgId]);
  await db.query("INSERT INTO connections(id,org_id,provider,account_external_id,display_name,timezone,currency,source_kind,read_mode) VALUES($1,$2,'mock','synthetic-legacy','Legacy mock source','Asia/Shanghai','CNY','mac_drive','mock')",[legacyId,ctx.orgId]);
  const legacy=await sync(legacyId,'legacy','旧模拟资料，仅验证历史保留。','mock');
  let firstVersion='',firstRun='',secondVersion='';
  await t.test('live source queues a private model configuration gap without requiring a publishing policy',async()=>{
   const first=await sync(sourceId,'r1','泊冉经营资料第一版。');firstVersion=first.result.sourceVersionIds[0]!;assert.equal(await dispatchMarketing(db),1);const run=await runFor(sourceId,firstVersion);firstRun=String(run.id);assert.equal(run.status,'needs_human');assert.deepEqual((run.error as Row).missing,['AI_NOT_CONFIGURED']);assert.equal((run.input_ref as Row).requested_by,ctx.actorId);assert.deepEqual((run.input_ref as Row).generation_gaps,['POLICY_NOT_ACTIVE']);
   assert.equal((await db.query('SELECT execution_mode FROM source_versions WHERE id=$1',[legacy.result.sourceVersionIds[0]])).rows[0]!.execution_mode,'mock');assert.equal((await db.query("SELECT dispatched_at FROM outbox_events WHERE event_type='source.changed' AND aggregate_id=$1",[legacyId])).rows[0]!.dispatched_at,null);
  });
  await t.test('saving valid local model configuration resumes an unattempted read-only run without another source event',async()=>{
   await setModel();assert.equal(await dispatchMarketing(db),0);const run=await runFor(sourceId,firstVersion);assert.equal(run.status,'queued');const step=(await db.query('SELECT * FROM workflow_steps WHERE run_id=$1',[run.id])).rows[0]!;assert.equal(step.execution_mode,'read_only');assert.equal(step.attempts,0);assert.equal(step.state,'queued');assert.equal(Number((await db.query('SELECT count(*) AS n FROM ai_runs')).rows[0]!.n),0);
  });
  await t.test('a second immutable change creates one additional workflow; repeated events cannot forge actors or rewrite historical mode',async()=>{
   const second=await sync(sourceId,'r2','泊冉经营资料第二版。');secondVersion=second.result.sourceVersionIds[0]!;assert.equal(await dispatchMarketing(db),1);assert.equal((await runFor(sourceId,secondVersion)).status,'queued');const repeat=await sync(sourceId,'r2','泊冉经营资料第二版。');assert.equal(repeat.result.sourceVersionIds.length,0);assert.equal(await dispatchMarketing(db),0);
   await db.query("INSERT INTO outbox_events(org_id,event_id,event_type,aggregate_id,schema_version,payload,occurred_at,next_attempt_at) VALUES($1,$2,'source.changed',$3,1,$4,now(),now())",[ctx.orgId,uuid(),sourceId,JSON.stringify({sourceVersionIds:[secondVersion],requested_by:uuid(),mode:'mock'})]);assert.equal(await dispatchMarketing(db),1);assert.equal((await runFor(sourceId,secondVersion)).input_ref&&((await runFor(sourceId,secondVersion)).input_ref as Row).requested_by,ctx.actorId);assert.equal(Number((await db.query("SELECT count(*) AS n FROM workflow_runs WHERE org_id=$1 AND kind='insight_topics'",[ctx.orgId])).rows[0]!.n),2);
  });
  await t.test('paid calling/failed markers and attempted steps never resume or get relabeled by duplicate source events',async()=>{
   await db.query("UPDATE workflow_runs SET status='needs_human',error=$2 WHERE id=$1",[firstRun,JSON.stringify({code:'MARKETING_DERIVATION_NEEDS_HUMAN',missing:['AI_NOT_CONFIGURED']})]);await db.query("UPDATE workflow_steps SET state='needs_human',attempts=1,output_ref=$2 WHERE run_id=$1",[firstRun,JSON.stringify({_ai_execution:{status:'calling',request_hash:'synthetic'}})]);await dispatchMarketing(db);assert.equal((await runFor(sourceId,firstVersion)).status,'needs_human');
   await db.query("INSERT INTO outbox_events(org_id,event_id,event_type,aggregate_id,schema_version,payload,occurred_at,next_attempt_at) VALUES($1,$2,'source.changed',$3,1,$4,now(),now())",[ctx.orgId,uuid(),sourceId,JSON.stringify({sourceVersionIds:[firstVersion]})]);await dispatchMarketing(db);const output=(await db.query('SELECT output_ref FROM workflow_steps WHERE run_id=$1',[firstRun])).rows[0]!.output_ref as Row;assert.equal((output._ai_execution as Row).status,'calling');assert.deepEqual(((await runFor(sourceId,firstVersion)).error as Row).missing,['AI_NOT_CONFIGURED']);
  });
  await t.test('safe configuration recovery rechecks immutable text hash, current scope and original active actor',async()=>{
   await clearModel();const third=await sync(sourceId,'r3','可恢复的第三版合成资料。'),version=third.result.sourceVersionIds[0]!;await dispatchMarketing(db);assert.equal((await runFor(sourceId,version)).status,'needs_human');await setModel();
   await writeFile(join(process.env.BORAN_SOURCE_ROOT!,third.snapshot.textObjectKey!),'篡改');await dispatchMarketing(db);assert.equal((await runFor(sourceId,version)).status,'needs_human');await writeFile(join(process.env.BORAN_SOURCE_ROOT!,third.snapshot.textObjectKey!),'可恢复的第三版合成资料。');
   await db.query("UPDATE connections SET scope_json='{}' WHERE id=$1",[sourceId]);await dispatchMarketing(db);assert.equal((await runFor(sourceId,version)).status,'needs_human');await db.query('UPDATE connections SET scope_json=$2 WHERE id=$1',[sourceId,JSON.stringify({folder_ids:['synthetic-root']})]);
   await db.query('UPDATE memberships SET active=false WHERE org_id=$1 AND user_id=$2',[ctx.orgId,ctx.actorId]);await dispatchMarketing(db);assert.equal((await runFor(sourceId,version)).status,'needs_human');await db.query('UPDATE memberships SET active=true WHERE org_id=$1 AND user_id=$2',[ctx.orgId,ctx.actorId]);await dispatchMarketing(db);assert.equal((await runFor(sourceId,version)).status,'queued');
  });
  await t.test('periodic live source watch only uses the deployment organization and enabled real connections',async()=>{
   const schedule=await validateOperatingSchedule({...ctx,actorType:'user'},{enabled:true,timezone:'Asia/Shanghai',workflows:['source_watch','insight_topics'],business_lines:['shared'],goal_ids:[]});await db.query("INSERT INTO settings(org_id,key,value,schema_version,updated_by) VALUES($1,'operating_schedule',$2,1,$3)",[ctx.orgId,JSON.stringify(schedule),ctx.actorId]);
   await db.query("INSERT INTO organizations(id,name,timezone,base_currency) VALUES($1,'Synthetic foreign org','Asia/Shanghai','CNY')",[foreignOrg]);await db.query("INSERT INTO memberships(org_id,user_id,roles) VALUES($1,$2,ARRAY['owner'])",[foreignOrg,ctx.actorId]);await db.query("INSERT INTO connections(org_id,provider,account_external_id,display_name,timezone,currency,source_kind,read_mode) VALUES($1,'google_drive','synthetic-foreign','Foreign scope','Asia/Shanghai','CNY','mac_drive','drive_sync')",[foreignOrg]);await db.query("INSERT INTO settings(org_id,key,value,schema_version,updated_by) VALUES($1,'operating_schedule',$2,1,$3)",[foreignOrg,JSON.stringify(schedule),ctx.actorId]);await scheduleDueWorkflows(db,new Date('2026-10-04T00:00:00Z'));await scheduleDueWorkflows(db,new Date('2026-10-04T00:01:00Z'));
   const watched=(await db.query("SELECT input_ref FROM workflow_runs WHERE kind='source_watch'")).rows;assert.equal(watched.length,1);assert.equal((watched[0]!.input_ref as Row).connection_id,sourceId);assert.equal(Number((await db.query('SELECT count(*) AS n FROM workflow_runs WHERE org_id=$1',[foreignOrg])).rows[0]!.n),0);
   await db.query("UPDATE connections SET health='disabled' WHERE id=$1",[sourceId]);await scheduleDueWorkflows(db,new Date('2026-10-04T00:15:00Z'));assert.equal(Number((await db.query("SELECT count(*) AS n FROM workflow_runs WHERE kind='source_watch'")).rows[0]!.n),1);
  });
 }finally{await db.close();await rm(root,{recursive:true,force:true});for(const name of names){if(previous[name]===undefined)delete process.env[name];else process.env[name]=previous[name];}}
});
