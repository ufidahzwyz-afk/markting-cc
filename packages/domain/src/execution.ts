import type { SqlExecutor } from "@boran/db";
import { DomainError, assertSafeInteger, assertVersion, audit, emitOutbox, nowIso, stableHash, uuid, type ServiceContext } from "./core";
import { assertOrgReference, requireActiveRole, requireOwner } from "./authz";

export type ActionType = "content.publish" | "content.unpublish" | "ads.update" | "ads.pause" | "external.publish" | "reception.reply";
export interface ExecutionInput {
  idempotencyKey: string;
  actionType: ActionType;
  target: Record<string, unknown>;
  payload: Record<string, unknown>;
  beforeSnapshot: Record<string, unknown>;
  policyVersionId?: string;
  approvalId?: string;
  versionId?: string;
  budgetImpactMinor?: number;
}
export interface PolicyInput {
  name: string;
  businessScope: Record<string, unknown>;
  accountIds: string[];
  allowedActions: ActionType[];
  dailyBudgetMinor?: number;
  totalBudgetMinor?: number;
  maxBidChangePct?: number;
  currency?: string;
  publishFrequency?: Record<string, unknown>;
  publishWindows?: unknown[];
  stopConditions: Record<string, unknown>;
  validFrom?: string;
  validUntil?: string;
  allowedAdOperations?: string[];
  allowedAdEntityLevels?: string[];
  approvedPathPrefixes?: string[];
  receptionScope?: Record<string, unknown>;
}
export interface ActionClaim { action: Record<string, unknown>; token: string; workerId: string }
const actionTypes: ActionType[] = ["content.publish", "content.unpublish", "ads.update", "ads.pause", "external.publish", "reception.reply"];
const asObject = (value: unknown): Record<string, unknown> => value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
const asStrings = (value: unknown): string[] => Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];

function validateActionInput(input: ExecutionInput): void {
  if (!actionTypes.includes(input.actionType) || !input.idempotencyKey || input.idempotencyKey.length > 128) throw new DomainError("INVALID_ACTION", 422, "动作类型或幂等键无效");
  if (Boolean(input.policyVersionId) === Boolean(input.approvalId)) throw new DomainError("AUTHORIZATION_REQUIRED", 422, "必须指定且仅指定一种授权来源");
  if (input.budgetImpactMinor !== undefined) assertSafeInteger(input.budgetImpactMinor, "budgetImpactMinor");
  if (input.actionType.startsWith("content.")) { if (typeof input.target.page_id !== "string" || !input.versionId) throw new DomainError("INVALID_TARGET", 422, "页面动作必须绑定页面与内容版本"); }
  else if (input.actionType === "reception.reply") { if (typeof input.target.connection_id !== "string" || typeof input.target.conversation_id !== "string") throw new DomainError("INVALID_TARGET", 422, "回复动作必须绑定连接与会话"); }
  else if (typeof input.target.platform_account_id !== "string" && typeof input.target.account_id !== "string") throw new DomainError("INVALID_TARGET", 422, "动作必须绑定具体平台账号");
}

async function validateTarget(ctx: ServiceContext, tx: SqlExecutor, target: Record<string, unknown>, versionId: unknown): Promise<void> {
  for (const [field, table] of [["page_id", "pages"], ["platform_account_id", "platform_accounts"], ["account_id", "platform_accounts"], ["connection_id", "connections"], ["conversation_id", "reception_conversations"], ["content_variant_id", "content_variants"], ["topic_id", "topics"]]) if (typeof target[field!] === "string") await assertOrgReference(ctx, tx, table!, target[field!] as string);
  if (typeof versionId === "string") await assertOrgReference(ctx, tx, "content_versions", versionId);
  if(target.account_id&&target.platform_account_id&&target.account_id!==target.platform_account_id)throw new DomainError("INVALID_TARGET",422,"账号引用不一致");
  const accountId=target.platform_account_id??target.account_id;
  if(accountId&&target.connection_id){const account=(await tx.query("SELECT connection_id FROM platform_accounts WHERE org_id=$1 AND id=$2",[ctx.orgId,accountId])).rows[0];if(account?.connection_id!==target.connection_id)throw new DomainError("INVALID_TARGET",422,"连接与平台账号不匹配");}
  if(target.conversation_id&&target.connection_id){const conversation=(await tx.query("SELECT connection_id FROM reception_conversations WHERE org_id=$1 AND id=$2",[ctx.orgId,target.conversation_id])).rows[0];if(conversation?.connection_id!==target.connection_id)throw new DomainError("INVALID_TARGET",422,"连接与会话不匹配");}
  if(target.content_variant_id){const variant=(await tx.query("SELECT platform_account_id,content_version_id FROM content_variants WHERE org_id=$1 AND id=$2",[ctx.orgId,target.content_variant_id])).rows[0];if(!variant||accountId&&variant.platform_account_id!==accountId||versionId&&variant.content_version_id!==versionId)throw new DomainError("INVALID_TARGET",422,"平台变体与账号或内容版本不匹配");}
  if(target.page_id&&versionId){const page=(await tx.query("SELECT p.content_item_id,v.content_item_id AS version_item_id FROM pages p CROSS JOIN content_versions v WHERE p.org_id=$1 AND p.id=$2 AND v.org_id=$1 AND v.id=$3",[ctx.orgId,target.page_id,versionId])).rows[0];if(page?.content_item_id&&page.content_item_id!==page.version_item_id)throw new DomainError("INVALID_TARGET",422,"页面与内容版本不属于同一内容");}
}

export async function createPolicy(ctx: ServiceContext, input: PolicyInput): Promise<Record<string, unknown>> {
  return ctx.db.transaction(async (tx) => {
    await requireOwner(ctx, tx);
    if (!input.name.trim() || !input.allowedActions.length || input.allowedActions.some((type) => !actionTypes.includes(type)) || !Object.keys(input.businessScope).length || !Object.keys(input.stopConditions).length) throw new DomainError("INVALID_POLICY", 422, "规则必须明确业务范围、动作与停止条件");
    for (const amount of [input.dailyBudgetMinor, input.totalBudgetMinor]) if (amount !== undefined) assertSafeInteger(amount);
    if (input.allowedActions.some((type) => type.startsWith("ads.")) && (input.dailyBudgetMinor === undefined || input.totalBudgetMinor === undefined)) throw new DomainError("INVALID_POLICY", 422, "广告规则必须明确日预算与总预算");
    for (const id of input.accountIds) await assertOrgReference(ctx, tx, "platform_accounts", id);
    const policyId = uuid(), versionId = uuid();
    await tx.query("INSERT INTO execution_policies(id,org_id,name,status,version,created_by) VALUES ($1,$2,$3,'draft',1,$4)", [policyId, ctx.orgId, input.name, ctx.actorId]);
    await tx.query(`INSERT INTO policy_versions(id,org_id,policy_id,version_no,business_scope,account_ids,allowed_actions,currency,daily_budget_minor,total_budget_minor,max_bid_change_pct,publish_frequency,publish_windows,stop_conditions,valid_from,valid_until,payload_hash,created_by,allowed_ad_operations,allowed_ad_entity_levels,approved_path_prefixes,reception_scope) VALUES ($1,$2,$3,1,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21)`, [versionId,ctx.orgId,policyId,JSON.stringify(input.businessScope),input.accountIds,input.allowedActions,input.currency??"CNY",input.dailyBudgetMinor??null,input.totalBudgetMinor??null,input.maxBidChangePct??null,JSON.stringify(input.publishFrequency??{}),JSON.stringify(input.publishWindows??[]),JSON.stringify(input.stopConditions),input.validFrom??nowIso(ctx),input.validUntil??null,stableHash(input),ctx.actorId,input.allowedAdOperations??[],input.allowedAdEntityLevels??[],input.approvedPathPrefixes??[],JSON.stringify(input.receptionScope??{})]);
    await audit(ctx, tx, "policy.created", "execution_policy", policyId, { versionId });
    return (await tx.query("SELECT * FROM execution_policies WHERE org_id=$1 AND id=$2", [ctx.orgId,policyId])).rows[0]!;
  });
}
export async function activatePolicy(ctx: ServiceContext, policyId: string, policyVersionId: string, expectedVersion: number): Promise<Record<string, unknown>> {
  return ctx.db.transaction(async (tx) => {
    await requireOwner(ctx, tx);
    const policy = (await tx.query("SELECT * FROM execution_policies WHERE org_id=$1 AND id=$2 FOR UPDATE", [ctx.orgId,policyId])).rows[0];
    if (!policy) throw new DomainError("NOT_FOUND",404,"规则不存在");
    assertVersion(Number(policy.version),expectedVersion);
    const version = (await tx.query("SELECT * FROM policy_versions WHERE org_id=$1 AND id=$2 AND policy_id=$3 FOR UPDATE", [ctx.orgId,policyVersionId,policyId])).rows[0];
    if (!version || !asStrings(version.allowed_actions).length || !Object.keys(asObject(version.business_scope)).length || !Object.keys(asObject(version.stop_conditions)).length) throw new DomainError("INVALID_POLICY",422,"规则范围不完整");
    if (version.approved_by && version.approved_by !== ctx.actorId) { /* Existing owner approval remains immutable. */ }
    else if (!version.approved_by) await tx.query("UPDATE policy_versions SET approved_by=$1,approved_at=$2 WHERE org_id=$3 AND id=$4", [ctx.actorId,nowIso(ctx),ctx.orgId,policyVersionId]);
    const result = (await tx.query("UPDATE execution_policies SET status='active',active_version_id=$1,version=version+1,updated_at=$2,revoked_at=NULL WHERE org_id=$3 AND id=$4 RETURNING *", [policyVersionId,nowIso(ctx),ctx.orgId,policyId])).rows[0]!;
    await audit(ctx,tx,"policy.activated","execution_policy",policyId,{policyVersionId}); return result;
  });
}
export async function revokePolicy(ctx: ServiceContext, policyId: string, expectedVersion: number): Promise<void> {
  await ctx.db.transaction(async (tx) => {
    await requireOwner(ctx,tx);
    const row = (await tx.query("SELECT version FROM execution_policies WHERE org_id=$1 AND id=$2 FOR UPDATE", [ctx.orgId,policyId])).rows[0];
    if (!row) throw new DomainError("NOT_FOUND",404,"规则不存在"); assertVersion(Number(row.version),expectedVersion);
    await tx.query("UPDATE execution_policies SET status='revoked',revoked_at=$1,version=version+1,updated_at=$1 WHERE org_id=$2 AND id=$3", [nowIso(ctx),ctx.orgId,policyId]);
    await tx.query("UPDATE execution_actions SET state='blocked',last_error=$1,version=version+1 WHERE org_id=$2 AND policy_version_id IN (SELECT id FROM policy_versions WHERE org_id=$2 AND policy_id=$3) AND state IN ('queued','retry_wait')", [JSON.stringify({code:"POLICY_REVOKED"}),ctx.orgId,policyId]);
    await audit(ctx,tx,"policy.revoked","execution_policy",policyId);
  });
}

async function assertPublishWindow(ctx: ServiceContext, tx: SqlExecutor, policy: Record<string, unknown>, accountId: unknown): Promise<void> {
  const account=(await tx.query("SELECT timezone FROM platform_accounts WHERE org_id=$1 AND id=$2 FOR UPDATE",[ctx.orgId,accountId])).rows[0];
  const timezone=String(account?.timezone??"");
  let weekday:number,minute:number;
  try {
    const parts=new Intl.DateTimeFormat("en-US",{timeZone:timezone,weekday:"short",hour:"2-digit",minute:"2-digit",hourCycle:"h23"}).formatToParts(new Date(nowIso(ctx)));
    const part=(type:string)=>parts.find(item=>item.type===type)?.value??"";
    weekday=["Sun","Mon","Tue","Wed","Thu","Fri","Sat"].indexOf(part("weekday"));
    minute=Number(part("hour"))*60+Number(part("minute"));
  } catch { throw new DomainError("PUBLISH_WINDOW_CLOSED",409,"当前账号本地时间不在批准的发布窗口内"); }
  const parseTime=(value:unknown,end=false):number=>{
    if(typeof value!=="string"||!/^\d{2}:\d{2}$/.test(value))return -1;
    const hour=Number(value.slice(0,2)),minutes=Number(value.slice(3));
    return minutes<60&&(hour<24||end&&hour===24&&minutes===0)?hour*60+minutes:-1;
  };
  const permitted=Array.isArray(policy.publish_windows)&&policy.publish_windows.some(value=>{
    const window=asObject(value),days=window.days??window.weekdays;
    if(!Array.isArray(days)||!days.length||days.some(day=>!Number.isInteger(day)||Number(day)<0||Number(day)>6))return false;
    for(const field of ["platform_account_id","account_id"])if(window[field]!==undefined&&window[field]!==accountId)return false;
    for(const field of ["platform_account_ids","account_ids"])if(window[field]!==undefined&&(!Array.isArray(window[field])||!asStrings(window[field]).includes(String(accountId))))return false;
    if(window.timezone!==undefined&&window.timezone!==timezone)return false;
    const start=parseTime(window.start??window.start_time),end=parseTime(window.end??window.end_time,true);
    if(start<0||end<0||start===end)return false;
    if(start<end)return days.includes(weekday)&&minute>=start&&minute<end;
    // An overnight window belongs to the weekday on which it starts.
    return days.includes(weekday)&&minute>=start||days.includes((weekday+6)%7)&&minute<end;
  });
  if(!permitted)throw new DomainError("PUBLISH_WINDOW_CLOSED",409,"当前账号本地时间不在批准的发布窗口内");
}

export async function assertExecutionAuthorized(ctx: ServiceContext, tx: SqlExecutor, action: Record<string, unknown>, options: {phase?:"plan"|"execute"}={}): Promise<Record<string, unknown> | null> {
  if (action.org_id !== ctx.orgId) throw new DomainError("NOT_FOUND",404,"动作不存在");
  const target=asObject(action.target),payload=asObject(action.payload);
  await validateTarget(ctx,tx,target,action.version_id);
  if (stableHash(payload) !== action.payload_hash) throw new DomainError("PAYLOAD_CHANGED",409,"动作载荷摘要不一致");
  if (action.approval_id) {
    const approval=(await tx.query("SELECT * FROM approvals WHERE org_id=$1 AND id=$2 FOR UPDATE",[ctx.orgId,action.approval_id])).rows[0];
    if (!approval || !["approved","consumed"].includes(String(approval.decision)) || String(approval.expires_at) && new Date(String(approval.expires_at)).getTime()<=Date.parse(nowIso(ctx)) || approval.payload_hash!==action.payload_hash || stableHash(approval.target)!==stableHash(target) || approval.action_type!==action.action_type || approval.version_id!==action.version_id) throw new DomainError("APPROVAL_INVALID",409,"单次授权已失效或载荷不匹配");
    if (!(await tx.query("SELECT m.id FROM memberships m JOIN users u ON u.id=m.user_id WHERE m.org_id=$1 AND m.user_id=$2 AND m.active AND u.active AND 'owner'=ANY(m.roles)",[ctx.orgId,approval.decided_by])).rows.length) throw new DomainError("APPROVAL_INVALID",409,"批准人不再拥有有效组织权限");
    if(target.page_id){const page=(await tx.query("SELECT version,published_release_id FROM pages WHERE org_id=$1 AND id=$2",[ctx.orgId,target.page_id])).rows[0];if(!page||stableHash({version:page.version,published_release_id:page.published_release_id})!==stableHash(approval.before_snapshot))throw new DomainError("RESOURCE_CHANGED",409,"单次授权的页面版本已改变");}
    return null;
  }
  const policy=(await tx.query("SELECT v.*,p.status AS policy_status,p.active_version_id FROM policy_versions v JOIN execution_policies p ON p.org_id=v.org_id AND p.id=v.policy_id WHERE v.org_id=$1 AND v.id=$2 FOR UPDATE OF p,v",[ctx.orgId,action.policy_version_id])).rows[0];
  const now=Date.parse(nowIso(ctx));
  if (!policy || policy.policy_status!=="active" || policy.active_version_id!==policy.id || !policy.approved_by || Date.parse(String(policy.valid_from))>now || (policy.valid_until && Date.parse(String(policy.valid_until))<=now)) throw new DomainError("POLICY_INACTIVE",409,"规则已撤销、替换或超出有效期");
  if (!(await tx.query("SELECT m.id FROM memberships m JOIN users u ON u.id=m.user_id WHERE m.org_id=$1 AND m.user_id=$2 AND m.active AND u.active AND 'owner'=ANY(m.roles)",[ctx.orgId,policy.approved_by])).rows.length) throw new DomainError("POLICY_INACTIVE",409,"规则批准人不再拥有有效组织权限");
  if (!asStrings(policy.allowed_actions).includes(String(action.action_type))) throw new DomainError("OUT_OF_SCOPE",409,"动作超出授权白名单");
  const accountId=target.platform_account_id??target.account_id;
  if (accountId && !asStrings(policy.account_ids).includes(String(accountId))) throw new DomainError("OUT_OF_SCOPE",409,"账号超出授权白名单");
  if(action.action_type==="external.publish"&&options.phase!=="plan")await assertPublishWindow(ctx,tx,policy,accountId);
  const scope=asObject(policy.business_scope),scopeTarget={...target};
  if(action.version_id){const content=(await tx.query("SELECT i.business_line,i.topic_id,t.product_family_key FROM content_versions v JOIN content_items i ON i.org_id=v.org_id AND i.id=v.content_item_id LEFT JOIN topics t ON t.org_id=i.org_id AND t.id=i.topic_id WHERE v.org_id=$1 AND v.id=$2",[ctx.orgId,action.version_id])).rows[0];if(content){scopeTarget.business_line=content.business_line;if(content.topic_id)scopeTarget.topic_id=content.topic_id;if(content.product_family_key)scopeTarget.product_family_key=content.product_family_key;}}
  if(target.page_id){const page=(await tx.query("SELECT business_line FROM pages WHERE org_id=$1 AND id=$2",[ctx.orgId,target.page_id])).rows[0];if(page)scopeTarget.business_line=page.business_line;}
  for (const [field,listField] of [["business_line","business_lines"],["topic_id","topic_ids"],["product_family_key","product_family_keys"]]) { const permitted=asStrings(scope[listField!]); if (permitted.length && (!scopeTarget[field!] || !permitted.includes(String(scopeTarget[field!])))) throw new DomainError("OUT_OF_SCOPE",409,"业务范围与授权不一致"); }
  if (String(action.action_type).startsWith("content.")) {
    const page=(await tx.query("SELECT path FROM pages WHERE org_id=$1 AND id=$2",[ctx.orgId,target.page_id])).rows[0];
    if (!page || !asStrings(policy.approved_path_prefixes).some((prefix)=>String(page.path)===prefix || String(page.path).startsWith(prefix.endsWith("/")?prefix:`${prefix}/`))) throw new DomainError("OUT_OF_SCOPE",409,"页面路径未经授权");
  }
  if (String(action.action_type).startsWith("ads.")) {
    const operation=String(payload.operation??""),level=String(payload.entity_level??target.entity_level??"");
    if (!asStrings(policy.allowed_ad_operations).includes(operation) || !asStrings(policy.allowed_ad_entity_levels).includes(level) || action.action_type==="ads.pause" && operation!=="pause") throw new DomainError("OUT_OF_SCOPE",409,"广告操作与对象级别未经授权");
  }
  if (action.action_type==="reception.reply") {
    const reception=asObject(policy.reception_scope);
    if (!asStrings(reception.connection_ids).includes(String(target.connection_id))) throw new DomainError("OUT_OF_SCOPE",409,"接待连接未经授权");
  }
  const stops=asObject(policy.stop_conditions);
  if(!Object.keys(stops).length)throw new DomainError("STOP_CONDITIONS_REQUIRED",409,"规则停止条件缺失");
  if(typeof stops.max_errors==="number"){const failures=Number((await tx.query("SELECT count(*) AS n FROM action_attempts a JOIN execution_actions e ON e.org_id=a.org_id AND e.id=a.action_id WHERE e.org_id=$1 AND e.policy_version_id=$2 AND a.result='failure' AND a.phase='submit'",[ctx.orgId,policy.id])).rows[0]!.n);if(failures>=stops.max_errors)throw new DomainError("STOP_CONDITION_MET",409,"规则错误停止条件已触发");}
  return policy;
}

async function reserveLimits(ctx: ServiceContext, tx: SqlExecutor, policy: Record<string, unknown> | null, input: ExecutionInput): Promise<Record<string, unknown>> {
  const amount=input.budgetImpactMinor??0;
  const accountId=input.target.platform_account_id??input.target.account_id;
  const snapshot:Record<string,unknown>={reserved_minor:amount,currency:policy?.currency??"CNY",reserved_at:nowIso(ctx),platform_account_id:accountId??null};
  if (!policy) return snapshot;
  const reservations=(await tx.query("SELECT COALESCE(sum((budget_snapshot->>'reserved_minor')::bigint),0)::text AS total, COALESCE(sum(CASE WHEN (created_at AT TIME ZONE 'Asia/Shanghai')::date=($3::timestamptz AT TIME ZONE 'Asia/Shanghai')::date THEN (budget_snapshot->>'reserved_minor')::bigint ELSE 0 END),0)::text AS daily FROM execution_actions WHERE org_id=$1 AND policy_version_id=$2 AND state NOT IN ('failed','cancelled')",[ctx.orgId,policy.id,nowIso(ctx)])).rows[0]!;
  if (input.actionType.startsWith("ads.")) {
    if (policy.daily_budget_minor===null || policy.total_budget_minor===null) throw new DomainError("BUDGET_REQUIRED",409,"广告规则未配置完整预算");
    if (BigInt(String(reservations.daily))+BigInt(amount)>BigInt(String(policy.daily_budget_minor)) || BigInt(String(reservations.total))+BigInt(amount)>BigInt(String(policy.total_budget_minor))) throw new DomainError("BUDGET_EXCEEDED",409,"并发预留超过规则预算");
  }
  if (input.actionType==="external.publish" && accountId) {
    const frequency=asObject(policy.publish_frequency),limit=asObject(frequency[String(accountId)]??frequency);
    const rows=(await tx.query("SELECT created_at FROM execution_actions WHERE org_id=$1 AND policy_version_id=$2 AND action_type='external.publish' AND COALESCE(target->>'platform_account_id',target->>'account_id')=$3 AND state NOT IN ('failed','cancelled') ORDER BY created_at DESC",[ctx.orgId,policy.id,String(accountId)])).rows;
    const account=(await tx.query("SELECT timezone FROM platform_accounts WHERE org_id=$1 AND id=$2",[ctx.orgId,accountId])).rows[0]!;
    const timezone=String(account.timezone),now=Date.parse(nowIso(ctx));
    const counts=(await tx.query("SELECT count(*) FILTER(WHERE (created_at AT TIME ZONE $4)::date=($5::timestamptz AT TIME ZONE $4)::date)::integer AS daily,count(*) FILTER(WHERE date_trunc('week',created_at AT TIME ZONE $4)=date_trunc('week',$5::timestamptz AT TIME ZONE $4))::integer AS weekly FROM execution_actions WHERE org_id=$1 AND policy_version_id=$2 AND action_type='external.publish' AND COALESCE(target->>'platform_account_id',target->>'account_id')=$3 AND state NOT IN ('failed','cancelled')",[ctx.orgId,policy.id,String(accountId),timezone,nowIso(ctx)])).rows[0]!;
    const daily=Number(counts.daily),weekly=Number(counts.weekly);
    if ((typeof limit.daily_max==="number" && daily>=limit.daily_max) || (typeof limit.weekly_max==="number" && weekly>=limit.weekly_max) || (typeof limit.min_interval_minutes==="number" && rows[0] && now-Date.parse(String(rows[0].created_at))<limit.min_interval_minutes*60000)) throw new DomainError("FREQUENCY_EXCEEDED",409,"发布频次或最小间隔超出规则");
    if (!Object.keys(limit).length) throw new DomainError("FREQUENCY_REQUIRED",409,"发布规则必须明确账号频次限制");
  }
  return snapshot;
}

export async function createExecutionAction(ctx: ServiceContext, input: ExecutionInput): Promise<Record<string, unknown>> {
  validateActionInput(input);
  const requestHash=stableHash(input),payloadHash=stableHash(input.payload);
  return ctx.db.transaction(async(tx)=>{
    await requireActiveRole(ctx,tx,"owner","marketer");
    // Locking the organization serializes idempotency and reservation checks even for first inserts.
    await tx.query("SELECT id FROM organizations WHERE id=$1 FOR UPDATE",[ctx.orgId]);
    const prior=(await tx.query("SELECT * FROM execution_actions WHERE org_id=$1 AND idempotency_key=$2",[ctx.orgId,input.idempotencyKey])).rows[0];
    if (prior) { if(prior.request_hash!==requestHash) throw new DomainError("IDEMPOTENCY_CONFLICT",409,"幂等键已绑定不同请求"); return prior; }
    const action:Record<string,unknown>={id:uuid(),org_id:ctx.orgId,action_type:input.actionType,target:input.target,payload:input.payload,payload_hash:payloadHash,approval_id:input.approvalId??null,policy_version_id:input.policyVersionId??null,version_id:input.versionId??null};
    const policy=await assertExecutionAuthorized(ctx,tx,action,{phase:"plan"});
    const budgetSnapshot=await reserveLimits(ctx,tx,policy,input);
    if(input.approvalId) { const approval=(await tx.query("SELECT decision,before_snapshot FROM approvals WHERE org_id=$1 AND id=$2",[ctx.orgId,input.approvalId])).rows[0]!; if(approval.decision!=="approved"||stableHash(approval.before_snapshot)!==stableHash(input.beforeSnapshot)) throw new DomainError("APPROVAL_INVALID",409,"单次批准已消费或资源版本已变化"); }
    const result=(await tx.query(`INSERT INTO execution_actions(id,org_id,approval_id,idempotency_key,request_hash,state,before_snapshot,version,policy_version_id,action_type,target,version_id,payload,payload_hash,budget_snapshot) VALUES ($1,$2,$3,$4,$5,'queued',$6,1,$7,$8,$9,$10,$11,$12,$13) RETURNING *`,[action.id,ctx.orgId,input.approvalId??null,input.idempotencyKey,requestHash,JSON.stringify(input.beforeSnapshot),input.policyVersionId??null,input.actionType,JSON.stringify(input.target),input.versionId??null,JSON.stringify(input.payload),payloadHash,JSON.stringify(budgetSnapshot)])).rows[0]!;
    if(input.approvalId) await tx.query("UPDATE approvals SET decision='consumed',version=version+1,updated_at=$1 WHERE org_id=$2 AND id=$3",[nowIso(ctx),ctx.orgId,input.approvalId]);
    await emitOutbox(ctx,tx,"execution.queued",String(action.id),{actionId:action.id,mode:ctx.mode}); await audit(ctx,tx,"execution.created","execution_action",String(action.id),{requestHash,authorization:input.policyVersionId?"policy":"approval"}); return result;
  });
}

export async function assertActionExecutable(ctx: ServiceContext, tx: SqlExecutor, actionId: string): Promise<Record<string,unknown>> {
  const action=(await tx.query("SELECT * FROM execution_actions WHERE org_id=$1 AND id=$2 FOR UPDATE",[ctx.orgId,actionId])).rows[0];
  if(!action) throw new DomainError("NOT_FOUND",404,"动作不存在");
  if(!["queued","executing","verification_pending","retry_wait"].includes(String(action.state))) throw new DomainError(action.state==="unknown"?"RECONCILE_REQUIRED":"INVALID_STATE",409,"动作必须先核对当前状态");
  await assertExecutionAuthorized(ctx,tx,action);
  const org=(await tx.query("SELECT write_enabled FROM organizations WHERE id=$1",[ctx.orgId])).rows[0];
  if(ctx.mode==="live"&&!org?.write_enabled) throw new DomainError("WRITE_DISABLED",409,"组织真实外部写入已关闭");
  const target=asObject(action.target),accountId=target.platform_account_id??target.account_id;
  if(accountId){const account=(await tx.query("SELECT a.*,c.provider AS connection_provider,c.access_status,c.health,c.capabilities,c.capabilities_verified_at FROM platform_accounts a JOIN connections c ON c.org_id=a.org_id AND c.id=a.connection_id WHERE a.org_id=$1 AND a.id=$2 FOR UPDATE OF a",[ctx.orgId,accountId])).rows[0];
    if(!account)throw new DomainError("NOT_FOUND",404,"平台账号不存在");
    if(ctx.mode==="mock"){if(account.connection_provider!=="mock")throw new DomainError("MOCK_BOUNDARY",409,"模拟执行不能访问真实平台账号");}
    else if(!account.enabled||account.access_status!=="connected"||account.session_status!=="active"||!account.capabilities_verified_at||!account.last_session_verified_at||account.health!=="healthy")throw new DomainError("ACCOUNT_UNVERIFIED",409,"账号权限或连接能力未核验");
  }
  // Live advertising requires a fresh authoritative source and verified native budget control.
  if(ctx.mode==="live"&&String(action.action_type).startsWith("ads.")) await assertAdsReadiness(ctx,tx,action);
  return action;
}
export async function claimExecutionAction(ctx: ServiceContext, actionId: string, workerId: string, leaseSeconds=300): Promise<ActionClaim> {
  if(!workerId||!Number.isInteger(leaseSeconds)||leaseSeconds<1||leaseSeconds>900)throw new DomainError("INVALID_LEASE",422,"租约参数无效");
  const outcome=await ctx.db.transaction(async(tx)=>{
    let action:Record<string,unknown>;
    try { action=await assertActionExecutable(ctx,tx,actionId); }
    catch(error){
      if(!(error instanceof DomainError)||error.code!=="PUBLISH_WINDOW_CLOSED")throw error;
      const blocked=await tx.query("UPDATE execution_actions SET state='blocked',last_error=$1,lease_owner=NULL,lease_until=NULL,fencing_token=fencing_token+1,version=version+1 WHERE org_id=$2 AND id=$3 AND state IN ('queued','retry_wait') RETURNING id",[JSON.stringify({code:error.code}),ctx.orgId,actionId]);
      if(blocked.rows.length)await audit(ctx,tx,"execution.blocked","execution_action",actionId,{code:error.code});
      return {error};
    }
    if(!["queued","retry_wait"].includes(String(action.state)))throw new DomainError("ALREADY_CLAIMED",409,"已提交或等待核验的动作不得重发");
    const result=(await tx.query("UPDATE execution_actions SET state='executing',lease_owner=$1,lease_until=$2::timestamptz+($3::text||' seconds')::interval,fencing_token=fencing_token+1,version=version+1 WHERE org_id=$4 AND id=$5 RETURNING *",[workerId,nowIso(ctx),leaseSeconds,ctx.orgId,actionId])).rows[0]!;
    return {action:result,token:String(result.fencing_token),workerId};
  });
  if("error" in outcome)throw outcome.error;
  return outcome;
}
export async function completeExecutionAction(ctx:ServiceContext,actionId:string,token:string, result:{state:"submitted"|"verification_pending"|"succeeded"|"failed"|"unknown";afterSnapshot?:unknown;externalId?:string;evidence?:unknown}):Promise<Record<string,unknown>>{
  return ctx.db.transaction(async(tx)=>{
    const row=(await tx.query("SELECT * FROM execution_actions WHERE org_id=$1 AND id=$2 FOR UPDATE",[ctx.orgId,actionId])).rows[0];
    if(!row)throw new DomainError("NOT_FOUND",404,"动作不存在");
    if(String(row.fencing_token)!==token||row.state!=="executing"||!row.lease_until||Date.parse(String(row.lease_until))<=Date.parse(nowIso(ctx)))throw new DomainError("STALE_LEASE",409,"旧执行租约不能提交结果");
    if(result.state==="succeeded"&&(!result.evidence||!result.afterSnapshot))throw new DomainError("VERIFICATION_REQUIRED",422,"成功必须提供实际回读快照与证据");
    if(ctx.mode==="mock"&&result.state==="succeeded")throw new DomainError("MOCK_NOT_LIVE_SUCCESS",409,"模拟执行不能记录真实外部核验成功");
    const updated=(await tx.query("UPDATE execution_actions SET state=$1,after_snapshot=$2,external_id=$3,verification_evidence_ref=$4,verified_at=$5,lease_until=NULL,lease_owner=NULL,version=version+1 WHERE org_id=$6 AND id=$7 RETURNING *",[result.state,result.afterSnapshot?JSON.stringify(result.afterSnapshot):null,result.externalId??null,result.evidence?JSON.stringify(result.evidence):null,result.state==="succeeded"?nowIso(ctx):null,ctx.orgId,actionId])).rows[0]!;
    const attempt=(await tx.query("SELECT COALESCE(max(attempt_no),0)+1 AS attempt_no FROM action_attempts WHERE org_id=$1 AND action_id=$2",[ctx.orgId,actionId])).rows[0]!;
    await tx.query("INSERT INTO action_attempts(id,org_id,action_id,attempt_no,request_id,request_digest,response_digest,result,started_at,finished_at,phase) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,'submit')",[uuid(),ctx.orgId,actionId,attempt.attempt_no,uuid(),row.payload_hash,stableHash(result),result.state==="unknown"?"unknown":result.state==="failed"?"failure":"success",row.created_at,nowIso(ctx)]);
    await emitOutbox(ctx,tx,"execution.result",actionId,{state:result.state});return updated;
  });
}
export async function recoverExpiredActions(ctx:ServiceContext):Promise<number>{
  return ctx.db.transaction(async(tx)=>{
    const result=await tx.query("UPDATE execution_actions SET state='unknown',lease_owner=NULL,lease_until=NULL,fencing_token=fencing_token+1,version=version+1,last_error=$1 WHERE org_id=$2 AND state='executing' AND lease_until<=$3 RETURNING id",[JSON.stringify({code:"LEASE_EXPIRED_RECONCILE_REQUIRED"}),ctx.orgId,nowIso(ctx)]);return result.rowCount;
  });
}
export async function reconcileExecutionAction(ctx:ServiceContext,actionId:string,input:{outcome:"found"|"absent"|"ambiguous";evidence:Record<string,unknown>;afterSnapshot?:Record<string,unknown>;externalId?:string}):Promise<Record<string,unknown>>{
  return ctx.db.transaction(async(tx)=>{
    await requireActiveRole(ctx,tx,"owner","marketer");
    const action=(await tx.query("SELECT * FROM execution_actions WHERE org_id=$1 AND id=$2 FOR UPDATE",[ctx.orgId,actionId])).rows[0];
    if(!action)throw new DomainError("NOT_FOUND",404,"动作不存在");if(!["unknown","submitted","verification_pending","waiting_review"].includes(String(action.state)))throw new DomainError("INVALID_STATE",409,"当前动作无需对账");
    if(!Object.keys(input.evidence).length)throw new DomainError("VERIFICATION_REQUIRED",422,"对账必须留存回读证据");
    if(ctx.mode==="mock"&&input.outcome==="found")throw new DomainError("MOCK_NOT_LIVE_SUCCESS",409,"模拟证据不能成为真实发布成功证明");
    let state=input.outcome==="found"?"succeeded":input.outcome==="absent"?"retry_wait":"unknown";
    if(input.outcome==="absent"){try{await assertExecutionAuthorized(ctx,tx,action);}catch(error){if(!(error instanceof DomainError))throw error;state="blocked";}}

    if(state==="succeeded"&&!input.afterSnapshot)throw new DomainError("VERIFICATION_REQUIRED",422,"必须提供实际回读快照");
    const result=(await tx.query("UPDATE execution_actions SET state=$1,after_snapshot=$2,external_id=COALESCE($3,external_id),verification_evidence_ref=$4,verified_at=$5,version=version+1 WHERE org_id=$6 AND id=$7 RETURNING *",[state,input.afterSnapshot?JSON.stringify(input.afterSnapshot):null,input.externalId??null,JSON.stringify(input.evidence),state==="succeeded"?nowIso(ctx):null,ctx.orgId,actionId])).rows[0]!;
    const attempt=(await tx.query("SELECT COALESCE(max(attempt_no),0)+1 AS attempt_no FROM action_attempts WHERE org_id=$1 AND action_id=$2",[ctx.orgId,actionId])).rows[0]!;
    await tx.query("INSERT INTO action_attempts(id,org_id,action_id,attempt_no,request_id,request_digest,response_digest,result,started_at,finished_at,phase) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$9,'reconcile')",[uuid(),ctx.orgId,actionId,attempt.attempt_no,uuid(),action.payload_hash,stableHash(input),input.outcome==="ambiguous"?"unknown":input.outcome==="found"?"success":"failure",nowIso(ctx)]);
    await audit(ctx,tx,"execution.reconciled","execution_action",actionId,{outcome:input.outcome});return result;
  });
}

export async function assertAdsReadiness(ctx:ServiceContext,tx:SqlExecutor,action:Record<string,unknown>):Promise<void>{
  const target=asObject(action.target),accountId=String(target.platform_account_id??target.account_id??"");
  const setting=(await tx.query("SELECT value FROM settings WHERE org_id=$1 AND key=$2",[ctx.orgId,`ads.readiness:${accountId}`])).rows[0];
  const proof=asObject(setting?.value),ids=asStrings(proof.source_batch_ids);
  if(!proof.control_verified||!ids.length||typeof proof.verified_at!=="string"||Date.parse(nowIso(ctx))-Date.parse(proof.verified_at)>5*60000||Date.parse(proof.verified_at)>Date.parse(nowIso(ctx))+30000)throw new DomainError("NATIVE_BUDGET_REQUIRED",409,"缺少近期可信平台预算与花费回读");
  const account=(await tx.query("SELECT connection_id,adapter_version FROM platform_accounts WHERE org_id=$1 AND id=$2",[ctx.orgId,accountId])).rows[0];
  if(!account||proof.connection_id!==account.connection_id||proof.adapter_version!==account.adapter_version)throw new DomainError("NATIVE_BUDGET_REQUIRED",409,"预算回读与当前账号适配版本不一致");
  const batches=(await tx.query("SELECT * FROM ingestion_batches WHERE org_id=$1 AND id=ANY($2::uuid[])",[ctx.orgId,ids])).rows;
  if(batches.length!==new Set(ids).size||batches.some((batch)=>batch.connection_id!==account.connection_id||batch.state!=="committed"||batch.quality!=="complete"||asObject(batch.mapping)._mode!=="live"||asObject(batch.mapping)._sourceKind!=="connector"||!batch.source_watermark||Date.parse(nowIso(ctx))-Date.parse(String(batch.source_watermark))>3600000))throw new DomainError("STALE_SPEND",409,"花费数据不是完整且近期的真实连接批次");
  for(const field of ["daily_spend_minor","total_spend_minor","native_daily_budget_minor","native_total_budget_minor"])assertSafeInteger(proof[field],field);
  const policy=(await tx.query("SELECT * FROM policy_versions WHERE org_id=$1 AND id=$2",[ctx.orgId,action.policy_version_id])).rows[0];
  const currency=policy?.currency??asObject(action.budget_snapshot).currency;
  if(proof.currency!==currency)throw new DomainError("CURRENCY_MISMATCH",409,"预算币种不一致");
  const reserved=(await tx.query("SELECT COALESCE(sum((budget_snapshot->>'reserved_minor')::bigint),0)::text AS total,COALESCE(sum(CASE WHEN (created_at AT TIME ZONE 'Asia/Shanghai')::date=($3::timestamptz AT TIME ZONE 'Asia/Shanghai')::date THEN (budget_snapshot->>'reserved_minor')::bigint ELSE 0 END),0)::text AS daily FROM execution_actions WHERE org_id=$1 AND policy_version_id IS NOT DISTINCT FROM $2::uuid AND state NOT IN ('failed','cancelled','succeeded')",[ctx.orgId,action.policy_version_id,nowIso(ctx)])).rows[0]!;
  if(BigInt(String(proof.daily_spend_minor))+BigInt(String(reserved.daily))>BigInt(String(proof.native_daily_budget_minor))||BigInt(String(proof.total_spend_minor))+BigInt(String(reserved.total))>BigInt(String(proof.native_total_budget_minor))||(policy&&(BigInt(String(proof.daily_spend_minor))+BigInt(String(reserved.daily))>BigInt(String(policy.daily_budget_minor))||BigInt(String(proof.total_spend_minor))+BigInt(String(reserved.total))>BigInt(String(policy.total_budget_minor)))))throw new DomainError("BUDGET_EXCEEDED",409,"花费加待执行预留超过平台或规则预算");
}

export async function createPolicyVersion(ctx:ServiceContext,policyId:string,input:Omit<PolicyInput,"name">,expectedVersion:number):Promise<Record<string,unknown>>{
  return ctx.db.transaction(async(tx)=>{
    await requireOwner(ctx,tx);
    const policy=(await tx.query("SELECT * FROM execution_policies WHERE org_id=$1 AND id=$2 FOR UPDATE",[ctx.orgId,policyId])).rows[0];if(!policy)throw new DomainError("NOT_FOUND",404,"规则不存在");assertVersion(Number(policy.version),expectedVersion);
    if(!input.accountIds.length||!input.allowedActions.length||!Object.keys(input.businessScope).length||!Object.keys(input.stopConditions).length)throw new DomainError("INVALID_POLICY",422,"新版本范围不完整");
    for(const amount of [input.dailyBudgetMinor,input.totalBudgetMinor])if(amount!==undefined)assertSafeInteger(amount);
    if(input.allowedActions.some((t)=>t.startsWith("ads."))&&(input.dailyBudgetMinor===undefined||input.totalBudgetMinor===undefined))throw new DomainError("INVALID_POLICY",422,"广告规则必须明确日预算与总预算");
    for(const id of input.accountIds)await assertOrgReference(ctx,tx,"platform_accounts",id);
    const next=Number((await tx.query("SELECT COALESCE(max(version_no),0)+1 AS n FROM policy_versions WHERE org_id=$1 AND policy_id=$2",[ctx.orgId,policyId])).rows[0]!.n),id=uuid();
    const result=(await tx.query(`INSERT INTO policy_versions(id,org_id,policy_id,version_no,business_scope,account_ids,allowed_actions,currency,daily_budget_minor,total_budget_minor,max_bid_change_pct,publish_frequency,publish_windows,stop_conditions,valid_from,valid_until,payload_hash,created_by,allowed_ad_operations,allowed_ad_entity_levels,approved_path_prefixes,reception_scope) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22) RETURNING *`,[id,ctx.orgId,policyId,next,JSON.stringify(input.businessScope),input.accountIds,input.allowedActions,input.currency??"CNY",input.dailyBudgetMinor??null,input.totalBudgetMinor??null,input.maxBidChangePct??null,JSON.stringify(input.publishFrequency??{}),JSON.stringify(input.publishWindows??[]),JSON.stringify(input.stopConditions),input.validFrom??nowIso(ctx),input.validUntil??null,stableHash(input),ctx.actorId,input.allowedAdOperations??[],input.allowedAdEntityLevels??[],input.approvedPathPrefixes??[],JSON.stringify(input.receptionScope??{})])).rows[0]!;
    await tx.query("UPDATE execution_policies SET version=version+1,updated_at=$1 WHERE org_id=$2 AND id=$3",[nowIso(ctx),ctx.orgId,policyId]);await audit(ctx,tx,"policy.version_created","execution_policy",policyId,{versionId:id});return result;
  });
}
export async function createApproval(ctx:ServiceContext,input:{actionType:ActionType;target:Record<string,unknown>;payload:Record<string,unknown>;versionId?:string;expiresAt:string;reason?:string}):Promise<Record<string,unknown>>{
  return ctx.db.transaction(async(tx)=>{
    await requireActiveRole(ctx,tx,"owner","marketer");
    if(Date.parse(input.expiresAt)<=Date.parse(nowIso(ctx))||!Number.isFinite(Date.parse(input.expiresAt)))throw new DomainError("INVALID_EXPIRY",422,"授权有效期必须在未来");
    await validateTarget(ctx,tx,input.target,input.versionId);
    let before:Record<string,unknown>={mode:ctx.mode};
    if(input.target.page_id){const row=(await tx.query("SELECT version,published_release_id FROM pages WHERE org_id=$1 AND id=$2",[ctx.orgId,input.target.page_id])).rows[0]!;before={version:row.version,published_release_id:row.published_release_id};}
    else if(ctx.mode==="live")throw new DomainError("ADAPTER_READBACK_REQUIRED",503,"例外授权需要可信平台目标回读，当前尚未接通");
    else before={mode:"mock",target:input.target};
    const result=(await tx.query("INSERT INTO approvals(org_id,action_type,target,version_id,payload,payload_hash,before_snapshot,after_preview,budget_impact,requested_by,decision,expires_at,reason,version) VALUES($1,$2,$3,$4,$5,$6,$7,$5,$8,$9,'pending',$10,$11,1) RETURNING *",[ctx.orgId,input.actionType,JSON.stringify(input.target),input.versionId??null,JSON.stringify(input.payload),stableHash(input.payload),JSON.stringify(before),JSON.stringify({mode:ctx.mode,actual_spend:false}),ctx.actorId,input.expiresAt,input.reason??null])).rows[0]!;
    await audit(ctx,tx,"approval.requested","approval",String(result.id));return result;
  });
}
export async function decideApproval(ctx:ServiceContext,approvalId:string,input:{decision:"approved"|"rejected"|"revoked";expectedPayloadHash:string;expectedVersion:number;reason?:string}):Promise<Record<string,unknown>>{
  return ctx.db.transaction(async(tx)=>{
    await requireOwner(ctx,tx);
    const approval=(await tx.query("SELECT * FROM approvals WHERE org_id=$1 AND id=$2 FOR UPDATE",[ctx.orgId,approvalId])).rows[0];if(!approval)throw new DomainError("NOT_FOUND",404,"批准记录不存在");assertVersion(Number(approval.version),input.expectedVersion);
    if(approval.payload_hash!==input.expectedPayloadHash||stableHash(approval.payload)!==input.expectedPayloadHash)throw new DomainError("PAYLOAD_CHANGED",409,"批准载荷已改变");
    if(input.decision!=="revoked"&&approval.decision!=="pending")throw new DomainError("INVALID_STATE",409,"批准记录已作决定");
    if(input.decision==="approved"&&Date.parse(String(approval.expires_at))<=Date.parse(nowIso(ctx)))throw new DomainError("APPROVAL_EXPIRED",409,"批准记录已过期");
    if(input.decision==="approved"&&asObject(approval.target).page_id){const page=(await tx.query("SELECT version,published_release_id FROM pages WHERE org_id=$1 AND id=$2 FOR UPDATE",[ctx.orgId,asObject(approval.target).page_id])).rows[0];if(!page||stableHash({version:page.version,published_release_id:page.published_release_id})!==stableHash(approval.before_snapshot))throw new DomainError("RESOURCE_CHANGED",409,"页面资源版本已改变");}
    const result=(await tx.query("UPDATE approvals SET decision=$1,decided_by=$2,decided_at=$3,reason=$4,version=version+1,updated_at=$3 WHERE org_id=$5 AND id=$6 RETURNING *",[input.decision,ctx.actorId,nowIso(ctx),input.reason??null,ctx.orgId,approvalId])).rows[0]!;
    if(input.decision==="revoked")await tx.query("UPDATE execution_actions SET state='blocked',version=version+1 WHERE org_id=$1 AND approval_id=$2 AND state IN('queued','retry_wait')",[ctx.orgId,approvalId]);
    await audit(ctx,tx,`approval.${input.decision}`,"approval",approvalId);return result;
  });
}

/** Pure readback settlement for an authenticated runtime. Stopping writes does not erase historical results. */
export async function reconcileServiceExecutionAction(ctx:ServiceContext,actionId:string,input:{commandId:string;outcome:'found'|'rejected'|'ambiguous';afterSnapshot?:Record<string,unknown>;externalId?:string}):Promise<Record<string,unknown>> {
  if(ctx.actorType!=='service'||!ctx.roles.includes('service')||!ctx.actorId.trim()||ctx.actorId.length>200)throw new DomainError('SERVICE_IDENTITY_REQUIRED',403,'自动回读须使用已认证服务身份');
  if(ctx.mode!=='live')throw new DomainError('MOCK_NOT_LIVE_SUCCESS',409,'模拟回读不能记录真实外部结果');
  return ctx.db.transaction(async tx=>{
    const action=(await tx.query('SELECT * FROM execution_actions WHERE org_id=$1 AND id=$2 FOR UPDATE',[ctx.orgId,actionId])).rows[0];if(!action)throw new DomainError('NOT_FOUND',404,'动作不存在');
    const target=asObject(action.target),accountId=target.platform_account_id??target.account_id;
    const account=(await tx.query('SELECT a.*,c.read_mode FROM platform_accounts a JOIN connections c ON c.org_id=a.org_id AND c.id=a.connection_id WHERE a.org_id=$1 AND a.id=$2',[ctx.orgId,accountId])).rows[0];
    const command=(await tx.query('SELECT * FROM browser_commands WHERE org_id=$1 AND id=$2 FOR SHARE',[ctx.orgId,input.commandId])).rows[0];
    const refs=asObject(asObject(command?.input_ref).refs),receipt=asObject(command?.result_ref),evidence=asObject(receipt.evidence),data=asObject(receipt.data);
    if(!account||account.read_mode==='mock'||!command||command.command_type!=='reconcile'||command.execution_action_id!==actionId||command.platform_account_id!==accountId||asObject(command.input_ref).mode!=='live'||typeof refs.reconcile_command_id!=='string')throw new DomainError('RECONCILIATION_BINDING_REQUIRED',422,'回读命令、原动作及实际账号关联无效');
    const original=(await tx.query('SELECT * FROM browser_commands WHERE org_id=$1 AND id=$2 FOR SHARE',[ctx.orgId,refs.reconcile_command_id])).rows[0];
    if(!original||original.execution_action_id!==actionId||original.platform_account_id!==accountId||asObject(original.input_ref).mode!=='live'||asObject(original.result_ref).reconciliationCommandId!==command.id||!['publish','ad_write'].includes(String(original.command_type)))throw new DomainError('RECONCILIATION_BINDING_REQUIRED',422,'缺少原提交命令与已完成回读的准确关联');
    if(stableHash(asObject(action.payload))!==action.payload_hash)throw new DomainError('PAYLOAD_CHANGED',409,'动作版本摘要不一致');
    const originalRefs=asObject(asObject(original.input_ref).refs);
    if(original.command_type==='publish'&&(action.action_type!=='external.publish'||originalRefs.content_version_id!==action.version_id)||original.command_type==='ad_write'&&(!String(action.action_type).startsWith('ads.')||originalRefs.action_snapshot_id!==actionId))throw new DomainError('RECONCILIATION_BINDING_REQUIRED',422,'原命令未绑定准确内容版本或广告动作');
    if(input.externalId!==undefined&&input.externalId!==(data.external_id??receipt.externalId))throw new DomainError('RECONCILIATION_BINDING_REQUIRED',422,'传入外部资源ID与服务保存回读不一致');
    const snapshot:Record<string,unknown>={browser_command_id:command.id,original_browser_command_id:original.id,...data};
    if(input.afterSnapshot&&Object.entries(input.afterSnapshot).some(([key,value])=>snapshot[key]===undefined||stableHash(snapshot[key])!==stableHash(value)))throw new DomainError('RECONCILIATION_BINDING_REQUIRED',422,'调用方快照与服务保存的实际回读不一致');
    const verified=evidence.verified===true&&['api_readback','browser_readback'].includes(String(evidence.kind))&&evidence.externalAccountId===account.account_external_id&&typeof evidence.evidenceRef==='string'&&evidence.evidenceRef.trim()&&typeof evidence.capturedAt==='string'&&Number.isFinite(Date.parse(evidence.capturedAt))&&command.finished_at&&Math.abs(Date.parse(evidence.capturedAt)-Date.parse(String(command.finished_at)))<=60_000;
    let state:string='unknown';
    if(input.outcome==='found'){
      if(command.state!=='succeeded'||receipt.status!=='verified'||!verified||evidence.labelsVerified!==true)throw new DomainError('VERIFICATION_REQUIRED',422,'生效须有真实账号、标识及准确时点回读证据');
      if(original.command_type==='publish'){
        let url:URL;try{url=new URL(String(data.published_url));}catch{throw new DomainError('VERIFICATION_REQUIRED',422,'真实发布须有实际URL');}
        if(evidence.contentHash!==action.payload_hash||typeof data.external_id!=='string'||!data.external_id||!['http:','https:'].includes(url.protocol)||url.username||url.password||['localhost','127.0.0.1','::1','[::1]'].includes(url.hostname))throw new DomainError('VERIFICATION_REQUIRED',422,'发布URL、资源ID或内容版本回读不一致');
      }else{
        const effective=asObject(data.effective_fields),payload=asObject(action.payload);
        if(!Object.keys(effective).length||effective.accountId!==account.account_external_id||Object.entries(payload).some(([key,value])=>effective[key]===undefined||stableHash(effective[key])!==stableHash(value)))throw new DomainError('VERIFICATION_REQUIRED',422,'百度实际对象生效字段与请求或账号不一致');
      }
      state='succeeded';
    }else if(input.outcome==='rejected'){
      if(command.state!=='failed'||receipt.status!=='rejected'||data.review_status!=='rejected'||!verified)throw new DomainError('VERIFICATION_REQUIRED',422,'审核拒绝须有实际账号与拒绝状态回读');
      state='failed';
    }else if(command.state!=='unknown'||!['unknown','submitted','in_review'].includes(String(receipt.status)))throw new DomainError('VERIFICATION_REQUIRED',422,'未知回读不能冒充确定结果');
    const priorProof=asObject(action.verification_evidence_ref);
    if(['succeeded','failed'].includes(String(action.state))&&action.state===state&&priorProof.browser_command_id===command.id)return action;
    if(!['unknown','submitted','verification_pending','waiting_review'].includes(String(action.state)))throw new DomainError('INVALID_STATE',409,'当前动作无需服务回读对账');
    const savedProof={...evidence,browser_command_id:command.id,original_browser_command_id:original.id,outcome:input.outcome};
    const result=(await tx.query('UPDATE execution_actions SET state=$3,after_snapshot=$4,external_id=COALESCE($5,external_id),verification_evidence_ref=$6,verified_at=$7,lease_owner=NULL,lease_until=NULL,version=version+1,updated_at=$8 WHERE org_id=$1 AND id=$2 RETURNING *',[ctx.orgId,actionId,state,JSON.stringify(snapshot),data.external_id??receipt.externalId??null,JSON.stringify(savedProof),state==='succeeded'?evidence.capturedAt:null,nowIso(ctx)])).rows[0]!;
    const attempt=(await tx.query('SELECT COALESCE(max(attempt_no),0)+1 AS n FROM action_attempts WHERE org_id=$1 AND action_id=$2',[ctx.orgId,actionId])).rows[0]!;
    await tx.query("INSERT INTO action_attempts(id,org_id,action_id,attempt_no,request_id,request_digest,response_digest,result,started_at,finished_at,phase) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,'reconcile')",[uuid(),ctx.orgId,actionId,attempt.n,uuid(),action.payload_hash,stableHash({snapshot,evidence: savedProof}),state==='succeeded'?'success':state==='failed'?'failure':'unknown',command.started_at??command.created_at,command.finished_at??nowIso(ctx)]);
    await audit(ctx,tx,'execution.service_reconciled','execution_action',actionId,{commandId:command.id,outcome:input.outcome});await emitOutbox(ctx,tx,'execution.result',actionId,{state,commandId:command.id,mode:ctx.mode});return result;
  });
}
