import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { chromium } from "playwright";
import { createTestDatabase, DEMO_ORG_ID, DEMO_OWNER_ID } from "@boran/db";
import { stableHash, type ServiceContext } from "@boran/domain/core";
import { LoginChallengeManager, parseLoginChallenge } from "../src/challenges";
import { BrowserRecipeRegistry, type BrowserRecipe } from "../src/recipes";
import { createBrowserService } from "../src/service";
import type { BrowserProfilePool } from "../src/profiles";

test("challenge commands cannot navigate, execute scripts, disclose cookies or choose a selector",()=>{
  assert.deepEqual(parseLoginChallenge({action:'submit',code:'738291'}),{action:'submit',code:'738291'});
  for(const field of ['url','selector','script','cookie'])assert.throws(()=>parseLoginChallenge({action:'open',[field]:'arbitrary'}),{code:'INVALID_LOGIN_CHALLENGE'});
  assert.throws(()=>parseLoginChallenge({action:'open',code:'738291'}),{code:'INVALID_LOGIN_CHALLENGE'});
  assert.throws(()=>parseLoginChallenge({action:'submit',code:'arbitrary long password value'}),{code:'INVALID_LOGIN_CHALLENGE'});
});
test("actual Chromium verification field is bound to redeemed member/account/session/fence and persists proof without the code",{skip:!process.env.CHROMIUM_EXECUTABLE_PATH},async()=>{
  const db=await createTestDatabase(),browser=await chromium.launch({headless:true,executablePath:process.env.CHROMIUM_EXECUTABLE_PATH!});
  const recipe:BrowserRecipe={id:'fixture-verification',version:'fixture-mfa-v1',channelId:'toutiao',allowedOrigins:['https://mp.toutiao.com'],login:{method:'password',url:'https://mp.toutiao.com/login',accountUrl:'https://mp.toutiao.com/account',account:{selector:'#account',attribute:'data-account-id'},usernameSelector:'#username',passwordSelector:'#password',submitSelector:'#login',challengeSelectors:['#mfa']},challenge:{method:'otp',startUrl:'https://mp.toutiao.com/mfa',codeSelector:'#code',submitSelector:'#verify',codeFormat:'digits'}};
  const connection=randomUUID(),account=randomUUID(),ctx:ServiceContext={db,orgId:DEMO_ORG_ID,actorId:DEMO_OWNER_ID,actorType:'user',roles:['owner'],mode:'live'};
  const scope={platform_login:{method:'password',recipe_id:recipe.id,recipe_version:recipe.version}};
  await db.query("INSERT INTO connections(id,org_id,provider,account_external_id,display_name,read_mode,scope_json,timezone,currency) VALUES($1,$2,'toutiao','fixture-real-account','fixture verification','authorized_browser',$3,'Asia/Shanghai','CNY')",[connection,ctx.orgId,JSON.stringify(scope)]);
  await db.query("INSERT INTO platform_accounts(id,org_id,connection_id,provider,channel_id,account_external_id,display_name,session_status) VALUES($1,$2,$3,'toutiao','toutiao','fixture-real-account','fixture verification','challenge_required')",[account,ctx.orgId,connection]);
  let submits=0,profileCloses=0,authenticated=false;
  const profiles={acquire:async(input:{orgId:string;accountId:string;fencingToken:number})=>{
    assert.equal(input.orgId,ctx.orgId);assert.equal(input.accountId,account);assert.ok(input.fencingToken>0);
    const context=await browser.newContext();
    await context.route('**/*',async route=>{const url=new URL(route.request().url());if(url.origin!=='https://mp.toutiao.com')return route.abort();
      let body='<form id="mfa" action="/verify-code" method="post"><input id="code" name="code"><button id="verify">核验</button></form>';
      if(url.pathname==='/verify-code'){assert.equal(new URLSearchParams(route.request().postData()??'').get('code'),'738291');submits++;authenticated=true;}
      if(authenticated)body='<div id="account" data-account-id="fixture-real-account">已登录账号</div>';
      return route.fulfill({contentType:'text/html; charset=utf-8',body});});
    return{context,profileRef:'private-profile:fixture',close:async()=>{await context.close();profileCloses++;}};
  }} as unknown as BrowserProfilePool;
  const manager=new LoginChallengeManager({database:async()=>db,profiles,recipes:new BrowserRecipeRegistry([recipe]),mode:'live'}),service=createBrowserService(ctx,{adapters:new Map()});
  try{
    const login=await service.createLogin(account);
    await assert.rejects(()=>manager.perform(ctx.orgId,login.id,{action:'open'}),{code:'LOGIN_INTERACTION_DENIED'});
    await service.redeemLogin({sessionId:login.id,accountId:account,ticket:login.ticket});
    assert.equal((await manager.perform(ctx.orgId,login.id,{action:'open'})).interaction_ready,true);
    await assert.rejects(()=>manager.perform(randomUUID(),login.id,{action:'submit',code:'738291'}),{code:'LOGIN_INTERACTION_DENIED'});
    await assert.rejects(()=>manager.perform(ctx.orgId,login.id,{action:'submit',code:'ABCD'}),{code:'INVALID_VERIFICATION_CODE'});assert.equal(submits,0);
    const done=await manager.perform(ctx.orgId,login.id,{action:'submit',code:'738291'});assert.equal(done.verified,true);assert.equal(done.state,'completed');assert.equal(profileCloses,1);assert.equal(submits,1);
    const saved=(await db.query('SELECT * FROM browser_commands WHERE id=$1',[done.command_id])).rows[0]!,proof=saved.result_ref as {status:string;evidence:{externalAccountId:string};data:Record<string,unknown>};
    assert.equal(saved.state,'succeeded');assert.equal(proof.status,'verified');assert.equal(proof.evidence.externalAccountId,'fixture-real-account');assert.equal(proof.data.session_version_after,1);assert.equal(proof.data.configuration_hash,stableHash({connection_id:connection,account_external_id:'fixture-real-account',read_mode:'authorized_browser',scope_json:scope,secret_ref:null}));
    for(const table of ['browser_commands','login_sessions','audit_logs'])assert.equal(JSON.stringify((await db.query(`SELECT * FROM ${table}`)).rows).includes('"738291"'),false);
    assert.equal((await db.query('SELECT enabled FROM platform_accounts WHERE id=$1',[account])).rows[0]!.enabled,false);
    authenticated=false;const second=await service.createLogin(account);await service.redeemLogin({sessionId:second.id,accountId:account,ticket:second.ticket});await manager.perform(ctx.orgId,second.id,{action:'open'});
    await db.query('UPDATE platform_accounts SET session_version=session_version+1 WHERE id=$1',[account]);await assert.rejects(()=>manager.perform(ctx.orgId,second.id,{action:'submit',code:'738291'}),{code:'LOGIN_INTERACTION_DENIED'});assert.equal(submits,1);
    // A rotated credential/configuration must deny verification but still release the old held profile.
    await db.query("UPDATE connections SET scope_json='{}' WHERE id=$1",[connection]);
    await db.query("UPDATE login_sessions SET state='expired' WHERE id=$1",[second.id]);
    assert.equal((await manager.perform(ctx.orgId,second.id,{action:'close'})).interaction_ready,false);assert.equal(profileCloses,2);
    assert.equal((await manager.perform(ctx.orgId,second.id,{action:'close'})).state,'cancelled');assert.equal(profileCloses,2);
  }finally{await manager.shutdown();await browser.close();await db.close();}
});
