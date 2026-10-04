import test from 'node:test';
import assert from 'node:assert/strict';
import {sanitizeAiRunMetadata,validateAiRunReceipt} from '../src/run-metadata';
import {aiOutputHash} from '@boran/contracts';
import type {AiRequest,AiGatewayResult} from '../src/types';

const receipt={mode:'real',simulation:false,schema_version:2,model:'deepseek-v4-pro',output_hash:'a'.repeat(64),provider:'deepseek',model_alias_verified:true,cost_basis:'configured_model_pricing',quota_timezone:'Asia/Shanghai',usage:{input_tokens:3,output_tokens:4,total_tokens:7,cache_hit_tokens:null},attempts:[{requested_model:'deepseek-v4-pro',model:'deepseek-v4-pro',provider_request_id:'req-synthetic',response_id:null,status:'received',latency_ms:12,cost_micro:2,price_model_verified:true,usage:{input_tokens:3,output_tokens:4,total_tokens:7,cache_hit_tokens:null}}],quality_result:{schema_valid:true,semantic_valid:true,evidence_valid:true,evidence_scope:'references_and_hard_claims',business_quality_verified:false,business_review_required:true,strict_schema_requested:true,model_catalog_verified:true}};
test('safe metadata retains pricing, evidence and classified attempts without reference aliasing',()=>{
  const copied=sanitizeAiRunMetadata(receipt,{strict:true});assert.deepEqual(copied,receipt);assert.notEqual(copied.usage,receipt.usage);assert.notEqual(copied.attempts,receipt.attempts);
});
test('unknown top-level and nested secret/body fields fail safe receipt acceptance and disappear from failure audits',()=>{
  for(const dirty of [{...receipt,apiKey:'private-synthetic'}, {...receipt,usage:{...receipt.usage,password:'private-synthetic'}},{...receipt,attempts:[{...receipt.attempts[0],body:{token:'private-synthetic'}}]}]){
    assert.throws(()=>sanitizeAiRunMetadata(dirty,{strict:true}),error=>!!error&&typeof error==='object'&&'code' in error&&error.code==='AI_RUN_METADATA_INVALID'&&!JSON.stringify(error).includes('private-synthetic'));
    assert.ok(!JSON.stringify(sanitizeAiRunMetadata(dirty)).includes('private-synthetic'));
  }
});
test('malformed costs, identifiers and self-certified business quality cannot enter audit records',()=>{
  const dirty={...receipt,response_id:'Bearer secret\npassword',cost_micro:-1,quality_result:{...receipt.quality_result,business_quality_verified:true}};
  assert.throws(()=>sanitizeAiRunMetadata(dirty,{strict:true}),{code:'AI_RUN_METADATA_INVALID'});const safe=sanitizeAiRunMetadata(dirty);assert.equal(safe.response_id,undefined);assert.equal(safe.cost_micro,undefined);assert.equal((safe.quality_result as Record<string,unknown>).business_quality_verified,undefined);
});
test('historical fixture partial token metadata remains labeled as fixture',()=>{
  assert.deepEqual(sanitizeAiRunMetadata({mode:'mock',simulation:true,model:'fixture-not-business-evidence',provider:'fixture',usage:{input_tokens:1,output_tokens:2}},{strict:true}),{mode:'mock',simulation:true,model:'fixture-not-business-evidence',provider:'fixture',usage:{input_tokens:1,output_tokens:2}});
});
test('receipt schema and hash are checked before storage; raw secret output cannot become a durable receipt',()=>{
  const request:AiRequest={workflow:'weekly_plan',context:{orgId:'00000000-0000-4000-8000-000000000001',sourceVersions:[],dataCutoff:'2026-10-04T00:00:00Z'},input:{}};
  const output={workflow:'weekly_plan',schema_version:2,source_versions:[],claims:[],policy_refs:[],output:{objectives:['Synthetic receipt validation'],tasks:[],assumptions:[],evidence_gaps:[],data_cutoff:'2026-10-04T00:00:00Z'}} as AiGatewayResult['output'];
  const result:AiGatewayResult={output,metadata:{mode:'real',simulation:false,schema_version:2,model:'synthetic-test',output_hash:aiOutputHash(output)}};
  assert.deepEqual(validateAiRunReceipt(request,result),result);
  assert.throws(()=>validateAiRunReceipt(request,{...result,metadata:{...result.metadata,output_hash:'f'.repeat(64)}}),{code:'AI_RUN_RECEIPT_INVALID'});
  assert.throws(()=>validateAiRunReceipt(request,{...result,output:{...output,password:'synthetic-private-key'} as unknown as AiGatewayResult['output']}));
  assert.throws(()=>validateAiRunReceipt(request,{...result,output:{...output,raw_response:'synthetic-private-body'} as unknown as AiGatewayResult['output']}));
});
