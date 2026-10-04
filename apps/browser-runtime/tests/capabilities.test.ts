import test from "node:test";
import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { chromium } from "playwright";
import { createTestDatabase, DEMO_ORG_ID, DEMO_OWNER_ID } from "@boran/db";
import { ConnectorBlockedError, createPlatformAdapter, getPlatformDescriptor, type PlatformExecutionContext, type PlatformHooks } from "@boran/connectors";
import { type ServiceContext } from "@boran/domain/core";
import { CapabilityArtifactRegistry, platformConfigurationHash } from "../src/capabilities";
import { BrowserRecipeRegistry, type BrowserRecipe } from "../src/recipes";
import { createRuntimePlatformRegistry } from "../src/runtime-hooks";
import { createBrowserService, parseBrowserCommand } from "../src/service";

async function artifact(root: string, context: PlatformExecutionContext, connection: Record<string, unknown>, names: readonly string[]) {
  const at=new Date().toISOString(),configurationHash=platformConfigurationHash(connection),tests=[];
  await mkdir(join(root,'evidence'),{mode:0o700});
  for(const capability of names){
    const evidenceRef=`synthetic-independent-receipt:${capability}`,evidencePath=`evidence/${capability}.json`;
    const content=JSON.stringify({orgId:context.orgId,accountId:context.accountId,connectionId:connection.connection_id??connection.id,configurationHash,adapterVersion:context.adapterVersion,sessionVersion:context.sessionVersion,capability,externalAccountId:context.externalAccountId,kind:'browser_readback',capturedAt:at,evidenceRef,source:'platform_readback',observed:{fixture:true,actualExternalAccountId:context.externalAccountId}});
    await writeFile(join(root,evidencePath),content,{mode:0o600});
    tests.push({capability,evidenceRef,evidencePath,sha256:createHash('sha256').update(content).digest('hex'),capturedAt:at,kind:'browser_readback',externalAccountId:context.externalAccountId});
  }
  const file=join(root,'artifacts.json');await writeFile(file,JSON.stringify([{id:'synthetic-acceptance-v1',orgId:context.orgId,accountId:context.accountId,connectionId:connection.connection_id??connection.id,configurationHash,externalAccountId:context.externalAccountId,adapterVersion:context.adapterVersion,sessionVersion:context.sessionVersion,acceptedAt:at,tests}]),{mode:0o600});return file;
}
test('capability admission only accepts a fixed server selection, never caller paths or uploaded proof',()=>{
  const input={command_type:'session_verify',platform_account_id:randomUUID(),connection_id:randomUUID(),idempotency_key:'cap-test',adapter_version:'reviewed-v1',input_ref:{capability_artifact:'server-selected'}};
  assert.equal(parseBrowserCommand(input).input_ref.capability_artifact,'server-selected');
  assert.throws(()=>parseBrowserCommand({...input,input_ref:{capability_artifact:'acceptance/file.json'}}),{code:'invalid_capability_reference'});
  assert.throws(()=>parseBrowserCommand({...input,command_type:'login'}),{code:'invalid_capability_reference'});
  assert.throws(()=>parseBrowserCommand({...input,input_ref:{capability_artifact:'server-selected',verified:'true'}}),{code:'invalid_input_reference'});
});
test('independent artifact binds config/session/account and verifies every original evidence file hash',async()=>{
  const root=await mkdtemp(join(tmpdir(),'boran-capability-'));
  const context:PlatformExecutionContext={orgId:randomUUID(),accountId:randomUUID(),externalAccountId:'synthetic-account',adapterVersion:'reviewed-v1',sessionVersion:3,fencingToken:4,commandId:randomUUID(),mode:'live',assertLease:async()=>undefined};
  const connection={id:randomUUID(),account_external_id:context.externalAccountId,read_mode:'authorized_browser',scope_json:{platform_login:{recipe_version:'reviewed-v1'}},secret_ref:'boran-secret:synthetic'};
  try{
    const path=await artifact(root,context,connection,['verify_account','maintain_session']),registry=new CapabilityArtifactRegistry(path);
    assert.deepEqual(registry.select(context,connection).capabilities,['verify_account','maintain_session']);
    assert.throws(()=>registry.select({...context,sessionVersion:4},connection),{code:'capability_artifact_not_configured'});
    assert.throws(()=>registry.select({...context,orgId:randomUUID()},connection),{code:'capability_artifact_not_configured'});
    assert.throws(()=>registry.select(context,{...connection,secret_ref:'boran-secret:rotated'}),{code:'capability_artifact_not_configured'});
    const originalNow=Date.now;try{Date.now=()=>originalNow()+25*3600_000;assert.throws(()=>registry.select(context,connection),{code:'capability_artifact_expired'});}finally{Date.now=originalNow;}
    await writeFile(join(root,'evidence/verify_account.json'),'tampered actual receipt',{mode:0o600});assert.throws(()=>registry.select(context,connection),{code:'capability_evidence_invalid'});
    assert.throws(()=>new CapabilityArtifactRegistry().select(context,connection),{code:'capability_artifact_not_configured'});
  }finally{await rm(root,{recursive:true,force:true});}
});
test('same-session cached capability proof cannot permit a write after 24-hour acceptance expiry or configuration revocation',async()=>{
  const originalNow=Date.now,at=originalNow(),context:PlatformExecutionContext={orgId:randomUUID(),accountId:randomUUID(),externalAccountId:'synthetic-account',adapterVersion:'fixture-v1',sessionVersion:2,fencingToken:4,commandId:randomUUID(),mode:'live',assertLease:async()=>undefined};let probes=0,writes=0,configurationCurrent=true;
  const hooks:PlatformHooks={probe:async()=>{probes++;if(!configurationCurrent)throw new ConnectorBlockedError('capability_configuration_changed');if(Date.now()>at+86400_000)throw new ConnectorBlockedError('capability_artifact_expired');return{verified:true,externalAccountId:context.externalAccountId,adapterVersion:context.adapterVersion,evidenceRef:'synthetic-independent-proof',capturedAt:new Date(at).toISOString(),kind:'browser_readback',capabilities:[...getPlatformDescriptor('toutiao').requiredCapabilities]};},publish:async()=>{writes++;return{status:'submitted',externalId:'fixture-publication'};},readback:async()=>({status:'verified',evidence:{verified:true,externalAccountId:context.externalAccountId,evidenceRef:'synthetic-result',capturedAt:new Date().toISOString(),kind:'browser_readback',labelsVerified:true}})};
  const adapter=createPlatformAdapter('toutiao',{mode:'live',hooks});await adapter.verify(context);
  try{Date.now=()=>at+25*3600_000;await assert.rejects(()=>adapter.execute(context,{commandType:'publish',actionId:randomUUID(),inputRef:{}}),{code:'capability_artifact_expired'});}finally{Date.now=originalNow;}
  configurationCurrent=false;await assert.rejects(()=>adapter.execute(context,{commandType:'publish',actionId:randomUUID(),inputRef:{}}),{code:'capability_configuration_changed'});assert.equal(probes,3);assert.equal(writes,0);
});
test('actual Chromium identity login grants no write capabilities; independent bound acceptance becomes durable and is revoked by config rotation',{skip:!process.env.CHROMIUM_EXECUTABLE_PATH},async()=>{
  const db=await createTestDatabase(),root=await mkdtemp(join(tmpdir(),'boran-capability-bootstrap-')),browser=await chromium.launch({headless:true,executablePath:process.env.CHROMIUM_EXECUTABLE_PATH!});
  let databaseFailure: unknown;const transact=db.transaction.bind(db);db.transaction=async fn=>transact(fn).catch(error=>{databaseFailure=error;throw error;});
  const pageContext=await browser.newContext(),recipe:BrowserRecipe={id:'fixture-capability',version:'fixture-v1',channelId:'toutiao',allowedOrigins:['https://mp.toutiao.com'],login:{method:'password',url:'https://mp.toutiao.com/login',accountUrl:'https://mp.toutiao.com/account',account:{selector:'#account',attribute:'data-account-id'},usernameSelector:'#username',passwordSelector:'#password',submitSelector:'#submit',challengeSelectors:['#challenge']}};
  let observedAccount='synthetic-real-account';await pageContext.route('**/*',async route=>route.fulfill({contentType:'text/html; charset=utf-8',body:`<div id="account" data-account-id="${observedAccount}">实际 fixture 账号</div>`}));
  const connectionId=randomUUID(),accountId=randomUUID(),scope={platform_login:{method:'password',recipe_id:recipe.id,recipe_version:recipe.version}},ctx:ServiceContext={db,orgId:DEMO_ORG_ID,actorId:DEMO_OWNER_ID,actorType:'user',roles:['owner'],mode:'live'};
  await db.query("INSERT INTO connections(id,org_id,provider,account_external_id,display_name,read_mode,scope_json,timezone,currency) VALUES($1,$2,'toutiao',$3,'capability fixture','authorized_browser',$4,'Asia/Shanghai','CNY')",[connectionId,ctx.orgId,observedAccount,JSON.stringify(scope)]);
  await db.query("INSERT INTO platform_accounts(id,org_id,connection_id,provider,channel_id,account_external_id,display_name,session_status) VALUES($1,$2,$3,'toutiao','toutiao',$4,'capability fixture','not_connected')",[accountId,ctx.orgId,connectionId,observedAccount]);
  const recipes=new BrowserRecipeRegistry([recipe]),withProfile=async<T>(_input:unknown,run:(browser:unknown)=>Promise<T>)=>run(pageContext);
  const platform=()=>db.query('SELECT a.*,c.read_mode,c.scope_json,c.secret_ref,c.account_external_id AS connection_external_id,c.capabilities,c.capabilities_verified_at FROM platform_accounts a JOIN connections c ON c.org_id=a.org_id AND c.id=a.connection_id WHERE a.id=$1',[accountId]);
  try{
    const initial=createBrowserService(ctx,{adapters:createRuntimePlatformRegistry({mode:'live',database:async()=>db,recipes,environment:{}}),withProfile});
    const login=await initial.enqueue({command_type:'login',platform_account_id:accountId,connection_id:connectionId,idempotency_key:'identity-first',adapter_version:recipe.version,session_version:0,input_ref:{}}),loginResult=await initial.execute(login.id,'fixture-runtime');assert.equal(loginResult.state,'succeeded',JSON.stringify({result:loginResult.result_ref,databaseFailure:String(databaseFailure)}));
    let connection=(await db.query('SELECT * FROM connections WHERE id=$1',[connectionId])).rows[0]!;assert.equal(connection.access_status,'verifying');assert.equal(connection.health,'healthy');assert.equal(connection.capabilities_verified_at,null);assert.deepEqual(connection.capabilities,{});
    const request={command_type:'session_verify' as const,platform_account_id:accountId,connection_id:connectionId,adapter_version:recipe.version,session_version:1,input_ref:{capability_artifact:'server-selected'}};
    const missing=await initial.enqueue({...request,idempotency_key:'missing-independent-acceptance'});const blocked=await initial.execute(missing.id,'fixture-runtime');assert.equal(blocked.state,'blocked');assert.equal((blocked.result_ref as {reason:string}).reason,'capability_artifact_not_configured');
    const runtime:PlatformExecutionContext={orgId:ctx.orgId,accountId,externalAccountId:observedAccount,adapterVersion:recipe.version,sessionVersion:1,fencingToken:1,commandId:randomUUID(),mode:'live',assertLease:async()=>undefined};
    const row=(await platform()).rows[0]!,required=getPlatformDescriptor('toutiao').requiredCapabilities,file=await artifact(root,runtime,row,required);
    const adapters=createRuntimePlatformRegistry({mode:'live',database:async()=>db,recipes,environment:{BROWSER_CAPABILITY_ARTIFACTS_FILE:file}}),service=createBrowserService(ctx,{adapters,withProfile});
    observedAccount='different-provider-account';const mismatch=await service.enqueue({...request,idempotency_key:'different-live-account'});assert.equal((await service.execute(mismatch.id,'fixture-runtime')).state,'blocked');
    connection=(await db.query('SELECT * FROM connections WHERE id=$1',[connectionId])).rows[0]!;assert.equal(connection.capabilities_verified_at,null);
    observedAccount=runtime.externalAccountId;const command=await service.enqueue({...request,idempotency_key:'bound-independent-acceptance'}),result=await service.execute(command.id,'fixture-runtime');assert.equal(result.state,'succeeded',JSON.stringify(result.result_ref));
    const data=(result.result_ref as {data:Record<string,unknown>}).data;assert.equal(data.capability_status,'verified');assert.equal(data.capability_artifact_id,'synthetic-acceptance-v1');assert.equal(data.session_version_after,2);
    connection=(await db.query('SELECT * FROM connections WHERE id=$1',[connectionId])).rows[0]!;assert.ok(connection.capabilities_verified_at);const saved=connection.capabilities as Record<string,unknown>;for(const name of required)assert.equal(saved[name],true);assert.equal(saved.collect_actual_metrics,undefined);assert.equal(saved.native_budget_control,undefined);assert.equal((saved.platform_execution as {registrationCommandId:string}).registrationCommandId,command.id);
    assert.equal((await adapters.get('toutiao')!.verify({...runtime,sessionVersion:2,browserSession:pageContext})).artifactId,'synthetic-acceptance-v1');
    await assert.rejects(()=>adapters.get('toutiao')!.verify({...runtime,sessionVersion:3,browserSession:pageContext}),{code:'capability_gap'});
    await db.query("UPDATE connections SET scope_json=scope_json||'{\"configuration_revision\":2}'::jsonb WHERE id=$1",[connectionId]);
    await assert.rejects(()=>adapters.get('toutiao')!.verify({...runtime,sessionVersion:2,browserSession:pageContext}),{code:'capability_gap'});
    await db.query('UPDATE connections SET scope_json=$2 WHERE id=$1',[connectionId,JSON.stringify(scope)]);
    const refreshed=await service.enqueue({...request,idempotency_key:'identity-session-rotation',session_version:2,input_ref:{}});assert.equal((await service.execute(refreshed.id,'fixture-runtime')).state,'succeeded');
    connection=(await db.query('SELECT * FROM connections WHERE id=$1',[connectionId])).rows[0]!;assert.equal(connection.access_status,'verifying');assert.equal(connection.capabilities_verified_at,null);assert.deepEqual(connection.capabilities,{});
  }finally{await browser.close();await db.close();await rm(root,{recursive:true,force:true});}
});
