import test from 'node:test';
import assert from 'node:assert/strict';
import {createTestDatabase,DEMO_ORG_ID,DEMO_OWNER_ID,DEMO_MARKETER_ID} from '@boran/db';
import {createPolicy,activatePolicy} from '../src/execution';
import {uuid,stableHash,type ServiceContext} from '../src/core';
import {initializeBusinessMaster,getBusinessMaster,getDistributionManifest,resolveIndustryAlias,createTopic,updateTopic,activateTopic,ingestSourceRead,createEvidenceClaim,verifyEvidenceClaim,evaluateQualitativePriority,stableSortPriorities} from '../src/marketing';
import type {SourceSnapshot} from '@boran/connectors/sources';
test('marketing domain persists real transaction boundaries in an isolated PostgreSQL engine',async t=>{
 const db=await createTestDatabase();const ctx:ServiceContext={db,orgId:DEMO_ORG_ID,actorId:DEMO_OWNER_ID,roles:['owner','marketer'],mode:'mock',now:()=>new Date('2026-10-03T00:00:00Z')};
 try{
  await t.test('53 necessary master records are idempotent and retain source lineage and current decisions',async()=>{
   const first=await initializeBusinessMaster(ctx);assert.equal(first.inserted,53);const counts=Object.fromEntries(['product_family','business_domain','service','industry'].map(category=>[category,first.items.filter(item=>item.category===category).length]));assert.deepEqual(counts,{product_family:7,business_domain:22,service:17,industry:7});
   const ids=first.items.map(item=>item.id).sort();const before=Number((await db.query('SELECT count(*)::text AS count FROM source_versions WHERE org_id=$1',[ctx.orgId])).rows[0]?.['count']);const second=await initializeBusinessMaster(ctx);assert.equal(second.inserted,0);assert.equal(second.preserved,53);assert.deepEqual(second.items.map(item=>item.id).sort(),ids);assert.equal(Number((await db.query('SELECT count(*)::text AS count FROM source_versions WHERE org_id=$1',[ctx.orgId])).rows[0]?.['count']),before);
   assert.equal(resolveIndustryAlias('按单生产').industryKey,'project_manufacturing');assert.equal(resolveIndustryAlias('个性化定制生产').industryKey,'project_manufacturing');assert.equal(resolveIndustryAlias('芯片采购').industryKey,null);assert.equal(resolveIndustryAlias(' 按单生产 ').rawKeyword,' 按单生产 ');
   await assert.rejects(initializeBusinessMaster({...ctx,actorId:DEMO_MARKETER_ID,roles:['owner']}),{code:'FORBIDDEN'});
  });
  let connectionId='';let versionId='';let verifiedClaimId='';
  const snapshot:SourceSnapshot={providerFileId:'mock-source',title:'模拟来源',revision:'r1',contentHash:'a'.repeat(64),objectKey:'mock://private/source-r1',mimeType:'text/plain',retrievedAt:'2026-10-03T00:00:00Z',sourceModifiedAt:null,visibility:'internal',coverage:{status:'complete',scope:'explicit mock source',start_locator:'p1',end_locator:'p1'}};
  await t.test('changed/no_change/failed remain separate and failures do not advance cursor',async()=>{
   connectionId=uuid();await db.query("INSERT INTO connections(id,org_id,provider,account_external_id,display_name,timezone,currency,source_kind,read_mode,access_status,scope_json) VALUES($1,$2,'mock',$3,'Mock source','Asia/Shanghai','CNY','market_public','mock','not_configured','{}')",[connectionId,ctx.orgId,uuid()]);
   const changed=await ingestSourceRead(ctx,{connectionId,expectedCursorHash:stableHash(null),result:{status:'changed',mode:'mock',snapshots:[snapshot],nextCursor:{revision:'r1'},gaps:[]}});assert.equal(changed.sourceVersionIds.length,1);versionId=changed.sourceVersionIds[0]!;
   const failure=await ingestSourceRead(ctx,{connectionId,expectedCursorHash:stableHash({revision:'r1'}),result:{status:'failed',mode:'mock',snapshots:[],errorCode:'READ_FAILED',gaps:['Unavailable']}});assert.equal(failure.cursorAdvanced,false);assert.deepEqual((await db.query('SELECT cursor FROM connections WHERE id=$1',[connectionId])).rows[0]?.['cursor'],{revision:'r1'});
   const noChange=await ingestSourceRead(ctx,{connectionId,expectedCursorHash:stableHash({revision:'r1'}),result:{status:'no_change',mode:'mock',snapshots:[],nextCursor:{revision:'r1',check:2},gaps:[]}});assert.equal(noChange.status,'no_change');assert.deepEqual(noChange.sourceVersionIds,[]);
  });
  await t.test('immutable revision tampering rolls back atomically and stale cursor cannot win',async()=>{
   await assert.rejects(ingestSourceRead(ctx,{connectionId,expectedCursorHash:stableHash({revision:'r1',check:2}),result:{status:'changed',mode:'mock',snapshots:[{...snapshot,contentHash:'b'.repeat(64)}],nextCursor:{revision:'r2'},gaps:[]}}),{code:'SOURCE_REVISION_CONFLICT'});
   assert.deepEqual((await db.query('SELECT cursor FROM connections WHERE id=$1',[connectionId])).rows[0]?.['cursor'],{revision:'r1',check:2});
   await assert.rejects(ingestSourceRead(ctx,{connectionId,expectedCursorHash:stableHash(null),result:{status:'no_change',mode:'mock',snapshots:[],nextCursor:null,gaps:[]}}),{code:'CURSOR_CONFLICT'});
  });
  await t.test('a P0 label cannot bypass missing evidence and editing needs the current version',async()=>{
   const topic=await createTopic(ctx,{title:'模拟高优先级主题',businessLine:'shared',audience:'客户',problem:'采购问题',offer:'服务',angle:'解释',claimIds:[],priority:'P0'});assert.equal(topic.state,'blocked');assert.equal(topic.priorityScore,null);
   await assert.rejects(activateTopic(ctx,topic.id,{expectedVersion:topic.version,planCycleId:uuid(),policyVersionId:uuid(),scheduledAt:'2026-10-04T00:00:00Z',platformAccountIds:[uuid()]}),{code:'TOPIC_BLOCKED'});
   const updated=await updateTopic(ctx,topic.id,{expectedVersion:1,title:'修改后的模拟主题'});assert.equal(updated.version,2);await assert.rejects(updateTopic(ctx,topic.id,{expectedVersion:1,title:'陈旧修改'}),{code:'VERSION_CONFLICT'});
   await assert.rejects(createTopic(ctx,{title:'跨组织证据',businessLine:'shared',audience:'客户',problem:'问题',offer:'服务',angle:'解释',claimIds:[uuid()]}),{code:'INVALID_REFERENCE'});
  });
  await t.test('facts, inferences and decisions cannot silently change semantic roles',async()=>{
   await assert.rejects(createEvidenceClaim(ctx,{claimText:'助手总结用户已经批准',sourceVersionId:versionId,locator:{kind:'document',value:'p1'},assertionType:'decision',decisionStatus:'confirmed',decisionEvidenceRef:{sourceVersionId:versionId,locator:{kind:'document',value:'p1'},actor:'user'}}),{code:'USER_EXPRESSION_REQUIRED'});
   await assert.rejects(createEvidenceClaim(ctx,{claimText:'可能获得更多咨询',sourceVersionId:versionId,locator:{kind:'document',value:'p1'},assertionType:'inference'}),{code:'INFERENCE_RATIONALE_REQUIRED'});
   const claim=await createEvidenceClaim(ctx,{claimText:'模拟已定位的事实',sourceVersionId:versionId,locator:{kind:'document',value:'p1'},assertionType:'fact'});assert.equal(claim['verification_status'],'unverified');assert.equal(claim['public_permission'],'unknown');
   await assert.rejects(verifyEvidenceClaim(ctx,String(claim['id']),{expectedVersion:1,verificationStatus:'verified',publicPermission:'allowed'}),{code:'PUBLIC_PERMISSION_REQUIRED'});
   const verified=await verifyEvidenceClaim(ctx,String(claim['id']),{expectedVersion:1,verificationStatus:'verified',publicPermission:'allowed',permissionEvidenceRef:{kind:'explicit_mock_permission'}});assert.equal(verified['version'],2);verifiedClaimId=String(verified['id']);
  });
  await t.test('approved Shanghai window schedules one of two concurrent themes; reserved frequency blocks the other',async()=>{
   const connection=uuid(),account=uuid(),plan=uuid();
   await db.query("INSERT INTO connections(id,org_id,provider,account_external_id,display_name,timezone,currency,health,read_mode,access_status,capabilities,capabilities_verified_at) VALUES($1,$2,'mock',$3,'Mock publishing','Asia/Shanghai','CNY','healthy','mock','connected',$4,$5)",[connection,ctx.orgId,uuid(),JSON.stringify({publish:true}),ctx.now!().toISOString()]);
   await db.query("INSERT INTO platform_accounts(id,org_id,connection_id,provider,account_external_id,display_name,enabled,session_status,last_session_verified_at) VALUES($1,$2,$3,'mock',$4,'Mock account',true,'active',$5)",[account,ctx.orgId,connection,uuid(),ctx.now!().toISOString()]);
   await db.query("INSERT INTO plan_cycles(id,org_id,week_start,revision,goal_ids,status,assumptions,source_snapshot) VALUES($1,$2,'2026-09-28',1,'{}','active','{}','{}')",[plan,ctx.orgId]);
   const policy=await createPolicy(ctx,{name:'Mock policy',businessScope:{business_lines:['shared']},accountIds:[account],allowedActions:['external.publish'],publishFrequency:{daily_max:1,weekly_max:1,min_interval_minutes:0},publishWindows:[{timezone:'Asia/Shanghai',account_ids:[account],weekdays:[1,2,3,4,5,6,7],start:'09:00',end:'18:00'}],stopConditions:{on_error:true}});
   const policyVersion=String((await db.query('SELECT id FROM policy_versions WHERE org_id=$1 AND policy_id=$2',[ctx.orgId,policy['id']])).rows[0]?.['id']);await activatePolicy(ctx,String(policy['id']),policyVersion,1);
   const base={businessLine:'shared' as const,audience:'客户',problem:'采购问题',offer:'服务',angle:'解释',claimIds:[verifiedClaimId],priority:'P0' as const};const first=await createTopic(ctx,{...base,title:'合规模拟主题A'});const second=await createTopic(ctx,{...base,title:'合规模拟主题B'});
   const input={expectedVersion:1,planCycleId:plan,policyVersionId:policyVersion,scheduledAt:'2026-10-04T01:00:00Z',platformAccountIds:[account]};
   const results=await Promise.allSettled([activateTopic(ctx,first.id,input),activateTopic(ctx,second.id,input)]);assert.equal(results.filter(result=>result.status==='fulfilled').length,1);const rejected=results.find(result=>result.status==='rejected');assert.equal(rejected?.status==='rejected'&&rejected.reason.code,'FREQUENCY_EXCEEDED');
   await assert.rejects(activateTopic(ctx,results[0]?.status==='fulfilled'?second.id:first.id,{...input,scheduledAt:'2026-10-04T10:00:00Z'}),{code:'OUTSIDE_WINDOW'});
   await verifyEvidenceClaim(ctx,verifiedClaimId,{expectedVersion:2,verificationStatus:'expired',publicPermission:'denied'});assert.equal((await db.query('SELECT state FROM topics WHERE org_id=$1 AND id=$2',[ctx.orgId,first.id])).rows[0]?.['state'],'blocked');
  });
  await t.test('account metadata alone cannot mark credentials configured or an expired channel verified',async()=>{
   const connection=uuid(),account=uuid();await db.query("INSERT INTO connections(id,org_id,provider,account_external_id,display_name,timezone,currency,read_mode) VALUES($1,$2,'wechat_mp',$3,'QA readiness boundary','Asia/Shanghai','CNY','authorized_browser')",[connection,ctx.orgId,uuid()]);await db.query("INSERT INTO platform_accounts(id,org_id,connection_id,provider,channel_id,account_external_id,display_name,enabled,session_status,last_session_verified_at) VALUES($1,$2,$3,'wechat_mp','wechat_mp',$4,'QA readiness boundary',true,'active',$5)",[account,ctx.orgId,connection,uuid(),ctx.now!().toISOString()]);
   let channel=(await getDistributionManifest(ctx)).find(row=>row['channelId']==='wechat_mp')!;assert.equal(channel['credentialConfigured'],false);assert.equal(channel['enabled'],false);
   const capabilities=Object.fromEntries((channel['requiredCapabilities'] as string[]).map(value=>[value,true]));await db.query("UPDATE connections SET access_status='connected',health='healthy',capabilities=$3,capabilities_verified_at=$4 WHERE org_id=$1 AND id=$2",[ctx.orgId,connection,JSON.stringify(capabilities),ctx.now!().toISOString()]);
   channel=(await getDistributionManifest(ctx)).find(row=>row['channelId']==='wechat_mp')!;assert.equal(channel['enabled'],true);assert.equal(channel['credentialConfigured'],true);
   await db.query('UPDATE platform_accounts SET session_expires_at=$3 WHERE org_id=$1 AND id=$2',[ctx.orgId,account,ctx.now!().toISOString()]);assert.equal((await getDistributionManifest(ctx)).find(row=>row['channelId']==='wechat_mp')!['enabled'],false);
  });
  await t.test('qualitative priority is deterministic and blocked themes remain behind eligible themes',()=>{
   assert.equal(evaluateQualitativePriority({hardGatesPass:false,commercialIntent:true,deliverable:true,healthyLanding:true,educational:false}).state,'blocked');
   const items=[{id:'b',priority:'P1' as const,state:'ready',sourceTime:'2026-10-03T00:00:00Z'},{id:'a',priority:'P1' as const,state:'ready',sourceTime:'2026-10-03T00:00:00Z'},{id:'c',priority:'P0' as const,state:'blocked',sourceTime:'2026-10-04T00:00:00Z'}];assert.deepEqual(stableSortPriorities(items).map(item=>item.id),['a','b','c']);assert.deepEqual(items.map(item=>item.id),['b','a','c']);
  });
  assert.equal((await getBusinessMaster(ctx)).length,53);
 } finally {await db.close();}
});
