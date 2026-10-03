import {validateApiRequest} from '@boran/contracts';
import {DomainError,nowIso,uuid,type ServiceContext} from '@boran/domain/core';
import {createContactCapture,confirmCapture,listLeads,updateLead,transitionLead,type ContactCaptureCreate,type LeadUpdate,type LeadTransitionCreate} from '@boran/domain/leads';
import {assertContactAccess,assertLeadRecordAccess,effectiveLeadRoles,privacyRequest,validatePrivacyConfiguration,type ContactPrivacyUpdate} from '@boran/domain/privacy';
import {getReceptionConversation,generateReceptionReply,handoffReception,type ReceptionReplyGenerate,type ReceptionHandoff} from '@boran/domain/reception';
import {databaseCommand,expectedVersion,idempotencyKey,jsonData} from '@/lib/http';
import {isLocalIdentity} from '@/lib/server-context';
const object=(value:unknown):Record<string,unknown>=>value&&typeof value==='object'&&!Array.isArray(value)?value as Record<string,unknown>:{};
function envelope(value:unknown,status=200):Response{return Response.json(value,{status,headers:{'Cache-Control':'no-store','X-Content-Type-Options':'nosniff'}});}
function safeLead(row:Record<string,unknown>){const {contact_ciphertext:_cipher,contact_hmac:_hmac,...safe}=row;return safe;}
function key(request:Request){const value=idempotencyKey(request);if(value.length<8)throw new DomainError('INVALID_IDEMPOTENCY_KEY',422,'请求键至少8个字符');return value;}
export async function handleLeads(ctx:ServiceContext,request:Request,segments:string[],body:Record<string,unknown>={}):Promise<Response|null>{
 const [area,id,action]=segments;const method=request.method;const synthetic={internalTest:ctx.mode==='mock'&&isLocalIdentity()};
 if(area==='leads'){
  if(!id&&method==='GET')return envelope(await listLeads(ctx));
  if(id&&!action&&method==='GET')return jsonData(safeLead(await assertLeadRecordAccess(ctx,id)));
  if(id&&!action&&method==='PATCH'){
   const input=validateApiRequest('LeadUpdate',body) as LeadUpdate;const version=expectedVersion(request);
   return databaseCommand(ctx,request,body,200,async txCtx=>(await updateLead(txCtx,id,input,version)).data);
  }
  if(id&&action==='stage-transitions'&&method==='POST'){
   const input=validateApiRequest('LeadTransitionCreate',body) as LeadTransitionCreate;
   return envelope(await transitionLead(ctx,id,input,expectedVersion(request),key(request)),201);
  }
 }
 if(area==='contact-captures'){
  if(!id&&method==='GET'){
   const roles=await effectiveLeadRoles(ctx);const shared=roles.some(r=>['owner','marketer'].includes(r));if(!shared&&!roles.includes('sales'))throw new DomainError('FORBIDDEN',403,'无权查看留资记录');
   const rows=(await ctx.db.query('SELECT cc.id,cc.contact_id,cc.lead_id,cc.source_channel,cc.captured_at,cc.commercial_intent_status,cc.counted_real_lead,cc.test_record,cc.version,c.company,c.contact_type,c.reachable_status FROM contact_captures cc JOIN lead_contacts c ON c.org_id=cc.org_id AND c.id=cc.contact_id LEFT JOIN leads l ON l.org_id=cc.org_id AND l.id=cc.lead_id WHERE cc.org_id=$1 AND ($2::boolean OR l.owner_user_id=$3) ORDER BY cc.captured_at DESC LIMIT 200',[ctx.orgId,shared,ctx.actorId])).rows;
   return jsonData(rows);
  }
  if(!id&&method==='POST'){
   const input=validateApiRequest('ContactCaptureCreate',body) as ContactCaptureCreate;key(request);
   return databaseCommand(ctx,request,body,201,async txCtx=>(await createContactCapture(txCtx,input,synthetic)).data);
  }
  if(id&&action==='confirm'&&method==='POST'){
   if(!object(body.reachable_evidence_ref)||!object(body.intent_evidence_ref)||typeof body.company!=='string'||typeof body.commercial_intent!=='string')throw new DomainError('INVALID_REQUEST',422,'确认须可联系及企业意图证据');
   const input={reachable_evidence_ref:object(body.reachable_evidence_ref),intent_evidence_ref:object(body.intent_evidence_ref),company:body.company,commercial_intent:body.commercial_intent};
   const version=expectedVersion(request);return databaseCommand(ctx,request,body,200,async txCtx=>(await confirmCapture(txCtx,id,input,version)).data);
  }
 }
 if(area==='contacts'&&id){
  if(!action&&method==='GET'){
   const contact=await assertContactAccess(ctx,id);const {contact_ciphertext:_cipher,normalized_contact_hmac:_hmac,normalized_company_hash:_companyHash,...safe}=contact;return jsonData(safe);
  }
  if(action==='privacy-requests'&&method==='POST')return envelope(await privacyRequest(ctx,id,validateApiRequest('ContactPrivacyUpdate',body) as ContactPrivacyUpdate,expectedVersion(request),key(request)),202);
  if(action==='privacy-requests'&&method==='GET'){
   await assertContactAccess(ctx,id);return jsonData((await ctx.db.query("SELECT id,status,input_ref->>'request_type' request_type,output_ref,created_at,finished_at FROM workflow_runs WHERE org_id=$1 AND kind='privacy_request' AND input_ref->>'contact_id'=$2 ORDER BY created_at DESC",[ctx.orgId,id])).rows);
  }
 }
 if(area==='privacy'&&id==='configuration'){
  const roles=await effectiveLeadRoles(ctx);if(!roles.includes('owner'))throw new DomainError('FORBIDDEN',403,'隐私配置仅负责人可访问');
  if(method==='GET')return jsonData((await ctx.db.query('SELECT value FROM settings WHERE org_id=$1 AND key=$2',[ctx.orgId,'privacy_configuration'])).rows[0]?.value ?? {enabled:false,configured:false});
  if(method==='PUT'||method==='POST'){
   return databaseCommand(ctx,request,body,200,async txCtx=>{
    const value=await validatePrivacyConfiguration(txCtx,body);await txCtx.db.query('INSERT INTO settings(id,org_id,key,value,schema_version,updated_by) VALUES($1,$2,$3,$4,1,$5) ON CONFLICT(org_id,key) DO UPDATE SET value=EXCLUDED.value,updated_by=EXCLUDED.updated_by,updated_at=$6',[uuid(),ctx.orgId,'privacy_configuration',JSON.stringify(value),ctx.actorId,nowIso(ctx)]);return {configured:true,...value};
   });
  }
 }
 if(area==='reception'&&id==='conversations'){
  const conversationId=segments[2],operation=segments[3];
  if(!conversationId&&method==='GET'){
   const roles=await effectiveLeadRoles(ctx);if(!roles.some(r=>['owner','marketer'].includes(r)))throw new DomainError('FORBIDDEN',403,'无权查看共享接待会话');
   return jsonData((await ctx.db.query('SELECT id,connection_id,state,handoff_status,first_response_at,silent_followup_count,last_visitor_message_at,test_record,version FROM reception_conversations WHERE org_id=$1 ORDER BY started_at DESC LIMIT 200',[ctx.orgId])).rows);
  }
  if(conversationId&&!operation&&method==='GET')return envelope(await getReceptionConversation(ctx,conversationId));
  if(conversationId&&operation==='handoff'&&method==='POST')return envelope(await handoffReception(ctx,conversationId,validateApiRequest('ReceptionHandoff',body) as ReceptionHandoff,expectedVersion(request),key(request),synthetic),202);
  if(conversationId&&operation==='reply'&&method==='POST'){
   const input=validateApiRequest('ReceptionReplyGenerate',body) as ReceptionReplyGenerate;if(input.conversation_version!==expectedVersion(request))throw new DomainError('VERSION_CONFLICT',409,'会话版本与If-Match不一致');
   return jsonData(await generateReceptionReply(ctx,conversationId,input,key(request),synthetic),202);
  }
 }
 return null;
}
