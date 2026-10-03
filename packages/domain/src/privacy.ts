import { createCipheriv, createDecipheriv, createHash, createHmac, randomBytes } from 'node:crypto';
import type { SqlExecutor } from '@boran/db';
import { audit, assertVersion, DomainError, nowIso, requireRole, stableHash, uuid, type ServiceContext } from './core';

export type ContactChannel = 'phone' | 'wechat' | 'email';
export interface PrivacyConfiguration {
  enabled: boolean;
  approved_by?: string;
  approved_at?: string;
  notice_version: string;
  notice_text: string;
  consultation_purpose: string;
  lawful_basis: string;
  retention_days: number;
  allowed_contact_channels: ContactChannel[];
  pii_access_roles: string[];
  responsible_user_id: string;
  deletion_policy: string;
  export_policy: string;
  cross_border_assessment: 'not_applicable' | 'approved';
}
export interface PrivacyOptions {
  internalTest?: boolean;
  encryptionKey?: string;
  hmacKey?: string;
}
export interface ContactPrivacyUpdate { request_type: 'withdraw' | 'delete' | 'export'; channels?: ContactChannel[]; reason?: string }

const PRIVACY_TEXT_LIMITS = {notice_version:100,notice_text:20000,consultation_purpose:2000,lawful_basis:2000,responsible_user_id:36,deletion_policy:4000,export_policy:4000} as const;
const PRIVACY_FIELDS = new Set(['enabled',...Object.keys(PRIVACY_TEXT_LIMITS),'retention_days','allowed_contact_channels','pii_access_roles','cross_border_assessment']);
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
function privacyShape(input: unknown, persisted = false): PrivacyConfiguration {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new DomainError('INVALID_PRIVACY_CONFIGURATION',422,'隐私配置必须为对象');
  const value = input as Record<string,unknown>;
  if (Object.keys(value).some(key=>!PRIVACY_FIELDS.has(key)&&!(persisted&&['approved_by','approved_at'].includes(key)))) throw new DomainError('INVALID_PRIVACY_CONFIGURATION',422,'隐私配置含未支持字段');
  if (typeof value.enabled !== 'boolean') throw new DomainError('INVALID_PRIVACY_CONFIGURATION',422,'必须明确启用或停用');
  for (const [field,limit] of Object.entries(PRIVACY_TEXT_LIMITS)) {
    const entry=value[field];
    if ((value.enabled||entry!==undefined)&&(typeof entry!=='string'||!entry.trim()||entry.length>limit||/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/.test(entry))) throw new DomainError('INVALID_PRIVACY_CONFIGURATION',422,`隐私配置字段无效: ${field}`);
  }
  if (value.responsible_user_id!==undefined&&!UUID_PATTERN.test(String(value.responsible_user_id))) throw new DomainError('INVALID_PRIVACY_CONFIGURATION',422,'隐私受理人标识无效');
  if ((value.enabled||value.retention_days!==undefined)&&(!Number.isInteger(value.retention_days)||Number(value.retention_days)<1||Number(value.retention_days)>3650)) throw new DomainError('INVALID_PRIVACY_CONFIGURATION',422,'须配置目的所需的保留天数');
  for (const [field,allowed] of [['allowed_contact_channels',['phone','email','wechat']],['pii_access_roles',['owner','marketer','sales']]] as const) {
    const entry=value[field];
    if ((value.enabled||entry!==undefined)&&(!Array.isArray(entry)||entry.length===0||entry.length>3||new Set(entry).size!==entry.length||entry.some(item=>typeof item!=='string'||!(allowed as readonly string[]).includes(item)))) throw new DomainError('INVALID_PRIVACY_CONFIGURATION',422,`隐私配置字段无效: ${field}`);
  }
  if ((value.enabled||value.cross_border_assessment!==undefined)&&!['not_applicable','approved'].includes(String(value.cross_border_assessment))) throw new DomainError('INVALID_PRIVACY_CONFIGURATION',422,'须确认跨境适用情况');
  if (persisted&&value.enabled&&(!UUID_PATTERN.test(String(value.approved_by??''))||typeof value.approved_at!=='string'||!Number.isFinite(Date.parse(value.approved_at)))) throw new DomainError('INVALID_PRIVACY_CONFIGURATION',422,'隐私配置缺少服务器批准记录');
  return Object.fromEntries(Object.entries(value).filter(([key])=>PRIVACY_FIELDS.has(key)||persisted&&['approved_by','approved_at'].includes(key))) as unknown as PrivacyConfiguration;
}

/** Enabling collection is an explicit owner operation; this validator never treats an ops policy as visitor consent. */
export async function validatePrivacyConfiguration(ctx: ServiceContext, input: unknown): Promise<PrivacyConfiguration> {
  requireRole(ctx, 'owner');
  if (!(await effectiveLeadRoles(ctx)).includes('owner')) throw new DomainError('FORBIDDEN',403,'仅负责人能配置个人信息处理');
  const config = { ...privacyShape(input), approved_by: ctx.actorId, approved_at: nowIso(ctx) };
  if (config.enabled) {
    const recipient = await ctx.db.query('SELECT m.id FROM memberships m JOIN users u ON u.id=m.user_id WHERE m.org_id=$1 AND m.user_id=$2 AND m.active=true AND u.active=true', [ctx.orgId, config.responsible_user_id]);
    if (!recipient.rowCount) throw new DomainError('INVALID_PRIVACY_CONFIGURATION', 422, '隐私受理人须为现有组织成员');
  }
  return config;
}

export async function requirePrivacyConfiguration(ctx: ServiceContext, options: PrivacyOptions = {}, executor: SqlExecutor = ctx.db): Promise<PrivacyConfiguration> {
  const row = (await executor.query('SELECT value FROM settings WHERE org_id=$1 AND key=$2', [ctx.orgId, 'privacy_configuration'])).rows[0];
  if (ctx.mode === 'mock' && options.internalTest === true) {
    return { enabled: false, notice_version: 'mock-v1', notice_text: '脱敏验收，仅允许指定测试邮箱，不处理真实联系方式', consultation_purpose: '脱敏验收', lawful_basis: 'synthetic_test_only', retention_days: 1, allowed_contact_channels: ['email'], pii_access_roles: ['owner', 'marketer'], responsible_user_id: ctx.actorId, deletion_policy: 'test deletion', export_policy: 'test export', cross_border_assessment: 'not_applicable' };
  }
  if (ctx.mode !== 'live' || process.env.PRODUCTION_PII_AUTOMATION_ENABLED !== 'true' || !row?.value) throw new DomainError('privacy_configuration_required', 503, '个人信息处理尚未启用');
  let config:PrivacyConfiguration;
  try { config=privacyShape(row.value,true); } catch { throw new DomainError('privacy_configuration_required',503,'个人信息处理配置不完整或批准失效'); }
  if (!config.enabled||!config.approved_by||!config.approved_at) throw new DomainError('privacy_configuration_required',503,'个人信息处理尚未启用');
  // Revalidate persisted approval, including changes to the responsible member and approver roles.
  const approver = await executor.query('SELECT m.roles FROM memberships m JOIN users u ON u.id=m.user_id WHERE m.org_id=$1 AND m.user_id=$2 AND m.active=true AND u.active=true', [ctx.orgId, config.approved_by]);
  const recipient = await executor.query('SELECT m.id FROM memberships m JOIN users u ON u.id=m.user_id WHERE m.org_id=$1 AND m.user_id=$2 AND m.active=true AND u.active=true', [ctx.orgId, config.responsible_user_id]);
  if (!(approver.rows[0]?.roles as string[] | undefined)?.includes('owner')||!recipient.rowCount) throw new DomainError('privacy_configuration_required',503,'个人信息处理配置不完整或批准失效');
  privacyKeys(ctx, options);
  return config;
}

function keyBytes(value: string | undefined, name: string): Buffer {
  if (!value) throw new DomainError('privacy_configuration_required', 503, `加密密钥引用未配置: ${name}`);
  const bytes = /^[a-f0-9]{64}$/i.test(value) ? Buffer.from(value, 'hex') : Buffer.from(value, 'base64');
  if (bytes.length !== 32) throw new DomainError('privacy_configuration_required', 503, `密钥长度无效: ${name}`);
  return bytes;
}
export function privacyKeys(ctx: ServiceContext, options: PrivacyOptions = {}): { encryption: Buffer; hmac: Buffer } {
  const synthetic = ctx.mode === 'mock' && options.internalTest === true;
  return { encryption: keyBytes(options.encryptionKey ?? process.env.PII_ENCRYPTION_KEY ?? (synthetic ? createHash('sha256').update('boran:synthetic-test-encryption:v1').digest('hex') : undefined), 'PII_ENCRYPTION_KEY'), hmac: keyBytes(options.hmacKey ?? process.env.PII_HMAC_KEY ?? (synthetic ? createHash('sha256').update('boran:synthetic-test-hmac:v1').digest('hex') : undefined), 'PII_HMAC_KEY') };
}
export function encryptContact(value: string, key: Buffer): string {
  const nonce = randomBytes(12); const cipher = createCipheriv('aes-256-gcm', key, nonce);
  const encrypted = Buffer.concat([cipher.update(value, 'utf8'), cipher.final()]);
  return `v1:${nonce.toString('base64url')}:${cipher.getAuthTag().toString('base64url')}:${encrypted.toString('base64url')}`;
}
export function decryptContact(ciphertext: string, key: Buffer): string {
  const [version, nonce, tag, payload] = ciphertext.split(':');
  if (version !== 'v1' || !nonce || !tag || !payload) throw new DomainError('INVALID_CIPHERTEXT', 422, '不支持的密文版本');
  const cipher = createDecipheriv('aes-256-gcm', key, Buffer.from(nonce, 'base64url')); cipher.setAuthTag(Buffer.from(tag, 'base64url'));
  return Buffer.concat([cipher.update(Buffer.from(payload, 'base64url')), cipher.final()]).toString('utf8');
}
export function contactHmac(type: string, value: string, key: Buffer): string { return createHmac('sha256', key).update(`${type}:v1:${value}`).digest('hex'); }
export function normalizeContact(type: string, value: string): string {
  if (typeof value !== 'string') throw new DomainError('INVALID_CONTACT', 422, '联系方式格式无效');
  const normalized = value.normalize('NFKC').trim();
  if (type === 'email') {
    if (normalized.length > 320 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalized)) throw new DomainError('INVALID_CONTACT', 422, '邮箱格式无效');
    return normalized.toLowerCase();
  }
  if (type === 'phone' || type === 'inbound_call') {
    const phone = normalized.replace(/[\s()-]/g, '');
    if (!/^\+?[0-9]{6,15}$/.test(phone)) throw new DomainError('INVALID_CONTACT', 422, '电话格式无效');
    return phone.replace(/^\+?86(?=1[3-9][0-9]{9}$)/, '');
  }
  if (type === 'wechat' && /^[a-zA-Z][a-zA-Z0-9_-]{2,99}$/.test(normalized)) return normalized;
  throw new DomainError('INVALID_CONTACT', 422, '联系方式类型或格式无效');
}
/** Boundary redaction applies even if a connector labels its own input sanitized. */
export function sanitizePrivateText(value: string): string {
  const normalized=String(value).normalize('NFKC');
  if(UUID_PATTERN.test(normalized))return normalized;
  return normalized
    .replace(/[A-Z0-9.!#$%&'*+/=?^_`{|}~-]+@[A-Z0-9-]+(?:\.[A-Z0-9-]+)+/gi, '[邮箱已脱敏]')
    .replace(/(?:\+?86[-\s]?)?1[3-9](?:[-\s]?\d){9}(?!\d)/g, '[电话已脱敏]')
    .replace(/(?:\+\d{1,3}[-\s]?)?(?:\d[-\s]){5,}\d|(?<!\d)\d{7,15}(?!\d)/g, '[联系方式已脱敏]')
    .replace(/((?:微信|wechat|weixin|电话|手机号|邮箱)\s*[:：=]\s*)[^\s,，;；]+/gi, '$1[联系方式已脱敏]');
}
export function redactPrivateObject(value: Record<string,unknown>): Record<string,unknown> {
  return JSON.parse(JSON.stringify(value, (key,item:unknown)=>/^(?:password|token|secret|api_key|access_token|refresh_token|authorization|client_secret|contact_ciphertext|normalized_contact_hmac|contact_value)$/i.test(key)?'[已脱敏]':typeof item==='string'?sanitizePrivateText(item):item)) as Record<string,unknown>;
}
const ATTRIBUTION_FIELDS = new Set(['utm_source','utm_medium','utm_campaign','utm_content','utm_term','click_id','referrer_origin','session_id','anonymous_id','query','conversation_external_id','campaign_external_id','unit_external_id','keyword_external_id','content_item_id','publish_job_id']);
export function sanitizeAttribution(value: unknown): Record<string, string> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  const result: Record<string, string> = {};
  for (const [key, item] of Object.entries(value)) {
    if (!ATTRIBUTION_FIELDS.has(key) || typeof item !== 'string') continue;
    const max = key === 'query' ? 2000 : key === 'referrer_origin' ? 1000 : key === 'click_id' ? 512 : 200;
    if (item.length > max) throw new DomainError('INVALID_ATTRIBUTION', 422, '来源字段超过长度限制');
    if (key === 'referrer_origin') {
      try { const url = new URL(item); if (['https:','http:'].includes(url.protocol)) result[key] = url.origin; } catch { /* unknown origin stays unknown */ }
    } else result[key] = sanitizePrivateText(item);
  }
  return result;
}

export async function effectiveLeadRoles(ctx: ServiceContext, tx: SqlExecutor = ctx.db): Promise<string[]> {
  const member = (await tx.query('SELECT m.roles FROM memberships m JOIN users u ON u.id=m.user_id WHERE m.org_id=$1 AND m.user_id=$2 AND m.active=true AND u.active=true', [ctx.orgId, ctx.actorId])).rows[0];
  if (!member) throw new DomainError('FORBIDDEN', 403, '组织访问未授权');
  return member.roles as string[];
}
export async function assertLeadRecordAccess(ctx: ServiceContext, leadId: string, tx: SqlExecutor = ctx.db): Promise<Record<string, unknown>> {
  const roles = await effectiveLeadRoles(ctx, tx);
  const row = (await tx.query('SELECT * FROM leads WHERE org_id=$1 AND id=$2', [ctx.orgId, leadId])).rows[0];
  if (!row || (!roles.some(x => ['owner', 'marketer'].includes(x)) && !(roles.includes('sales') && row.owner_user_id === ctx.actorId))) throw new DomainError('FORBIDDEN', 403, '无权访问此线索');
  return row;
}
export async function assertContactAccess(ctx: ServiceContext, contactId: string, tx: SqlExecutor = ctx.db): Promise<Record<string, unknown>> {
  const roles = await effectiveLeadRoles(ctx, tx);
  const row = (await tx.query('SELECT * FROM lead_contacts WHERE org_id=$1 AND id=$2', [ctx.orgId, contactId])).rows[0];
  let canAccess = roles.some(x => ['owner','marketer'].includes(x));
  if (!canAccess && roles.includes('sales')) canAccess = (await tx.query('SELECT id FROM leads WHERE org_id=$1 AND contact_id=$2 AND owner_user_id=$3', [ctx.orgId, contactId, ctx.actorId])).rowCount > 0;
  if (!row || !canAccess) throw new DomainError('FORBIDDEN', 403, '无权访问此联系人');
  return row;
}

export async function privacyRequest(ctx: ServiceContext, contactId: string, input: ContactPrivacyUpdate, expectedVersion: number, key: string) {
  if (!['withdraw','delete','export'].includes(input.request_type) || key.length < 8 || key.length > 128 || (input.reason?.length ?? 0) > 2000 || input.channels?.some(x => !['phone','email','wechat'].includes(x))) throw new DomainError('INVALID_PRIVACY_REQUEST', 422, '隐私请求格式无效');
  return ctx.db.transaction(async tx => {
    await tx.query('SELECT id FROM organizations WHERE id=$1 FOR UPDATE', [ctx.orgId]);
    const contact = await assertContactAccess(ctx, contactId, tx);
    const scope = `contact_privacy:${contactId}`; const hash = stableHash({ input, expectedVersion });
    const previous = (await tx.query('SELECT request_hash,response_json FROM idempotency_records WHERE org_id=$1 AND scope=$2 AND key=$3', [ctx.orgId,scope,key])).rows[0];
    if (previous) { if (previous.request_hash !== hash) throw new DomainError('IDEMPOTENCY_CONFLICT',409,'同一请求键不能用于不同请求'); return previous.response_json; }
    assertVersion(Number(contact.version),expectedVersion);
    const requestId = uuid(); const time = nowIso(ctx);
    const statusField = input.request_type === 'withdraw' ? 'withdrawal_status' : input.request_type === 'delete' ? 'deletion_status' : 'export_status';
    const contactResult = await tx.query(`UPDATE lead_contacts SET ${statusField}='requested',marketing_consent_status=CASE WHEN $3 THEN 'withdrawn' ELSE marketing_consent_status END,consultation_processing_permission=CASE WHEN $3 THEN 'withdrawn' ELSE consultation_processing_permission END,consent_status=CASE WHEN $3 THEN 'withdrawn' ELSE consent_status END,allowed_contact_channels=CASE WHEN $3 THEN '{}'::text[] ELSE allowed_contact_channels END,version=version+1,updated_at=$4 WHERE org_id=$1 AND id=$2 AND version=$5 RETURNING version`, [ctx.orgId,contactId,input.request_type !== 'export',time,expectedVersion]);
    if (!contactResult.rowCount) throw new DomainError('VERSION_CONFLICT',409,'联系人已被修改');
    if (input.request_type !== 'export') {
      await tx.query("UPDATE tasks SET status='cancelled',version=version+1,updated_at=$3 WHERE org_id=$1 AND status IN ('todo','doing','blocked') AND (brief->>'contact_id'=$2 OR brief->>'lead_id' IN (SELECT id::text FROM leads WHERE org_id=$1 AND contact_id=$2::uuid))", [ctx.orgId,contactId,time]);
      await tx.query("UPDATE reception_conversations SET state='blocked',version=version+1,updated_at=$3 WHERE org_id=$1 AND contact_id=$2",[ctx.orgId,contactId,time]);
      await tx.query("UPDATE outbox_events SET dispatched_at=$3 WHERE org_id=$1 AND dispatched_at IS NULL AND event_type IN ('reception.silent_followup','contact.marketing','contact.crm_sync','contact.auto_assign') AND (payload->>'contact_id'=$2 OR aggregate_id IN (SELECT id FROM reception_conversations WHERE org_id=$1 AND contact_id=$2::uuid))",[ctx.orgId,contactId,time]);
      await tx.query("UPDATE execution_actions SET state='cancelled',version=version+1,updated_at=$3 WHERE org_id=$1 AND action_type='reception.reply' AND state IN ('queued','blocked','retry_wait') AND target->>'conversation_id' IN (SELECT id::text FROM reception_conversations WHERE org_id=$1 AND contact_id=$2::uuid)",[ctx.orgId,contactId,time]);
    }
    await tx.query("INSERT INTO workflow_runs(id,org_id,kind,period_key,schedule_version,status,input_ref) VALUES($1::uuid,$2,'privacy_request',$1::text,1,'queued',$3)",[requestId,ctx.orgId,JSON.stringify({request_id:requestId,contact_id:contactId,request_type:input.request_type,channels:input.channels ?? [],reason:sanitizePrivateText(input.reason ?? ''),contact_version:Number(contactResult.rows[0]!.version)})]);
    await audit(ctx,tx,`contact.${input.request_type}.requested`,'contact',contactId,{request_id:requestId,channels:input.channels ?? [],version:contactResult.rows[0]!.version});
    const result = {data:{id:requestId,request_id:requestId,status:'queued',contact_version:Number(contactResult.rows[0]!.version)},meta:{request_id:requestId}};
    await tx.query('INSERT INTO idempotency_records(org_id,scope,key,request_hash,status_code,response_json,resource_id,expires_at) VALUES($1,$2,$3,$4,202,$5,$6,$7)',[ctx.orgId,scope,key,hash,JSON.stringify(result),requestId,new Date(new Date(time).getTime()+7*86400000).toISOString()]);
    return result;
  });
}

export interface PrivacyDownstreamAdapter { process(request: {request_id:string;contact_id:string;request_type:string}): Promise<{verified:boolean; evidence_ref:Record<string,unknown>}> }
/** Completes a request only after downstream receipts; every request retains its own workflow and append audit. */
export async function completePrivacyRequest(ctx: ServiceContext, requestId: string, adapter: PrivacyDownstreamAdapter) {
  requireRole(ctx,'owner','marketer');
  const run = (await ctx.db.query("SELECT * FROM workflow_runs WHERE org_id=$1 AND id=$2 AND kind='privacy_request'",[ctx.orgId,requestId])).rows[0];
  if (!run) throw new DomainError('NOT_FOUND',404,'隐私请求不存在');
  if (run.status === 'succeeded') return run.output_ref;
  const input = run.input_ref as {request_id:string;contact_id:string;request_type:string;contact_version:number};
  await assertContactAccess(ctx,input.contact_id);
  let receipt: Awaited<ReturnType<PrivacyDownstreamAdapter['process']>>;
  try { receipt = await adapter.process(input); } catch { throw new DomainError('PRIVACY_DOWNSTREAM_UNAVAILABLE',503,'下游处理未核验，请重试'); }
  if (!receipt.verified || !Object.keys(receipt.evidence_ref ?? {}).length) throw new DomainError('PRIVACY_VERIFICATION_REQUIRED',409,'下游处理回执缺失');
  return ctx.db.transaction(async tx => {
    const contact = await assertContactAccess(ctx,input.contact_id,tx);
    const current = (await tx.query('SELECT status FROM workflow_runs WHERE org_id=$1 AND id=$2 FOR UPDATE',[ctx.orgId,requestId])).rows[0];
    if (current?.status === 'succeeded') return (await tx.query('SELECT output_ref FROM workflow_runs WHERE org_id=$1 AND id=$2',[ctx.orgId,requestId])).rows[0]?.output_ref;
    // An older export receipt cannot overwrite a newer delete/withdraw request's state.
    const newerSameType = (await tx.query("SELECT id FROM workflow_runs WHERE org_id=$1 AND kind='privacy_request' AND input_ref->>'contact_id'=$2 AND input_ref->>'request_type'=$3 AND created_at>$4",[ctx.orgId,input.contact_id,input.request_type,run.created_at])).rowCount > 0;
    if (!newerSameType || input.request_type === 'delete') {
      const field = input.request_type === 'withdraw' ? 'withdrawal_status' : input.request_type === 'delete' ? 'deletion_status' : 'export_status';
      const status = input.request_type === 'delete' ? 'deleted' : 'completed';
      await tx.query(`UPDATE lead_contacts SET ${field}=$3,contact_ciphertext=CASE WHEN $4 THEN '[deleted]' ELSE contact_ciphertext END,company=CASE WHEN $4 THEN NULL ELSE company END,version=version+1,updated_at=$5 WHERE org_id=$1 AND id=$2`,[ctx.orgId,input.contact_id,status,input.request_type === 'delete',nowIso(ctx)]);
    }
    const output = {request_id:requestId,verified:true,evidence_ref:redactPrivateObject(receipt.evidence_ref),synthetic:ctx.mode==='mock'};
    await tx.query("UPDATE workflow_runs SET status='succeeded',output_ref=$3,finished_at=$4,updated_at=$4 WHERE org_id=$1 AND id=$2",[ctx.orgId,requestId,JSON.stringify(output),nowIso(ctx)]);
    await audit(ctx,tx,`contact.${input.request_type}.verified`,'contact',input.contact_id,{request_id:requestId,evidence_ref:redactPrivateObject(receipt.evidence_ref),synthetic:ctx.mode==='mock'});
    return output;
  });
}
