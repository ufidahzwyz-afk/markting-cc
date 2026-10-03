import { createHash } from "node:crypto";
import { readFile, realpath, stat } from "node:fs/promises";
import path from "node:path";
import { validateApiRequest } from "@boran/contracts";
import { scheduleRun } from "@boran/worker";
import { DomainError, requireRole, stableHash } from "@boran/domain/core";
import type { ServiceContext } from "@boran/domain/core";
import { archiveContentItem, updatePageMetadata, calibratePlatformProfile, createContentItem, createContentVersion, createPage, createPlatformProfile, createPlatformProfileVersion, createPlatformVariant, createPublishJob, getPagePreview, publishPage, reviewContentVersion, rollbackPage } from "@boran/domain/content";
import type { AssetVerifier, ContentItemInput, PageInput, PlatformVariantInput, SitePolicy } from "@boran/domain/content";
import { databaseCommand, expectedVersion, idempotencyKey, jsonData } from "@/lib/http";

function policy(ctx: ServiceContext): SitePolicy {
  const publicOrigin = process.env.PUBLIC_BASE_URL ?? process.env.PUBLIC_SITE_ORIGIN ?? (ctx.mode === "mock" ? "http://localhost:3001" : "");
  const allowedPathPrefixes = (process.env.PUBLIC_ALLOWED_PATH_PREFIXES ?? process.env.PUBLIC_SITE_ALLOWED_PATH_PREFIXES ?? "").split(",").map((item) => item.trim()).filter(Boolean);
  return { publicOrigin, allowedPathPrefixes };
}
const verifyObject: AssetVerifier = async (asset) => {
  if (!process.env.BORAN_MEDIA_ROOT) throw new DomainError("MEDIA_STORAGE_REQUIRED", 503, "实际媒体存储未配置");
  if (path.isAbsolute(asset.object_key) || asset.object_key.includes("\\") || asset.object_key.split("/").some((part) => !part || part === "." || part === "..")) throw new DomainError("UNSAFE_MEDIA_PATH", 422, "媒体路径无效");
  const root = await realpath(process.env.BORAN_MEDIA_ROOT); const file = await realpath(path.join(root, asset.object_key));
  if (!file.startsWith(`${root}${path.sep}`)) throw new DomainError("UNSAFE_MEDIA_PATH", 422, "媒体路径越界");
  const info = await stat(file); if (!info.isFile() || info.size < 1 || info.size > 50 * 1024 * 1024) throw new DomainError("MEDIA_SIZE_INVALID", 422, "媒体大小无效");
  const bytes = await readFile(file); if (createHash("sha256").update(bytes).digest("hex") !== asset.content_hash) throw new DomainError("MEDIA_HASH_MISMATCH", 422, "素材已改变");
  return { bytes, mimeType: asset.mime_type };
};
function only(body: Record<string, unknown>, keys: string[]) { if (Object.keys(body).some((key) => !keys.includes(key))) throw new DomainError("INVALID_REQUEST", 400, "请求包含不允许修改的字段"); }
function text(body: Record<string, unknown>, key: string) { if (typeof body[key] !== "string" || !body[key]) throw new DomainError("INVALID_REQUEST", 400, `${key} 必填`); return body[key] as string; }
function contentVersion(request: Request) { const header = request.headers.get("if-match")?.replaceAll('"', ""); const value = Number(header); if (!header || !Number.isSafeInteger(value) || value < 0) throw new DomainError("VERSION_REQUIRED", 428, "内容编辑需要 If-Match 正文版本（首次为 0）"); return value; }
async function readOne(ctx: ServiceContext, table: string, id: string) {
  if (!/^[0-9a-f-]{36}$/i.test(id)) throw new DomainError("INVALID_ID", 400, "资源 ID 无效");
  const row = (await ctx.db.query(`SELECT * FROM ${table} WHERE org_id=$1 AND id=$2`, [ctx.orgId, id])).rows[0]; if (!row) throw new DomainError("NOT_FOUND", 404, "组织内资源不存在"); return row;
}
function limit(request: Request) { const input = Number(new URL(request.url).searchParams.get("limit") ?? 50); return Number.isInteger(input) && input > 0 ? Math.min(input, 200) : 50; }

export async function handleContent(ctx: ServiceContext, request: Request, segments: string[], body: Record<string, unknown> = {}): Promise<Response | null> {
  const [resource, id, operation, suboperation] = segments; const method = request.method;
  if (!["content", "pages", "platform-profiles", "content-variants", "publish-jobs", "media-assets"].includes(resource ?? "")) return null;
  requireRole(ctx, "owner", "marketer", "reviewer", "admin");
  if (method === "GET" && resource === "content" && !id) {
    const rows = await ctx.db.query("SELECT i.*,COALESCE(v.version_no,0)::integer AS version,v.id AS latest_version_id,v.review_status FROM content_items i LEFT JOIN LATERAL (SELECT id,version_no,review_status FROM content_versions WHERE org_id=i.org_id AND content_item_id=i.id ORDER BY version_no DESC LIMIT 1) v ON true WHERE i.org_id=$1 AND i.deleted_at IS NULL ORDER BY i.updated_at DESC,i.id LIMIT $2", [ctx.orgId, limit(request)]); return jsonData(rows.rows, 200, { mode: ctx.mode });
  }
  if (method === "POST" && resource === "content" && !id) {
    only(body, ["title", "kind", "business_line", "topic_id", "task_id"]);
    const input: ContentItemInput = { title: text(body, "title"), kind: text(body, "kind"), business_line: text(body, "business_line") as ContentItemInput["business_line"], ...(body.topic_id ? { topic_id: text(body, "topic_id") } : {}), ...(body.task_id ? { task_id: text(body, "task_id") } : {}) };
    return databaseCommand(ctx, request, body, 201, (txCtx) => createContentItem(txCtx, input));
  }
  if (method === "POST" && resource === "content" && id === "generate" && !operation) {
    const input = validateApiRequest("ContentGenerate", body);
    return databaseCommand(ctx, request, body, 202, async (txCtx) => {
      for (const claimId of input.evidence_ids) await readOne(txCtx, "evidence_claims", claimId);
      if (input.topic_id) await readOne(txCtx, "topics", input.topic_id);
      if (input.task_id && !(await txCtx.db.query("SELECT id FROM tasks WHERE org_id=$1 AND id=$2", [txCtx.orgId, input.task_id])).rows.length) throw new DomainError("NOT_FOUND", 404, "任务不存在");
      for (const target of input.targets ?? []) {
        await readOne(txCtx, "platform_accounts", target.platform_account_id);
        const version = await readOne(txCtx, "platform_profile_versions", target.platform_profile_version_id);
        const profile = await readOne(txCtx, "platform_profiles", String(version.profile_id));
        if (profile.platform_account_id !== target.platform_account_id) throw new DomainError("PROFILE_ACCOUNT_MISMATCH", 422, "平台档案不属于目标账号");
      }
      const run = await scheduleRun(txCtx.db, { orgId: txCtx.orgId, kind: "platform_assets", periodKey: `content:${stableHash({ actor: txCtx.actorId, key: idempotencyKey(request) }).slice(0, 40)}`, input: { ...input, actor_id: txCtx.actorId, mode: txCtx.mode }, steps: [{ key: "content_generate", mode: txCtx.mode === "mock" ? "mock" : "read_only", input: { ...input, actor_id: txCtx.actorId, mode: txCtx.mode } }] });
      return { run_id: run.id, status: "queued", missing_capability: "content_generation_gateway", execution_authorized: false };
    });
  }
  if (method === "DELETE" && resource === "content" && id && id !== "versions" && !operation) { only(body, []); return databaseCommand(ctx, request, body, 200, (txCtx) => archiveContentItem(txCtx, id)); }
  if (method === "GET" && resource === "content" && id && id !== "versions" && !operation) return jsonData(await readOne(ctx, "content_items", id), 200, { mode: ctx.mode });
  if (resource === "content" && id && operation === "versions" && !suboperation) {
    if (method === "GET") { await readOne(ctx, "content_items", id); return jsonData((await ctx.db.query("SELECT * FROM content_versions WHERE org_id=$1 AND content_item_id=$2 ORDER BY version_no DESC", [ctx.orgId, id])).rows, 200, { mode: ctx.mode }); }
    if (method === "POST") { const input = validateApiRequest("ContentVersionCreate", body); if (input.channel_variants?.length) throw new DomainError("LEGACY_VARIANTS_BLOCKED", 422, "平台素材需绑定已校准账号与实际媒体，不能用旧通用变体直接发布"); return databaseCommand(ctx, request, body, 201, (txCtx) => createContentVersion(txCtx, id, input, contentVersion(request))); }
  }
  if (resource === "content" && id === "versions" && operation && suboperation === "review" && method === "POST") {
    const input = validateApiRequest("ReviewContent", body); const expected = expectedVersion(request); const version = await readOne(ctx, "content_versions", operation);
    if (Number(version.version_no) !== expected) throw new DomainError("VERSION_CONFLICT", 409, "内容版本已改变");
    return databaseCommand(ctx, request, body, 200, (txCtx) => reviewContentVersion(txCtx, operation, input));
  }
  if (resource === "pages" && !id) {
    if (method === "GET") return jsonData((await ctx.db.query("SELECT * FROM pages WHERE org_id=$1 ORDER BY updated_at DESC,id LIMIT $2", [ctx.orgId, limit(request)])).rows, 200, { mode: ctx.mode });
    if (method === "POST") { const input = validateApiRequest("PageCreate", body); return databaseCommand(ctx, request, body, 201, (txCtx) => createPage(txCtx, input as PageInput, policy(ctx))); }
  }
  if (resource === "pages" && id) {
    if (method === "GET" && !operation) return jsonData(await readOne(ctx, "pages", id), 200, { mode: ctx.mode });
    if (method === "PATCH" && !operation) {
      only(body, ["seo_title", "description", "index_policy"]);
      return databaseCommand(ctx, request, body, 200, (txCtx) => updatePageMetadata(txCtx, id, { ...(body.seo_title !== undefined ? { seo_title: text(body, "seo_title") } : {}), ...(body.description !== undefined ? { description: text(body, "description") } : {}), ...(body.index_policy !== undefined ? { index_policy: text(body, "index_policy") as "index" | "noindex" } : {}) }, expectedVersion(request)));
    }
    if (method === "GET" && operation === "preview") return jsonData(await getPagePreview(ctx, id), 200, { mode: ctx.mode });
    if (method === "GET" && operation === "releases") { await readOne(ctx, "pages", id); return jsonData((await ctx.db.query("SELECT * FROM releases WHERE org_id=$1 AND page_id=$2 ORDER BY published_at DESC,id LIMIT 100", [ctx.orgId, id])).rows, 200, { mode: ctx.mode }); }
    if (method === "POST" && operation === "publish") { only(body, ["action_id", "content_version_id"]); return jsonData(await publishPage(ctx, { pageId: id, actionId: text(body, "action_id"), contentVersionId: text(body, "content_version_id"), expectedVersion: expectedVersion(request), verifyObject }, policy(ctx)), 202, { mode: ctx.mode }); }
    if (method === "POST" && operation === "rollback") { only(body, ["action_id", "release_id"]); return jsonData(await rollbackPage(ctx, { pageId: id, releaseId: text(body, "release_id"), actionId: text(body, "action_id"), expectedVersion: expectedVersion(request), verifyObject }, policy(ctx)), 202, { mode: ctx.mode }); }
  }
  if (resource === "platform-profiles" && !id) {
    if (method === "GET") return jsonData((await ctx.db.query("SELECT * FROM platform_profiles WHERE org_id=$1 ORDER BY updated_at DESC,id LIMIT $2", [ctx.orgId, limit(request)])).rows, 200, { mode: ctx.mode });
    if (method === "POST") { only(body, ["platform_account_id", "name"]); return databaseCommand(ctx, request, body, 201, (txCtx) => createPlatformProfile(txCtx, { platform_account_id: text(body, "platform_account_id"), name: text(body, "name") })); }
  }
  if (resource === "platform-profiles" && id) {
    if (method === "GET" && !operation) return jsonData(await readOne(ctx, "platform_profiles", id), 200, { mode: ctx.mode });
    if (operation === "versions" && method === "GET") { await readOne(ctx, "platform_profiles", id); return jsonData((await ctx.db.query("SELECT * FROM platform_profile_versions WHERE org_id=$1 AND profile_id=$2 ORDER BY version_no DESC", [ctx.orgId, id])).rows, 200, { mode: ctx.mode }); }
    if (operation === "versions" && method === "POST") { const input = validateApiRequest("PlatformProfileVersionCreate", body); return databaseCommand(ctx, request, body, 201, (txCtx) => createPlatformProfileVersion(txCtx, id, input, expectedVersion(request))); }
    if (operation === "calibrate" && method === "POST") { only(body, []); return databaseCommand(ctx, request, body, 200, (txCtx) => calibratePlatformProfile(txCtx, id, expectedVersion(request))); }
  }
  if (resource === "content-variants") {
    if (method === "GET" && !id) return jsonData((await ctx.db.query("SELECT * FROM content_variants WHERE org_id=$1 ORDER BY created_at DESC,id LIMIT $2", [ctx.orgId, limit(request)])).rows, 200, { mode: ctx.mode });
    if (method === "GET" && id) return jsonData(await readOne(ctx, "content_variants", id), 200, { mode: ctx.mode });
    if (method === "POST" && !id) { only(body, ["mother_content_version_id", "content_item_id", "platform_account_id", "platform_profile_version_id", "format", "title", "body", "cta", "target_url", "claim_ids", "asset_ids", "ai_generated", "ai_label_applied"]); if (!Array.isArray(body.claim_ids) || !Array.isArray(body.asset_ids)) throw new DomainError("INVALID_REQUEST", 400, "素材与事实引用必须为数组"); return jsonData(await createPlatformVariant(ctx, body as unknown as PlatformVariantInput, policy(ctx), verifyObject), 201, { mode: ctx.mode }); }
  }
  if (resource === "publish-jobs") {
    if (method === "GET" && !id) return jsonData((await ctx.db.query("SELECT id,execution_action_id AS action_id,platform_account_id,content_variant_id,scheduled_at,delivery_state,external_id,published_url,verification_status,verified_at,submission_receipt,verification_evidence_ref FROM publish_jobs WHERE org_id=$1 ORDER BY scheduled_at DESC,id LIMIT $2", [ctx.orgId, limit(request)])).rows, 200, { mode: ctx.mode });
    if (method === "GET" && id) return jsonData(await readOne(ctx, "publish_jobs", id), 200, { mode: ctx.mode });
    if (method === "POST" && !id) { const input = validateApiRequest("PublishJobCreate", body); return jsonData(await createPublishJob(ctx, { ...input, idempotency_key: idempotencyKey(request) }, verifyObject), 202, { mode: ctx.mode }); }
  }
  if (resource === "media-assets" && method === "GET" && !id) return jsonData((await ctx.db.query("SELECT id,kind,mime_type,state,public_permission,content_hash,created_at,updated_at FROM media_assets WHERE org_id=$1 ORDER BY updated_at DESC,id LIMIT $2", [ctx.orgId, limit(request)])).rows, 200, { mode: ctx.mode });
  return null;
}
