import { randomUUID } from "node:crypto";
import { createBrowserService } from "@boran/browser-runtime/service";
import { browserClientFromEnvironment } from '@boran/browser-runtime';
import { createPlatformRegistry, PLATFORM_DESCRIPTORS } from "@boran/connectors";
import { assertVersion, audit, DomainError, nowIso, requireRole, stableHash, type ServiceContext } from "@boran/domain/core";
import { databaseCommand, expectedVersion, idempotencyKey, jsonData, transactionContext } from "../http";
import { requireActiveRole } from "@boran/domain/authz";
import { createSecretStoreFromEnvironment } from "@boran/connectors/secrets";
import { sourceScope, credentialReference, sourceProvider, platformLoginScope } from "../source-config";

const dto = (row: Record<string, unknown>, fields: string[]) => Object.fromEntries(fields.filter((key) => row[key] !== undefined).map((key) => [key, row[key]]));
const accountFields = ["id", "connection_id", "provider", "channel_id", "display_name", "enabled", "session_status", "session_expires_at", "last_session_verified_at", "session_version", "version", "timezone", "adapter_version"];
const connectionFields = ["id", "provider", "display_name", "timezone", "currency", "health", "enabled_for_reporting", "authoritative_report_type", "last_success_at", "source_kind", "read_mode", "access_status", "last_attempt_at", "last_error_code", "capabilities_verified_at", "scope_json"];
export function connectionVersion(row: Record<string, unknown>) { return stableHash({ display_name: row.display_name, timezone: row.timezone, currency: row.currency, enabled_for_reporting: row.enabled_for_reporting, authoritative_report_type: row.authoritative_report_type ?? null, source_kind: row.source_kind ?? null, scope_json: row.scope_json ?? {}, secret_ref: row.secret_ref ?? null, read_mode: row.read_mode, updated_at: row.updated_at instanceof Date ? row.updated_at.toISOString() : row.updated_at }); }
export function connectionDto(row: Record<string, unknown>) { return { ...dto(row, connectionFields), has_credential_ref: Boolean(row.secret_ref), edit_version: connectionVersion(row) }; }
const loginFields = ["id", "platform_account_id", "state", "expires_at", "ticket_expires_at", "started_at", "completed_at", "version"];
function interactionDto(value: unknown) {
  const row = value && typeof value === 'object' ? value as Record<string, unknown> : {};
  const output = dto(row, ['interaction_ready', 'method', 'expires_at', 'state', 'verified', 'session_version', 'id', 'status']);
  if (typeof row.qr_image === 'string' && row.qr_image.length <= 2_000_000 && /^data:image\/png;base64,[A-Za-z0-9+/=]+$/.test(row.qr_image)) output.qr_image = row.qr_image;
  return output;
}
function text(body: Record<string, unknown>, key: string, limit = 200) { const value = body[key]; if (typeof value !== "string" || !value.trim() || value.length > limit) throw new DomainError("INVALID_REQUEST", 422, `${key} 无效`); return value.trim(); }
function allowed(body: Record<string, unknown>, keys: string[]) { if (Object.keys(body).some((key) => !keys.includes(key))) throw new DomainError("INVALID_REQUEST", 422, "请求包含未允许字段"); }
function requireConnectionMode(ctx: ServiceContext, connection: Record<string, unknown>) {
  if (ctx.mode !== 'live' && connection.read_mode !== 'mock') throw new DomainError('LIVE_IDENTITY_REQUIRED', 403, '真实连接须由独立登录的真实工作空间操作');
}
function requireReadableConnection(ctx: ServiceContext, connection: Record<string, unknown>) {
  if (ctx.mode === 'mock' && connection.read_mode !== 'mock') throw new DomainError('NOT_FOUND', 404, '记录不存在');
}
function service(ctx: ServiceContext) { return createBrowserService(ctx, { adapters: createPlatformRegistry({ mode: ctx.mode }) }); }
async function cancelBoundInteraction(ctx: ServiceContext, sessionId: string) {
  await ctx.db.transaction(async tx => {
    await requireActiveRole(ctx, tx, 'owner', 'admin', 'marketer');
    const bound = (await tx.query('SELECT platform_account_id FROM login_sessions WHERE org_id=$1 AND id=$2 AND user_id=$3', [ctx.orgId, sessionId, ctx.actorId])).rows[0];
    if (bound) await tx.query('SELECT id FROM platform_accounts WHERE org_id=$1 AND id=$2 FOR UPDATE', [ctx.orgId, bound.platform_account_id]);
    const session = (await tx.query("UPDATE login_sessions SET state='cancelled',version=version+1,updated_at=clock_timestamp() WHERE org_id=$1 AND id=$2 AND user_id=$3 AND state IN ('created','active') RETURNING platform_account_id", [ctx.orgId, sessionId, ctx.actorId])).rows[0];
    if (session) {
      await tx.query('UPDATE platform_accounts SET browser_fencing_token=browser_fencing_token+1 WHERE org_id=$1 AND id=$2', [ctx.orgId, session.platform_account_id]);
      await audit(transactionContext(ctx, tx), tx, 'browser.interaction.cancelled', 'login_session', sessionId, { reason: 'user_closed_or_unavailable' });
    }
  });
}
async function one(ctx: ServiceContext, table: "connections" | "platform_accounts" | "login_sessions", id: string) {
  const row = (await ctx.db.query(`SELECT * FROM ${table} WHERE org_id=$1 AND id=$2`, [ctx.orgId, id])).rows[0];
  if (!row) throw new DomainError("NOT_FOUND", 404, "记录不存在");
  return row;
}
function timezone(body: Record<string, unknown>) { const zone = typeof body.timezone === "string" ? body.timezone : "Asia/Shanghai"; try { new Intl.DateTimeFormat("zh-CN", { timeZone: zone }); } catch { throw new DomainError("INVALID_REQUEST", 422, "时区无效"); } return zone; }

export async function handleBrowser(ctx: ServiceContext, request: Request, segments: string[], body: Record<string, unknown> = {}): Promise<Response | null> {
  const [resource, id, action, extra] = segments;
  if (!["connections", "platform-accounts", "login-sessions"].includes(resource ?? "")) return null;
  await requireActiveRole(ctx, ctx.db, "owner", "admin", "marketer", "reviewer", "viewer");
  if (resource === "connections") {
    if (request.method === "GET" && !id) return jsonData((await ctx.db.query("SELECT * FROM connections WHERE org_id=$1 AND ($2<>'mock' OR read_mode='mock') ORDER BY created_at DESC LIMIT 100", [ctx.orgId, ctx.mode])).rows.map(connectionDto));
    if (request.method === "GET" && id && (!action || action === "health")) { const connection = await one(ctx, 'connections', id); requireReadableConnection(ctx, connection); return jsonData(connectionDto(connection)); }
    if (request.method === "PATCH" && id && !action) {
      requireRole(ctx, "owner", "admin", "marketer");
      allowed(body, ["display_name", "enabled_for_reporting", "timezone", "currency", "scope_json", "secret_ref"]);
      if (!Object.keys(body).length) throw new DomainError("INVALID_REQUEST", 422, "修改字段不能为空");
      if (body.enabled_for_reporting !== undefined && typeof body.enabled_for_reporting !== "boolean") throw new DomainError("INVALID_REQUEST", 422, "enabled_for_reporting 须为布尔值");
      if (body.currency !== undefined && (typeof body.currency !== "string" || !["CNY", "USD", "EUR", "JPY", "GBP", "HKD", "SGD", "TWD", "AUD", "CAD"].includes(body.currency))) throw new DomainError("INVALID_CURRENCY", 422, "币种无效");
      const expected = request.headers.get("if-match")?.replace(/^W\//, "").replaceAll('"', "");
      if (!expected || !/^[a-f0-9]{64}$/.test(expected)) throw new DomainError("VERSION_REQUIRED", 428, "修改需要 If-Match edit_version");
      return databaseCommand(ctx, request, body, 200, async (context) => {
        const row = (await context.db.query("SELECT * FROM connections WHERE org_id=$1 AND id=$2 FOR UPDATE", [context.orgId, id])).rows[0];
        if (!row) throw new DomainError("NOT_FOUND", 404, "连接不存在");
        requireConnectionMode(context, row);
        if (connectionVersion(row) !== expected) throw new DomainError("VERSION_CONFLICT", 409, "连接配置已变化，请重新读取");
        const zone = body.timezone === undefined ? row.timezone : timezone(body), currency = body.currency ?? row.currency;
        if ((zone !== row.timezone || currency !== row.currency) && (await context.db.query("SELECT id FROM ingestion_batches WHERE org_id=$1 AND connection_id=$2 LIMIT 1", [context.orgId, id])).rowCount) throw new DomainError("HISTORICAL_METRIC_SCOPE_LOCKED", 409, "已有报表批次不能改变时区或币种，请创建独立连接");
        await requireActiveRole(context, context.db, "owner", "admin", "marketer");
        const reporting = body.enabled_for_reporting ?? row.enabled_for_reporting;
        const scope = body.scope_json === undefined ? row.scope_json : sourceProvider(row.source_kind) ? sourceScope(body.scope_json, row.source_kind, row.read_mode !== "mock") : platformLoginScope(body.scope_json);
        const secret = body.secret_ref === undefined ? row.secret_ref : credentialReference(body.secret_ref);
        if (body.secret_ref !== undefined && typeof secret === 'string' && secret.startsWith('boran-secret:')) { try { await createSecretStoreFromEnvironment(process.env).assertScope(secret, { orgId: context.orgId, connectionId: id }); } catch { throw new DomainError('INVALID_CREDENTIAL_REFERENCE', 422, '凭据引用不属于当前连接或加密存储不可用'); } }
        const changed = stableHash(scope) !== stableHash(row.scope_json) || secret !== row.secret_ref;
        const updated = (await context.db.query("UPDATE connections SET display_name=$3,enabled_for_reporting=$4,timezone=$5,currency=$6,authoritative_report_type=CASE WHEN $4 THEN COALESCE(authoritative_report_type,'campaign_daily') ELSE authoritative_report_type END,scope_json=$7,secret_ref=$8,cursor=CASE WHEN $9 THEN NULL ELSE cursor END,access_status=CASE WHEN $9 THEN 'not_configured' ELSE access_status END,health=CASE WHEN $9 THEN 'unknown' ELSE health END,capabilities=CASE WHEN $9 THEN '{}'::jsonb ELSE capabilities END,capabilities_verified_at=CASE WHEN $9 THEN NULL ELSE capabilities_verified_at END,last_error_code=CASE WHEN $9 THEN NULL ELSE last_error_code END,updated_at=clock_timestamp() WHERE org_id=$1 AND id=$2 RETURNING *", [context.orgId, id, body.display_name === undefined ? row.display_name : text(body, "display_name"), reporting, zone, currency, JSON.stringify(scope), secret, changed])).rows[0]!;
        if (changed) {
          await context.db.query("UPDATE connections SET browser_fencing_token=browser_fencing_token+1 WHERE org_id=$1 AND id=$2", [context.orgId, id]);
          await context.db.query("UPDATE platform_accounts SET enabled=false,session_status='not_connected',adapter_version=NULL,session_version=session_version+1,version=version+1,updated_at=clock_timestamp() WHERE org_id=$1 AND connection_id=$2", [context.orgId, id]);
          await context.db.query("UPDATE login_sessions SET state='cancelled' WHERE org_id=$1 AND platform_account_id IN (SELECT id FROM platform_accounts WHERE org_id=$1 AND connection_id=$2) AND state IN ('created','active')", [context.orgId, id]);
          await context.db.query("UPDATE browser_commands SET state=CASE WHEN state='running' AND command_type IN ('publish','ad_write') THEN 'unknown' ELSE 'blocked' END,updated_at=clock_timestamp() WHERE org_id=$1 AND connection_id=$2 AND state IN ('queued','running')", [context.orgId, id]);
        }
        await audit(context, context.db, "connection.updated", "connection", id, { fields: Object.keys(body), reporting: Boolean(reporting), mode: ctx.mode });
        return connectionDto(updated);
      });
    }
    if (request.method === "POST" && !id) {
      requireRole(ctx, "owner", "admin", "marketer");
      allowed(body, ["provider", "account_external_id", "display_name", "timezone", "currency", "source_kind", "read_mode", "scope_json", "secret_ref"]);
      const provider = text(body, "provider", 60);
      if (!["baidu_ads", "google_drive", "public_web", "chatgpt_authorized", "aifanfan", "deepseek", "website", "mock", ...PLATFORM_DESCRIPTORS.map((item) => item.channelId)].includes(provider)) throw new DomainError("INVALID_PROVIDER", 422, "连接类型未支持");
      const readMode = body.read_mode ?? (ctx.mode === "mock" ? "mock" : "native_api");
      requireConnectionMode(ctx, { read_mode: readMode });
      if (!["native_api", "authorized_browser", "drive_sync", "manual_import", "mock"].includes(String(readMode)) || ctx.mode === "live" && readMode === "mock") throw new DomainError("INVALID_MODE", 422, "读取模式无效");
      const sourceKind = body.source_kind ?? null;
      if (sourceKind !== null && !["market_public", "competitor_public", "mac_drive", "chatgpt", "other"].includes(String(sourceKind))) throw new DomainError("INVALID_SOURCE_KIND", 422, "来源分类无效");
      const expectedProvider = sourceProvider(sourceKind);
      if (expectedProvider && expectedProvider !== provider) throw new DomainError("SOURCE_PROVIDER_MISMATCH", 422, "来源类型与连接服务不一致");
      const scope = expectedProvider ? sourceScope(body.scope_json ?? {}, sourceKind, readMode !== "mock") : platformLoginScope(body.scope_json ?? {});
      const secret = body.secret_ref === undefined ? null : credentialReference(body.secret_ref);
      if (secret?.startsWith('boran-secret:')) throw new DomainError('CREDENTIAL_CONNECTION_REQUIRED', 422, '先创建连接，再在该连接下保存加密凭据');
      if (expectedProvider && readMode !== "mock" && readMode !== (sourceKind === "mac_drive" ? "drive_sync" : sourceKind === "chatgpt" ? "authorized_browser" : "native_api")) throw new DomainError("INVALID_MODE", 422, "来源读取模式与来源类型不一致");
      const currency = body.currency ?? "CNY";
      if (typeof currency !== "string" || !/^[A-Z]{3}$/.test(currency)) throw new DomainError("INVALID_CURRENCY", 422, "币种无效");
      return databaseCommand(ctx, request, body, 201, async (context) => {
        await requireActiveRole(context, context.db, "owner", "admin", "marketer");
        const result = (await context.db.query("INSERT INTO connections (id,org_id,provider,account_external_id,display_name,timezone,currency,source_kind,read_mode,scope_json,secret_ref,access_status,health,enabled_for_reporting) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,'not_configured','unknown',false) RETURNING *", [randomUUID(), context.orgId, provider, text(body, "account_external_id"), text(body, "display_name"), timezone(body), currency, sourceKind, readMode, JSON.stringify(scope), secret])).rows[0]!;
        await audit(context, context.db, "connection.created", "connection", String(result.id), { provider, mode: ctx.mode });
        return connectionDto(result);
      });
    }
    if (request.method === "POST" && id && action === "login" && !extra) {
      allowed(body, []); await requireActiveRole(ctx, ctx.db, "owner", "admin", "marketer");
      const connection = await one(ctx, "connections", id);
      requireConnectionMode(ctx, connection);
      if (connection.source_kind !== "chatgpt" || connection.access_status === "disabled") throw new DomainError("SOURCE_LOGIN_UNAVAILABLE", 409, "此来源不能进行会话登录核验");
      const login = (connection.scope_json as Record<string, unknown>).platform_login as Record<string, unknown> | undefined;
      if (!login?.recipe_id || !login.recipe_version) throw new DomainError("LOGIN_ADAPTER_NOT_CONFIGURED", 503, "请先选择服务端配置的登录适配器版本");
      const sourceContext = { ...ctx, mode: connection.read_mode === "mock" ? "mock" as const : "live" as const };
      const command = await service(sourceContext).enqueue({ command_type: "login", connection_id: id, idempotency_key: `${ctx.actorId}:${idempotencyKey(request)}`, adapter_version: String(login.recipe_version), input_ref: {} });
      return jsonData({ command_id: command.id, state: command.state, verified: false }, 202);
    }
    return null; // Source sync belongs to the marketing handler.
  }
  if (resource === "platform-accounts") {
    if (request.method === "GET" && !id) return jsonData((await ctx.db.query("SELECT a.* FROM platform_accounts a JOIN connections c ON c.org_id=a.org_id AND c.id=a.connection_id WHERE a.org_id=$1 AND ($2<>'mock' OR c.read_mode='mock') ORDER BY a.created_at DESC LIMIT 100", [ctx.orgId, ctx.mode])).rows.map((row) => dto(row, accountFields)));
    if (request.method === "GET" && id && (!action || action === "session")) { const account = await one(ctx, 'platform_accounts', id); requireReadableConnection(ctx, await one(ctx, 'connections', String(account.connection_id))); return jsonData(dto(account, accountFields)); }
    if (request.method === "POST" && !id) {
      requireRole(ctx, "owner", "admin", "marketer");
      allowed(body, ["connection_id", "provider", "channel_id", "account_external_id", "display_name", "timezone"]);
      const channelId = text(body, "channel_id", 60);
      if (channelId !== 'website' && !PLATFORM_DESCRIPTORS.some((item) => item.channelId === channelId)) throw new DomainError("INVALID_PLATFORM", 422, "发布平台未支持");
      return databaseCommand(ctx, request, body, 201, async (context) => {
        const connection = await one(context, "connections", text(body, "connection_id"));
        requireConnectionMode(context, connection);
        const provider = body.provider === undefined ? String(connection.provider) : text(body, "provider", 60);
        const externalId = text(body, "account_external_id");
        if (provider !== connection.provider || externalId !== connection.account_external_id) throw new DomainError("ACCOUNT_CONNECTION_MISMATCH", 422, "账号身份与连接不一致");
        if (channelId === 'website' && provider !== 'website') throw new DomainError('ACCOUNT_CONNECTION_MISMATCH', 422, '网站账号须绑定独立网站连接');
        const row = (await context.db.query("INSERT INTO platform_accounts (id,org_id,connection_id,provider,channel_id,account_external_id,display_name,timezone,enabled,session_status) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,false,'not_connected') RETURNING *", [randomUUID(), context.orgId, connection.id, provider, channelId, externalId, text(body, "display_name"), timezone(body)])).rows[0]!;
        await audit(context, context.db, "platform.account.created", "platform_account", String(row.id), { channelId });
        return dto(row, accountFields);
      });
    }
    if (request.method === "POST" && id && action === "disable") {
      requireRole(ctx, "owner", "admin"); allowed(body, []);
      return databaseCommand(ctx, request, body, 200, async (context) => {
        const row = (await context.db.query("SELECT * FROM platform_accounts WHERE org_id=$1 AND id=$2 FOR UPDATE", [context.orgId, id])).rows[0];
        if (!row) throw new DomainError("NOT_FOUND", 404, "账号不存在"); requireConnectionMode(context, await one(context, 'connections', String(row.connection_id))); assertVersion(Number(row.version), expectedVersion(request));
        const disabled = (await context.db.query("UPDATE platform_accounts SET enabled=false,session_status='revoked',session_version=session_version+1,version=version+1 WHERE org_id=$1 AND id=$2 RETURNING *", [context.orgId, id])).rows[0]!;
        await context.db.query("UPDATE login_sessions SET state='cancelled' WHERE org_id=$1 AND platform_account_id=$2 AND state IN ('created','active')", [context.orgId, id]);
        await context.db.query("UPDATE browser_commands SET state=CASE WHEN state='running' AND command_type IN ('publish','ad_write') THEN 'unknown' ELSE 'blocked' END WHERE org_id=$1 AND platform_account_id=$2 AND state IN ('queued','running')", [context.orgId, id]);
        await audit(context, context.db, "platform.account.revoked", "platform_account", id);
        return dto(disabled, accountFields);
      });
    }
    if (request.method === 'POST' && id && action === 'enable' && !extra) {
      allowed(body, []);
      if (ctx.actorType === 'service') throw new DomainError('FORBIDDEN', 403, '服务身份不能启用自己的执行账号');
      await requireActiveRole(ctx, ctx.db, 'owner', 'admin');
      return databaseCommand(ctx, request, body, 200, async context => {
        await requireActiveRole(context, context.db, 'owner', 'admin');
        const initial = await one(context, 'platform_accounts', id);
        const connection = (await context.db.query('SELECT * FROM connections WHERE org_id=$1 AND id=$2 FOR UPDATE', [context.orgId, initial.connection_id])).rows[0];
        const account = (await context.db.query('SELECT * FROM platform_accounts WHERE org_id=$1 AND id=$2 FOR UPDATE', [context.orgId, id])).rows[0]!;
        assertVersion(Number(account.version), expectedVersion(request));
        const login = (connection?.scope_json as Record<string, unknown> | undefined)?.platform_login as Record<string, unknown> | undefined;
        const now = Date.parse(nowIso(context)), verifiedAt = Date.parse(String(account.last_session_verified_at));
        if (context.mode !== 'live' || !connection || ['mock', 'manual_import'].includes(String(connection.read_mode)) || connection.access_status === 'disabled' || account.session_status !== 'active' || !Number.isFinite(verifiedAt) || verifiedAt < now - 30 * 60_000 || verifiedAt > now + 60_000 || account.session_expires_at && Date.parse(String(account.session_expires_at)) <= now || !account.adapter_version || account.adapter_version !== login?.recipe_version) throw new DomainError('ACCOUNT_SESSION_UNVERIFIED', 409, '当前账号、连接配置和近期真实会话尚未完成一致核验');
        const configurationHash = stableHash({ connection_id: connection.id, account_external_id: connection.account_external_id, read_mode: connection.read_mode, scope_json: connection.scope_json, secret_ref: connection.secret_ref });
        const proof = (await context.db.query("SELECT result_ref,input_ref FROM browser_commands WHERE org_id=$1 AND platform_account_id=$2 AND connection_id=$3 AND command_type IN ('login','session_verify') AND state='succeeded' ORDER BY finished_at DESC LIMIT 10", [context.orgId, id, connection.id])).rows.find(row => {
          const result = row.result_ref as Record<string, unknown>, input = row.input_ref as Record<string, unknown>, evidence = result?.evidence as Record<string, unknown>, data = result?.data as Record<string, unknown>;
          const capturedAt = Date.parse(String(evidence?.capturedAt));
          return input?.mode === 'live' && result?.status === 'verified' && evidence?.verified === true && ['api_readback', 'browser_readback'].includes(String(evidence.kind)) && evidence.externalAccountId === account.account_external_id && evidence.externalAccountId === connection.account_external_id && typeof evidence.evidenceRef === 'string' && evidence.evidenceRef.length > 0 && capturedAt >= now - 30 * 60_000 && capturedAt <= now + 60_000 && data?.configuration_hash === configurationHash && data.adapter_version === account.adapter_version && Number(data.session_version_after) === Number(account.session_version);
        });
        if (!proof) throw new DomainError('ACCOUNT_SESSION_UNVERIFIED', 409, '缺少绑定当前账号、凭据和适配器版本的真实身份回读记录');
        const updated = (await context.db.query('UPDATE platform_accounts SET enabled=true,version=version+1,updated_at=clock_timestamp() WHERE org_id=$1 AND id=$2 RETURNING *', [context.orgId, id])).rows[0]!;
        await audit(context, context.db, 'platform.account.enabled', 'platform_account', id, { session_version: Number(account.session_version), adapter_version: account.adapter_version, external_write_authorized: false });
        return { ...dto(updated, accountFields), execution_policy_required: true, platform_capabilities_required: true };
      });
    }
    if (request.method === "POST" && id && action === "login" && !extra) {
      allowed(body, []); await requireActiveRole(ctx, ctx.db, "owner", "admin", "marketer");
      const account = await one(ctx, "platform_accounts", id), connection = await one(ctx, "connections", String(account.connection_id));
      requireConnectionMode(ctx, connection);
      const login = (connection.scope_json as Record<string, unknown>).platform_login as Record<string, unknown> | undefined;
      if (!login?.recipe_id || !login.recipe_version) throw new DomainError("LOGIN_ADAPTER_NOT_CONFIGURED", 503, "请先选择服务端配置的登录适配器版本");
      const accountContext = { ...ctx, mode: connection.read_mode === "mock" ? "mock" as const : "live" as const };
      const command = await service(accountContext).enqueue({ command_type: "login", platform_account_id: id, connection_id: String(account.connection_id), idempotency_key: `${ctx.actorId}:${idempotencyKey(request)}`, adapter_version: String(login.recipe_version), session_version: Number(account.session_version), input_ref: {} });
      return jsonData({ command_id: command.id, state: command.state, verified: false }, 202);
    }
    if (request.method === 'POST' && id && action === 'capabilities' && extra === 'verify' && segments.length === 4) {
      allowed(body, []);
      if (ctx.actorType === 'service') throw new DomainError('FORBIDDEN', 403, '能力验收须由当前负责人或管理员发起');
      await requireActiveRole(ctx, ctx.db, 'owner', 'admin');
      if (ctx.mode !== 'live') throw new DomainError('LIVE_IDENTITY_REQUIRED', 403, '真实能力核验须使用独立登录的真实工作空间');
      const account = await one(ctx, 'platform_accounts', id), connection = await one(ctx, 'connections', String(account.connection_id));
      requireConnectionMode(ctx, connection);
      const login = (connection.scope_json as Record<string, unknown>).platform_login as Record<string, unknown> | undefined;
      if (!login?.recipe_id || !login.recipe_version) throw new DomainError('LOGIN_ADAPTER_NOT_CONFIGURED', 503, '请先选择服务端配置的适配器版本');
      const command = await service(ctx).enqueue({ command_type: 'session_verify', platform_account_id: id, connection_id: String(account.connection_id), idempotency_key: `${ctx.actorId}:${idempotencyKey(request)}`, adapter_version: String(login.recipe_version), session_version: Number(account.session_version), input_ref: { capability_artifact: 'server-selected' } });
      return jsonData({ command_id: command.id, state: command.state, verified: false, capability_status: 'verification_pending' }, 202);
    }
    if (request.method === "POST" && id && action === "session" && extra === "verify") {
      requireRole(ctx, "owner", "admin", "marketer"); allowed(body, []);
      const account = await one(ctx, "platform_accounts", id);
      requireConnectionMode(ctx, await one(ctx, 'connections', String(account.connection_id)));
      const command = await service(ctx).enqueue({ command_type: "session_verify", idempotency_key: `${ctx.actorId}:${idempotencyKey(request)}`, platform_account_id: id, connection_id: String(account.connection_id), session_version: Number(account.session_version), adapter_version: String(account.adapter_version ?? "unconfigured-v1"), input_ref: {} });
      return jsonData({ command_id: command.id, state: command.state, verified: false, integration_status: "verification_required" }, 202);
    }
    if (request.method === "POST" && id && action === "login-sessions") {
      allowed(body, []); requireRole(ctx, "owner", "admin", "marketer");
      const account = await one(ctx, 'platform_accounts', id);
      requireConnectionMode(ctx, await one(ctx, 'connections', String(account.connection_id)));
      // This special idempotency record stores only the resource reference. The raw ticket is emitted once.
      const key = idempotencyKey(request), scope = `browser.login.create:${id}:${ctx.actorId}`, hash = stableHash({ accountId: id, actorId: ctx.actorId });
      const result = await ctx.db.transaction(async (tx) => {
        await tx.query("INSERT INTO idempotency_records (org_id,scope,key,request_hash,expires_at) VALUES ($1,$2,$3,$4,now()+interval '7 days') ON CONFLICT (org_id,scope,key) DO NOTHING", [ctx.orgId, scope, key, hash]);
        const prior = (await tx.query("SELECT response_json,status_code,request_hash FROM idempotency_records WHERE org_id=$1 AND scope=$2 AND key=$3 FOR UPDATE", [ctx.orgId, scope, key])).rows[0]!;
        if (prior.request_hash !== hash) throw new DomainError("IDEMPOTENCY_CONFLICT", 409, "幂等请求不一致");
        if (prior.status_code !== null) return { ...(prior.response_json as Record<string, unknown>), interaction_ticket: null, interaction_url: null, replay: true };
        const created = await service(transactionContext(ctx, tx)).createLogin(id);
        const safe = { id: created.id, ticket_expires_at: created.ticketExpiresAt, expires_at: created.expiresAt, interaction_ready: false, status: 'challenge_verification_pending' };
        await tx.query("UPDATE idempotency_records SET response_json=$4,status_code=201 WHERE org_id=$1 AND scope=$2 AND key=$3", [ctx.orgId, scope, key, JSON.stringify(safe)]);
        return { ...safe, interaction_ticket: created.ticket, interaction_url: null, replay: false };
      });
      return jsonData(result, 201);
    }
  }
  if (resource === "login-sessions" && id) {
    const row = await one(ctx, "login_sessions", id);
    if (request.method === 'GET') { const account = await one(ctx, 'platform_accounts', String(row.platform_account_id)); requireReadableConnection(ctx, await one(ctx, 'connections', String(account.connection_id))); }
    if (row.user_id !== ctx.actorId) throw new DomainError("FORBIDDEN", 403, "登录交互绑定其他用户");
    if (request.method !== 'GET') { const account = await one(ctx, 'platform_accounts', String(row.platform_account_id)); requireConnectionMode(ctx, await one(ctx, 'connections', String(account.connection_id))); }
    if (request.method === "GET" && !action) return jsonData(dto(row, loginFields));
    if (request.method === "POST" && action === "redeem") {
      allowed(body, ["platform_account_id", "interaction_ticket"]);
      return jsonData(await service(ctx).redeemLogin({ sessionId: id, accountId: text(body, "platform_account_id"), ticket: text(body, "interaction_ticket", 100) }));
    }
    if (request.method === 'POST' && ['challenge', 'complete'].includes(action ?? '') && !extra) {
      if (ctx.mode !== 'live') throw new DomainError('LIVE_IDENTITY_REQUIRED', 403, '真实验证交互须使用独立登录的真实工作空间');
      allowed(body, action === 'complete' ? ['platform_account_id'] : ['action', 'code']);
      if (body.platform_account_id !== undefined && body.platform_account_id !== row.platform_account_id) throw new DomainError('FORBIDDEN', 403, '验证交互账号不匹配');
      const operation = action === 'complete' ? 'verify' : String(body.action);
      if (!['open', 'submit', 'verify', 'close'].includes(operation) || body.code !== undefined && (operation !== 'submit' || typeof body.code !== 'string' || !/^[A-Za-z0-9]{1,16}$/.test(body.code))) throw new DomainError('INVALID_REQUEST', 422, '验证交互操作或验证码格式无效');
      await requireActiveRole(ctx, ctx.db, 'owner', 'admin', 'marketer');
      if (operation !== 'close') await service(ctx).authorizeInteraction(id, String(row.platform_account_id));
      // OTP and cropped QR data are ephemeral. This action deliberately does not use databaseCommand.
      try {
        const result = await browserClientFromEnvironment(process.env, 'ops').challenge(ctx.orgId, id, { action: operation as 'open'|'submit'|'verify'|'close', ...(typeof body.code === 'string' ? { code: body.code } : {}) });
        return jsonData(interactionDto(result));
      } catch (error) {
        const unavailable = error instanceof DomainError && ['LOGIN_CHALLENGE_UNSUPPORTED', 'BROWSER_IDENTITY_NOT_CONFIGURED', 'BROWSER_SERVICE_UNAVAILABLE', 'LOGIN_ADAPTER_NOT_CONFIGURED'].includes(error.code);
        if (operation === 'close' || operation === 'open' && unavailable) await cancelBoundInteraction(ctx, id);
        if (operation === 'close') return jsonData({ interaction_ready: false, state: 'cancelled', verified: false });
        if (unavailable) throw new DomainError(error.code, 503, '当前账号的受控验证适配器或服务尚未配置，保持待处理；不会标记登录成功');
        throw error;
      }
    }
  }
  return null;
}
