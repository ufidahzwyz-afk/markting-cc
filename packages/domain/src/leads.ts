import type { SqlExecutor } from '@boran/db';
import { createHmac } from 'node:crypto';
import { assertSafeInteger, assertVersion, audit, DomainError, emitOutbox, nowIso, stableHash, uuid, type ServiceContext } from './core';
import { assertLeadRecordAccess, contactHmac, effectiveLeadRoles, encryptContact, normalizeContact, privacyKeys, requirePrivacyConfiguration, redactPrivateObject, sanitizeAttribution, sanitizePrivateText, type ContactChannel, type PrivacyOptions, type PrivacyConfiguration } from './privacy';

export interface LeadSubmit {
  submission_id: string; page_id: string; release_id: string; privacy_notice_version: string; consent: true;
  contact_phone?: string; contact_email?: string; contact_wechat?: string; company?: string; need?: string;
  attribution?: Record<string,string>; honeypot?: string; test_record?: boolean; allowed_contact_channels?: ContactChannel[]; marketing_consent?: boolean | undefined;
}
export interface ContactCaptureCreate {
  event_key: string; contact_type: 'phone'|'wechat'|'email'|'inbound_call'; contact_value: string; company?: string | undefined; source_channel: string;
  conversation_id?: string|null; commercial_intent?: string | undefined; intent_evidence_ref?: Record<string,unknown> | undefined; privacy_notice_version: string;
  consent: true; allowed_contact_channels: ContactChannel[]; lawful_basis?: string; marketing_consent?: boolean | undefined;
}
export interface CaptureOptions extends PrivacyOptions { reachableEvidence?: Record<string,unknown>; testRecord?: boolean }
export interface LeadUpdate {
  owner_user_id?: string; status?: 'new'|'assigned'|'contacted'|'qualified'|'invalid'; invalid_reason?: 'spam'|'duplicate'|'no_need'|'unreachable'|'out_of_scope'|'other'; need?: string; note?: string;
  feedback?: Record<string,string>; quality_level?: 'real_lead'|'qualified_lead'; qualification_evidence_ref?: Record<string,unknown>;
  funnel_stage?: string; transition_evidence_ref?: Record<string,unknown>;
}
export interface LeadTransitionCreate {
  funnel_stage: string; evidence_ref: Record<string,unknown>; next_step: string; opportunity_id: string|null;
  opportunity_details?: {problem?:string;product_or_scope?:string;sales_acceptance_evidence?:Record<string,unknown>;quote_external_id?:string;quote_date?:string;quote_scope?:string;contract_or_order_ref?:Record<string,unknown>;amount_minor?:number;currency?:string;won_at?:string};
}
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const REAL_STAGES = new Set(['QUALIFIED','OPPORTUNITY','DEMO','PROPOSAL','QUOTED','WON']);
function checkUuid(value: unknown, field: string) { if (typeof value !== 'string' || !UUID_PATTERN.test(value)) throw new DomainError('INVALID_REQUEST',422,`${field}格式无效`); }
function bounded(value: unknown, min: number, max: number, field: string) { if (typeof value !== 'string' || value.trim().length < min || value.length > max) throw new DomainError('INVALID_REQUEST',422,`${field}长度无效`); }
function evidence(value: unknown): value is Record<string,unknown> { return !!value && typeof value === 'object' && !Array.isArray(value) && Object.keys(value).length > 0; }
function cleanRecord(value: Record<string, unknown> = {}): Record<string, unknown> { return redactPrivateObject(value); }
function requireSyntheticContact(ctx: ServiceContext, contactType: string, normalized: string, options: PrivacyOptions) {
  if (ctx.mode === 'mock' && (!options.internalTest || contactType !== 'email' || !/^[a-z0-9._+-]+@example\.invalid$/i.test(normalized))) throw new DomainError('SYNTHETIC_TEST_CONTACT_REQUIRED',403,'模拟模式仅接收指定 example.invalid 测试邮箱');
}
function permissionChannels(channels: ContactChannel[] | undefined, type: string, config: PrivacyConfiguration): ContactChannel[] {
  const actual = type === 'inbound_call' ? 'phone' : type;
  const given = channels ?? [actual as ContactChannel];
  if (!Array.isArray(given) || given.length > 3 || new Set(given).size !== given.length || given.some(x => !['phone','wechat','email'].includes(x) || !config.allowed_contact_channels.includes(x))) throw new DomainError('CONTACT_CHANNEL_NOT_ALLOWED',422,'联系渠道未获本次咨询许可');
  return given;
}

async function existingRequest(tx: SqlExecutor, ctx: ServiceContext, scope: string, key: string, hash: string): Promise<unknown|undefined> {
  const row = (await tx.query('SELECT request_hash,response_json FROM idempotency_records WHERE org_id=$1 AND scope=$2 AND key=$3',[ctx.orgId,scope,key])).rows[0];
  if (!row) return undefined;
  if (row.request_hash !== hash) throw new DomainError('IDEMPOTENCY_CONFLICT',409,'同一请求键不能用于不同内容');
  return row.response_json;
}
async function saveRequest(tx: SqlExecutor,ctx:ServiceContext,scope:string,key:string,hash:string,result:unknown,id:string,code=201) {
  await tx.query('INSERT INTO idempotency_records(org_id,scope,key,request_hash,status_code,response_json,resource_id,expires_at) VALUES($1,$2,$3,$4,$5,$6,$7,$8)',[ctx.orgId,scope,key,hash,code,JSON.stringify(result),id,new Date(new Date(nowIso(ctx)).getTime()+7*86400000).toISOString()]);
}

/** Caller locks the organization before this helper: concurrent capture requests cannot create duplicate master contacts. */
async function persistCapture(ctx: ServiceContext,tx:SqlExecutor,input:ContactCaptureCreate,options:CaptureOptions,config:PrivacyConfiguration) {
  const normalized = normalizeContact(input.contact_type,input.contact_value);
  requireSyntheticContact(ctx,input.contact_type,normalized,options);
  const keys = privacyKeys(ctx,options); const hmac = contactHmac(input.contact_type,normalized,keys.hmac);
  const company = input.company?.trim() ? sanitizePrivateText(input.company.trim()) : null; const companyHash = company ? stableHash(company.normalize('NFKC').toLowerCase().replace(/\s+/g,'')) : null;
  const channels = permissionChannels(input.allowed_contact_channels,input.contact_type,config); const time = nowIso(ctx);
  const candidate = (await tx.query("SELECT * FROM lead_contacts WHERE org_id=$1 AND normalized_contact_hmac=$2 AND deletion_status='active' AND ((normalized_company_hash=$3) OR normalized_company_hash IS NULL OR $3::text IS NULL) ORDER BY CASE WHEN normalized_company_hash=$3 THEN 0 ELSE 1 END, created_at LIMIT 1 FOR UPDATE",[ctx.orgId,hmac,companyHash])).rows[0];
  let contactId: string; let reachable = evidence(options.reachableEvidence); let consentActive = true;
  if (candidate) {
    contactId = String(candidate.id); reachable ||= candidate.reachable_status === 'verified';
    if (candidate.consent_status === 'withdrawn' || candidate.consultation_processing_permission === 'withdrawn' || candidate.deletion_status !== 'active') throw new DomainError('CONTACT_PROCESSING_WITHDRAWN',409,'已有联系人请求停止处理，须单独核验新的许可');
    consentActive = candidate.consultation_processing_permission === 'permitted';
    if (company && !candidate.normalized_company_hash) await tx.query('UPDATE lead_contacts SET company=$3,normalized_company_hash=$4,version=version+1,updated_at=$5 WHERE org_id=$1 AND id=$2',[ctx.orgId,contactId,company,companyHash,time]);
    if (evidence(options.reachableEvidence) && candidate.reachable_status !== 'verified') await tx.query("UPDATE lead_contacts SET reachable_status='verified',reachable_evidence_ref=$3,version=version+1,updated_at=$4 WHERE org_id=$1 AND id=$2",[ctx.orgId,contactId,JSON.stringify(cleanRecord(options.reachableEvidence)),time]);
    // A capture never grants marketing consent inferred from earlier consultation or another event.
    if (input.marketing_consent === true && candidate.marketing_consent_status !== 'granted') await tx.query("UPDATE lead_contacts SET marketing_consent_status='granted',marketing_consent_at=$3,version=version+1,updated_at=$3 WHERE org_id=$1 AND id=$2",[ctx.orgId,contactId,time]);
  } else {
    contactId = uuid();
    await tx.query("INSERT INTO lead_contacts(id,org_id,contact_type,normalized_contact_hmac,contact_ciphertext,company,normalized_company_hash,reachable_status,reachable_evidence_ref,consent_status,consent_at,privacy_notice_version,allowed_contact_channels,retention_until,lawful_basis,consultation_processing_permission,marketing_consent_status,marketing_consent_at,deletion_status,withdrawal_status,export_status,version) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,'granted',$10,$11,$12,$13,$14,'permitted',$15,$16,'active','none','none',1)",[contactId,ctx.orgId,input.contact_type,hmac,encryptContact(normalized,keys.encryption),company,companyHash,reachable ? 'verified':'unknown',options.reachableEvidence ? JSON.stringify(cleanRecord(options.reachableEvidence)):null,time,input.privacy_notice_version,channels,new Date(new Date(time).getTime()+config.retention_days*86400000).toISOString(),config.lawful_basis,input.marketing_consent ? 'granted':'denied',input.marketing_consent ? time:null]);
  }
  const intentConfirmed = consentActive && !!company && !!input.commercial_intent?.trim() && evidence(input.intent_evidence_ref);
  const prior = (await tx.query('SELECT id,dedupe_window_start FROM leads WHERE org_id=$1 AND contact_id=$2 AND dedupe_window_start>=$3 AND merged_into_id IS NULL ORDER BY acquired_at LIMIT 1',[ctx.orgId,contactId,new Date(new Date(time).getTime()-30*86400000).toISOString()])).rows[0];
  let leadId: string|null = null; let counted = false;
  if (reachable && intentConfirmed) {
    if (prior) leadId=String(prior.id);
    else {
      leadId=uuid(); counted=true;
      const intentEvidence = cleanRecord(input.intent_evidence_ref);
      await tx.query("INSERT INTO leads(id,org_id,company,business_line,need,status,first_touch,last_non_direct_touch,acquired_at,version,contact_id,commercial_intent,intent_evidence_ref,last_touch,funnel_stage,feedback_json,test_record,dedupe_window_start,quality_level) VALUES($1,$2,$3,'unknown',$4,'new',$5,'{\"source\":\"unknown\",\"reason\":\"attribution_policy_not_approved\"}',$6,1,$7,$8,$9,$5,'REAL_LEAD','{}',$10,$6,'real_lead')",[leadId,ctx.orgId,company,sanitizePrivateText(input.commercial_intent ?? ''),JSON.stringify({source_channel:input.source_channel}),time,contactId,sanitizePrivateText(input.commercial_intent ?? ''),JSON.stringify(intentEvidence),ctx.mode === 'mock' || options.testRecord === true]);
      await audit(ctx,tx,'lead.real.created','lead',leadId,{contact_id:contactId,intent_evidence_ref:intentEvidence,test_record:ctx.mode === 'mock' || options.testRecord === true});
    }
  }
  const captureId = uuid(); const windowStart = prior?.dedupe_window_start ?? time;
  await tx.query('INSERT INTO contact_captures(id,org_id,contact_id,lead_id,event_key,source_channel,conversation_id,captured_at,commercial_intent_status,intent_type,intent_evidence_ref,dedupe_window_start,counted_real_lead,test_record,version) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,1)',[captureId,ctx.orgId,contactId,leadId,input.event_key,input.source_channel,input.conversation_id ?? null,time,intentConfirmed ? 'confirmed':'unknown',input.commercial_intent ? sanitizePrivateText(input.commercial_intent) : null,input.intent_evidence_ref ? JSON.stringify(cleanRecord(input.intent_evidence_ref)):null,windowStart,counted,ctx.mode === 'mock' || options.testRecord === true]);
  if (input.conversation_id) {
    const conv = await tx.query("UPDATE reception_conversations SET contact_id=$3,lead_id=COALESCE($4,lead_id),contact_captured_at=$5,state='contact_captured',version=version+1,updated_at=$5 WHERE org_id=$1 AND id=$2",[ctx.orgId,input.conversation_id,contactId,leadId,time]);
    if (!conv.rowCount) throw new DomainError('INVALID_CONVERSATION',422,'关联会话不存在');
    await tx.query("UPDATE outbox_events SET dispatched_at=$3 WHERE org_id=$1 AND aggregate_id=$2 AND event_type='reception.silent_followup' AND dispatched_at IS NULL",[ctx.orgId,input.conversation_id,time]);
  }
  await audit(ctx,tx,'contact.capture.created','contact_capture',captureId,{contact_id:contactId,lead_id:leadId,counted_real_lead:counted,test_record:ctx.mode === 'mock' || options.testRecord === true});
  await emitOutbox(ctx,tx,'contact.captured',captureId,{contact_id:contactId,capture_id:captureId,lead_id:leadId,test_record:ctx.mode === 'mock' || options.testRecord === true});
  return {data:{contact_id:contactId,capture_id:captureId,lead_id:leadId,classification:leadId ? 'real_lead' as const:'contact_capture' as const,deduplicated:!!prior},meta:{request_id:uuid()}};
}

export async function createContactCapture(ctx: ServiceContext,input:ContactCaptureCreate,options:CaptureOptions = {}) {
  const roles = await effectiveLeadRoles(ctx); if (!roles.some(x=>['owner','marketer'].includes(x))) throw new DomainError('FORBIDDEN',403,'仅共享运营成员可捕获联系方式');
  bounded(input.event_key,1,200,'event_key'); bounded(input.source_channel,1,60,'source_channel'); if(!/^[a-z0-9_.:-]+$/i.test(input.source_channel))throw new DomainError('INVALID_SOURCE_CHANNEL',422,'来源渠道须为稳定渠道标识'); bounded(input.privacy_notice_version,1,80,'privacy_notice_version');
  if (input.company !== undefined) bounded(input.company,1,200,'company'); if (input.commercial_intent !== undefined) bounded(input.commercial_intent,1,100,'commercial_intent');
  if (input.consent !== true) throw new DomainError('CONSENT_REQUIRED',422,'须确认本次咨询处理告知');
  if(input.marketing_consent!==undefined&&typeof input.marketing_consent!=='boolean')throw new DomainError('INVALID_MARKETING_CONSENT',422,'营销许可必须明确选择');
  const config=await requirePrivacyConfiguration(ctx,options); if (input.privacy_notice_version!==config.notice_version || (input.lawful_basis && input.lawful_basis!==config.lawful_basis)) throw new DomainError('PRIVACY_NOTICE_MISMATCH',422,'告知版本或合法基础与有效配置不一致');
  if (input.conversation_id) checkUuid(input.conversation_id,'conversation_id');
  const keys=privacyKeys(ctx,options); const hash=createHmac('sha256',keys.hmac).update(stableHash({input,reachableEvidence:options.reachableEvidence ?? null})).digest('hex');
  return ctx.db.transaction(async tx=>{
    await tx.query('SELECT id FROM organizations WHERE id=$1 FOR UPDATE',[ctx.orgId]);
    const scope=`contact_capture:${input.source_channel}`; const key=stableHash(input.event_key); const previous=await existingRequest(tx,ctx,scope,key,hash); if (previous) return previous as Awaited<ReturnType<typeof persistCapture>>;
    const result=await persistCapture(ctx,tx,input,options,config); await saveRequest(tx,ctx,scope,key,hash,result,result.data.capture_id); return result;
  });
}

export async function submitPublicLead(ctx:ServiceContext,input:LeadSubmit,options:PrivacyOptions & {rateLimitKey?:string} = {}) {
  for (const field of ['submission_id','page_id','release_id'] as const) checkUuid(input[field],field);
  if (input.honeypot !== undefined && input.honeypot !== '') throw new DomainError('INVALID_SUBMISSION',422,'提交无效');
  if (input.consent !== true) throw new DomainError('CONSENT_REQUIRED',422,'须确认咨询处理告知');
  if(input.marketing_consent!==undefined&&typeof input.marketing_consent!=='boolean')throw new DomainError('INVALID_MARKETING_CONSENT',422,'营销许可必须明确选择');
  bounded(input.privacy_notice_version,1,40,'privacy_notice_version'); if (input.company !== undefined) bounded(input.company,1,200,'company'); if (input.need !== undefined) bounded(input.need,5,3000,'need');
  const known=new Set(['submission_id','page_id','release_id','privacy_notice_version','consent','contact_phone','contact_email','contact_wechat','company','need','attribution','honeypot','test_record','allowed_contact_channels','marketing_consent']);
  if (Object.keys(input).some(key=>!known.has(key))) throw new DomainError('INVALID_SUBMISSION',422,'存在未知表单字段');
  const contacts: Array<['phone'|'email'|'wechat',string]> = [];
  for (const [type,field] of [['phone','contact_phone'],['email','contact_email'],['wechat','contact_wechat']] as const) if (input[field]!==undefined) contacts.push([type,normalizeContact(type,input[field])]);
  if (!contacts.length) throw new DomainError('CONTACT_REQUIRED',422,'请提供最小联系方式');
  const config=await requirePrivacyConfiguration(ctx,options);
  for (const [type,value] of contacts) requireSyntheticContact(ctx,type,value,options); if (config.notice_version!==input.privacy_notice_version) throw new DomainError('PRIVACY_NOTICE_MISMATCH',422,'告知版本不匹配');
  const keys=privacyKeys(ctx,options); const hash=createHmac('sha256',keys.hmac).update(stableHash(input)).digest('hex');
  const attribution=sanitizeAttribution(input.attribution);
  return ctx.db.transaction(async tx=>{
    await tx.query('SELECT id FROM organizations WHERE id=$1 FOR UPDATE',[ctx.orgId]);
    const previous=(await tx.query('SELECT id,request_hash FROM lead_submissions WHERE org_id=$1 AND submission_id=$2',[ctx.orgId,input.submission_id])).rows[0];
    if (previous) { if (previous.request_hash!==hash) throw new DomainError('IDEMPOTENCY_CONFLICT',409,'相同submission_id对应不同内容'); return {data:{receipt_id:String(previous.id),status:'received' as const},meta:{request_id:String(previous.id)}}; }
    const page=(await tx.query('SELECT p.id,p.business_line,p.content_item_id FROM pages p JOIN releases r ON r.org_id=p.org_id AND r.id=p.published_release_id WHERE p.org_id=$1 AND p.id=$2 AND r.id=$3 AND r.page_id=p.id',[ctx.orgId,input.page_id,input.release_id])).rows[0];
    if (!page) throw new DomainError('INVALID_PUBLISHED_PAGE',422,'表单来源不是当前已发布页面');
    if (!options.rateLimitKey && ctx.mode==='live') throw new DomainError('RATE_LIMIT_CONTEXT_REQUIRED',503,'匿名提交限流上下文未配置');
    const time=nowIso(ctx); const rateHash=contactHmac('rate',options.rateLimitKey ?? 'synthetic-test',keys.hmac); const count=(await tx.query("SELECT count(*)::integer AS count FROM idempotency_records WHERE org_id=$1 AND scope='public_lead_rate' AND key LIKE $2 AND created_at>$3",[ctx.orgId,`${rateHash}:%`,new Date(new Date(time).getTime()-60000).toISOString()])).rows[0];
    if (Number(count?.count ?? 0)>=10) throw new DomainError('RATE_LIMITED',429,'提交过于频繁');
    const [type,value]=contacts[0]!;
    const capture=await persistCapture(ctx,tx,{event_key:input.submission_id,contact_type:type,contact_value:value,source_channel:'form',company:input.company,commercial_intent:input.company && input.need ? 'enterprise_consultation':undefined,intent_evidence_ref:input.company && input.need ? {kind:'visitor_form',submission_id:input.submission_id,need:sanitizePrivateText(input.need)}:undefined,privacy_notice_version:input.privacy_notice_version,consent:true,allowed_contact_channels:permissionChannels(input.allowed_contact_channels,type,config),marketing_consent:input.marketing_consent}, {...options,testRecord:ctx.mode==='mock'},config);
    const receiptId=uuid();
    await tx.query("INSERT INTO lead_submissions(id,org_id,submission_id,request_hash,lead_id,page_id,release_id,channel,privacy_notice_version,consent,attribution,received_at,contact_id,capture_id,test_record) VALUES($1,$2,$3,$4,$5,$6,$7,'form',$8,true,$9,$10,$11,$12,$13)",[receiptId,ctx.orgId,input.submission_id,hash,capture.data.lead_id,input.page_id,input.release_id,input.privacy_notice_version,JSON.stringify({...attribution,verification_status:'unknown'}),time,capture.data.contact_id,capture.data.capture_id,ctx.mode==='mock']);
    await tx.query('UPDATE contact_captures SET submission_id=$3 WHERE org_id=$1 AND id=$2',[ctx.orgId,capture.data.capture_id,receiptId]);
    await tx.query("INSERT INTO attribution_touches(org_id,event_key,contact_id,lead_id,capture_id,channel,occurred_at,received_at,campaign_external_id,unit_external_id,keyword_external_id,sanitized_query,content_item_id,page_id,click_id_hash,evidence_ref,verification_status,is_paid_attributed) VALUES($1,$2,$3,$4,$5,'form',$6,$6,$7,$8,$9,$10,$11,$12,$13,$14,'unknown',false)",[ctx.orgId,input.submission_id,capture.data.contact_id,capture.data.lead_id,capture.data.capture_id,time,attribution.campaign_external_id ?? null,attribution.unit_external_id ?? null,attribution.keyword_external_id ?? null,attribution.query ?? null,page.content_item_id,page.id,attribution.click_id?contactHmac('click',attribution.click_id,keys.hmac):null,JSON.stringify({kind:'client_observation',verification:'unknown',submission_id:input.submission_id,release_id:input.release_id,utm:attribution})]);
    await tx.query("INSERT INTO idempotency_records(org_id,scope,key,request_hash,expires_at,created_at) VALUES($1,'public_lead_rate',$2,$3,$4,$5)",[ctx.orgId,`${rateHash}:${input.submission_id}`,hash,new Date(new Date(time).getTime()+7*86400000).toISOString(),time]);
    await emitOutbox(ctx,tx,'lead.submission.received',receiptId,{receipt_id:receiptId,capture_id:capture.data.capture_id,lead_id:capture.data.lead_id,test_record:ctx.mode==='mock'});
    return {data:{receipt_id:receiptId,status:'received' as const},meta:{request_id:receiptId}};
  });
}

/** Human evidence upgrades a capture; a valid-format contact or an AI guess cannot do so. */
export async function confirmCapture(ctx:ServiceContext,captureId:string,input:{reachable_evidence_ref:Record<string,unknown>;company:string;commercial_intent:string;intent_evidence_ref:Record<string,unknown>},expectedVersion:number) {
  const roles=await effectiveLeadRoles(ctx); if (!roles.some(x=>['owner','marketer'].includes(x))) throw new DomainError('FORBIDDEN',403,'无权确认联系方式');
  if (!evidence(input.reachable_evidence_ref)||!evidence(input.intent_evidence_ref)||!input.company?.trim()||!input.commercial_intent?.trim()) throw new DomainError('LEAD_EVIDENCE_REQUIRED',422,'可联系与企业意图都需要核验依据');
  return ctx.db.transaction(async tx=>{
    await tx.query('SELECT id FROM organizations WHERE id=$1 FOR UPDATE',[ctx.orgId]);
    const cap=(await tx.query('SELECT * FROM contact_captures WHERE org_id=$1 AND id=$2 FOR UPDATE',[ctx.orgId,captureId])).rows[0]; if(!cap)throw new DomainError('NOT_FOUND',404,'联系方式记录不存在'); assertVersion(Number(cap.version),expectedVersion);
    const contact=(await tx.query('SELECT * FROM lead_contacts WHERE org_id=$1 AND id=$2 FOR UPDATE',[ctx.orgId,cap.contact_id])).rows[0]!;
    if(contact.consultation_processing_permission!=='permitted'||contact.deletion_status!=='active')throw new DomainError('CONTACT_PROCESSING_WITHDRAWN',409,'个人已撤回或限制处理');
    const company=sanitizePrivateText(input.company.trim()); const companyHash=stableHash(company.normalize('NFKC').toLowerCase().replace(/\s+/g,''));
    if(contact.normalized_company_hash && contact.normalized_company_hash!==companyHash)throw new DomainError('COMPANY_EVIDENCE_CONFLICT',409,'企业不一致，须单独核验联系关系');
    const time=nowIso(ctx);
    await tx.query("UPDATE lead_contacts SET company=$3,normalized_company_hash=$4,reachable_status='verified',reachable_evidence_ref=$5,version=version+1,updated_at=$6 WHERE org_id=$1 AND id=$2",[ctx.orgId,cap.contact_id,company,companyHash,JSON.stringify(cleanRecord(input.reachable_evidence_ref)),time]);
    const prior=(await tx.query('SELECT id,dedupe_window_start FROM leads WHERE org_id=$1 AND contact_id=$2 AND dedupe_window_start>=$3 AND merged_into_id IS NULL ORDER BY acquired_at LIMIT 1',[ctx.orgId,cap.contact_id,new Date(new Date(String(cap.captured_at)).getTime()-30*86400000).toISOString()])).rows[0];
    let leadId=cap.lead_id ? String(cap.lead_id):prior?.id ? String(prior.id):uuid(); const counted=!cap.lead_id&&!prior;
    const submission=(await tx.query('SELECT s.attribution,s.page_id,s.release_id,p.business_line FROM lead_submissions s LEFT JOIN pages p ON p.org_id=s.org_id AND p.id=s.page_id WHERE s.org_id=$1 AND s.capture_id=$2 ORDER BY s.received_at LIMIT 1',[ctx.orgId,captureId])).rows[0];
    const touch=submission?{source_channel:cap.source_channel,page_id:submission.page_id,release_id:submission.release_id,observed_at:cap.captured_at instanceof Date?cap.captured_at.toISOString():cap.captured_at,attribution:submission.attribution,verification_status:'unknown'}:{source_channel:cap.source_channel};
    if(counted)await tx.query("INSERT INTO leads(id,org_id,company,business_line,need,status,first_touch,last_non_direct_touch,acquired_at,version,contact_id,commercial_intent,intent_evidence_ref,last_touch,funnel_stage,feedback_json,test_record,dedupe_window_start,quality_level) VALUES($1,$2,$3,$11,$4,'new',$5,'{\"source\":\"unknown\",\"reason\":\"attribution_policy_not_approved\"}',$6,1,$7,$8,$9,$5,'REAL_LEAD','{}',$10,$6,'real_lead')",[leadId,ctx.orgId,company,sanitizePrivateText(input.commercial_intent),JSON.stringify(touch),cap.captured_at,cap.contact_id,sanitizePrivateText(input.commercial_intent),JSON.stringify(cleanRecord(input.intent_evidence_ref)),cap.test_record,submission?.business_line ?? 'unknown']);
    await tx.query("UPDATE contact_captures SET lead_id=$3,commercial_intent_status='confirmed',intent_type=$4,intent_evidence_ref=$5,counted_real_lead=$6,dedupe_window_start=$7,version=version+1,updated_at=$8 WHERE org_id=$1 AND id=$2",[ctx.orgId,captureId,leadId,sanitizePrivateText(input.commercial_intent),JSON.stringify(cleanRecord(input.intent_evidence_ref)),Boolean(cap.counted_real_lead)||counted,prior?.dedupe_window_start ?? cap.captured_at,time]);
    await tx.query('UPDATE lead_submissions SET lead_id=$3 WHERE org_id=$1 AND capture_id=$2 AND lead_id IS NULL',[ctx.orgId,captureId,leadId]);
    if(cap.conversation_id)await tx.query('UPDATE reception_conversations SET lead_id=$3,version=version+1 WHERE org_id=$1 AND id=$2',[ctx.orgId,cap.conversation_id,leadId]);
    await audit(ctx,tx,'capture.real.confirmed','contact_capture',captureId,{lead_id:leadId,counted_real_lead:counted,reachable_evidence_ref:cleanRecord(input.reachable_evidence_ref),intent_evidence_ref:cleanRecord(input.intent_evidence_ref)});
    return {data:{capture_id:captureId,lead_id:leadId,classification:'real_lead',deduplicated:!counted,version:Number(cap.version)+1},meta:{request_id:uuid()}};
  });
}

export async function listLeads(ctx:ServiceContext) {
  const roles=await effectiveLeadRoles(ctx); const shared=roles.some(x=>['owner','marketer'].includes(x)); if(!shared&&!roles.includes('sales'))throw new DomainError('FORBIDDEN',403,'无权访问线索');
  const rows=(await ctx.db.query('SELECT l.*,c.reachable_status,c.marketing_consent_status,c.deletion_status,c.contact_type FROM leads l JOIN lead_contacts c ON c.org_id=l.org_id AND c.id=l.contact_id WHERE l.org_id=$1 AND ($2::boolean OR l.owner_user_id=$3) ORDER BY l.created_at DESC LIMIT 200',[ctx.orgId,shared,ctx.actorId])).rows;
  return {data:rows.map(row=>{const {contact_ciphertext:_cipher,contact_hmac:_hmac,...safe}=row;return safe;}),meta:{request_id:uuid()}};
}

export async function updateLead(ctx:ServiceContext,id:string,input:LeadUpdate,expectedVersion:number) {
  if(input.status&&!['new','assigned','contacted','qualified','invalid'].includes(input.status))throw new DomainError('INVALID_STATUS',422,'线索处理状态无效');
  if(input.status==='invalid'&&!['spam','duplicate','no_need','unreachable','out_of_scope','other'].includes(input.invalid_reason ?? ''))throw new DomainError('INVALID_REASON_REQUIRED',422,'无效线索必须记录原因');
  if(input.need!==undefined)bounded(input.need,5,3000,'need'); if(input.note!==undefined)bounded(input.note,0,2000,'note');
  if(input.quality_level==='real_lead')throw new DomainError('QUALIFICATION_WITHDRAWAL_REQUIRES_EVIDENCE',422,'撤回销售确认须专门记录证据');
  if(input.funnel_stage)throw new DomainError('STAGE_TRANSITION_REQUIRED',422,'销售阶段变更须使用带证据的阶段迁移');
  return ctx.db.transaction(async tx=>{
    const lead=await assertLeadRecordAccess(ctx,id,tx); assertVersion(Number(lead.version),expectedVersion);
    if(input.owner_user_id){const member=await tx.query('SELECT m.id FROM memberships m JOIN users u ON u.id=m.user_id WHERE m.org_id=$1 AND m.user_id=$2 AND m.active=true AND u.active=true',[ctx.orgId,input.owner_user_id]);if(!member.rowCount)throw new DomainError('INVALID_OWNER',422,'负责人必须为现有组织成员');}
    const feedback:Record<string,unknown>={...(lead.feedback_json as Record<string,unknown>),...cleanRecord(input.feedback),...(input.note!==undefined?{note:sanitizePrivateText(input.note)}:{})};
    const owner=input.owner_user_id ?? lead.owner_user_id; const need=input.need!==undefined?sanitizePrivateText(input.need):String(lead.need); const qualifying=input.quality_level==='qualified_lead'||input.status==='qualified';
    if(qualifying&&(!lead.company||!need||!owner||!feedback.next_step||!evidence(input.qualification_evidence_ref)))throw new DomainError('QUALIFICATION_EVIDENCE_REQUIRED',422,'销售确认须有企业、需求、负责人、下一步和证据');
    const status=input.status ?? String(lead.status); const time=nowIso(ctx);
    const result=await tx.query('UPDATE leads SET owner_user_id=$3,status=$4,invalid_reason=$5,need=$6,feedback_json=$7,quality_level=$8,qualified_at=$9,qualified_by=$10,qualification_evidence_ref=$11,version=version+1,updated_at=$12 WHERE org_id=$1 AND id=$2 AND version=$13 RETURNING *',[ctx.orgId,id,owner,status,status==='invalid'?input.invalid_reason ?? lead.invalid_reason:null,need,JSON.stringify(feedback),qualifying?'qualified_lead':lead.quality_level,qualifying?time:lead.qualified_at,qualifying?ctx.actorId:lead.qualified_by,qualifying?JSON.stringify(cleanRecord(input.qualification_evidence_ref)):lead.qualification_evidence_ref?JSON.stringify(lead.qualification_evidence_ref):null,time,expectedVersion]);
    if(!result.rowCount)throw new DomainError('VERSION_CONFLICT',409,'线索已被修改，请重新读取');
    await tx.query('INSERT INTO lead_status_events(org_id,lead_id,from_status,to_status,actor_id,reason,occurred_at,from_funnel_stage,to_funnel_stage,evidence_ref,next_step) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$8,$9,$10)',[ctx.orgId,id,lead.status,status,ctx.actorId,qualifying?'sales_qualification':'operator_update',time,lead.funnel_stage,JSON.stringify(cleanRecord(input.qualification_evidence_ref ?? input.transition_evidence_ref ?? {})),String(feedback.next_step ?? '')]);
    await audit(ctx,tx,'lead.updated','lead',id,{from_version:expectedVersion,to_version:expectedVersion+1,status,quality_level:qualifying?'qualified_lead':lead.quality_level});
    const {contact_ciphertext:_cipher,contact_hmac:_hmac,...safe}=result.rows[0]!; return {data:safe,meta:{request_id:uuid()}};
  });
}

export async function transitionLead(ctx:ServiceContext,id:string,input:LeadTransitionCreate,expectedVersion:number,key?:string) {
  const allowed=['CONTACTED','QUALIFIED','OPPORTUNITY','DEMO','PROPOSAL','QUOTED','WON','LOST','NURTURE','REACTIVATED'];
  if(!allowed.includes(input.funnel_stage)||!evidence(input.evidence_ref)||!input.next_step?.trim())throw new DomainError('TRANSITION_EVIDENCE_REQUIRED',422,'阶段迁移须有证据和下一步');
  bounded(input.next_step,1,2000,'next_step'); if(input.opportunity_id)checkUuid(input.opportunity_id,'opportunity_id'); if(key&&(key.length<8||key.length>128))throw new DomainError('INVALID_IDEMPOTENCY_KEY',422,'请求键格式无效');
  return ctx.db.transaction(async tx=>{
    await tx.query('SELECT id FROM organizations WHERE id=$1 FOR UPDATE',[ctx.orgId]);
    const lead=await assertLeadRecordAccess(ctx,id,tx); const hash=stableHash({input,expectedVersion}); if(key){const previous=await existingRequest(tx,ctx,`lead_transition:${id}`,key,hash);if(previous)return previous;}
    assertVersion(Number(lead.version),expectedVersion);
    if(REAL_STAGES.has(input.funnel_stage)&&lead.quality_level!=='qualified_lead')throw new DomainError('SALES_QUALIFICATION_REQUIRED',422,'该阶段须先完成销售有效线索确认');
    let opportunity: Record<string,unknown>|undefined;
    if(input.opportunity_id) { opportunity=(await tx.query('SELECT * FROM opportunities WHERE org_id=$1 AND id=$2 AND lead_id=$3 FOR UPDATE',[ctx.orgId,input.opportunity_id,id])).rows[0]; if(!opportunity)throw new DomainError('INVALID_OPPORTUNITY',422,'商机不属于此线索'); }
    const details=input.opportunity_details ?? {};
    if(details.amount_minor!==undefined)assertSafeInteger(details.amount_minor,'amount_minor');
    for(const [field,max] of [['problem',3000],['product_or_scope',3000],['quote_external_id',200],['quote_scope',3000]] as const)if(details[field]!==undefined)bounded(details[field],1,max,field);
    if(details.quote_date!==undefined&&!/^\d{4}-\d{2}-\d{2}$/.test(details.quote_date))throw new DomainError('INVALID_QUOTE_DATE',422,'报价日期格式无效');
    const values={...opportunity,...details}; const time=nowIso(ctx); const commercialStage=['OPPORTUNITY','DEMO','PROPOSAL','QUOTED','WON'].includes(input.funnel_stage);
    if(commercialStage && (!lead.owner_user_id || !values.problem || !values.product_or_scope || (!opportunity?.sales_accepted_at&&!evidence(details.sales_acceptance_evidence))))throw new DomainError('SALES_ACCEPTANCE_REQUIRED',422,'商机须保存问题、范围、负责人和销售接受依据');
    if(input.funnel_stage==='QUOTED'&&(!values.quote_external_id||!values.quote_date||!values.quote_scope))throw new DomainError('QUOTE_EVIDENCE_REQUIRED',422,'报价须保存实际报价ID、日期与范围');
    if(input.funnel_stage==='WON') {
      if(!evidence(values.contract_or_order_ref)||values.amount_minor===undefined||values.amount_minor===null||typeof values.currency!=='string'||!(/^[A-Z]{3}$/).test(values.currency)||typeof values.won_at!=='string'||!Number.isFinite(Date.parse(values.won_at)))throw new DomainError('CONTRACT_EVIDENCE_REQUIRED',422,'成交须保存合同订单、金额、币种及成交日期');
      assertSafeInteger(Number(values.amount_minor),'amount_minor');
    }
    let opportunityId=input.opportunity_id;
    if(commercialStage) {
      opportunityId??=uuid(); const accepted=opportunity?.sales_accepted_at ?? time;
      const params=[ctx.orgId,opportunityId,id,lead.owner_user_id,input.funnel_stage==='WON'?'won':input.funnel_stage==='PROPOSAL'?'proposal':'open',values.amount_minor ?? null,values.currency ?? null,input.funnel_stage==='WON'?values.won_at:null,JSON.stringify({transition_evidence_ref:cleanRecord(input.evidence_ref),sales_acceptance_evidence:cleanRecord(details.sales_acceptance_evidence ?? {}),confirmed_by:ctx.actorId}),sanitizePrivateText(String(values.problem)),sanitizePrivateText(String(values.product_or_scope)),accepted,sanitizePrivateText(input.next_step),values.quote_external_id ? sanitizePrivateText(String(values.quote_external_id)):null,values.quote_date ?? null,values.quote_scope ? sanitizePrivateText(String(values.quote_scope)):null,values.contract_or_order_ref?JSON.stringify(cleanRecord(values.contract_or_order_ref as Record<string,unknown>)):null,values.won_at ?? null];
      if(opportunity)await tx.query('UPDATE opportunities SET stage=$5,amount_minor=$6,currency=$7,closed_at=$8,source_ref=$9,problem=$10,product_or_scope=$11,sales_accepted_at=$12,next_step=$13,quote_external_id=$14,quote_date=$15,quote_scope=$16,contract_or_order_ref=$17,won_at=$18,updated_at=now() WHERE org_id=$1 AND id=$2 AND lead_id=$3 AND owner_user_id=$4',params);
      else await tx.query('INSERT INTO opportunities(org_id,id,lead_id,owner_user_id,stage,amount_minor,currency,closed_at,source_ref,problem,product_or_scope,sales_accepted_at,next_step,quote_external_id,quote_date,quote_scope,contract_or_order_ref,won_at) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18)',params);
    }
    if(opportunity&&input.funnel_stage==='LOST')await tx.query("UPDATE opportunities SET stage='lost',closed_at=$3,close_reason=$4,next_step=$5,updated_at=$3 WHERE org_id=$1 AND id=$2",[ctx.orgId,opportunity.id,time,sanitizePrivateText(String(input.evidence_ref.reason ?? 'sales_confirmed_loss')),sanitizePrivateText(input.next_step)]);
    const update=await tx.query('UPDATE leads SET funnel_stage=$3,version=version+1,updated_at=$4 WHERE org_id=$1 AND id=$2 AND version=$5 RETURNING version',[ctx.orgId,id,input.funnel_stage,time,expectedVersion]);if(!update.rowCount)throw new DomainError('VERSION_CONFLICT',409,'销售反馈已更新');
    const eventId=uuid(); await tx.query('INSERT INTO lead_status_events(id,org_id,lead_id,from_status,to_status,actor_id,reason,occurred_at,from_funnel_stage,to_funnel_stage,evidence_ref,next_step) VALUES($1,$2,$3,$4,$4,$5,$6,$7,$8,$9,$10,$11)',[eventId,ctx.orgId,id,lead.status,ctx.actorId,'sales_stage_transition',time,lead.funnel_stage,input.funnel_stage,JSON.stringify(cleanRecord(input.evidence_ref)),sanitizePrivateText(input.next_step)]);
    await audit(ctx,tx,'lead.stage.transitioned','lead',id,{event_id:eventId,from:lead.funnel_stage,to:input.funnel_stage,opportunity_id:opportunityId,version:expectedVersion+1,evidence_ref:cleanRecord(input.evidence_ref)});
    const result={data:{id,version:expectedVersion+1,funnel_stage:input.funnel_stage,opportunity_id:opportunityId,event_id:eventId},meta:{request_id:uuid()}}; if(key)await saveRequest(tx,ctx,`lead_transition:${id}`,key,hash,result,eventId);return result;
  });
}
