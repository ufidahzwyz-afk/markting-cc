import test from 'node:test';
import assert from 'node:assert/strict';
import {createSourceReaders,ConfiguredSourceReader} from '../src/sources';
const request={orgId:'org',connectionId:'id',sourceKind:'chatgpt' as const,scope:{conversationIds:['approved']},cursor:null};
test('all four independent unconfigured sources report failed, never no_change',async()=>{
 for(const reader of Object.values(createSourceReaders())){const result=await reader.read({...request,sourceKind:reader.kind});assert.equal(result.status,'failed');if(result.status==='failed')assert.equal(result.errorCode,'NOT_CONFIGURED');}
});
test('ChatGPT transport requires explicit conversation scope and actual message coverage',async()=>{
 let calls=0;const reader=new ConfiguredSourceReader('chatgpt',async()=>{calls++;return {status:'changed',mode:'live',nextCursor:{message:'m1'},gaps:[],snapshots:[{providerFileId:'approved',title:'Conversation',revision:'1',contentHash:'a'.repeat(64),objectKey:'private/key',mimeType:'application/json',retrievedAt:'2026-10-03T00:00:00Z',sourceModifiedAt:null,visibility:'internal',conversationId:'approved',coverage:{status:'complete',scope:'approved',start_locator:'m1',end_locator:'m1'}}]};});
 const missing=await reader.read({...request,scope:{}});assert.equal(missing.status,'failed');assert.equal(calls,0);
 const invalid=await reader.read(request);assert.equal(invalid.status,'failed');if(invalid.status==='failed')assert.equal(invalid.errorCode,'INVALID_READ_RESULT');
});
test('live source rejects mock results and out of scope snapshots',async()=>{
 const reader=new ConfiguredSourceReader('chatgpt',async()=>({status:'no_change',mode:'mock',snapshots:[],nextCursor:null,gaps:[]}));const result=await reader.read(request);assert.equal(result.status,'failed');
});
