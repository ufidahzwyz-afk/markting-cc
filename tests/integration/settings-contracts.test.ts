import test from 'node:test';
import assert from 'node:assert/strict';
import {createTestDatabase,DEMO_ORG_ID,DEMO_OWNER_ID,DEMO_MARKETER_ID} from '@boran/db';
import {validateApiRequest,openapi} from '@boran/contracts';
import {validateAnalyticsConfiguration} from '@boran/domain/events';
import {uuid,type ServiceContext} from '@boran/domain/core';

test('analytics settings preserve explicit owner approval and strict versioned wire contracts',async()=>{
 const db=await createTestDatabase();const ctx:ServiceContext={db,orgId:DEMO_ORG_ID,actorId:DEMO_OWNER_ID,roles:['owner'],mode:'mock'};
 try{
  const input={enabled:true,notice_version:'synthetic-v1',purpose:'Synthetic analytics acceptance',lawful_basis:'consent' as const,retention_days:1,allowed_event_types:['cta_click' as const],allow_attribution:false,allow_identifiers:false};
  validateApiRequest('AnalyticsConfigurationInput',input);
  assert.throws(()=>validateApiRequest('AnalyticsConfigurationInput',{enabled:true}));assert.throws(()=>validateApiRequest('AnalyticsConfigurationInput',{...input,approved_by:ctx.actorId}));assert.throws(()=>validateApiRequest('AnalyticsConfigurationInput',{...input,allow_identifiers:'false'}));
  const value=await validateAnalyticsConfiguration(ctx,input);assert.equal(value.approved_by,ctx.actorId);validateApiRequest('AnalyticsConfigurationUpdated',{data:{key:'analytics_configuration',value,schema_version:1},meta:{request_id:uuid(),mode:'mock'}});
  await assert.rejects(validateAnalyticsConfiguration({...ctx,actorId:DEMO_MARKETER_ID,roles:['owner']},input),{code:'FORBIDDEN'});
  await db.query("UPDATE memberships SET roles='{viewer}' WHERE org_id=$1 AND user_id=$2",[ctx.orgId,ctx.actorId]);await assert.rejects(validateAnalyticsConfiguration(ctx,input),{code:'FORBIDDEN'});
  const operation=openapi.paths['/settings/analytics_configuration'].put;assert.ok(operation.parameters.some(parameter=>parameter.name==='If-Match'&&parameter.required));assert.deepEqual(operation['x-required-roles'],['owner']);
 }finally{await db.close();}
});

test('notification responses require explicit mode in both list rows and response metadata',()=>{
 const item={id:uuid(),report_id:uuid(),channel:'in_app',status:'pending',created_at:'2026-10-03T00:00:00Z',sent_at:null,kind:'daily',period_start:'2026-10-01',period_end:'2026-10-01',revision:1,quality:'missing',read:false,mode:'mock'};
 validateApiRequest('NotificationsRead',{data:[item],meta:{request_id:uuid(),mode:'mock'}});
 assert.throws(()=>validateApiRequest('NotificationsRead',{data:[item],meta:{request_id:uuid()}}));
 const {mode:_mode,...unlabelled}=item;assert.throws(()=>validateApiRequest('NotificationsRead',{data:[unlabelled],meta:{request_id:uuid(),mode:'mock'}}));
 validateApiRequest('NotificationMarkedRead',{data:{id:item.id,read:true},meta:{request_id:uuid(),mode:'mock',idempotency_replay:false}});
});
