import { randomUUID } from "node:crypto";
import { createBrowserService } from "@boran/browser-runtime/service";
import { createPlatformRegistry, PLATFORM_DESCRIPTORS } from "@boran/connectors";
import { assertVersion, audit, DomainError, requireRole, stableHash, type ServiceContext } from "@boran/domain/core";
import { databaseCommand, expectedVersion, idempotencyKey, jsonData, transactionContext } from "../http";

const dto = (row: Record<string, unknown>, fields: string[]) => Object.fromEntries(fields.filter((key) => row[key] !== undefined).map((key) => [key, row[key]]));
const accountFields = ["id", "connection_id", "provider", "channel_id", "display_name", "enabled", "session_status", "session_expires_at", "last_session_verified_at", "session_version", "version", "timezone"];
const connectionFields = ["id", "provider", "display_name", "timezone", "currency", "health", "enabled_for_reporting", "authoritative_report_type", "last_success_at", "source_kind", "read_mode", "access_status", "last_attempt_at", "last_error_code", "capabilities_verified_at"];
function connectionVersion(row: Record<string, unknown>) { return stableHash({ display_name: row.display_name, timezone: row.timezone, currency: row.currency, enabled_for_reporting: row.enabled_for_reporting, authoritative_report_type: row.authoritative_report_type ?? null, updated_at: row.updated_at instanceof Date ? row.updated_at.toISOString() : row.updated_at }); }
function connectionDto(row: Record<string, unknown>) { return { ...dto(row, connectionFields), edit_version: connectionVersion(row) }; }
const loginFields = ["id", "platform_account_id", "state", "expires_at", "ticket_expires_at", "started_at", "completed_at", "version"];
function text(body: Record<string, unknown>, key: string, limit = 200) { const value = body[key]; if (typeof value !== "string" || !value.trim() || value.length > limit) throw new DomainError("INVALID_REQUEST", 422, `${key} 无效`); return value.trim(); }
function allowed(body: Record<string, unknown>, keys: string[]) { if (Object.keys(body).some((key) => !keys.includes(key))) throw new DomainError("INVALID_REQUEST", 422, "请求包含未允许字段"); }
function service(ctx: ServiceContext) { return createBrowserService(ctx, { adapters: createPlatformRegistry({ mode: ctx.mode }) }); }
async function one(ctx: ServiceContext, table: "connections" | "platform_accounts" | "login_sessions", id: string) {
  const row = (await ctx.db.query(`SELECT * FROM ${table} WHERE org_id=$1 AND id=$2`, [ctx.orgId, id])).rows[0];
  if (!row) throw new DomainError("NOT_FOUND", 404, "记录不存在");
  return row;
}
function timezone(body: Record<string, unknown>) { const zone = typeof body.timezone === "string" ? body.timezone : "Asia/Shanghai"; try { new Intl.DateTimeFormat("zh-CN", { timeZone: zone }); } catch { throw new DomainError("INVALID_REQUEST", 422, "时区无效"); } return zone; }

export async function handleBrowser(ctx: ServiceContext, request: Request, segments: string[], body: Record<string, unknown> = {}): Promise<Response | null> {
  const [resource, id, action, extra] = segments;
  if (!["connections", "platform-accounts", "login-sessions"].includes(resource ?? "")) return null;
  requireRole(ctx, "owner", "admin", "marketer", "reviewer", "viewer");
  if (resource === "connections") {
    if (request.method === "GET" && !id) return jsonData((await ctx.db.query("SELECT * FROM connections WHERE org_id=$1 ORDER BY created_at DESC LIMIT 100", [ctx.orgId])).rows.map(connectionDto));
    if (request.method === "GET" && id && (!action || action === "health")) return jsonData(connectionDto(await one(ctx, "connections", id)));
    if (request.method === "PATCH" && id && !action) {
      requireRole(ctx, "owner", "admin", "marketer");
      allowed(body, ["display_name", "enabled_for_reporting", "timezone", "currency"]);
      if (!Object.keys(body).length) throw new DomainError("INVALID_REQUEST", 422, "修改字段不能为空");
      if (body.enabled_for_reporting !== undefined && typeof body.enabled_for_reporting !== "boolean") throw new DomainError("INVALID_REQUEST", 422, "enabled_for_reporting 须为布尔值");
      if (body.currency !== undefined && (typeof body.currency !== "string" || !["CNY", "USD", "EUR", "JPY", "GBP", "HKD", "SGD", "TWD", "AUD", "CAD"].includes(body.currency))) throw new DomainError("INVALID_CURRENCY", 422, "币种无效");
      const expected = request.headers.get("if-match")?.replace(/^W\//, "").replaceAll('"', "");
      if (!expected || !/^[a-f0-9]{64}$/.test(expected)) throw new DomainError("VERSION_REQUIRED", 428, "修改需要 If-Match edit_version");
      return databaseCommand(ctx, request, body, 200, async (context) => {
        const row = (await context.db.query("SELECT * FROM connections WHERE org_id=$1 AND id=$2 FOR UPDATE", [context.orgId, id])).rows[0];
        if (!row) throw new DomainError("NOT_FOUND", 404, "连接不存在");
        if (connectionVersion(row) !== expected) throw new DomainError("VERSION_CONFLICT", 409, "连接配置已变化，请重新读取");
        const zone = body.timezone === undefined ? row.timezone : timezone(body), currency = body.currency ?? row.currency;
        if ((zone !== row.timezone || currency !== row.currency) && (await context.db.query("SELECT id FROM ingestion_batches WHERE org_id=$1 AND connection_id=$2 LIMIT 1", [context.orgId, id])).rowCount) throw new DomainError("HISTORICAL_METRIC_SCOPE_LOCKED", 409, "已有报表批次不能改变时区或币种，请创建独立连接");
        const reporting = body.enabled_for_reporting ?? row.enabled_for_reporting;
        const updated = (await context.db.query("UPDATE connections SET display_name=$3,enabled_for_reporting=$4,timezone=$5,currency=$6,authoritative_report_type=CASE WHEN $4 THEN COALESCE(authoritative_report_type,'campaign_daily') ELSE authoritative_report_type END,updated_at=clock_timestamp() WHERE org_id=$1 AND id=$2 RETURNING *", [context.orgId, id, body.display_name === undefined ? row.display_name : text(body, "display_name"), reporting, zone, currency])).rows[0]!;
        await audit(context, context.db, "connection.updated", "connection", id, { fields: Object.keys(body), reporting: Boolean(reporting), mode: ctx.mode });
        return connectionDto(updated);
      });
    }
    if (request.method === "POST" && !id) {
      requireRole(ctx, "owner", "admin", "marketer");
      allowed(body, ["provider", "account_external_id", "display_name", "timezone", "currency", "source_kind", "read_mode"]);
      const provider = text(body, "provider", 60);
      if (!["baidu_ads", "google_drive", "public_web", "chatgpt_authorized", "aifanfan", "mock", ...PLATFORM_DESCRIPTORS.map((item) => item.channelId)].includes(provider)) throw new DomainError("INVALID_PROVIDER", 422, "连接类型未支持");
      const readMode = body.read_mode ?? (ctx.mode === "mock" ? "mock" : "native_api");
      if (!["native_api", "authorized_browser", "drive_sync", "manual_import", "mock"].includes(String(readMode)) || ctx.mode === "live" && readMode === "mock") throw new DomainError("INVALID_MODE", 422, "读取模式无效");
      const sourceKind = body.source_kind ?? null;
      if (sourceKind !== null && !["market_public", "competitor_public", "mac_drive", "chatgpt", "other"].includes(String(sourceKind))) throw new DomainError("INVALID_SOURCE_KIND", 422, "来源分类无效");
      const currency = body.currency ?? "CNY";
      if (typeof currency !== "string" || !/^[A-Z]{3}$/.test(currency)) throw new DomainError("INVALID_CURRENCY", 422, "币种无效");
      return databaseCommand(ctx, request, body, 201, async (context) => {
        const result = (await context.db.query("INSERT INTO connections (id,org_id,provider,account_external_id,display_name,timezone,currency,source_kind,read_mode,access_status,health,enabled_for_reporting) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,'not_configured','unknown',false) RETURNING *", [randomUUID(), context.orgId, provider, text(body, "account_external_id"), text(body, "display_name"), timezone(body), currency, sourceKind, readMode])).rows[0]!;
        await audit(context, context.db, "connection.created", "connection", String(result.id), { provider, mode: ctx.mode });
        return connectionDto(result);
      });
    }
    return null; // Source sync belongs to the marketing handler.
  }
  if (resource === "platform-accounts") {
    if (request.method === "GET" && !id) return jsonData((await ctx.db.query("SELECT * FROM platform_accounts WHERE org_id=$1 ORDER BY created_at DESC LIMIT 100", [ctx.orgId])).rows.map((row) => dto(row, accountFields)));
    if (request.method === "GET" && id && (!action || action === "session")) return jsonData(dto(await one(ctx, "platform_accounts", id), accountFields));
    if (request.method === "POST" && !id) {
      requireRole(ctx, "owner", "admin", "marketer");
      allowed(body, ["connection_id", "provider", "channel_id", "account_external_id", "display_name", "timezone"]);
      const channelId = text(body, "channel_id", 60);
      if (!PLATFORM_DESCRIPTORS.some((item) => item.channelId === channelId)) throw new DomainError("INVALID_PLATFORM", 422, "发布平台未支持");
      return databaseCommand(ctx, request, body, 201, async (context) => {
        const connection = await one(context, "connections", text(body, "connection_id"));
        const provider = body.provider === undefined ? String(connection.provider) : text(body, "provider", 60);
        const externalId = text(body, "account_external_id");
        if (provider !== connection.provider || externalId !== connection.account_external_id) throw new DomainError("ACCOUNT_CONNECTION_MISMATCH", 422, "账号身份与连接不一致");
        const row = (await context.db.query("INSERT INTO platform_accounts (id,org_id,connection_id,provider,channel_id,account_external_id,display_name,timezone,enabled,session_status) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,false,'not_connected') RETURNING *", [randomUUID(), context.orgId, connection.id, provider, channelId, externalId, text(body, "display_name"), timezone(body)])).rows[0]!;
        await audit(context, context.db, "platform.account.created", "platform_account", String(row.id), { channelId });
        return dto(row, accountFields);
      });
    }
    if (request.method === "POST" && id && action === "disable") {
      requireRole(ctx, "owner", "admin"); allowed(body, []);
      return databaseCommand(ctx, request, body, 200, async (context) => {
        const row = (await context.db.query("SELECT * FROM platform_accounts WHERE org_id=$1 AND id=$2 FOR UPDATE", [context.orgId, id])).rows[0];
        if (!row) throw new DomainError("NOT_FOUND", 404, "账号不存在"); assertVersion(Number(row.version), expectedVersion(request));
        const disabled = (await context.db.query("UPDATE platform_accounts SET enabled=false,session_status='revoked',session_version=session_version+1,version=version+1 WHERE org_id=$1 AND id=$2 RETURNING *", [context.orgId, id])).rows[0]!;
        await context.db.query("UPDATE login_sessions SET state='cancelled' WHERE org_id=$1 AND platform_account_id=$2 AND state IN ('created','active')", [context.orgId, id]);
        await context.db.query("UPDATE browser_commands SET state=CASE WHEN state='running' AND command_type IN ('publish','ad_write') THEN 'unknown' ELSE 'blocked' END WHERE org_id=$1 AND platform_account_id=$2 AND state IN ('queued','running')", [context.orgId, id]);
        await audit(context, context.db, "platform.account.revoked", "platform_account", id);
        return dto(disabled, accountFields);
      });
    }
    if (request.method === "POST" && id && action === "session" && extra === "verify") {
      requireRole(ctx, "owner", "admin", "marketer"); allowed(body, []);
      const account = await one(ctx, "platform_accounts", id);
      const command = await service(ctx).enqueue({ command_type: "session_verify", idempotency_key: `${ctx.actorId}:${idempotencyKey(request)}`, platform_account_id: id, session_version: Number(account.session_version), adapter_version: String(account.adapter_version ?? "unconfigured-v1"), input_ref: {} });
      return jsonData({ command_id: command.id, state: command.state, verified: false, integration_status: "verification_required" }, 202);
    }
    if (request.method === "POST" && id && action === "login-sessions") {
      allowed(body, []); requireRole(ctx, "owner", "admin", "marketer");
      // This special idempotency record stores only the resource reference. The raw ticket is emitted once.
      const key = idempotencyKey(request), scope = `browser.login.create:${id}:${ctx.actorId}`, hash = stableHash({ accountId: id, actorId: ctx.actorId });
      const result = await ctx.db.transaction(async (tx) => {
        await tx.query("INSERT INTO idempotency_records (org_id,scope,key,request_hash,expires_at) VALUES ($1,$2,$3,$4,now()+interval '7 days') ON CONFLICT (org_id,scope,key) DO NOTHING", [ctx.orgId, scope, key, hash]);
        const prior = (await tx.query("SELECT response_json,status_code,request_hash FROM idempotency_records WHERE org_id=$1 AND scope=$2 AND key=$3 FOR UPDATE", [ctx.orgId, scope, key])).rows[0]!;
        if (prior.request_hash !== hash) throw new DomainError("IDEMPOTENCY_CONFLICT", 409, "幂等请求不一致");
        if (prior.status_code !== null) return { ...(prior.response_json as Record<string, unknown>), interaction_ticket: null, interaction_url: null, replay: true };
        const created = await service(transactionContext(ctx, tx)).createLogin(id);
        const safe = { id: created.id, ticket_expires_at: created.ticketExpiresAt, expires_at: created.expiresAt, interaction_ready: false, status: created.status };
        await tx.query("UPDATE idempotency_records SET response_json=$4,status_code=201 WHERE org_id=$1 AND scope=$2 AND key=$3", [ctx.orgId, scope, key, JSON.stringify(safe)]);
        return { ...safe, interaction_ticket: created.ticket, interaction_url: null, replay: false };
      });
      return jsonData(result, 201);
    }
  }
  if (resource === "login-sessions" && id) {
    const row = await one(ctx, "login_sessions", id);
    if (row.user_id !== ctx.actorId) throw new DomainError("FORBIDDEN", 403, "登录交互绑定其他用户");
    if (request.method === "GET" && !action) return jsonData(dto(row, loginFields));
    if (request.method === "POST" && action === "redeem") {
      allowed(body, ["platform_account_id", "interaction_ticket"]);
      return jsonData(await service(ctx).redeemLogin({ sessionId: id, accountId: text(body, "platform_account_id"), ticket: text(body, "interaction_ticket", 100) }));
    }
    if (request.method === "POST" && action === "complete") throw new DomainError("LOGIN_PROXY_INTEGRATION_REQUIRED", 503, "受控登录代理和真实账号核验尚未配置");
  }
  return null;
}
