import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {createTestDatabase,DEMO_ORG_ID,DEMO_OWNER_ID} from '@boran/db';
import {validateApiRequest} from '@boran/contracts';
import type {ServiceContext} from '@boran/domain/core';
import {handleAdsReporting} from '../../apps/ops/src/lib/handlers/ads-reporting';

test('actual synchronous import/report responses satisfy the published contract',async t=>{
 const db=await createTestDatabase();
 const ctx:ServiceContext={db,orgId:DEMO_ORG_ID,actorId:DEMO_OWNER_ID,roles:['owner','marketer'],mode:'mock',now:()=>new Date('2026-10-03T00:00:00Z')};
 const connectionId=randomUUID();
 await db.query("INSERT INTO connections(id,org_id,provider,account_external_id,display_name,read_mode,enabled_for_reporting,authoritative_report_type,timezone,currency) VALUES($1,$2,'mock','demo_baidu','Contract fixture','mock',true,'campaign_daily','Asia/Shanghai','CNY')",[connectionId,ctx.orgId]);
 async function call(path:string,method='GET',body?:Record<string,unknown>,key=randomUUID()){
  const request=new Request(`http://localhost/api/v1/${path}`,{method,headers:{'Content-Type':'application/json','Idempotency-Key':key},...(body?{body:JSON.stringify(body)}:{})});
  const response=await handleAdsReporting(ctx,request,path.split('?')[0]!.split('/'),body);
  assert.ok(response);return {status:response.status,body:await response.json() as {data:Record<string,unknown>;meta:Record<string,unknown>}};
 }
 try{
  const fixtures=await call('imports/fixtures');
  const fixture=(fixtures.body.data as unknown as Record<string,unknown>[]).find(row=>row.object_key==='mock:campaign_daily')!;
  let batchId='';let reportId='';let draftId='';let draftHash='';
  await t.test('preflight is a persisted 201 batch, replay returns the same batch',async()=>{
   const input={connection_id:connectionId,report_type:'campaign_daily',object_key:fixture.object_key,file_hash:fixture.file_hash,window_start:'2026-09-30',window_end:'2026-10-01',currency:'CNY',timezone:'Asia/Shanghai',mapping:{}};
   const first=await call('imports/preflight','POST',input,'contract-preflight');assert.equal(first.status,201);validateApiRequest('ImportPreflightRead',first.body);assert.equal(first.body.data.state,'validated');assert.equal(first.body.data.rowCount,2);assert.equal(first.body.data.run_id,undefined);batchId=String(first.body.data.id);
   const replay=await call('imports/preflight','POST',input,'contract-preflight');validateApiRequest('ImportPreflightRead',replay.body);assert.equal(replay.body.data.id,batchId);assert.equal(replay.body.meta.idempotency_replay,true);
  });
  await t.test('commit is 200, reads conceal normalized upload rows',async()=>{
   const result=await call(`imports/${batchId}/commit`,'POST',{expected_file_hash:fixture.file_hash,confirm_complete_window:true,revision_policy:'upsert_by_natural_key'});assert.equal(result.status,200);validateApiRequest('ImportCommitRead',result.body);
   const read=await call(`imports/${batchId}`);validateApiRequest('ImportBatchRead',read.body);assert.equal(read.body.data.state,'committed');assert.equal(JSON.stringify(read.body.data.mapping).includes('_normalizedRows'),false);
  });
  await t.test('metrics preserve unavailable attribution and authoritative totals',async()=>{
   const result=await call('metrics?start=2026-09-30&end=2026-10-01');validateApiRequest('AdMetricsRead',result.body);assert.equal(result.body.data.spendMinor,22000);assert.equal((result.body.data.attribution as Record<string,unknown>).paidCplMinor,null);
   assert.throws(()=>validateApiRequest('AdMetricsRead',{...result.body,data:{...result.body.data,spendMinor:-1}}));
  });
  await t.test('report generation is a completed immutable snapshot, not queued',async()=>{
   const result=await call('reports/generate','POST',{kind:'daily',period_start:'2026-09-30',period_end:'2026-10-01',connection_ids:[connectionId]});assert.equal(result.status,201);validateApiRequest('ReportCreated',result.body);reportId=String(result.body.data.id);assert.equal(result.body.data.run_id,undefined);
   validateApiRequest('ReportRead',(await call(`reports/${reportId}`)).body);validateApiRequest('ReportsRead',(await call('reports')).body);
  });
  await t.test('pending and approved metric policies have distinct real response shapes',async()=>{
   validateApiRequest('MetricPolicyCurrentRead',(await call('metric-policies/current')).body);
   const draft=await call('metric-policies/versions','POST',{dedupe_window_days:30,attribution_window_days:null,cohort_maturation_window_days:null,scoring_mode:'qualitative',scoring_config:{},calibration_evidence_refs:[],optimization_enabled:false});assert.equal(draft.status,201);validateApiRequest('MetricPolicyDraftCreated',draft.body);draftId=String(draft.body.data.id);draftHash=String(draft.body.data.payloadHash);
   const approved=await call(`metric-policies/${draftId}/approve`,'POST',{payload_hash:draftHash});assert.equal(approved.status,200);validateApiRequest('MetricPolicyApproved',approved.body);validateApiRequest('MetricPolicyCurrentRead',(await call('metric-policies/current')).body);
  });
 }finally{await db.close();}
});
