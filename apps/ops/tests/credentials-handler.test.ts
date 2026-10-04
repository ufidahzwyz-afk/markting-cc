import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, readFile, readdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createTestDatabase, DEMO_ORG_ID, DEMO_OWNER_ID, DEMO_MARKETER_ID } from '@boran/db';
import { initializeSecretStore } from '@boran/connectors/secrets';
import type { ServiceContext } from '@boran/domain/core';
import { handleBrowser } from '../src/lib/handlers/browser';
import { handleCredentials } from '../src/lib/handlers/credentials';
const request = (path:string,key:string,version?:string) => new Request(`http://localhost/api/v1/${path}`, { method:'POST', headers:{'content-type':'application/json','idempotency-key':key,...(version?{'if-match':version}:{})} });
test('credential save is encrypted, scoped, role-bound and idempotent without returning secrets', async () => {
  const db=await createTestDatabase(), directory=await mkdtemp(join(tmpdir(),'boran-credential-http-'));
  const priorRoot=process.env.BORAN_SECRET_STORE_ROOT,priorKey=process.env.BORAN_SECRET_KEY_FILE;
  const rootDirectory=join(directory,'secrets'),keyFile=join(directory,'key','master.key');
  process.env.BORAN_SECRET_STORE_ROOT=rootDirectory;process.env.BORAN_SECRET_KEY_FILE=keyFile;
  const ctx:ServiceContext={db,orgId:DEMO_ORG_ID,actorId:DEMO_OWNER_ID,roles:['owner'],mode:'live'};
  try {
    await initializeSecretStore({rootDirectory,keyFile});
    const create=await handleBrowser(ctx,request('connections','credentials-connection'),['connections'],{provider:'zhihu',account_external_id:'expected-account',display_name:'QA platform',read_mode:'native_api',scope_json:{platform_login:{method:'password',recipe_id:'qa.trusted',recipe_version:'1'}}});
    const connection=(await create!.json()).data;
    const accountResult=await handleBrowser(ctx,request('platform-accounts','credential-platform-account'),['platform-accounts'],{connection_id:connection.id,channel_id:'zhihu',account_external_id:'expected-account',display_name:'QA platform'});const account=(await accountResult!.json()).data;
    const body={kind:'platform_password',username:'synthetic-user-only',password:'synthetic-password-only'};
    const path=`connections/${connection.id}/credentials`,segments=['connections',connection.id,'credentials'];
    await assert.rejects(handleCredentials({...ctx,mode:'mock'},request(path,'mock-anonymous-real-credentials',connection.edit_version),segments,body),{code:'LIVE_IDENTITY_REQUIRED'});
    await assert.rejects(handleCredentials({...ctx,actorId:DEMO_MARKETER_ID,roles:['marketer']},request(path,'denied',connection.edit_version),segments,body),{code:'FORBIDDEN'});
    const first=await handleCredentials(ctx,request(path,'credential-save',connection.edit_version),segments,body);
    assert.equal(first!.status,200);const result=await first!.json();assert.equal(result.data.has_credential_ref,true);assert.equal(result.data.verified,false);assert.equal(result.data.access_status,'not_configured');assert.equal(result.data.login_status,'queued');assert.equal(result.data.login_command_ids.length,1);const command=(await db.query('SELECT command_type,platform_account_id,state,input_ref FROM browser_commands WHERE id=$1',[result.data.login_command_ids[0]])).rows[0]!;assert.equal(command.command_type,'login');assert.equal(command.platform_account_id,account.id);assert.equal(command.state,'queued');assert.equal(JSON.stringify(command).includes(body.password),false);
    const serialized=JSON.stringify(result);for(const secret of [body.username,body.password,'boran-secret:'])assert.equal(serialized.includes(secret),false);
    const files=await readdir(rootDirectory);assert.equal(files.length,1);const stored=await readFile(join(rootDirectory,files[0]!), 'utf8');assert.equal(stored.includes(body.password),false);assert.equal(stored.includes(body.username),false);
    const repeat=await handleCredentials(ctx,request(path,'credential-save',connection.edit_version),segments,body);assert.equal((await repeat!.json()).meta.idempotency_replay,true);assert.equal((await readdir(rootDirectory)).length,1);assert.equal((await db.query('SELECT id FROM browser_commands WHERE org_id=$1',[ctx.orgId])).rows.length,1);
    await assert.rejects(handleCredentials(ctx,request(path,'credential-save',connection.edit_version),segments,{...body,password:'different-synthetic-password'}),{code:'IDEMPOTENCY_CONFLICT'});
    const second=await handleBrowser(ctx,request('connections','credentials-other-connection'),['connections'],{provider:'zhihu',account_external_id:'different-expected-account',display_name:'Other QA platform',read_mode:'native_api'});const other=(await second!.json()).data;const reference=(await db.query('SELECT secret_ref FROM connections WHERE org_id=$1 AND id=$2',[ctx.orgId,connection.id])).rows[0]!.secret_ref;
    const patch=new Request(`http://localhost/api/v1/connections/${other.id}`,{method:'PATCH',headers:{'idempotency-key':'cross-connection-reference','if-match':other.edit_version}});await assert.rejects(handleBrowser(ctx,patch,['connections',other.id],{secret_ref:reference}),{code:'INVALID_CREDENTIAL_REFERENCE'});
    const records=JSON.stringify((await db.query('SELECT response_json FROM idempotency_records WHERE org_id=$1',[ctx.orgId])).rows)+(JSON.stringify((await db.query('SELECT * FROM audit_logs WHERE org_id=$1',[ctx.orgId])).rows));
    assert.equal(records.includes(body.password),false);assert.equal(records.includes(body.username),false);
    await assert.rejects(handleCredentials({...ctx,orgId:'10000000-0000-4000-8000-000000000001'},request(path,'foreign',result.data.edit_version),segments,body),{code:'FORBIDDEN'});
  } finally { if(priorRoot===undefined)delete process.env.BORAN_SECRET_STORE_ROOT;else process.env.BORAN_SECRET_STORE_ROOT=priorRoot;if(priorKey===undefined)delete process.env.BORAN_SECRET_KEY_FILE;else process.env.BORAN_SECRET_KEY_FILE=priorKey;await db.close();await rm(directory,{recursive:true,force:true}); }
});
