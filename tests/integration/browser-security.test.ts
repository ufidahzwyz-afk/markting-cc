import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import type {AddressInfo} from 'node:net';
import {createLocalJWKSet,exportJWK,generateKeyPair,SignJWT} from 'jose';
import {createTestDatabase,DEMO_ORG_ID,DEMO_OWNER_ID,DEMO_MARKETER_ID} from '@boran/db';
import {validateApiRequest} from '@boran/contracts';
import {stableHash,type ServiceContext} from '@boran/domain/core';
import {createPolicy} from '@boran/domain/execution';
import {createBrowserService} from '../../apps/browser-runtime/src/service';
import {createServiceIdentityVerifier} from '../../apps/browser-runtime/src/auth';
import {createBrowserServer} from '../../apps/browser-runtime/src/server';
import {handleBrowser} from '../../apps/ops/src/lib/handlers/browser';

test('independent browser security boundaries use durable account, membership and proof state',async t=>{
 const db=await createTestDatabase();let now=new Date('2026-10-03T00:00:00Z');
 const ctx:ServiceContext={db,orgId:DEMO_ORG_ID,actorId:DEMO_OWNER_ID,actorType:'user',roles:['owner','marketer'],mode:'live',now:()=>now};
 // The callback isolates browser proof checks from execution-policy checks, which have their own suite.
 const service=createBrowserService(ctx,{adapters:new Map(),authorizeAction:async()=>undefined});
 const accounts:string[]=[];
 for(let i=0;i<3;i++){
  const connection=randomUUID(),account=randomUUID();accounts.push(account);
  await db.query("INSERT INTO connections(id,org_id,provider,account_external_id,display_name,read_mode,timezone,currency) VALUES($1,$2,'wechat_mp',$3,'QA live boundary','authorized_browser','Asia/Shanghai','CNY')",[connection,ctx.orgId,`qa-${i}`]);
  await db.query("INSERT INTO platform_accounts(id,org_id,connection_id,provider,channel_id,account_external_id,display_name,enabled,session_status,adapter_version,timezone) VALUES($1,$2,$3,'wechat_mp','wechat_mp',$4,'QA live boundary',true,'active','qa-v1','Asia/Shanghai')",[account,ctx.orgId,connection,`qa-${i}`]);
 }
 const enqueue=(accountId:string)=>service.enqueue({command_type:'session_verify',idempotency_key:randomUUID(),platform_account_id:accountId,adapter_version:'qa-v1',input_ref:{}});
 const clear=()=>db.query("UPDATE browser_commands SET state='cancelled' WHERE org_id=$1 AND state IN('running','queued')",[ctx.orgId]);
 try{
  await t.test('three simultaneous claims persist two global leases and one lease per account',async()=>{
   const commands=await Promise.all(accounts.map(enqueue));const claims=await Promise.allSettled(commands.map(command=>service.claim(command.id,'qa-node')));
   assert.equal(claims.filter(result=>result.status==='fulfilled').length,2);assert.equal((await db.query("SELECT count(*)::integer AS n FROM browser_commands WHERE state='running'")).rows[0]!.n,2);
   assert.ok(claims.some(result=>result.status==='rejected'&&result.reason.code==='browser_capacity_exhausted'));await clear();
   const first=await enqueue(accounts[0]!);const second=await enqueue(accounts[0]!);const same=await Promise.allSettled([service.claim(first.id,'node-a'),service.claim(second.id,'node-b')]);assert.equal(same.filter(result=>result.status==='fulfilled').length,1);assert.ok(same.some(result=>result.status==='rejected'&&result.reason.code==='account_busy'));await clear();
  });
  await t.test('cross-organization reads and current-role revocation defeat stale user context',async()=>{
   const otherOrg=randomUUID();await db.query("INSERT INTO organizations(id,name,timezone,base_currency) VALUES($1,'QA second org','Asia/Shanghai','CNY')",[otherOrg]);
   await db.query("INSERT INTO memberships(id,org_id,user_id,roles,active) VALUES($1,$2,$3,'{owner}',true)",[randomUUID(),otherOrg,ctx.actorId]);
   const foreign=createBrowserService({...ctx,orgId:otherOrg},{adapters:new Map()});const command=await enqueue(accounts[0]!);await assert.rejects(foreign.get(command.id),{code:'command_not_found'});await assert.rejects(foreign.createLogin(accounts[0]!),{code:'account_not_found'});
   const login=await service.createLogin(accounts[1]!);await db.query("UPDATE memberships SET roles='{viewer}' WHERE org_id=$1 AND user_id=$2",[ctx.orgId,ctx.actorId]);
   await assert.rejects(service.createLogin(accounts[2]!),{code:'user_role_revoked'});await assert.rejects(service.redeemLogin({sessionId:login.id,accountId:accounts[1]!,ticket:login.ticket}),{code:'user_role_revoked'});
   await db.query("UPDATE memberships SET roles='{owner,marketer}' WHERE org_id=$1 AND user_id=$2",[ctx.orgId,ctx.actorId]);
   const machine=createBrowserService({...ctx,actorType:'service'},{adapters:new Map()});await assert.rejects(machine.createLogin(accounts[2]!),{code:'login_user_identity_required'});
   await db.query("UPDATE login_sessions SET state='cancelled' WHERE org_id=$1",[ctx.orgId]);await clear();
  });
  await t.test('HTTP idempotency never replays tickets or stores plaintext in audit/results',async()=>{
   const path=`platform-accounts/${accounts[0]}/login-sessions`;const request=()=>new Request(`http://localhost/api/v1/${path}`,{method:'POST',headers:{'Content-Type':'application/json','Idempotency-Key':'qa-login-once'}});
   const first=await handleBrowser(ctx,request(),path.split('/'),{});assert.equal(first?.status,201);const issued=await first!.json();validateApiRequest('LoginSessionCreated',issued);assert.equal(typeof issued.data.interaction_ticket,'string');assert.equal(issued.data.interaction_url,null);
   const replay=await handleBrowser(ctx,request(),path.split('/'),{});const repeated=await replay!.json();validateApiRequest('LoginSessionCreated',repeated);assert.equal(repeated.data.interaction_ticket,null);assert.equal(repeated.data.interaction_url,null);assert.equal(repeated.data.replay,true);
   const stored=await db.query('SELECT * FROM login_sessions WHERE id=$1',[issued.data.id]);assert.equal(JSON.stringify(stored.rows).includes(issued.data.interaction_ticket),false);assert.equal(JSON.stringify((await db.query('SELECT * FROM idempotency_records WHERE org_id=$1',[ctx.orgId])).rows).includes(issued.data.interaction_ticket),false);assert.equal(JSON.stringify((await db.query('SELECT * FROM audit_logs WHERE org_id=$1',[ctx.orgId])).rows).includes(issued.data.interaction_ticket),false);
   const other=createBrowserService({...ctx,actorId:DEMO_MARKETER_ID,roles:['marketer']},{adapters:new Map()});await assert.rejects(other.redeemLogin({sessionId:issued.data.id,accountId:accounts[0]!,ticket:issued.data.interaction_ticket}),{code:'login_binding_mismatch'});
   await service.redeemLogin({sessionId:issued.data.id,accountId:accounts[0]!,ticket:issued.data.interaction_ticket});await assert.rejects(service.redeemLogin({sessionId:issued.data.id,accountId:accounts[0]!,ticket:issued.data.interaction_ticket}),{code:'login_ticket_invalid'});
   await db.query("UPDATE memberships SET active=false WHERE org_id=$1 AND user_id=$2",[ctx.orgId,ctx.actorId]);await assert.rejects(service.authorizeInteraction(issued.data.id,accounts[0]!),{code:'user_revoked'});await db.query('UPDATE memberships SET active=true WHERE org_id=$1 AND user_id=$2',[ctx.orgId,ctx.actorId]);
   now=new Date(now.getTime()+900_000);await assert.rejects(service.authorizeInteraction(issued.data.id,accounts[0]!),{code:'login_interaction_denied'});await service.recoverExpired();
  });
  await t.test('the 60 second ticket deadline expires before the 900 second interaction deadline',async()=>{
   const login=await service.createLogin(accounts[1]!);assert.equal(Date.parse(login.ticketExpiresAt)-now.getTime(),60_000);assert.equal(Date.parse(login.expiresAt)-now.getTime(),900_000);
   now=new Date(now.getTime()+60_000);await assert.rejects(service.redeemLogin({sessionId:login.id,accountId:accounts[1]!,ticket:login.ticket}),{code:'login_ticket_invalid'});assert.ok(Date.parse(login.expiresAt)>now.getTime());await db.query("UPDATE login_sessions SET state='cancelled' WHERE id=$1",[login.id]);
  });
  await t.test('uncertain publish cannot replay, and reconciliation binds account, labels and original content hash',async()=>{
   const payload={title:'QA exact publication',body:'模拟验收，不是实际平台发布'};const payloadHash=stableHash(payload);
   const policy=await createPolicy(ctx,{name:'QA proof binding',businessScope:{business_lines:['shared']},accountIds:[accounts[0]!],allowedActions:['external.publish'],stopConditions:{on_error:true}});const version=(await db.query('SELECT id FROM policy_versions WHERE org_id=$1 AND policy_id=$2',[ctx.orgId,policy.id])).rows[0]!.id;
   const action=randomUUID();await db.query("INSERT INTO execution_actions(id,org_id,policy_version_id,action_type,target,payload,payload_hash,idempotency_key,request_hash,before_snapshot,state) VALUES($1,$2,$3,'external.publish',$4,$5,$6,$7,$6,'{}','queued')",[action,ctx.orgId,version,JSON.stringify({platform_account_id:accounts[0]}),JSON.stringify(payload),payloadHash,randomUUID()]);
   const command=await service.enqueue({command_type:'publish',idempotency_key:randomUUID(),platform_account_id:accounts[0]!,execution_action_id:action,adapter_version:'qa-v1',input_ref:{}});const claimed=await service.claim(command.id,'qa-publish');
   const proof={verified:true as const,externalAccountId:'qa-0',evidenceRef:'qa/readback',capturedAt:now.toISOString(),kind:'browser_readback' as const,labelsVerified:true};
   await assert.rejects(service.finish(command.id,'qa-publish',Number(claimed.fencing_token),{status:'verified',evidence:proof}),{code:'content_verification_mismatch'});
   await assert.rejects(service.finish(command.id,'qa-publish',Number(claimed.fencing_token),{status:'verified',evidence:{...proof,contentHash:'f'.repeat(64)}}),{code:'content_verification_mismatch'});
   await service.finish(command.id,'qa-publish',Number(claimed.fencing_token),{status:'unknown',reason:'response_lost'});await assert.rejects(service.execute(command.id,'qa-again'),{code:'reconciliation_required'});
   const reconcile=await service.reconcile(command.id);const lease=await service.claim(reconcile.id,'qa-read-only');assert.equal(reconcile.command_type,'reconcile');assert.equal(reconcile.input_ref.refs.reconcile_command_id,command.id);
   await assert.rejects(service.finish(reconcile.id,'qa-read-only',Number(lease.fencing_token),{status:'verified',evidence:{...proof,externalAccountId:'other-account',contentHash:payloadHash}}),{code:'account_verification_mismatch'});
   await assert.rejects(service.finish(reconcile.id,'qa-read-only',Number(lease.fencing_token),{status:'verified',evidence:{...proof,labelsVerified:false,contentHash:payloadHash}}),{code:'label_verification_missing'});
   await assert.rejects(service.finish(reconcile.id,'qa-read-only',Number(lease.fencing_token),{status:'verified',evidence:proof}),{code:'content_verification_mismatch'});
   assert.equal((await service.get(command.id)).state,'unknown');await service.finish(reconcile.id,'qa-read-only',Number(lease.fencing_token),{status:'verified',evidence:{...proof,contentHash:payloadHash}});assert.equal((await service.get(command.id)).state,'succeeded');
  });
  await t.test('OIDC ignores token organization claims and live unconfigured execution is 503',async()=>{
   const pair=await generateKeyPair('RS256');const jwk=await exportJWK(pair.publicKey);const email='qa-worker@test-project.iam.gserviceaccount.com';const audience='https://qa-browser.example.invalid';const verifier=createServiceIdentityVerifier({audience,serviceOrganizations:{[email]:[ctx.orgId]},trustedJwks:createLocalJWKSet({keys:[{...jwk,kid:'qa',alg:'RS256'}]})});
   const token=await new SignJWT({email,email_verified:true,org_id:'forged-org'}).setProtectedHeader({alg:'RS256',kid:'qa'}).setIssuer('https://accounts.google.com').setAudience(audience).setSubject('qa-service').setIssuedAt().setExpirationTime('2m').sign(pair.privateKey);
   let factories=0;const server=createBrowserServer({identityVerifier:verifier,getService:async()=>{factories++;return service;}});await new Promise<void>(resolve=>server.listen(0,'127.0.0.1',resolve));const base=`http://127.0.0.1:${(server.address() as AddressInfo).port}`;
   try{
    const command=await enqueue(accounts[2]!);const headers={Authorization:`Bearer ${token}`,'X-Org-ID':'00000000-0000-4000-8000-000000000099'};
    assert.equal((await fetch(`${base}/internal/browser/commands/${command.id}`,{headers})).status,403);assert.equal(factories,0);
    const response=await fetch(`${base}/internal/browser/commands/${command.id}/execute`,{method:'POST',headers:{...headers,'X-Org-ID':ctx.orgId}});assert.equal(response.status,503);assert.equal((await service.get(command.id)).state,'blocked');assert.equal((await service.get(command.id)).result_ref!==null,true);
    assert.equal((await fetch(`${base}/internal/browser/cdp`)).status,404);
   }finally{server.closeAllConnections();await new Promise<void>(resolve=>server.close(()=>resolve()));}
  });
 }finally{await db.close();}
});
