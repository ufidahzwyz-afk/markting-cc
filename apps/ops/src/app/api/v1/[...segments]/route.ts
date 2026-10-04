import { authenticate, assertWriteOrigin, isLocalIdentity } from "@/lib/server-context";
import { databaseCommand, errorResponse, expectedVersion, idempotencyKey, jsonData, readBody } from "@/lib/http";
import { getWorkspaceOverview, getWorkspaceThemes, saveWorkspaceTheme, type WorkspaceThemeInput } from "@boran/domain/workspace";
import { DomainError, audit, stableHash, uuid } from "@boran/domain/core";
import { requireOwner, activeRoles } from "@boran/domain/authz";
import { validatePrivacyConfiguration } from "@boran/domain/privacy";
import { validateAnalyticsConfiguration } from "@boran/domain/events";
import { validateOperatingSchedule } from "@boran/worker/scheduler";
import { handleMarketing } from "@/lib/handlers/marketing";
import { handleContent } from "@/lib/handlers/content";
import { handleAdsReporting } from "@/lib/handlers/ads-reporting";
import { handleLeads } from "@/lib/handlers/leads";
import { handleExecution } from "@/lib/handlers/execution";
import { handleBrowser } from "@/lib/handlers/browser";
import { handleAutomation } from "@/lib/handlers/automation";
import { handleCredentials } from "@/lib/handlers/credentials";
import { handleModel } from "@/lib/handlers/model";
import type { ServiceContext } from "@boran/domain/core";

export const dynamic = "force-dynamic";
type RouteContext = { params: Promise<{ segments: string[] }> };
const publicSettings = new Set(["privacy_configuration", "analytics_configuration", "site_policy", "notification_channels", "operating_schedule"]);
async function handleWorkspace(ctx: ServiceContext, request: Request, parts: string[], body?: Record<string, unknown>): Promise<Response | null> {
  const method = request.method;
  if (parts.join("/") === "workspace/themes") {
    if (method === "GET") return jsonData(await getWorkspaceThemes(ctx), 200, { mode: ctx.mode });
    if (method === "POST") return databaseCommand(ctx, request, body, 201, async command => saveWorkspaceTheme(command, body as unknown as WorkspaceThemeInput));
  }
  if (parts[0] === "workspace" && parts[1] === "themes" && parts.length === 3 && parts[2] !== "batch" && method === "PATCH") {
    const version = expectedVersion(request);
    return databaseCommand(ctx, request, body, 200, async command => saveWorkspaceTheme(command, body as unknown as WorkspaceThemeInput, { id: parts[2]!, expectedVersion: version }));
  }
  if (parts.join("/") === "workspace/themes/batch" && method === "POST") {
    if (!body || !Array.isArray(body.updates) || body.updates.length < 1 || body.updates.length > 50) throw new DomainError("INVALID_BATCH", 400, "批量请求须含 1 至 50 个主题");
    const updates = body.updates as { id: string; version: number; theme: WorkspaceThemeInput }[];
    if (updates.some(update => !update || typeof update.id !== "string" || !Number.isSafeInteger(update.version) || update.version < 1 || !update.theme) || new Set(updates.map(update => update.id)).size !== updates.length) throw new DomainError("INVALID_BATCH", 400, "批量主题或版本无效");
    return databaseCommand(ctx, request, body, 200, async command => {
      for (const update of updates) await saveWorkspaceTheme(command, update.theme, { id: update.id, expectedVersion: update.version });
      return (await getWorkspaceThemes(command)).filter(theme => updates.some(update => update.id === theme.id));
    });
  }
  if (parts.join("/") === "workspace/members" && method === "GET") {
    const roles = await activeRoles(ctx);
    if (!roles.some(role => ["owner", "marketer"].includes(role))) throw new DomainError("FORBIDDEN", 403, "无权查看运营成员");
    return jsonData((await ctx.db.query("SELECT u.id,u.display_name AS name,m.roles FROM users u JOIN memberships m ON m.user_id=u.id WHERE m.org_id=$1 AND u.active AND m.active ORDER BY u.display_name", [ctx.orgId])).rows);
  }
  if (parts.join("/") === "workspace/overview" && method === "GET") return jsonData(await getWorkspaceOverview(ctx), 200, { mode: ctx.mode });
  if (parts.join("/") === "session/actor" && method === "POST") {
    if (!isLocalIdentity()) throw new DomainError("FORBIDDEN", 403, "仅本地测试可切换模拟账号");
    if (!body || !["00000000-0000-4000-8000-000000000002", "00000000-0000-4000-8000-000000000003"].includes(String(body.actor_id))) throw new DomainError("INVALID_ACTOR", 400, "测试运营账号无效");
    const response = jsonData({ actor_id: body.actor_id });
    response.headers.append("Set-Cookie", `boran_dev_actor=${body.actor_id}; Path=/; HttpOnly; SameSite=Strict`);
    return response;
  }
  if (parts[0] === "notifications") {
    await activeRoles(ctx);
    if (method === "GET" && parts.length === 1) return jsonData((await ctx.db.query("SELECT n.id,n.report_id,n.channel,n.status,n.created_at,n.sent_at,r.kind,r.period_start::text,r.period_end::text,r.revision,r.quality,r.body_json->>'mode' AS mode,EXISTS(SELECT 1 FROM outbox_events e LEFT JOIN notifications en ON en.org_id=e.org_id AND en.id=e.aggregate_id WHERE e.org_id=n.org_id AND e.dispatched_at IS NULL AND e.payload->>'mode'=$4 AND e.payload->>'processing_error'='WRITE_DISABLED' AND ((e.event_type='report.archive' AND e.aggregate_id=r.id) OR (e.event_type='notification.deliver' AND en.report_id=r.id))) AS external_delivery_paused,(s.key IS NOT NULL) AS read FROM notifications n JOIN report_snapshots r ON r.org_id=n.org_id AND r.id=n.report_id LEFT JOIN settings s ON s.org_id=n.org_id AND s.key='notification.read.'||n.id::text||'.'||$2 WHERE n.org_id=$1 AND n.channel='in_app' AND n.recipient_ref=$3 AND r.body_json->>'mode'=$4 ORDER BY n.created_at DESC LIMIT 100", [ctx.orgId, ctx.actorId, `user:${ctx.actorId}`, ctx.mode])).rows, 200, { mode: ctx.mode });
    if (method === "POST" && parts.length === 3 && parts[2] === "read") return databaseCommand(ctx, request, body, 200, async command => {
      const row = (await command.db.query("SELECT n.id FROM notifications n JOIN report_snapshots r ON r.org_id=n.org_id AND r.id=n.report_id WHERE n.org_id=$1 AND n.id=$2 AND n.channel='in_app' AND n.recipient_ref=$3 AND r.body_json->>'mode'=$4", [ctx.orgId, parts[1], `user:${ctx.actorId}`, ctx.mode])).rows[0];
      if (!row) throw new DomainError("NOT_FOUND", 404, "该通知不属于当前成员");
      await command.db.query("INSERT INTO settings(org_id,key,value,schema_version,updated_by) VALUES($1,$2,'true',1,$3) ON CONFLICT(org_id,key) DO NOTHING", [ctx.orgId, `notification.read.${parts[1]}.${ctx.actorId}`, ctx.actorId]);
      await audit(command, command.db, "notification.read", "notification", parts[1]!);
      return { id: parts[1], read: true };
    });
  }
  if (parts[0] === "settings") {
    const roles = await activeRoles(ctx);
    const visibleKeys = [...publicSettings].filter(key => !["privacy_configuration", "analytics_configuration"].includes(key) || roles.includes("owner"));
    if (method === "GET" && parts.length === 1) return jsonData((await ctx.db.query("SELECT key,value,schema_version,updated_at FROM settings WHERE org_id=$1 AND key=ANY($2::text[]) ORDER BY key", [ctx.orgId, visibleKeys])).rows, 200, { mode: ctx.mode });
    if (method === "PUT" && parts.length === 2 && publicSettings.has(parts[1]!)) {
      await requireOwner(ctx);
      const key = parts[1]!;
      if (!["privacy_configuration", "analytics_configuration", "operating_schedule"].includes(key)) throw new DomainError("CONFIGURATION_VALIDATION_PENDING", 503, "该配置需要专用范围校验，不允许任意 JSON 写入");
      const configVersion = Number(request.headers.get("if-match"));
      if (!request.headers.has("if-match") || !Number.isSafeInteger(configVersion) || configVersion < 0) throw new DomainError("VERSION_REQUIRED", 428, "配置更新需要当前版本，首次为 0");
      return databaseCommand(ctx, request, body, 200, async command => {
        await command.db.query("SELECT id FROM organizations WHERE id=$1 FOR UPDATE", [ctx.orgId]);
        const current = (await command.db.query("SELECT schema_version FROM settings WHERE org_id=$1 AND key=$2", [ctx.orgId, key])).rows[0];
        if (Number(current?.schema_version ?? 0) !== configVersion) throw new DomainError("VERSION_CONFLICT", 409, "配置已被其他运营更新，请刷新");
        const validated = key === "privacy_configuration" ? await validatePrivacyConfiguration(command, body) : key === "analytics_configuration" ? await validateAnalyticsConfiguration(command, body) : await validateOperatingSchedule(command, body);
        const nextVersion = configVersion + 1;
        await command.db.query("INSERT INTO settings(org_id,key,value,schema_version,updated_by) VALUES($1,$2,$3,$4,$5) ON CONFLICT(org_id,key) DO UPDATE SET value=excluded.value,schema_version=excluded.schema_version,updated_by=excluded.updated_by,updated_at=now()", [ctx.orgId, key, JSON.stringify(validated), nextVersion, ctx.actorId]);
        await audit(command, command.db, "settings.updated", "setting", key, { schemaVersion: nextVersion });
        return { key, value: validated, schema_version: nextVersion };
      });
    }
  }
  if (parts.join("/") === "uploads" && method === "POST") {
    const roles = await activeRoles(ctx);
    if (!roles.some(role => ["owner", "marketer"].includes(role))) throw new DomainError("FORBIDDEN", 403, "无权上传报表");
    if (!body || body.content_type !== "text/csv" || typeof body.csv !== "string" || Buffer.byteLength(body.csv) > 800000 || !body.csv.trim()) throw new DomainError("INVALID_UPLOAD", 400, "当前上传接口接收最多 800 KB 的 CSV 报表");
    return databaseCommand(ctx, request, body, 201, async command => {
      const objectKey = `report:${uuid()}`;
      const hash = (await import("node:crypto")).createHash("sha256").update(String(body.csv)).digest("hex");
      await command.db.query("INSERT INTO settings(org_id,key,value,schema_version,updated_by) VALUES($1,$2,$3,1,$4)", [ctx.orgId, `import.upload:${objectKey}`, JSON.stringify({ csv: body.csv, mode: ctx.mode, uploaded_by: ctx.actorId, file_hash: hash }), ctx.actorId]);
      await audit(command, command.db, "report.uploaded", "upload", objectKey, { fileHash: hash });
      return { object_key: objectKey, file_hash: hash, content_type: "text/csv" };
    });
  }
  return null;
}
async function route(request: Request, routeContext: RouteContext) {
  try {
    const ctx = await authenticate(request.headers);
    const { segments } = await routeContext.params;
    let body: Record<string, unknown> | undefined;
    if (!["GET", "HEAD"].includes(request.method)) {
      assertWriteOrigin(request);
      idempotencyKey(request);
      body = request.method === "DELETE" && request.body === null ? {} : await readBody(request);
    }
    for (const handler of [handleModel, handleAutomation, handleCredentials, handleWorkspace, handleMarketing, handleContent, handleAdsReporting, handleLeads, handleExecution, handleBrowser]) {
      const response = await handler(ctx, request, segments, body);
      if (response) return response;
    }
    throw new DomainError("NOT_FOUND", 404, "接口不存在");
  } catch (error) { return errorResponse(error); }
}
export const GET = route;
export const POST = route;
export const PATCH = route;
export const PUT = route;
export const DELETE = route;
