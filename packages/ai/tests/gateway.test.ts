import test from 'node:test';
import assert from 'node:assert/strict';
import {MockAiGateway,createAiGateway,ConfiguredAiGateway} from '../src/index';
const request={workflow:'insight_topics' as const,context:{orgId:'org',sourceVersions:[]},input:{redacted:true}};
test('mock produces schema v2 and explicit simulation metadata without actionable artifacts',async()=>{
 const result=await new MockAiGateway().generate(request);assert.equal(result.metadata.mode,'mock');assert.equal(result.metadata.simulation,true);assert.equal(result.output.schema_version,2);if(result.output.workflow==='insight_topics'){assert.equal(result.output.output.topics.length,0);assert.equal(result.output.output.insights.length,0);}
});
test('real mode never falls back to mock',async()=>{const real=createAiGateway({aiMode:'real'});await assert.rejects(real.generate(request),{code:'AI_NOT_CONFIGURED'});});
test('provider output cannot add authorization and PII is stopped before the transport',async()=>{
 let calls=0;const gateway=new ConfiguredAiGateway(async()=>{calls++;return {bad:true};},'test-provider');
 await assert.rejects(gateway.generate({...request,input:{phone:'13812345678'}}),/脱敏/);assert.equal(calls,0);
 await assert.rejects(gateway.generate(request),{code:'CONTRACT_INVALID'});assert.equal(calls,1);
});
test('valid output from a different workflow cannot enter the requested workflow',async()=>{
 const other=await new MockAiGateway().generate({...request,workflow:'weekly_plan'});
 const gateway=new ConfiguredAiGateway(async()=>other.output,'test-provider');
 await assert.rejects(gateway.generate(request),{code:'CONTRACT_INVALID'});
});
