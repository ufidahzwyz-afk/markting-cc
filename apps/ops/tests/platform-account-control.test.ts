import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {createTestDatabase,DEMO_ORG_ID,DEMO_OWNER_ID,DEMO_MARKETER_ID} from '@boran/db';
import {stableHash,type ServiceContext} from '@boran/domain/core';
import {handleBrowser} from '../src/lib/handlers/browser';
const request=(method:string,path:string,version?:string|number)=>new Request(`http://localhost/api/v1/${path}`,{method,headers:{'idempotency-key':randomUUID(),...(version!==undefined?{'if-match':String(version)}:{})}});

test('separate website account configuration and explicit enable require a current real account receipt',async()=>{
 const db=await createTestDatabase(),ctx:ServiceContext={db,orgId:DEMO_ORG_ID,actorId:DEMO_OWNER_ID,roles:['owner'],mode:'live'};
 try{
  const created=await handleBrowser(ctx,request('POST','connections'),['connections'],{provider:'website',account_external_id:'synthetic-website-user',display_name:'Synthetic site fixture',read_mode:'authorized_browser',scope_json:{platform_login:{method:'password',recipe_id:'private.site',recipe_version:'v1'}}});
  const connection=(await created!.json()).data;
  const result=await handleBrowser(ctx,request('POST','platform-accounts'),['platform-accounts'],{connection_id:connection.id,channel_id:'website',account_external_id:'synthetic-website-user',display_name:'Synthetic site fixture'});
  const account=(await result!.json()).data;assert.equal(account.channel_id,'website');assert.equal(account.enabled,false);
  const path=`platform-accounts/${account.id}/enable`,segments=['platform-accounts',account.id,'enable'];
  await assert.rejects(handleBrowser(ctx,request('POST',path,account.version),segments,{}),{code:'ACCOUNT_SESSION_UNVERIFIED'});
  await assert.rejects(handleBrowser({...ctx,actorId:DEMO_MARKETER_ID,roles:['marketer']},request('POST',path,account.version),segments,{}),{code:'FORBIDDEN'});
  await db.query("UPDATE platform_accounts SET session_status='active',last_session_verified_at=now(),session_version=4,adapter_version='v1' WHERE org_id=$1 AND id=$2",[ctx.orgId,account.id]);
  await assert.rejects(handleBrowser(ctx,request('POST',path,account.version),segments,{}),{code:'ACCOUNT_SESSION_UNVERIFIED'});
  const current=(await db.query('SELECT * FROM connections WHERE org_id=$1 AND id=$2',[ctx.orgId,connection.id])).rows[0]!;
  const hash=stableHash({connection_id:current.id,account_external_id:current.account_external_id,read_mode:current.read_mode,scope_json:current.scope_json,secret_ref:current.secret_ref});
  const commandId=randomUUID(),proof={status:'verified',evidence:{verified:true,kind:'browser_readback',externalAccountId:'synthetic-website-user',capturedAt:new Date().toISOString(),evidenceRef:'synthetic-unit-fixture:identity-only'},data:{configuration_hash:hash,adapter_version:'v1',session_version_after:3}};
  await db.query("INSERT INTO browser_commands(id,org_id,platform_account_id,connection_id,command_type,idempotency_key,state,input_ref,result_ref,finished_at) VALUES($1,$2,$3,$4,'login',$5,'succeeded',$6,$7,now())",[commandId,ctx.orgId,account.id,connection.id,randomUUID(),JSON.stringify({mode:'live',adapter_version:'v1'}),JSON.stringify(proof)]);
  await assert.rejects(handleBrowser(ctx,request('POST',path,account.version),segments,{}),{code:'ACCOUNT_SESSION_UNVERIFIED'});
  proof.data.session_version_after=4;await db.query('UPDATE browser_commands SET result_ref=$2 WHERE id=$1',[commandId,JSON.stringify(proof)]);
  const enabled=await handleBrowser(ctx,request('POST',path,account.version),segments,{});const accepted=(await enabled!.json()).data;
  assert.equal(accepted.enabled,true);assert.equal(accepted.execution_policy_required,true);assert.equal(accepted.platform_capabilities_required,true);
  assert.equal((await db.query('SELECT access_status,capabilities FROM connections WHERE id=$1',[connection.id])).rows[0]!.access_status,'not_configured');
  await assert.rejects(handleBrowser({...ctx,mode:'mock'},request('POST',`platform-accounts/${account.id}/login`),['platform-accounts',account.id,'login'],{}),{code:'LIVE_IDENTITY_REQUIRED'});
  await assert.rejects(handleBrowser({...ctx,mode:'mock'},request('PATCH',`connections/${connection.id}`,connection.edit_version),['connections',connection.id],{display_name:'Anonymous overwrite'}),{code:'LIVE_IDENTITY_REQUIRED'});
  const changed=await handleBrowser(ctx,request('PATCH',`connections/${connection.id}`,connection.edit_version),['connections',connection.id],{scope_json:{platform_login:{method:'password',recipe_id:'private.site',recipe_version:'v2'}}});assert.equal(changed!.status,200);
  const invalidated=(await db.query('SELECT * FROM platform_accounts WHERE id=$1',[account.id])).rows[0]!;assert.equal(invalidated.enabled,false);assert.equal(invalidated.adapter_version,null);assert.equal(invalidated.session_status,'not_connected');assert.equal(Number(invalidated.session_version),5);
  await assert.rejects(handleBrowser(ctx,request('POST',path,Number(invalidated.version)),segments,{}),{code:'ACCOUNT_SESSION_UNVERIFIED'});
  await assert.rejects(handleBrowser(ctx,request('PATCH',`connections/${connection.id}`,(await changed!.json()).data.edit_version),['connections',connection.id],{scope_json:{platform_login:{method:'password',recipe_id:'private.site',recipe_version:'v2'},url:'https://arbitrary.invalid'}}),{code:'INVALID_LOGIN_SCOPE'});
 }finally{await db.close();}
});

test('mock local entry can retain mock accounts but cannot create or mutate real accounts',async()=>{
 const db=await createTestDatabase(),ctx:ServiceContext={db,orgId:DEMO_ORG_ID,actorId:DEMO_OWNER_ID,roles:['owner'],mode:'mock'};
 try{
  await assert.rejects(handleBrowser(ctx,request('POST','connections'),['connections'],{provider:'csdn',account_external_id:'synthetic-real-account',display_name:'Rejected real',read_mode:'native_api'}),{code:'LIVE_IDENTITY_REQUIRED'});
  const result=await handleBrowser(ctx,request('POST','connections'),['connections'],{provider:'csdn',account_external_id:'synthetic-mock-account',display_name:'Allowed mock',read_mode:'mock'});assert.equal(result!.status,201);
  assert.equal((await result!.json()).data.read_mode,'mock');
 }finally{await db.close();}
});

test('unconfigured strong verification stays pending and cancels its manual lock without leaking a ticket or accepting client success',async()=>{
 const db=await createTestDatabase(),ctx:ServiceContext={db,orgId:DEMO_ORG_ID,actorId:DEMO_OWNER_ID,roles:['owner'],mode:'live'};
 const original=process.env.BROWSER_RUNTIME_URL;delete process.env.BROWSER_RUNTIME_URL;
 try{
  const cr=await handleBrowser(ctx,request('POST','connections'),['connections'],{provider:'csdn',account_external_id:'synthetic-mfa-user',display_name:'Synthetic pending MFA',read_mode:'authorized_browser',scope_json:{platform_login:{method:'password',recipe_id:'private.pending',recipe_version:'v1'}}});const connection=(await cr!.json()).data;
  const ar=await handleBrowser(ctx,request('POST','platform-accounts'),['platform-accounts'],{connection_id:connection.id,channel_id:'csdn',account_external_id:'synthetic-mfa-user',display_name:'Synthetic pending MFA'});const account=(await ar!.json()).data;
  const created=await handleBrowser(ctx,request('POST',`platform-accounts/${account.id}/login-sessions`),['platform-accounts',account.id,'login-sessions'],{});const session=(await created!.json()).data;
  assert.equal(session.interaction_ready,false);assert.equal(session.status,'challenge_verification_pending');
  const segments=['login-sessions',session.id,'challenge'],path=`login-sessions/${session.id}/challenge`;
  await assert.rejects(handleBrowser(ctx,request('POST',path),segments,{action:'open',verified:true}),{code:'INVALID_REQUEST'});
  await handleBrowser(ctx,request('POST',`login-sessions/${session.id}/redeem`),['login-sessions',session.id,'redeem'],{platform_account_id:account.id,interaction_ticket:session.interaction_ticket});
  await assert.rejects(handleBrowser(ctx,request('POST',path),segments,{action:'open'}),{code:'BROWSER_IDENTITY_NOT_CONFIGURED'});
  assert.equal((await db.query('SELECT state FROM login_sessions WHERE id=$1',[session.id])).rows[0]!.state,'cancelled');
  const closed=await handleBrowser(ctx,request('POST',path),segments,{action:'close'});assert.equal((await closed!.json()).data.verified,false);
  assert.equal((await db.query('SELECT session_status,enabled FROM platform_accounts WHERE id=$1',[account.id])).rows[0]!.session_status,'not_connected');
  const records=JSON.stringify((await db.query('SELECT response_json FROM idempotency_records')).rows)+JSON.stringify((await db.query('SELECT details FROM audit_logs')).rows);assert.equal(records.includes(session.interaction_ticket),false);
  const again=await handleBrowser(ctx,request('POST',`platform-accounts/${account.id}/login-sessions`),['platform-accounts',account.id,'login-sessions'],{});assert.equal(again!.status,201);
 }finally{if(original===undefined)delete process.env.BROWSER_RUNTIME_URL;else process.env.BROWSER_RUNTIME_URL=original;await db.close();}
});

test('capability verification accepts only an owner request and queues server-selected evidence without declaring success',async()=>{
 const db=await createTestDatabase(),ctx:ServiceContext={db,orgId:DEMO_ORG_ID,actorId:DEMO_OWNER_ID,roles:['owner'],mode:'live'};
 try{
  const created=await handleBrowser(ctx,request('POST','connections'),['connections'],{provider:'csdn',account_external_id:'synthetic-capability-user',display_name:'Synthetic capability fixture',read_mode:'authorized_browser',scope_json:{platform_login:{method:'password',recipe_id:'private.capability',recipe_version:'v1'}}});const connection=(await created!.json()).data;
  const result=await handleBrowser(ctx,request('POST','platform-accounts'),['platform-accounts'],{connection_id:connection.id,channel_id:'csdn',account_external_id:'synthetic-capability-user',display_name:'Synthetic capability fixture'});const account=(await result!.json()).data;
  const path=`platform-accounts/${account.id}/capabilities/verify`,segments=['platform-accounts',account.id,'capabilities','verify'];
  await assert.rejects(handleBrowser(ctx,request('POST',path),segments,{capability_artifact:'caller-selected-file'}),{code:'INVALID_REQUEST'});
  await assert.rejects(handleBrowser({...ctx,mode:'mock'},request('POST',path),segments,{}),{code:'LIVE_IDENTITY_REQUIRED'});
  await assert.rejects(handleBrowser({...ctx,actorId:DEMO_MARKETER_ID,roles:['marketer']},request('POST',path),segments,{}),{code:'FORBIDDEN'});
  await assert.rejects(handleBrowser({...ctx,actorType:'service'},request('POST',path),segments,{}),{code:'FORBIDDEN'});
  const key=randomUUID(),makeRequest=()=>new Request(`http://localhost/api/v1/${path}`,{method:'POST',headers:{'idempotency-key':key}});
  const queued=await handleBrowser(ctx,makeRequest(),segments,{});const data=(await queued!.json()).data;assert.equal(queued!.status,202);assert.equal(data.verified,false);assert.equal(data.capability_status,'verification_pending');
  const command=(await db.query('SELECT * FROM browser_commands WHERE id=$1',[data.command_id])).rows[0]!;assert.equal(command.command_type,'session_verify');assert.equal(command.connection_id,connection.id);assert.equal(command.platform_account_id,account.id);assert.deepEqual((command.input_ref as {refs:unknown}).refs,{capability_artifact:'server-selected'});
  const repeated=await handleBrowser(ctx,makeRequest(),segments,{});assert.equal((await repeated!.json()).data.command_id,data.command_id);
  assert.equal((await db.query('SELECT capabilities_verified_at FROM connections WHERE id=$1',[connection.id])).rows[0]!.capabilities_verified_at,null);assert.equal((await db.query('SELECT enabled FROM platform_accounts WHERE id=$1',[account.id])).rows[0]!.enabled,false);
 }finally{await db.close();}
});

test('mock deployment reads retain mock history and cannot disclose real Drive scope, account IDs or login sessions',async()=>{
 const db=await createTestDatabase(),live:ServiceContext={db,orgId:DEMO_ORG_ID,actorId:DEMO_OWNER_ID,roles:['owner'],mode:'live'},mock={...live,mode:'mock' as const};
 try{
  const real=await handleBrowser(live,request('POST','connections'),['connections'],{provider:'google_drive',account_external_id:'private-real-drive-account',display_name:'Private real Drive',source_kind:'mac_drive',read_mode:'drive_sync',scope_json:{folder_ids:['private-actual-folder']}});const drive=(await real!.json()).data;
  const cr=await handleBrowser(live,request('POST','connections'),['connections'],{provider:'csdn',account_external_id:'private-real-channel-account',display_name:'Private channel fixture',read_mode:'authorized_browser'});const channel=(await cr!.json()).data;
  const ar=await handleBrowser(live,request('POST','platform-accounts'),['platform-accounts'],{connection_id:channel.id,channel_id:'csdn',account_external_id:'private-real-channel-account',display_name:'Private channel fixture'});const account=(await ar!.json()).data;
  const sr=await handleBrowser(live,request('POST',`platform-accounts/${account.id}/login-sessions`),['platform-accounts',account.id,'login-sessions'],{});const session=(await sr!.json()).data;
  const history=await handleBrowser(mock,request('POST','connections'),['connections'],{provider:'csdn',account_external_id:'old-mock-account',display_name:'Original mock history',read_mode:'mock'});const old=(await history!.json()).data;
  const list=await handleBrowser(mock,request('GET','connections'),['connections']);const contents=(await list!.json()).data;assert.ok(contents.some((r:{id:string})=>r.id===old.id));for(const secret of [drive.id,channel.id,'private-actual-folder'])assert.equal(JSON.stringify(contents).includes(secret),false);
  const accounts=await handleBrowser(mock,request('GET','platform-accounts'),['platform-accounts']);assert.equal(JSON.stringify((await accounts!.json()).data).includes(account.id),false);
  for(const [path,segments]of [[`connections/${drive.id}`,['connections',drive.id]],[`connections/${drive.id}/health`,['connections',drive.id,'health']],[`platform-accounts/${account.id}`,['platform-accounts',account.id]],[`platform-accounts/${account.id}/session`,['platform-accounts',account.id,'session']],[`login-sessions/${session.id}`,['login-sessions',session.id]]] as [string,string[]][])await assert.rejects(handleBrowser(mock,request('GET',path),segments),{code:'NOT_FOUND'});
  assert.equal((await handleBrowser(live,request('GET',`connections/${old.id}`),['connections',old.id]))!.status,200);
 }finally{await db.close();}
});
