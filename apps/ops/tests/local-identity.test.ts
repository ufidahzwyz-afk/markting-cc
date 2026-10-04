import test from 'node:test';
import assert from 'node:assert/strict';
import { createTestDatabase, DEMO_ORG_ID, DEMO_OWNER_ID, DEMO_MARKETER_ID } from '@boran/db';
import { configureLocalIdentity, localIdentityReady, signInLocal, resolveLocalSession, revokeLocalSession } from '../src/lib/local-identity';
import { evaluateOpsAccess } from '../src/lib/access';
import { assertWriteOrigin, assertMockOrganizationIsolated } from '../src/lib/server-context';
import { POST as login } from '../src/app/api/v1/local-auth/login/route';

test('local live identity is explicit and remains unavailable in production or mock authorization', () => {
  const env={AUTH_MODE:'local',APP_ENV:'development',BORAN_MODE:'live',BORAN_ORG_ID:DEMO_ORG_ID};
  assert.equal(localIdentityReady(env),true);assert.deepEqual(evaluateOpsAccess(env),{allowed:true,mode:'local',environment:'development'});
  for(const changed of [{APP_ENV:'production'},{APP_ENV:undefined},{BORAN_MODE:'mock'},{BORAN_ORG_ID:'invalid'},{AUTH_MODE:'mock'}])assert.equal(localIdentityReady({...env,...changed}),false);
});
test('a real configured organization cannot be reopened through anonymous mock identity; isolated demo history remains usable',async()=>{
  const db=await createTestDatabase();
  try{
    await assertMockOrganizationIsolated(db,DEMO_ORG_ID);
    await configureLocalIdentity(db,{orgId:DEMO_ORG_ID,ownerId:DEMO_OWNER_ID,userId:DEMO_OWNER_ID,loginName:'private.owner',password:'synthetic-private-org-identity'});
    await assert.rejects(assertMockOrganizationIsolated(db,DEMO_ORG_ID),{code:'LIVE_IDENTITY_REQUIRED'});
    const live=await signInLocal(db,{orgId:DEMO_ORG_ID,name:'private.owner',password:'synthetic-private-org-identity'});
    assert.equal(await resolveLocalSession(db,DEMO_ORG_ID,live.token),DEMO_OWNER_ID);
    assert.equal((await db.query('SELECT count(*)::integer AS n FROM users')).rows[0]!.n,2);
  }finally{await db.close();}
});
test('local sessions bind organization, current membership and credential version, expire after eight hours and revoke', async () => {
  const db=await createTestDatabase(),password='synthetic-local-password-123';
  const configuration={orgId:DEMO_ORG_ID,ownerId:DEMO_OWNER_ID,userId:DEMO_MARKETER_ID,loginName:'qa.operator',password};
  const now=new Date('2026-10-04T08:00:00Z');
  try{
    const before=(await db.query('SELECT count(*)::integer AS n FROM users')).rows[0]!.n;
    await configureLocalIdentity(db,configuration);
    assert.equal((await db.query('SELECT count(*)::integer AS n FROM users')).rows[0]!.n,before);
    const raw=JSON.stringify((await db.query('SELECT value FROM settings WHERE org_id=$1',[DEMO_ORG_ID])).rows);assert.equal(raw.includes(password),false);
    const audit=(await db.query("SELECT request_id FROM audit_logs WHERE action='identity.local_configured'")).rows[0]!;assert.match(String(audit.request_id),/^[0-9a-f-]{36}$/);
    await assert.rejects(configureLocalIdentity(db,{...configuration,ownerId:DEMO_MARKETER_ID}),{code:'FORBIDDEN'});
    await assert.rejects(configureLocalIdentity(db,{...configuration,userId:DEMO_OWNER_ID}),{code:'LOGIN_NAME_TAKEN'});
    await assert.rejects(resolveLocalSession(db,DEMO_ORG_ID,undefined,now),{code:'UNAUTHENTICATED'});
    const session=await signInLocal(db,{orgId:DEMO_ORG_ID,name:'QA.Operator',password},now);
    assert.equal(Date.parse(session.expiresAt)-now.getTime(),8*60*60_000);
    assert.equal(await resolveLocalSession(db,DEMO_ORG_ID,session.token,now),DEMO_MARKETER_ID);
    await assert.rejects(resolveLocalSession(db,'10000000-0000-4000-8000-000000000001',session.token,now),{code:'UNAUTHENTICATED'});
    await assert.rejects(resolveLocalSession(db,DEMO_ORG_ID,session.token,new Date(session.expiresAt)),{code:'UNAUTHENTICATED'});
    await db.query('UPDATE memberships SET active=false WHERE org_id=$1 AND user_id=$2',[DEMO_ORG_ID,DEMO_MARKETER_ID]);
    await assert.rejects(resolveLocalSession(db,DEMO_ORG_ID,session.token,now),{code:'FORBIDDEN'});
    await db.query('UPDATE memberships SET active=true WHERE org_id=$1 AND user_id=$2',[DEMO_ORG_ID,DEMO_MARKETER_ID]);
    await configureLocalIdentity(db,{...configuration,password:'synthetic-rotated-password-456'});
    await assert.rejects(resolveLocalSession(db,DEMO_ORG_ID,session.token,now),{code:'UNAUTHENTICATED'});
    const rotated=await signInLocal(db,{orgId:DEMO_ORG_ID,name:'qa.operator',password:'synthetic-rotated-password-456'},now);await revokeLocalSession(db,DEMO_ORG_ID,rotated.token);await assert.rejects(resolveLocalSession(db,DEMO_ORG_ID,rotated.token,now),{code:'UNAUTHENTICATED'});
  }finally{await db.close();}
});
test('ten failed local logins persist a fifteen minute limit and never create a session', async () => {
  const db=await createTestDatabase(),now=new Date('2026-10-04T08:00:00Z');
  try{
    const input={orgId:DEMO_ORG_ID,name:'unknown.operator',password:'synthetic-wrong-password'};
    for(let attempt=0;attempt<10;attempt++)await assert.rejects(signInLocal(db,input,now),{code:'UNAUTHENTICATED'});
    await assert.rejects(signInLocal(db,input,now),{code:'RATE_LIMITED'});
    assert.equal((await db.query("SELECT key FROM settings WHERE key LIKE 'local_session:%'")).rows.length,0);
    await assert.rejects(signInLocal(db,input,new Date(now.getTime()+15*60_000+1)),{code:'UNAUTHENTICATED'});
    const guards=(await db.query("SELECT value FROM settings WHERE key LIKE 'local_login_guard:%'")).rows;assert.equal((guards[0]!.value as {failures:number}).failures,1);
  }finally{await db.close();}
});
test('local login and authenticated logout reject cross-origin requests before accepting mutations', async () => {
  const keys=['AUTH_MODE','APP_ENV','BORAN_MODE','BORAN_ORG_ID','OPS_BASE_URL'] as const;
  const prior=Object.fromEntries(keys.map(key=>[key,process.env[key]]));
  Object.assign(process.env,{AUTH_MODE:'local',APP_ENV:'test',BORAN_MODE:'live',BORAN_ORG_ID:DEMO_ORG_ID,OPS_BASE_URL:'http://localhost:3000'});
  try{
    const response=await login(new Request('http://localhost:3000/api/v1/local-auth/login',{method:'POST',headers:{origin:'https://other.example','content-type':'application/json'},body:JSON.stringify({login_name:'qa.operator',password:'synthetic-private-password'})}));assert.equal(response.status,403);assert.equal((await response.json()).error.code,'CSRF_REJECTED');
    const token='a'.repeat(64);assert.throws(()=>assertWriteOrigin(new Request('http://localhost:3000/api/v1/local-auth/logout',{method:'POST',headers:{origin:'https://other.example',cookie:`boran_csrf=${token}`,'x-csrf-token':token}})),{code:'CSRF_REJECTED'});
  }finally{for(const key of keys){if(prior[key]===undefined)delete process.env[key];else process.env[key]=prior[key];}}
});
