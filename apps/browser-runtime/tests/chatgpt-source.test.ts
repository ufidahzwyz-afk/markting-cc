import test from "node:test";
import assert from "node:assert/strict";
import { chromium } from "playwright";
import { captureChatGptSource, type ChatGptReadRecipe } from "../src/chatgpt-source";
import { parseSourceReadCommand } from "../src/server";
import type { PlatformExecutionContext } from "@boran/connectors";

test("source browser requests accept immutable references rather than URLs, credentials or selectors", () => {
  const data={connection_id:'a660f7f1-bf5c-422a-88d8-c8b1e8c88567',workflow_run_id:'b3b0bc12-912b-4a22-89cb-1a203be86e24',idempotency_key:'source-watch:test'};
  assert.deepEqual(parseSourceReadCommand(data),data);
  for(const field of ['url','password','script','selectors'])assert.throws(()=>parseSourceReadCommand({...data,[field]:'untrusted'}),{code:'INVALID_SOURCE_READ'});
});
test("actual browser source capture keeps user/assistant roles, message time, branch and cursor; partial reads do not advance",{skip:!process.env.CHROMIUM_EXECUTABLE_PATH},async()=>{
  const browser=await chromium.launch({headless:true,executablePath:process.env.CHROMIUM_EXECUTABLE_PATH!}),session=await browser.newContext();
  let changed=false,branch=true,timestamps=true,authenticated=true;const visited:string[]=[];
  await session.route('**/*',async route=>{const url=new URL(route.request().url());if(url.origin!=='https://chatgpt.com')return route.abort();visited.push(url.pathname);
    const message=(id:string,role:string,text:string)=>`<article data-message-id="${id}" data-role="${role}"><div class="message-text">${text}</div>${timestamps?'<time datetime="2026-10-04T00:00:00Z">时间</time>':''}</article>`;
    const html=url.pathname==='/'?authenticated?'<div id="account" data-account-id="source-user">已登录</div>':'请登录':`<title>授权沟通</title>${message('user-1','user','明确确认资料范围')}${message('assistant-1','assistant','助手总结不是用户确认')}${changed?message('user-2','user','撤销前一个确认'):''}${branch?'<div id="branch" data-branch-id="actual-selected-branch">当前分支</div>':''}<div id="complete">完整历史</div>`;
    return route.fulfill({contentType:'text/html; charset=utf-8',body:html});});
  const recipe:ChatGptReadRecipe={version:'fixture-chatgpt-v1',accountUrl:'https://chatgpt.com/',account:{selector:'#account',attribute:'data-account-id'},messageSelector:'article[data-message-id]',messageIdAttribute:'data-message-id',roleAttribute:'data-role',textSelector:'.message-text',timestamp:{selector:'time',attribute:'datetime'},branch:{selector:'#branch',attribute:'data-branch-id'},completeHistorySelector:'#complete'};
  const context:PlatformExecutionContext={orgId:'fixture-org',accountId:'fixture-connection',externalAccountId:'source-user',adapterVersion:recipe.version,sessionVersion:0,fencingToken:1,commandId:'fixture-command',mode:'live',browserSession:session,assertLease:async()=>undefined};
  const config={externalAccountId:'source-user',conversationIds:['authorized-conversation'],projectIds:[],cursor:null as unknown};
  try{const first=await captureChatGptSource(context,config,recipe);assert.equal(first.status,'changed');assert.equal(first.snapshots[0]!.coverage.status,'complete');assert.equal(first.snapshots[0]!.coverage.branch,'actual-selected-branch');assert.deepEqual(first.snapshots[0]!.coverage.message_ids,['user-1','assistant-1']);
    const messages=JSON.parse(first.snapshots[0]!.rawContent).messages;assert.equal(messages[0].role,'user');assert.equal(messages[1].role,'assistant');assert.equal(messages[0].createdAt,'2026-10-04T00:00:00.000Z');
    config.cursor=first.nextCursor;assert.equal((await captureChatGptSource(context,config,recipe)).status,'no_change');
    changed=true;const second=await captureChatGptSource(context,config,recipe);assert.equal(second.status,'changed');assert.notEqual(second.snapshots[0]!.revision,first.snapshots[0]!.revision);config.cursor=second.nextCursor;
    branch=false;timestamps=false;const partial=await captureChatGptSource(context,config,recipe);assert.equal(partial.status,'partial');assert.deepEqual(partial.nextCursor,config.cursor);assert.ok(partial.gaps.includes('CHATGPT_BRANCH_UNVERIFIED'));assert.ok(partial.gaps.includes('CHATGPT_MESSAGE_TIME_UNAVAILABLE'));assert.equal(partial.snapshots[0]!.coverage.status,'partial');
    authenticated=false;const unauthorized=await captureChatGptSource(context,config,recipe);assert.equal(unauthorized.status,'auth_required');assert.equal(unauthorized.snapshots.length,0);assert.ok(visited.every(path=>path==='/'||path==='/c/authorized-conversation'));
  }finally{await session.close();await browser.close();}
});
