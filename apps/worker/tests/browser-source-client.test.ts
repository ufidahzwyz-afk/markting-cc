import test from 'node:test';
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {createHash,randomBytes,randomUUID} from 'node:crypto';
import {mkdtemp,readdir,rm,writeFile} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {createLocalServiceIdentityVerifier} from '@boran/browser-runtime';
import {SourceObjectStore} from '@boran/connectors/source-content';
import type {SourceReadRequest} from '@boran/connectors/sources';
import {createBrowserSourceTransport} from '../src/browser-source-client';

const sha=(value:string)=>createHash('sha256').update(value).digest('hex');
function snapshot(conversationId='authorized-conversation',missingTime=false){
  const messages=[{id:'message-1',role:'user',text:'泊冉业务说明。',createdAt:missingTime?null:'2026-10-04T01:00:00.000Z'}];
  const rawContent=JSON.stringify({conversationId,branch:'branch-1',messages}),revision=sha(rawContent);
  return {providerFileId:conversationId,conversationId,title:'指定业务沟通',revision,rawContent,text:messages.map(message=>`[${message.role}] [${message.id}] [${message.createdAt??'time unavailable'}]\n${message.text}`).join('\n\n'),sourceModifiedAt:messages[0]!.createdAt,coverage:{status:missingTime?'partial':'complete',scope:JSON.stringify({conversation_ids:['authorized-conversation'],project_ids:[]}),conversation_id:conversationId,message_ids:['message-1'],branch:'branch-1',start_locator:'message:message-1',end_locator:'message:message-1',...(missingTime?{gaps:['CHATGPT_MESSAGE_TIME_UNAVAILABLE']}:{})}};
}

test('independent browser source uses fresh authenticated nonce, fixed references, and immutable scope-bound text',async t=>{
  const root=await mkdtemp(join(tmpdir(),'boran-browser-source-')),keyFile=join(root,'service.key');await writeFile(keyFile,randomBytes(32),{mode:0o600});
  const orgId=randomUUID(),connectionId=randomUUID(),workflowRunId=randomUUID(),audience='http://browser-runtime:3003';
  const verify=createLocalServiceIdentityVerifier({audience,keyFile,services:{'boran-worker':{orgIds:[orgId],roles:['worker']}},allowedRoles:['worker'],replayDirectory:join(root,'nonces')});
  let capture:Record<string,unknown>={status:'changed',snapshots:[snapshot()],nextCursor:{version:'recipe-v1',revisions:{'authorized-conversation':snapshot().revision}},gaps:[]},httpCalls=0;
  const bodies:Record<string,unknown>[]=[],tokens:string[]=[];
  const server=createServer(async(request,response)=>{
    try{
      assert.equal(request.url,'/internal/browser/source-read');assert.equal(request.headers['x-org-id'],orgId);
      const token=String(request.headers.authorization).slice(7);assert.deepEqual((await verify(token)).orgIds,[orgId]);tokens.push(token);
      const chunks=[];for await(const chunk of request)chunks.push(Buffer.from(chunk));bodies.push(JSON.parse(Buffer.concat(chunks).toString()));httpCalls++;
      response.setHeader('content-type','application/json');response.end(JSON.stringify({data:capture}));
    }catch{response.writeHead(403);response.end(JSON.stringify({password:'synthetic-private-error'}));}
  });await new Promise<void>(resolve=>server.listen(0,'127.0.0.1',resolve));
  const env={APP_ENV:'test',BROWSER_RUNTIME_INTERNAL_URL:`http://127.0.0.1:${(server.address() as {port:number}).port}`,BROWSER_IDENTITY_MODE:'local_service',BORAN_SERVICE_KEY_FILE:keyFile,BROWSER_LOCAL_SERVICE_AUDIENCE:audience};
  const request:SourceReadRequest={orgId,connectionId,sourceKind:'chatgpt',scope:{conversationIds:['authorized-conversation']},cursor:null};
  const sourceRoot=join(root,'source'),transport=createBrowserSourceTransport({workflowRunId,sourceRoot,env});
  try{
    await t.test('valid original is stored by content digest; repeated requests get different service tokens',async()=>{
      const first=await transport(request),second=await transport(request);assert.equal(first.status,'changed');assert.equal(second.status,'changed');assert.equal(tokens.length,2);assert.notEqual(tokens[0],tokens[1]);
      assert.deepEqual(Object.keys(bodies[0]!).sort(),['connection_id','idempotency_key','workflow_run_id']);assert.equal(bodies[0]!.connection_id,connectionId);assert.equal(bodies[0]!.workflow_run_id,workflowRunId);assert.equal(bodies[0]!.idempotency_key,bodies[1]!.idempotency_key);
      const item=first.snapshots[0]!,objects=new SourceObjectStore(sourceRoot);assert.equal((await objects.readBytes({orgId,connectionId,objectKey:item.objectKey,expectedHash:item.contentHash})).toString(),snapshot().rawContent);assert.equal(await objects.readText({orgId,connectionId,objectKey:item.textObjectKey!,expectedHash:item.textHash!}),snapshot().text);
    });
    await t.test('foreign scope, modified text, forged cursor/hash, unknown browser payload and false completeness save no originals',async()=>{
      const dirty=[snapshot('foreign-conversation'),{...snapshot(),text:'替换正文'}, {...snapshot(),revision:'f'.repeat(64)}, {...snapshot(),coverage:{...snapshot().coverage,scope:JSON.stringify({conversation_ids:['foreign-conversation'],project_ids:[]})}},{...snapshot(),coverage:{...snapshot().coverage,password:'synthetic-private'}},snapshot('authorized-conversation',true)];
      for(const [index,item] of dirty.entries()){
        capture={status:'changed',snapshots:[item],nextCursor:{version:'recipe-v1',revisions:{'authorized-conversation':item.revision}},gaps:[]};const emptyRoot=join(root,`rejected-${index}`);
        const result=await createBrowserSourceTransport({workflowRunId,sourceRoot:emptyRoot,env})(request);assert.equal(result.status,'failed');await assert.rejects(readdir(emptyRoot),{code:'ENOENT'});assert.ok(!JSON.stringify(result).includes('synthetic-private'));
      }
      capture={status:'changed',snapshots:[snapshot()],nextCursor:{version:'recipe-v1',revisions:{'authorized-conversation':'f'.repeat(64)}},gaps:[]};assert.equal((await transport(request)).status,'failed');
    });
    await t.test('partial time coverage retains prior waterline; complete no-change is honest and bounded',async()=>{
      const cursor={version:'recipe-v1',revisions:{'authorized-conversation':snapshot().revision}};
      capture={status:'partial',snapshots:[snapshot('authorized-conversation',true)],nextCursor:{opaque_token:'never-save-provider-token'},gaps:['CHATGPT_MESSAGE_TIME_UNAVAILABLE']};
      const partial=await transport({...request,cursor});assert.equal(partial.status,'partial');assert.deepEqual(partial.nextCursor,cursor);assert.ok(!JSON.stringify(partial).includes('never-save-provider-token'));
      capture={status:'no_change',snapshots:[],nextCursor:cursor,gaps:[]};const unchanged=await transport({...request,cursor});assert.equal(unchanged.status,'no_change');assert.deepEqual(unchanged.snapshots,[]);
      capture={...capture,nextCursor:{...cursor,authorization:'private'}};assert.equal((await transport({...request,cursor})).status,'failed');
    });
    await t.test('unscoped IDs, arbitrary URLs and production local identity fail before verified source requests',async()=>{
      const before=httpCalls;assert.equal((await transport({...request,scope:{}})).status,'failed');assert.equal((await transport({...request,orgId:randomUUID()})).status,'failed');
      for(const base of ['https://example.com','http://127.0.0.1/private','http://user:password@localhost:3003','http://localhost:3003?token=secret'])assert.equal((await createBrowserSourceTransport({workflowRunId,sourceRoot,env:{...env,BROWSER_RUNTIME_INTERNAL_URL:base}})(request)).status,'failed');
      assert.equal((await createBrowserSourceTransport({workflowRunId,sourceRoot,env:{...env,APP_ENV:'production'}})(request)).status,'failed');assert.equal(httpCalls,before);
    });
  }finally{await new Promise<void>(resolve=>server.close(()=>resolve()));await rm(root,{recursive:true,force:true});}
});
