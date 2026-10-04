import test from "node:test";
import assert from "node:assert/strict";
import { createBaiduJsonClient,createBaiduNativeTransport,parseBaiduReviewContracts } from "@boran/connectors/baidu";

test("Baidu native boundary checks actual account, fixed API host, write fence and effective fields; search terms stay read-only",async()=>{
  const calls:{method:string;body:Record<string,unknown>}[]=[];let stopped=false,price=1.25,accountId=123,review='FIXTURE_APPROVED';
  const fetcher:typeof fetch=async(input,init)=>{const url=new URL(String(input));assert.equal(url.origin,'https://api.baidu.com');assert.equal(init?.redirect,'error');const request=JSON.parse(String(init?.body));assert.equal(request.header.password,'SYNTHETIC_PASSWORD');const method=url.pathname.slice('/json/sms/service/'.length);calls.push({method,body:request.body});
    let body:Record<string,unknown>={};if(method==='AccountService/getAccountInfo')body={accountInfo:{userId:accountId}};
    if(method==='KeywordService/getKeyword'){assert.ok(request.body.keywordFields.includes('status'));body={keywordTypes:[{keywordId:1,price,pause:false,status:review}]};}
    if(method==='KeywordService/updateKeyword'){price=request.body.keywordTypes[0].price;body={keywordTypes:[{keywordId:1}]};}
    return Response.json({header:{status:0},body});};
  const guard=async()=>{if(stopped)throw new Error('authorization revoked');};
  const client=createBaiduJsonClient({credentials:async()=>({username:'SYNTHETIC_USER',password:'SYNTHETIC_PASSWORD',token:'SYNTHETIC_TOKEN'}),fetch:fetcher,beforeMutation:guard});
  const reviewContracts={keyword:{field:'status' as const,approved:['FIXTURE_APPROVED'],pending:['FIXTURE_PENDING'],rejected:['FIXTURE_REJECTED']}};
  const adapter=createBaiduNativeTransport({call:client,contractVersion:'reviewed-fixture-v1',externalAccountId:'123',beforeMutation:guard,reviewContracts});
  const target={accountId:'123',entityType:'keyword',entityId:1};
  assert.equal((await adapter.read(target)).price,1.25);
  const input={actionId:'authorized-action',idempotencyKey:'same-action',target,payload:{price:1.5}},receipt=await adapter.write(input);
  assert.equal(receipt.status,'submitted');assert.equal(receipt.externalId,'1');assert.equal((await adapter.readback({...input,receipt})).verified,true);
  review='FIXTURE_PENDING';let readback=await adapter.readback({...input,receipt});assert.equal(readback.verified,false);assert.equal(readback.effectiveFieldsVerified,true);assert.equal(readback.reviewStatus,'pending');
  review='FIXTURE_REJECTED';readback=await adapter.readback({...input,receipt});assert.equal(readback.verified,false);assert.equal(readback.reviewStatus,'rejected');
  review='UNREVIEWED_PROVIDER_ENUM';readback=await adapter.readback({...input,receipt});assert.equal(readback.verified,false);assert.equal(readback.reviewStatus,'unknown');
  review='FIXTURE_APPROVED';
  price=1.6;assert.equal((await adapter.readback({...input,receipt})).verified,false);
  assert.equal(calls.filter(call=>call.method==='KeywordService/updateKeyword').length,1);
  stopped=true;await assert.rejects(()=>adapter.write(input),/authorization revoked/);assert.equal(calls.filter(call=>call.method==='KeywordService/updateKeyword').length,1);
  stopped=false;await assert.rejects(()=>adapter.write({...input,target:{...target,entityType:'search_term'}}),{code:'search_terms_are_read_only'});
  const unmapped=createBaiduNativeTransport({call:client,contractVersion:'reviewed-fixture-v1',externalAccountId:'123',beforeMutation:guard});await assert.rejects(()=>unmapped.write(input),{code:'baidu_review_contract_not_configured'});assert.equal(calls.filter(call=>call.method==='KeywordService/updateKeyword').length,1);
  await assert.rejects(()=>adapter.write({...input,payload:{script:'arbitrary'}}),{code:'unsupported_baidu_effective_field'});
  await assert.rejects(()=>client('http://unapproved.example/execute',{}),{code:'unsupported_api_method'});
  accountId=456;await assert.rejects(()=>adapter.read(target),{code:'account_mismatch'});
});
test('Baidu review contract never guesses overlapping or invalid provider status values',()=>{
  assert.throws(()=>parseBaiduReviewContracts({creative:{field:'arbitrary',approved:[1],pending:[2],rejected:[3]}}),{code:'baidu_review_contract_invalid'});
  assert.throws(()=>parseBaiduReviewContracts({creative:{field:'status',approved:[1],pending:[1],rejected:[3]}}),{code:'baidu_review_contract_invalid'});
  assert.throws(()=>parseBaiduReviewContracts({creative:{field:'status',approved:[1],pending:[],rejected:[3]}}),{code:'baidu_review_contract_invalid'});
});
test("missing credentials or mutation lease cannot perform a native write",async()=>{
  let requests=0;const fetcher:typeof fetch=async()=>{requests++;return Response.json({header:{status:0},body:{}});};
  const empty=createBaiduJsonClient({credentials:async()=>({username:'',password:'',token:''}),fetch:fetcher});await assert.rejects(()=>empty('AccountService/getAccountInfo',{}),{code:'baidu_credentials_not_configured'});assert.equal(requests,0);
  const noGuard=createBaiduJsonClient({credentials:async()=>({username:'fixture',password:'fixture',token:'fixture'}),fetch:fetcher});await assert.rejects(()=>noGuard('CampaignService/updateCampaign',{}),{code:'authorization_required'});assert.equal(requests,0);
});
