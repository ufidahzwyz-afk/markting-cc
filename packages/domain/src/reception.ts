import { createHmac, timingSafeEqual } from 'node:crypto';
import type { SqlExecutor } from '@boran/db';
import { assertVersion, audit, DomainError, nowIso, stableHash, uuid, type ServiceContext } from './core';
import { assertExecutionAuthorized, claimExecutionAction, completeExecutionAction, createExecutionAction } from './execution';
import { assertLeadRecordAccess, effectiveLeadRoles, requirePrivacyConfiguration, redactPrivateObject, sanitizePrivateText, type PrivacyOptions } from './privacy';

export interface ReceptionEventIngest {
  connection_id:string;external_event_id:string;external_conversation_id:string;external_message_id?:string;
  event_type:'visitor_message'|'contact_captured'|'delivery_receipt'|'handoff_receipt'|'closed';occurred_at:string;sanitized_text?:string;encrypted_payload_ref?:string;receipt?:Record<string,unknown>;
}
export interface ReceptionReplyGenerate { conversation_version:number;reason:'visitor_message'|'silent_followup'|'identity_question'|'handoff_request';policy_version_id:string }
export interface ReceptionHandoff { owner_user_id:string;reason:string;next_step?:string }
export interface ReceptionReplyPayload {
  conversation_id:string;conversation_version:number;ai_run_id:string;reply_text:string;question_count:number;
  reply_class:'useful_answer'|'one_question'|'contact_value_explanation'|'identity_disclosure'|'silent_followup'|'handoff_acknowledgement'|'contact_captured_acknowledgement';expected_conversation_hash:string;sop_version:string;
}
export interface ReceptionReceipt { verified:boolean;external_message_id:string;occurred_at?:string;evidence_ref:Record<string,unknown> }
export interface ReceptionAdapter {
  kind:'mock'|'live';
  verifyEvent(input:{rawBody:string;signature:string;timestamp:string}):Promise<boolean>|boolean;
  sendReply(input:{external_conversation_id:string;idempotency_key:string;text:string}):Promise<{external_message_id:string}>;
  readDelivery(input:{external_conversation_id:string;external_message_id:string;idempotency_key:string}):Promise<ReceptionReceipt>;
  handoff(input:{external_conversation_id:string;owner_user_id:string;idempotency_key:string}):Promise<{external_handoff_id:string}>;
  readHandoff(input:{external_handoff_id:string;external_conversation_id:string;owner_user_id:string}):Promise<{verified:boolean;evidence_ref:Record<string,unknown>}>;
}
export interface ReceptionEventAccepted {data:{event_id:string;conversation_id:string;version:number;state:unknown;status:string;message_duplicate?:boolean};meta:{request_id:string};duplicate:boolean;reply?:unknown;gap?:string|null;processing_ms?:number;sla_verified?:boolean}
export interface ReceptionRuntimeOptions extends PrivacyOptions {adapter?:ReceptionAdapter;signature?:string;timestamp?:string;rawBody?:string;policyVersionId?:string}
const adapters=new Map<string,ReceptionAdapter>();
export function registerReceptionAdapter(connectionId:string,adapter:ReceptionAdapter):()=>void { adapters.set(connectionId,adapter);return ()=>adapters.delete(connectionId); }
function adapterFor(connectionId:string,options:ReceptionRuntimeOptions):ReceptionAdapter {
  const adapter=options.adapter ?? adapters.get(connectionId); if(!adapter)throw new DomainError('integration_required',503,'爱番番实时消息、发送与回读连接尚未配置');return adapter;
}
/** Connector boundary HMAC helper: signature covers exact bytes and a bounded timestamp, with constant-time comparison. */
export function verifyReceptionSignature(secret:string,rawBody:string,signature:string,timestamp:string,now=new Date()):boolean {
  if(!secret||!/^\d{10,13}$/.test(timestamp)||!/^(?:sha256=)?[a-f0-9]{64}$/i.test(signature))return false;
  const number=Number(timestamp);const millis=timestamp.length===10?number*1000:number;
  if(!Number.isSafeInteger(number)||Math.abs(now.getTime()-millis)>5*60000)return false;
  const expected=createHmac('sha256',secret).update(`${timestamp}.${rawBody}`).digest();const actual=Buffer.from(signature.replace(/^sha256=/i,''),'hex');
  return actual.length===expected.length&&timingSafeEqual(actual,expected);
}
const asRecord=(v:unknown):Record<string,unknown>=>v&&typeof v==='object'&&!Array.isArray(v)?v as Record<string,unknown>:{};
const textArray=(v:unknown):string[]=>Array.isArray(v)?v.filter((s):s is string=>typeof s==='string'):[];
function clean(value:Record<string,unknown>):Record<string,unknown>{return redactPrivateObject(value);}
function explicitHandoff(text:string):boolean{return /(?:转|找|联系|叫|要|请|帮|接).{0,12}(?:人工客服|人工|真人|工作人员)|(?:human|live)\s+(?:agent|support)/i.test(text);}
function identityQuestion(text:string):boolean{return /(?:你|客服|顾问).{0,12}(?:AI|人工智能|机器人|真人|是不是人)|(?:are you).{0,12}(?:AI|bot|human)/i.test(text);}
async function assertConversationRead(ctx:ServiceContext,id:string,tx:SqlExecutor=ctx.db) {
  const row=(await tx.query('SELECT * FROM reception_conversations WHERE org_id=$1 AND id=$2',[ctx.orgId,id])).rows[0];const roles=await effectiveLeadRoles(ctx,tx);
  if(!row)throw new DomainError('NOT_FOUND',404,'接待会话不存在');
  if(!roles.some(r=>['owner','marketer'].includes(r))) {if(!roles.includes('sales')||!row.lead_id)throw new DomainError('FORBIDDEN',403,'无权查看该会话');await assertLeadRecordAccess(ctx,String(row.lead_id),tx);}
  return row;
}
async function assertConnection(ctx:ServiceContext,connectionId:string,tx:SqlExecutor=ctx.db) {
  const row=(await tx.query('SELECT * FROM connections WHERE org_id=$1 AND id=$2',[ctx.orgId,connectionId])).rows[0];
  if(!row)throw new DomainError('NOT_FOUND',404,'接待账号不存在');
  if(ctx.mode==='mock') {if(row.provider!=='mock')throw new DomainError('MOCK_BOUNDARY',409,'模拟接待不能调用真实连接');}
  else {const caps=asRecord(row.capabilities);if(row.access_status!=='connected'||row.health!=='healthy'||!row.capabilities_verified_at||caps.realtime_events!==true||caps.reception_send!==true||caps.delivery_readback!==true)throw new DomainError('integration_required',503,'接待实时能力尚未逐项核验');}
  return row;
}
async function cancelFollowups(ctx:ServiceContext,tx:SqlExecutor,id:string) {await tx.query("UPDATE outbox_events SET dispatched_at=$3 WHERE org_id=$1 AND aggregate_id=$2 AND event_type='reception.silent_followup' AND dispatched_at IS NULL",[ctx.orgId,id,nowIso(ctx)]);}
async function currentPolicy(ctx:ServiceContext,connectionId:string,id?:string,tx:SqlExecutor=ctx.db) {
  const rows=(await tx.query("SELECT v.* FROM policy_versions v JOIN execution_policies p ON p.org_id=v.org_id AND p.id=v.policy_id WHERE v.org_id=$1 AND p.status='active' AND p.active_version_id=v.id AND ($2::uuid IS NULL OR v.id=$2) AND 'reception.reply'=ANY(v.allowed_actions)",[ctx.orgId,id ?? null])).rows;
  return rows.find(row=>textArray(asRecord(row.reception_scope).connection_ids).includes(connectionId));
}
async function addHandoffTask(ctx:ServiceContext,tx:SqlExecutor,conversation:Record<string,unknown>,ownerId:string,reason:string) {
  const existing=await tx.query("SELECT id FROM tasks WHERE org_id=$1 AND type='followup' AND brief->>'conversation_id'=$2 AND brief->>'handoff'='true' AND status!='cancelled'",[ctx.orgId,conversation.id]);
  if(!existing.rowCount)await tx.query("INSERT INTO tasks(org_id,type,title,brief,business_line,owner_user_id,due_at,priority,status,version) VALUES($1,'followup','客户明确请求人工接待',$2,'unknown',$3,$4,'P0','todo',1)",[ctx.orgId,JSON.stringify({conversation_id:conversation.id,handoff:true,reason:sanitizePrivateText(reason)}),ownerId,nowIso(ctx)]);
}

/** Executes the short event path in this request; delayed silence jobs are durable outbox rows, never minute polling replies. */
export async function ingestReceptionEvent(ctx:ServiceContext,input:ReceptionEventIngest,options:ReceptionRuntimeOptions={}):Promise<ReceptionEventAccepted> {
  if(!input.external_event_id||input.external_event_id.length>200||!input.external_conversation_id||input.external_conversation_id.length>200||!Number.isFinite(Date.parse(input.occurred_at))||!['visitor_message','contact_captured','delivery_receipt','handoff_receipt','closed'].includes(input.event_type)||(input.sanitized_text?.length ?? 0)>5000)throw new DomainError('INVALID_RECEPTION_EVENT',422,'接待事件字段无效');
  const adapter=adapterFor(input.connection_id,options);
  if(adapter.kind!==ctx.mode)throw new DomainError('CONNECTOR_MODE_MISMATCH',409,'连接器与运行模式不一致');
  if(!options.rawBody||!options.signature||!options.timestamp)throw new DomainError('VERIFIED_CONNECTOR_REQUIRED',401,'仅已验签连接器可录入接待事件');
  let signedInput:unknown;try{signedInput=JSON.parse(options.rawBody);}catch{throw new DomainError('INVALID_RECEPTION_EVENT',422,'事件JSON无效');}
  if(stableHash(signedInput)!==stableHash(input)||!await adapter.verifyEvent({rawBody:options.rawBody,signature:options.signature,timestamp:options.timestamp}))throw new DomainError('INVALID_CONNECTOR_SIGNATURE',401,'平台签名无效');
  await requirePrivacyConfiguration(ctx,options);await assertConnection(ctx,input.connection_id);
  const start=performance.now();const text=sanitizePrivateText(input.sanitized_text ?? '');
  const hash=stableHash(input);const scope=`reception_event:${input.connection_id}`;const key=stableHash(input.external_event_id);
  const accepted=await ctx.db.transaction(async tx=>{
    await tx.query('SELECT id FROM organizations WHERE id=$1 FOR UPDATE',[ctx.orgId]);
    const old=(await tx.query('SELECT request_hash,response_json FROM idempotency_records WHERE org_id=$1 AND scope=$2 AND key=$3',[ctx.orgId,scope,key])).rows[0];
    if(old){if(old.request_hash!==hash)throw new DomainError('IDEMPOTENCY_CONFLICT',409,'平台事件ID对应不同载荷');return {...(old.response_json as ReceptionEventAccepted),duplicate:true};}
    let conv=(await tx.query('SELECT * FROM reception_conversations WHERE org_id=$1 AND connection_id=$2 AND external_conversation_id=$3 FOR UPDATE',[ctx.orgId,input.connection_id,input.external_conversation_id])).rows[0];
    if(!conv) {const id=uuid();conv=(await tx.query("INSERT INTO reception_conversations(id,org_id,connection_id,external_conversation_id,started_at,state,test_record,version) VALUES($1,$2,$3,$4,$5,'bot_active',$6,1) RETURNING *",[id,ctx.orgId,input.connection_id,input.external_conversation_id,input.occurred_at,ctx.mode==='mock'])).rows[0]!;}
    const id=String(conv.id); let duplicateMessage=false; const externalId=input.external_message_id ?? `event:${input.external_event_id}`;
    if(input.event_type==='visitor_message') {
      const repeated=(await tx.query('SELECT id FROM reception_messages WHERE org_id=$1 AND conversation_id=$2 AND external_message_id=$3',[ctx.orgId,id,externalId])).rows[0];
      duplicateMessage=!!repeated;
      if(!repeated) {
        await cancelFollowups(ctx,tx,id);
        await tx.query("INSERT INTO reception_messages(org_id,conversation_id,external_message_id,role,sanitized_text,encrypted_content_ref,occurred_at,received_at,delivery_status,question_count) VALUES($1,$2,$3,'visitor',$4,$5,$6,$7,'received',0)",[ctx.orgId,id,externalId,text,input.encrypted_payload_ref ?? null,input.occurred_at,nowIso(ctx)]);
        const blocked=['closed','blocked','human_active','handoff_requested'].includes(String(conv.state));
        const state=blocked?String(conv.state):explicitHandoff(text)?'handoff_requested':conv.contact_id?'contact_captured':'bot_active';
        await tx.query("UPDATE reception_conversations SET state=$3::varchar,last_visitor_message_at=$4,handoff_status=CASE WHEN $3::varchar='handoff_requested' THEN 'requested' ELSE handoff_status END,version=version+1,updated_at=$5 WHERE org_id=$1 AND id=$2",[ctx.orgId,id,state,input.occurred_at,nowIso(ctx)]);
        if(state==='handoff_requested') {
          const owner=(await tx.query("SELECT m.user_id FROM memberships m JOIN users u ON u.id=m.user_id WHERE m.org_id=$1 AND m.active AND u.active AND ('owner'=ANY(m.roles) OR 'marketer'=ANY(m.roles)) ORDER BY CASE WHEN 'owner'=ANY(m.roles) THEN 0 ELSE 1 END,m.user_id LIMIT 1",[ctx.orgId])).rows[0];
          if(owner)await addHandoffTask(ctx,tx,conv,String(owner.user_id),text);
        }
      }
    } else if(input.event_type==='closed') {await cancelFollowups(ctx,tx,id);await tx.query("UPDATE reception_conversations SET state='closed',version=version+1 WHERE org_id=$1 AND id=$2",[ctx.orgId,id]);}
    else if(input.event_type==='contact_captured') {await cancelFollowups(ctx,tx,id);await tx.query("UPDATE reception_conversations SET state='contact_captured',contact_captured_at=$3,version=version+1 WHERE org_id=$1 AND id=$2",[ctx.orgId,id,input.occurred_at]);}
    else if(input.event_type==='delivery_receipt') {
      // A webhook receipt without matching actual submitted external id does not create a message or success.
      await tx.query("UPDATE reception_messages SET delivery_status='delivered_verified',evidence_ref=$4 WHERE org_id=$1 AND conversation_id=$2 AND (external_message_id=$3 OR evidence_ref->>'external_message_id'=$3) AND delivery_status IN ('submitted','unknown')",[ctx.orgId,id,externalId,JSON.stringify(clean(input.receipt ?? {}))]);
    } else if(input.event_type==='handoff_receipt') {
      // Final human activation is verified by adapter.readHandoff, rather than a caller-provided boolean.
      await audit(ctx,tx,'reception.handoff.receipt.received','reception_conversation',id,{event_id:input.external_event_id});
    }
    const current=(await tx.query('SELECT version,state FROM reception_conversations WHERE org_id=$1 AND id=$2',[ctx.orgId,id])).rows[0]!;
    const result={data:{event_id:input.external_event_id,conversation_id:id,version:Number(current.version),state:current.state,status:'accepted',message_duplicate:duplicateMessage},meta:{request_id:uuid()}};
    await tx.query('INSERT INTO idempotency_records(org_id,scope,key,request_hash,status_code,response_json,resource_id,expires_at) VALUES($1,$2,$3,$4,202,$5,$6,$7)',[ctx.orgId,scope,key,hash,JSON.stringify(result),id,new Date(Date.parse(nowIso(ctx))+7*86400000).toISOString()]);
    return {...result,duplicate:false};
  });
  if(accepted.duplicate)return accepted;
  const data=asRecord((accepted as Record<string,unknown>).data);let reply:unknown=null;let gap:string|null=null;
  if(input.event_type==='visitor_message'&&!data.message_duplicate) {
    try {
      const policy=await currentPolicy(ctx,input.connection_id,options.policyVersionId);
      if(!policy)throw new DomainError('RECEPTION_POLICY_REQUIRED',409,'当前没有有效接待发送规则');
      if(data.state==='handoff_requested') {
        const owner=(await ctx.db.query("SELECT m.user_id FROM memberships m JOIN users u ON u.id=m.user_id WHERE m.org_id=$1 AND m.active AND u.active AND ('owner'=ANY(m.roles) OR 'marketer'=ANY(m.roles)) ORDER BY CASE WHEN 'owner'=ANY(m.roles) THEN 0 ELSE 1 END,m.user_id LIMIT 1",[ctx.orgId])).rows[0];
        if(owner)reply=await handoffReception(ctx,String(data.conversation_id),{owner_user_id:String(owner.user_id),reason:'visitor_explicit_request'},Number(data.version),`handoff:${key}`,options);
      } else if(!['human_active','closed','blocked'].includes(String(data.state))) {
        reply=await generateReceptionReply(ctx,String(data.conversation_id),{conversation_version:Number(data.version),reason:identityQuestion(text)?'identity_question':'visitor_message',policy_version_id:String(policy.id)},`reception:${key}`,options);
      }
    } catch(error) {gap=error instanceof DomainError?error.code:'RECEPTION_PROCESSING_FAILED';await ctx.db.transaction(tx=>audit(ctx,tx,'reception.immediate.blocked','reception_conversation',String(data.conversation_id),{code:gap}));}
  }
  const responseAt=asRecord(reply).delivered_at;const delay=typeof responseAt==='string'?Date.parse(responseAt)-Date.parse(input.occurred_at):null;
  return {...accepted,reply,gap,processing_ms:Math.round(performance.now()-start),sla_verified:ctx.mode==='live'&&asRecord(reply).delivery_status==='delivered_verified'&&delay!==null&&delay>=0&&delay<=3000};
}

export async function getReceptionConversation(ctx:ServiceContext,id:string) {
  const conv=await assertConversationRead(ctx,id); const messages=(await ctx.db.query('SELECT id,role,sanitized_text,occurred_at,delivery_status FROM reception_messages WHERE org_id=$1 AND conversation_id=$2 ORDER BY occurred_at,id LIMIT 200',[ctx.orgId,id])).rows;
  return {data:{id:conv.id,connection_id:conv.connection_id,external_conversation_id:conv.external_conversation_id,contact_id:conv.contact_id,lead_id:conv.lead_id,state:conv.state,handoff_status:conv.handoff_status,first_response_at:conv.first_response_at,silent_followup_count:Number(conv.silent_followup_count),version:Number(conv.version),messages},meta:{request_id:uuid()}};
}

function validateReply(text:string,replyClass:string,conversation:Record<string,unknown>,scope:Record<string,unknown>):number {
  if(!text.trim()||text.length>1500||text.normalize('NFKC')!==sanitizePrivateText(text)||/https?:\/\/|\bGIF\b|[\u{1F300}-\u{1FAFF}]/iu.test(text))throw new DomainError('RECEPTION_SOP_VIOLATION',422,'接待话术包含链接、表情包、个人信息或超限内容');
  const questions=(text.match(/[?？]/g) ?? []).length;if(questions>1)throw new DomainError('RECEPTION_SOP_VIOLATION',422,'每轮最多一个问题');
  if((conversation.contact_id||conversation.contact_captured_at)&&/(留|提供|告诉|给).{0,8}(手机|电话|微信|联系方式)/.test(text))throw new DomainError('RECEPTION_CONTACT_ALREADY_CAPTURED',409,'已留资后不能重复索取联系方式');
  if(replyClass==='identity_disclosure'&&!/(AI|人工智能|智能助手|机器人)/i.test(text))throw new DomainError('RECEPTION_IDENTITY_REQUIRED',422,'身份询问必须如实告知');
  if(!textArray(scope.allowed_reply_classes).includes(replyClass))throw new DomainError('RECEPTION_SOP_VIOLATION',409,'当前规则未允许此类话术');return questions;
}
async function buildReply(ctx:ServiceContext,id:string,input:ReceptionReplyGenerate,key:string,options:ReceptionRuntimeOptions) {
  await requirePrivacyConfiguration(ctx,options);
  return ctx.db.transaction(async tx=>{
    await tx.query('SELECT id FROM organizations WHERE id=$1 FOR UPDATE',[ctx.orgId]);
    const proposalScope=`reception_proposal:${id}`; const requestHash=stableHash(input);
    const stored=(await tx.query('SELECT request_hash,response_json FROM idempotency_records WHERE org_id=$1 AND scope=$2 AND key=$3',[ctx.orgId,proposalScope,key])).rows[0];
    if(stored){if(stored.request_hash!==requestHash)throw new DomainError('IDEMPOTENCY_CONFLICT',409,'接待提议请求键对应不同内容');return stored.response_json as {conv:Record<string,unknown>;payload:ReceptionReplyPayload;hash:string;messageId:string};}
    const conv=await assertConversationRead(ctx,id,tx);assertVersion(Number(conv.version),input.conversation_version);await assertConnection(ctx,String(conv.connection_id),tx);
    if(['closed','blocked','human_active'].includes(String(conv.state))||conv.handoff_status==='completed')throw new DomainError('RECEPTION_STOPPED',409,'会话已停止自动接待');
    if(input.reason==='silent_followup'&&(conv.contact_id||conv.contact_captured_at||conv.handoff_status!=='none'||Number(conv.silent_followup_count)>=2))throw new DomainError('RECEPTION_FOLLOWUP_CANCELLED',409,'不再发送沉默跟进');
    const policy=await currentPolicy(ctx,String(conv.connection_id),input.policy_version_id,tx);if(!policy)throw new DomainError('RECEPTION_POLICY_REQUIRED',409,'接待规则已失效');
    const scope=asRecord(policy.reception_scope);if(typeof scope.sop_version!=='string'||!scope.sop_version||!Array.isArray(scope.allowed_reply_classes))throw new DomainError('RECEPTION_SOP_REQUIRED',409,'接待规则须明确SOP版本与允许话术');
    const replyClass=conv.contact_id||conv.contact_captured_at?'contact_captured_acknowledgement':input.reason==='identity_question'?'identity_disclosure':input.reason==='silent_followup'?'silent_followup':input.reason==='handoff_request'?'handoff_acknowledgement':'useful_answer';
    const templates=asRecord(scope.approved_templates);const text=templates[replyClass];if(typeof text!=='string')throw new DomainError('RECEPTION_APPROVED_REPLY_REQUIRED',409,'尚无批准的备用话术');
    const questions=validateReply(text,replyClass,conv,scope);const aiId=uuid();const snapshot={conversation_id:id,version:Number(conv.version),state:conv.state,last_visitor_message_at:conv.last_visitor_message_at?new Date(String(conv.last_visitor_message_at)).toISOString():null,contact_id:conv.contact_id,handoff_status:conv.handoff_status,silent_followup_count:conv.silent_followup_count};
    const hash=stableHash(snapshot);const payload:ReceptionReplyPayload={conversation_id:id,conversation_version:Number(conv.version),ai_run_id:aiId,reply_text:text,question_count:questions,reply_class:replyClass,expected_conversation_hash:hash,sop_version:String(scope.sop_version)};
    await tx.query("INSERT INTO ai_runs(id,org_id,provider,model,prompt_version,input_hash,source_ids,output_hash,output_ref,quality_result,latency_ms) VALUES($1,$2,'deterministic_sop','approved-fallback',$3,$4,'{}',$5,$6,$7,0)",[aiId,ctx.orgId,scope.sop_version,hash,stableHash(payload),JSON.stringify({proposal:payload}),JSON.stringify({sop_valid:true,synthetic:ctx.mode==='mock'})]);
    const messageId=uuid();await tx.query("INSERT INTO reception_messages(id,org_id,conversation_id,external_message_id,role,sanitized_text,occurred_at,received_at,ai_run_id,delivery_status,question_count) VALUES($1,$2,$3,$4,'assistant',$5,$6,$6,$7,'proposed',$8)",[messageId,ctx.orgId,id,`proposal:${aiId}`,text,nowIso(ctx),aiId,questions]);
    const prepared={conv,payload,hash,messageId};
    await tx.query('INSERT INTO idempotency_records(org_id,scope,key,request_hash,status_code,response_json,resource_id,expires_at) VALUES($1,$2,$3,$4,202,$5,$6,$7)',[ctx.orgId,proposalScope,key,requestHash,JSON.stringify(prepared),messageId,new Date(Date.parse(nowIso(ctx))+7*86400000).toISOString()]);
    return prepared;
  });
}

/** Only a stored, approved proposal can become an execution action. The injected adapter must return a matching actual readback. */
export async function generateReceptionReply(ctx:ServiceContext,id:string,input:ReceptionReplyGenerate,key:string,options:ReceptionRuntimeOptions={}) {
  if(key.length<8||key.length>128)throw new DomainError('INVALID_IDEMPOTENCY_KEY',422,'回复请求键格式无效');
  await assertConversationRead(ctx,id);
  const prior=(await ctx.db.query("SELECT * FROM execution_actions WHERE org_id=$1 AND idempotency_key=$2 AND action_type='reception.reply'",[ctx.orgId,key])).rows[0];
  if(prior) {
    const payload=asRecord(prior.payload);if(asRecord(prior.target).conversation_id!==id||payload.conversation_version!==input.conversation_version||prior.policy_version_id!==input.policy_version_id)throw new DomainError('IDEMPOTENCY_CONFLICT',409,'回复请求键对应不同会话版本');
    if(prior.state==='queued'||prior.state==='retry_wait')return executeReceptionReply(ctx,String(prior.id),options);
    return {action_id:prior.id,state:prior.state,delivery_status:prior.state==='succeeded'?'delivered_verified':prior.state==='unknown'?'unknown':'submitted',replayed:true};
  }
  const prepared=await buildReply(ctx,id,input,key,options);const action=await createExecutionAction(ctx,{idempotencyKey:key,actionType:'reception.reply',target:{connection_id:prepared.conv.connection_id,conversation_id:id},payload:{...prepared.payload},beforeSnapshot:{conversation_version:input.conversation_version,conversation_hash:prepared.hash},policyVersionId:input.policy_version_id});
  await ctx.db.query('UPDATE reception_messages SET execution_action_id=$3 WHERE org_id=$1 AND id=$2',[ctx.orgId,prepared.messageId,action.id]);
  return executeReceptionReply(ctx,String(action.id),options);
}

export async function executeReceptionReply(ctx:ServiceContext,actionId:string,options:ReceptionRuntimeOptions={}) {
  const action=(await ctx.db.query("SELECT * FROM execution_actions WHERE org_id=$1 AND id=$2 AND action_type='reception.reply'",[ctx.orgId,actionId])).rows[0];if(!action)throw new DomainError('NOT_FOUND',404,'接待回复不存在');
  if(['succeeded','submitted','unknown','executing','verification_pending'].includes(String(action.state)))return {action_id:actionId,state:action.state,delivery_status:action.state==='succeeded'?'delivered_verified':action.state==='unknown'?'unknown':'submitted'};
  const target=asRecord(action.target);const adapter=adapterFor(String(target.connection_id),options);if(adapter.kind!==ctx.mode)throw new DomainError('CONNECTOR_MODE_MISMATCH',409,'接待连接器模式不一致');
  const claim=await claimExecutionAction(ctx,actionId,`reception:${uuid()}`,30);const payload=asRecord(claim.action.payload) as unknown as ReceptionReplyPayload;const id=String(target.conversation_id);
  let conv:Record<string,unknown>;
  try {conv=await ctx.db.transaction(async tx=>{
    await requirePrivacyConfiguration(ctx,options,tx);
    const current=(await tx.query('SELECT * FROM reception_conversations WHERE org_id=$1 AND id=$2 FOR UPDATE',[ctx.orgId,id])).rows[0]!;
    assertVersion(Number(current.version),payload.conversation_version);
    const currentHash=stableHash({conversation_id:id,version:Number(current.version),state:current.state,last_visitor_message_at:current.last_visitor_message_at?new Date(String(current.last_visitor_message_at)).toISOString():null,contact_id:current.contact_id,handoff_status:current.handoff_status,silent_followup_count:current.silent_followup_count});
    if(currentHash!==payload.expected_conversation_hash)throw new DomainError('RECEPTION_SNAPSHOT_CHANGED',409,'当前会话快照已变化');
    if(['closed','blocked','human_active','handoff_requested'].includes(String(current.state)))throw new DomainError('RECEPTION_STOPPED',409,'会话停止或已转人工');
    if(payload.reply_class==='silent_followup'&&(current.contact_id||current.contact_captured_at||current.handoff_status!=='none'||Number(current.silent_followup_count)>=2))throw new DomainError('RECEPTION_FOLLOWUP_CANCELLED',409,'沉默跟进已取消');
    if(current.contact_id){const contact=(await tx.query('SELECT consultation_processing_permission,deletion_status,retention_until FROM lead_contacts WHERE org_id=$1 AND id=$2',[ctx.orgId,current.contact_id])).rows[0];if(!contact||contact.consultation_processing_permission!=='permitted'||contact.deletion_status!=='active'||Date.parse(String(contact.retention_until))<=Date.parse(nowIso(ctx)))throw new DomainError('CONTACT_PROCESSING_WITHDRAWN',409,'联系人许可已撤回或到期');}
    const policy=await assertExecutionAuthorized(ctx,tx,claim.action);await assertConnection(ctx,String(target.connection_id),tx);const scope=asRecord(policy?.reception_scope);
    if(scope.sop_version!==payload.sop_version)throw new DomainError('RECEPTION_SOP_CHANGED',409,'SOP版本已变化');
    validateReply(payload.reply_text,payload.reply_class,current,scope);
    const ai=(await tx.query('SELECT output_ref FROM ai_runs WHERE org_id=$1 AND id=$2',[ctx.orgId,payload.ai_run_id])).rows[0];if(stableHash(asRecord(ai?.output_ref).proposal)!==stableHash(payload))throw new DomainError('RECEPTION_PROPOSAL_CHANGED',409,'回复与保存提议不一致');
    await tx.query("UPDATE reception_messages SET delivery_status='submitted' WHERE org_id=$1 AND execution_action_id=$2 AND delivery_status='proposed'",[ctx.orgId,actionId]);
    await tx.query("UPDATE reception_conversations SET state=CASE WHEN contact_id IS NOT NULL OR contact_captured_at IS NOT NULL THEN 'contact_captured' ELSE 'waiting_customer' END,version=version+1,silent_followup_count=silent_followup_count+$3,policy_version_id=$4,updated_at=$5 WHERE org_id=$1 AND id=$2",[ctx.orgId,id,payload.reply_class==='silent_followup'?1:0,action.policy_version_id,nowIso(ctx)]);
    return current;
  });} catch(error) {
    await completeExecutionAction(ctx,actionId,claim.token,{state:'failed',evidence:{code:error instanceof DomainError?error.code:'RECEPTION_PRECONDITION_FAILED'}});throw error;
  }
  let externalId:string;
  try {externalId=(await adapter.sendReply({external_conversation_id:String(conv.external_conversation_id),idempotency_key:String(action.idempotency_key),text:payload.reply_text})).external_message_id;
    if(!externalId)throw new Error('missing message id');
  } catch {await completeExecutionAction(ctx,actionId,claim.token,{state:'unknown',evidence:{code:'RECEPTION_SUBMISSION_UNKNOWN'}});await ctx.db.query("UPDATE reception_messages SET delivery_status='unknown' WHERE org_id=$1 AND execution_action_id=$2",[ctx.orgId,actionId]);return {action_id:actionId,state:'unknown',delivery_status:'unknown'};}
  let receipt:ReceptionReceipt|undefined;try{receipt=await adapter.readDelivery({external_conversation_id:String(conv.external_conversation_id),external_message_id:externalId,idempotency_key:String(action.idempotency_key)});}catch{/* Unknown delivery must reconcile; no resend. */}
  const verified=receipt?.verified===true&&receipt.external_message_id===externalId&&Object.keys(receipt.evidence_ref ?? {}).length>0&&(ctx.mode==='mock'||(typeof receipt.occurred_at==='string'&&Number.isFinite(Date.parse(receipt.occurred_at))));
  const state=verified&&ctx.mode==='live'?'succeeded':verified?'submitted':'unknown';
  await completeExecutionAction(ctx,actionId,claim.token,{state,externalId,afterSnapshot:verified?{external_message_id:externalId,delivery_status:'delivered_verified'}:undefined,evidence:verified?clean(receipt!.evidence_ref):{code:'DELIVERY_UNVERIFIED'}});
  await ctx.db.transaction(async tx=>{
    await tx.query("UPDATE reception_messages SET delivery_status=$4,evidence_ref=$5 WHERE org_id=$1 AND execution_action_id=$2 AND $3::text IS NOT NULL",[ctx.orgId,actionId,externalId,verified&&ctx.mode==='live'?'delivered_verified':ctx.mode==='mock'?'submitted':'unknown',JSON.stringify({synthetic:ctx.mode==='mock',external_message_id:externalId,...(verified?clean(receipt!.evidence_ref):{code:'DELIVERY_UNVERIFIED'})})]);
    if(verified&&ctx.mode==='live')await tx.query('UPDATE reception_conversations SET first_response_at=COALESCE(first_response_at,$3) WHERE org_id=$1 AND id=$2',[ctx.orgId,id,receipt?.occurred_at ?? nowIso(ctx)]);
    const current=(await tx.query('SELECT * FROM reception_conversations WHERE org_id=$1 AND id=$2 FOR UPDATE',[ctx.orgId,id])).rows[0]!;
    if(verified&&!current.contact_id&&!current.contact_captured_at&&current.handoff_status==='none'&&current.state==='waiting_customer'&&Number(current.silent_followup_count)<2) {
      const eventId=uuid();const generation=Number(current.version);const attempt=Number(current.silent_followup_count)+1;
      const reminderKey=`${id}:${generation}:${attempt}`;
      // Outbox event id is durable; repeated task delivery refers to this same row.
      await tx.query("INSERT INTO outbox_events(id,org_id,event_id,event_type,aggregate_id,schema_version,payload,occurred_at,attempts,next_attempt_at) VALUES($1,$2,$3,'reception.silent_followup',$4,1,$5,$6,0,$7)",[eventId,ctx.orgId,uuid(),id,JSON.stringify({conversation_id:id,generation,attempt_no:attempt,reminder_key:reminderKey,policy_version_id:action.policy_version_id,synthetic:ctx.mode==='mock'}),nowIso(ctx),new Date(Date.parse(nowIso(ctx))+10000).toISOString()]);
    }
  });
  return {action_id:actionId,state,delivery_status:verified&&ctx.mode==='live'?'delivered_verified':ctx.mode==='mock'?'submitted':'unknown',delivered_at:verified?receipt!.occurred_at ?? null:null,synthetic:ctx.mode==='mock'};
}

export async function processReceptionFollowup(ctx:ServiceContext,eventId:string,options:ReceptionRuntimeOptions={}) {
  const claimed=await ctx.db.transaction(async tx=>{
    const event=(await tx.query("SELECT * FROM outbox_events WHERE org_id=$1 AND id=$2 AND event_type='reception.silent_followup' FOR UPDATE",[ctx.orgId,eventId])).rows[0];if(!event)throw new DomainError('NOT_FOUND',404,'沉默延时任务不存在');
    if(event.dispatched_at)return {cancelled:true,reason:'already_dispatched'};
    if(Date.parse(String(event.next_attempt_at))>Date.parse(nowIso(ctx)))throw new DomainError('FOLLOWUP_NOT_DUE',409,'沉默跟进尚未到期');
    const payload=asRecord(event.payload);const conv=(await tx.query('SELECT * FROM reception_conversations WHERE org_id=$1 AND id=$2 FOR UPDATE',[ctx.orgId,event.aggregate_id])).rows[0];
    const cancelled=!conv||Number(conv.version)!==payload.generation||conv.state!=='waiting_customer'||conv.contact_id||conv.contact_captured_at||conv.handoff_status!=='none'||Number(conv.silent_followup_count)>=2;
    if(cancelled){await tx.query('UPDATE outbox_events SET dispatched_at=$3 WHERE org_id=$1 AND id=$2',[ctx.orgId,eventId,nowIso(ctx)]);return {cancelled:true,reason:'conversation_changed'};}
    return {cancelled:false,conv,payload};
  });
  if(claimed.cancelled)return claimed;
  const result=await generateReceptionReply(ctx,String(claimed.conv!.id),{conversation_version:Number(claimed.payload!.generation),reason:'silent_followup',policy_version_id:String(claimed.payload!.policy_version_id)},`silence:${stableHash(claimed.payload!.reminder_key)}`,options);
  await ctx.db.query('UPDATE outbox_events SET dispatched_at=$3,attempts=attempts+1 WHERE org_id=$1 AND id=$2',[ctx.orgId,eventId,nowIso(ctx)]);
  return result;
}

export async function handoffReception(ctx:ServiceContext,id:string,input:ReceptionHandoff,expectedVersion:number,key:string,options:ReceptionRuntimeOptions={}) {
  if(!input.reason?.trim()||input.reason.length>2000||key.length<8||key.length>128)throw new DomainError('INVALID_HANDOFF',422,'接手须提供原因和请求键');
  const conv=await assertConversationRead(ctx,id);const adapter=adapterFor(String(conv.connection_id),options);if(adapter.kind!==ctx.mode)throw new DomainError('CONNECTOR_MODE_MISMATCH',409,'接待连接器模式不一致');
  await requirePrivacyConfiguration(ctx,options);await assertConnection(ctx,String(conv.connection_id));
  const hash=stableHash({input,expectedVersion});const scope=`reception_handoff:${id}`;
  const planned=await ctx.db.transaction(async tx=>{
    const previous=(await tx.query('SELECT request_hash,response_json FROM idempotency_records WHERE org_id=$1 AND scope=$2 AND key=$3 FOR UPDATE',[ctx.orgId,scope,key])).rows[0];if(previous){if(previous.request_hash!==hash)throw new DomainError('IDEMPOTENCY_CONFLICT',409,'交接请求键对应不同请求');return {replayed:true,result:previous.response_json};}
    const current=await assertConversationRead(ctx,id,tx);assertVersion(Number(current.version),expectedVersion);
    if(current.state!=='handoff_requested'||current.handoff_status!=='requested')throw new DomainError('EXPLICIT_HANDOFF_REQUIRED',409,'仅客户明确请求人工时可交接');
    const member=(await tx.query("SELECT m.id FROM memberships m JOIN users u ON u.id=m.user_id WHERE m.org_id=$1 AND m.user_id=$2 AND m.active AND u.active AND ('owner'=ANY(m.roles) OR 'marketer'=ANY(m.roles))",[ctx.orgId,input.owner_user_id])).rows[0];if(!member)throw new DomainError('INVALID_HANDOFF_OWNER',422,'须指派现有两名运营之一');
    await cancelFollowups(ctx,tx,id);await tx.query("UPDATE reception_conversations SET handoff_status='assigned',handoff_owner_user_id=$3,version=version+1 WHERE org_id=$1 AND id=$2",[ctx.orgId,id,input.owner_user_id]);await addHandoffTask(ctx,tx,current,input.owner_user_id,input.reason);
    const requestId=uuid();const result={data:{id,request_id:requestId,status:'assigned',version:expectedVersion+1},meta:{request_id:requestId}};
    await tx.query('INSERT INTO idempotency_records(org_id,scope,key,request_hash,status_code,response_json,resource_id,expires_at) VALUES($1,$2,$3,$4,202,$5,$6,$7)',[ctx.orgId,scope,key,hash,JSON.stringify(result),id,new Date(Date.parse(nowIso(ctx))+7*86400000).toISOString()]);await audit(ctx,tx,'reception.handoff.assigned','reception_conversation',id,{owner_user_id:input.owner_user_id,request_id:requestId});return {replayed:false,result};
  });
  if(planned.replayed)return planned.result;
  let externalId:string;let receipt:{verified:boolean;evidence_ref:Record<string,unknown>}|undefined;
  try{externalId=(await adapter.handoff({external_conversation_id:String(conv.external_conversation_id),owner_user_id:input.owner_user_id,idempotency_key:key})).external_handoff_id;receipt=await adapter.readHandoff({external_handoff_id:externalId,external_conversation_id:String(conv.external_conversation_id),owner_user_id:input.owner_user_id});}catch{return {data:{id,status:'assigned',verified:false,delivery_status:'unknown'},meta:{request_id:uuid()}};}
  if(receipt?.verified&&Object.keys(receipt.evidence_ref ?? {}).length&&ctx.mode==='live') {
    await ctx.db.transaction(async tx=>{
      await tx.query("UPDATE reception_conversations SET state='human_active',handoff_status='completed',version=version+1 WHERE org_id=$1 AND id=$2 AND state='handoff_requested' AND handoff_owner_user_id=$3",[ctx.orgId,id,input.owner_user_id]);
      await audit(ctx,tx,'reception.handoff.verified','reception_conversation',id,{external_id:externalId,evidence_ref:clean(receipt!.evidence_ref)});
    });
    return {data:{id,status:'completed',verified:true},meta:{request_id:uuid()}};
  }
  return {data:{id,status:'assigned',verified:false,synthetic:ctx.mode==='mock'},meta:{request_id:uuid()}};
}
