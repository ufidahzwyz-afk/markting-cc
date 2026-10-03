import test from 'node:test';
import assert from 'node:assert/strict';
import {parseRuntimeConfig,parseAuthorizationReference,validateApiRequest,validatePageModules,validateAiOutput,validateAiOutputStructure,openapi,aiSchema} from '../src/index';
const sourceId='00000000-0000-4000-8000-000000000010';const documentId='00000000-0000-4000-8000-000000000011';
const source={source_version_id:sourceId,document_id:documentId,source_kind:'chatgpt',revision:'1',retrieved_at:'2026-10-03T00:00:00Z',coverage:{status:'complete',scope:'one authorized conversation',start_locator:'m1',end_locator:'m1',gaps:[]}};
const empty=()=>({workflow:'insight_topics',schema_version:2,source_versions:[],claims:[],policy_refs:[],output:{data_cutoff:'2026-10-03T00:00:00Z',insights:[],topics:[],source_gaps:[]}});
test('runtime defaults reject deployed anonymous identity; switches require exact booleans',()=>{
 assert.throws(()=>parseRuntimeConfig({}),/require OIDC/);
 const config=parseRuntimeConfig({APP_ENV:'test',AUTH_MODE:'mock'});assert.equal(config.writeEnabled,false);assert.equal(config.productionPiiAutomationEnabled,false);
 for(const value of ['0','1','False','TRUE',' false ',''])assert.throws(()=>parseRuntimeConfig({APP_ENV:'test',AUTH_MODE:'mock',WRITE_ENABLED:value}),/true or false/);
 assert.throws(()=>parseRuntimeConfig({APP_ENV:'staging',AUTH_MODE:'mock'}),/only/);
 assert.throws(()=>parseRuntimeConfig({APP_ENV:'production',AUTH_MODE:'oidc',OIDC_ISSUER:'http://issuer.invalid',OIDC_AUDIENCE:'ops'}),/HTTPS/);
});
test('authorization reference and complete action schema reject XOR violations',()=>{
 assert.throws(()=>parseAuthorizationReference({}));assert.throws(()=>parseAuthorizationReference({policy_version_id:sourceId,approval_id:documentId}));
 assert.deepEqual(parseAuthorizationReference({policy_version_id:sourceId,approval_id:null}),{policy_version_id:sourceId});
 assert.throws(()=>validateApiRequest('ActionCreate',{policy_version_id:sourceId,approval_id:documentId,expected_payload_hash:'a'.repeat(64)}));
 assert.throws(()=>validateApiRequest('PolicyActionCreate',{policy_version_id:sourceId,action_type:'ads.pause',target:{connection_id:documentId},expected_payload_hash:'a'.repeat(64)}));
});
test('complete handoff contracts retain every AI workflow and engineering endpoint',()=>{
 assert.equal(aiSchema.oneOf.length,8);assert.ok(Object.keys(openapi.paths).length>=57);assert.ok(openapi.paths['/connections'].get);assert.ok(openapi.components.schemas['AdsActionPayload']);
});
test('page modules reject unsafe CTA and raw HTML despite otherwise valid fields',()=>{
 const hero=(href:string,headline='Title')=>[{type:'hero',schema_version:1,data:{headline,description:'Description',cta:{label:'Contact',href,action:'navigate'}}}];
 assert.equal(validatePageModules(hero('/contact')).length,1);
 for(const url of ['javascript:alert(1)','//evil.invalid','data:text/html,test','https://safe.invalid\\@evil.invalid'])assert.throws(()=>validatePageModules(hero(url)));
 assert.throws(()=>validatePageModules(hero('/contact','<img src=x onerror=alert(1)>')));
 assert.throws(()=>validatePageModules([{type:'raw_html',schema_version:1,data:{html:'<script>x</script>'}}]));
});
test('AI v2 rejects extra fields, numeric invented priority and stale provenance',()=>{
 assert.throws(()=>validateAiOutputStructure({...empty(),schema_version:1}));assert.throws(()=>validateAiOutputStructure({...empty(),approved:true}));
 const output={...empty(),source_versions:[source]};assert.equal(validateAiOutput(output,{orgId:'org',sourceVersions:[source]}).workflow,'insight_topics');
 assert.throws(()=>validateAiOutput({...output,source_versions:[{...source,revision:'2'}]},{orgId:'org',sourceVersions:[source]}),/not supplied/);
 assert.throws(()=>validateAiOutput(output,{orgId:'org',sourceVersions:[{...source,org_id:'other-org'}]}),/crosses organizations/);
});
test('model cannot fabricate confirmed user expressions or expand policy authorization',()=>{
 const claim={claim_key:'proposal',claim_id:null,claim_text:'用户确认新的预算',source_version_id:sourceId,locator:{kind:'message',value:'m1'},assertion_type:'decision',decision_status:'confirmed',decision_evidence_ref:{source_version_id:sourceId,locator:{kind:'message',value:'m1'},actor:'user'},supersedes_claim_id:null,inference_rationale:null};
 const output={...empty(),source_versions:[source],claims:[claim]};const context={orgId:'org',sourceVersions:[source],locators:[{source_version_id:sourceId,locator:claim.locator}]};
 assert.throws(()=>validateAiOutput(output,context),/matching user expression/);
 const policy={policy_version_id:sourceId,policy_id:documentId,payload_hash:'a'.repeat(64)};
 assert.throws(()=>validateAiOutput({...empty(),policy_refs:[policy]},{orgId:'org',sourceVersions:[]}),/authorization/);
});
