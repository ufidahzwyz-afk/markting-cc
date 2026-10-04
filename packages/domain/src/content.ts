import { createHash } from "node:crypto";
import type { SqlExecutor } from "@boran/db";
import { validatePageModules } from "@boran/contracts";
import type { PageModules } from "@boran/contracts";
import { assertVersion, audit, DomainError, emitOutbox, nowIso, requireRole, stableHash, uuid } from "./core";
import type { ServiceContext } from "./core";
import { requirePrivacyConfiguration } from "./privacy";
import { requireActiveRole } from "./authz";

export interface SitePolicy {
  publicOrigin: string;
  allowedPathPrefixes: string[];
  allowedLinkOrigins?: string[];
}
export interface AssetFile {
  id: string; kind: string; mime_type: string; object_key: string; content_hash: string; metadata_json: Record<string, unknown>;
}
export type AssetVerifier = (asset: AssetFile) => Promise<{ bytes: Uint8Array; mimeType: string }>;
export interface ContentVersionInput { title: string; modules: unknown; claim_ids: string[] }
export interface ContentItemInput { title: string; business_line: "yonyou" | "seeyon" | "shared"; kind: string; topic_id?: string; task_id?: string }
export interface PageInput {
  host: string; path: string; business_line: "yonyou" | "seeyon" | "shared"; template_key: "service" | "industry" | "case" | "article";
  content_item_id: string; seo_title: string; description: string; canonical_url: string; index_policy: "index" | "noindex"; form_schema_id?: string;
}
type Row = Record<string, unknown>;
export type PageRecord = Row & { id: string; host: string; path: string; owner_system: string; content_item_id: string; published_release_id: string | null; version: number; seo_title: string; description: string; canonical_url: string; index_policy: string; template_key: string };
export type VersionRecord = Row & { id: string; content_item_id: string; version_no: number; body_json: { title: string; modules: PageModules }; claim_ids: string[]; payload_hash: string; review_status: string };
export type ReleaseRecord = Row & { id: string; page_id: string; content_version_id: string; action_id: string; seo_snapshot: { title: string; description: string; canonical: string; index_policy: string; payload_hash: string; mode?: string }; previous_release_id: string | null; rollback_of_id: string | null; published_at: string };
export type PublishedPage = { page: PageRecord; release: ReleaseRecord; content: VersionRecord; modules: PageModules; media: { id: string; mimeType: string; contentHash: string }[] };

async function requireContentAccess(ctx: ServiceContext, ...roles: string[]) {
  requireRole(ctx, ...roles);
  await requireActiveRole(ctx, ctx.db, ...roles);
}

const contentKinds = new Set(["mother_draft", "article", "landing_page", "case", "ad_copy", "qa", "image_text", "video_script", "subtitle", "storyboard"]);
const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
function validId(id: string) { if (!uuidPattern.test(id)) throw new DomainError("INVALID_ID", 422, "资源 ID 无效"); }
function safeText(value: string, max = 3000) {
  if (typeof value !== "string" || !value.trim() || value.length > max || /<\/?[a-z!][^>]*>/i.test(value) || /[\u0000-\u0008\u000b\u000c\u000e-\u001f]/.test(value)) throw new DomainError("UNSAFE_TEXT", 422, "正文必须是长度受限的纯文本");
}
function moduleValidation(value: unknown): PageModules {
  try { return validatePageModules(value); } catch (error) { throw new DomainError("INVALID_PAGE_MODULES", 422, "页面模块格式或安全检查失败", error instanceof Error ? error.message : undefined); }
}
function originFor(policy: SitePolicy) {
  let origin: URL;
  try { origin = new URL(policy.publicOrigin); } catch { throw new DomainError("SITE_NOT_CONFIGURED", 503, "网站主机尚未配置"); }
  if (origin.username || origin.password || origin.pathname !== "/" || origin.search || origin.hash || !["https:", "http:"].includes(origin.protocol)) throw new DomainError("INVALID_SITE_ORIGIN", 422, "网站地址必须是无路径的规范 HTTP(S) origin");
  return origin;
}
export function assertSitePath(path: string, policy: SitePolicy): string {
  if (typeof path !== "string" || path.length > 1000 || !/^\/[a-z0-9][a-z0-9/-]*$/i.test(path) || path.includes("//") || /\/$/.test(path) || /^\/(api|_next|preview|media|privacy)(\/|$)/i.test(path)) throw new DomainError("UNSAFE_PAGE_PATH", 422, "页面路径必须是批准范围内的规范站内路径");
  if (!policy.allowedPathPrefixes.some((prefix) => /^\/[a-z0-9][a-z0-9/-]*$/i.test(prefix) && !prefix.endsWith("/") && (path === prefix || path.startsWith(`${prefix}/`)))) throw new DomainError("PAGE_PATH_NOT_APPROVED", 403, "页面路径不在批准范围内");
  return path;
}
export function assertSameSiteUrl(url: string, policy: SitePolicy, path?: string): string {
  const origin = originFor(policy);
  let parsed: URL;
  try { parsed = new URL(url); } catch { throw new DomainError("UNSAFE_URL", 422, "网址格式无效"); }
  if (parsed.origin !== origin.origin || parsed.username || parsed.password || parsed.search || parsed.hash || (path !== undefined && parsed.pathname !== path)) throw new DomainError("CROSS_ORIGIN_URL", 422, "规范网址必须与已批准主机和页面路径一致");
  return parsed.href;
}
export function assertPageLinks(modules: PageModules, policy: SitePolicy) {
  const origin = originFor(policy);
  for (const module of modules) {
    if (module.type !== "hero" && module.type !== "cta") continue;
    const link = module.type === "hero" ? module.data.cta : module.data.button;
    if (link.action === "scroll_to_form") {
      if (link.href !== "#lead-form" || !modules.some((item) => item.type === "lead_form")) throw new DomainError("CTA_FORM_MISSING", 422, "表单 CTA 必须指向本页有效表单");
      continue;
    }
    if (link.href.startsWith("/") && !link.href.startsWith("//") && !/[\\%\s?#]/.test(link.href)) continue;
    let href: URL;
    try { href = new URL(link.href); } catch { throw new DomainError("UNSAFE_CTA", 422, "CTA 网址无效"); }
    if (href.protocol !== "https:" || href.username || href.password || !(href.origin === origin.origin || policy.allowedLinkOrigins?.includes(href.origin))) throw new DomainError("UNSAFE_CTA", 422, "CTA 只能使用站内路径或明确批准的 HTTPS 主机");
  }
}
function references(modules: PageModules) {
  const claims = new Set<string>(); const assets = new Set<string>();
  for (const module of modules) {
    if (module.type === "hero" && module.data.media) assets.add(module.data.media.asset_id);
    if (module.type === "solution" || module.type === "case") module.data.claim_ids.forEach((id) => claims.add(id));
    if (module.type === "proof") module.data.claims.forEach((claim) => claims.add(claim.claim_id));
    if (module.type === "faq") module.data.items.forEach((item) => item.claim_ids.forEach((id) => claims.add(id)));
  }
  return { claims: [...claims], assets: [...assets] };
}
async function one<T extends Row>(tx: SqlExecutor, sql: string, params: unknown[], label: string): Promise<T> {
  const result = await tx.query<T>(sql, params); const row = result.rows[0];
  if (!row) throw new DomainError("NOT_FOUND", 404, `${label}不存在或无权访问`); return row;
}
function assertContentMode(ctx:ServiceContext,row:Row) {
  if(row.execution_mode&&row.execution_mode!==ctx.mode)throw new DomainError('CONTENT_MODE_MISMATCH',409,'模拟内容和真实内容须使用各自的运行模式，历史版本不自动转换');
}
async function assertVersionMode(ctx:ServiceContext,tx:SqlExecutor,version:VersionRecord) {
  const item=await one<Row>(tx,'SELECT id,execution_mode FROM content_items WHERE org_id=$1 AND id=$2',[ctx.orgId,version.content_item_id],'内容');
  assertContentMode(ctx,item);
  if(ctx.mode==='live'&&!item.execution_mode)throw new DomainError('CONTENT_MODE_UNVERIFIED',409,'历史内容未建立真实来源及运行模式；请保留历史并创建经过核验的真实版本');
}
async function validateClaims(ctx: ServiceContext, tx: SqlExecutor, ids: string[], modules?: PageModules) {
  if (ids.length > 100 || new Set(ids).size !== ids.length) throw new DomainError("INVALID_CLAIMS", 422, "事实引用重复或超出数量限制");
  ids.forEach(validId);
  const result = ids.length ? await tx.query<Row>("SELECT * FROM evidence_claims WHERE org_id=$1 AND id=ANY($2::uuid[])", [ctx.orgId, ids]) : { rows: [] };
  const now = Date.parse(nowIso(ctx));
  if (result.rows.length !== ids.length) throw new DomainError("CLAIM_NOT_FOUND", 422, "事实不存在或不属于当前组织");
  for (const claim of result.rows) {
    if(claim.execution_mode&&claim.execution_mode!==ctx.mode)throw new DomainError('CLAIM_MODE_MISMATCH',409,'模拟主张不能用于真实公开内容');
    if(ctx.mode==='live'){
      const source=await one<Row>(tx,'SELECT v.execution_mode,d.deleted_at,c.read_mode,c.access_status FROM source_versions v JOIN source_documents d ON d.org_id=v.org_id AND d.id=v.document_id LEFT JOIN connections c ON c.org_id=d.org_id AND c.id=d.connection_id WHERE v.org_id=$1 AND v.id=$2',[ctx.orgId,claim.source_version_id],'来源版本');
      if(source.execution_mode!=='live'||source.deleted_at||source.read_mode==='mock'||source.access_status==='disabled')throw new DomainError('CLAIM_SOURCE_MODE_UNVERIFIED',409,'旧模拟或未核验来源不能自动转换为真实公开依据');
    }
    if (claim.verification_status !== "verified" || claim.assertion_type !== "fact" || claim.visibility !== "public" || claim.public_permission !== "allowed" || !claim.permission_evidence_ref || (claim.valid_until && Date.parse(String(claim.valid_until)) <= now)) throw new DomainError("CLAIM_NOT_PUBLIC", 422, "事实尚未核实、许可缺失、已撤销或已过期", { claim_id: claim.id });
  }
  if (modules) {
    const used = references(modules).claims;
    if (used.some((id) => !ids.includes(id))) throw new DomainError("UNBOUND_CLAIM", 422, "模块引用事实未绑定到当前内容版本");
    for (const module of modules) {
      if (module.type === "proof") for (const shown of module.data.claims) {
        const fact = result.rows.find((claim) => claim.id === shown.claim_id);
        if (!fact || shown.display_text !== fact.claim_text) throw new DomainError("CLAIM_TEXT_MISMATCH", 422, "公开证据展示不得扩写已核实事实");
      }
      if (module.type === "case") {
        const facts = result.rows.filter((claim) => module.data.claim_ids.includes(String(claim.id))).map((claim) => String(claim.claim_text));
        if (module.data.result && !facts.some((text) => text.includes(module.data.result))) throw new DomainError("UNSUPPORTED_CASE_RESULT", 422, "案例结果缺少对应公开事实");
        const marker = module.data.project_status === "accepted" ? /验收|accepted/i : module.data.project_status === "live" ? /上线|投产|live/i : null;
        if (marker && !facts.some((text) => marker.test(text))) throw new DomainError("UNSUPPORTED_PROJECT_STATUS", 422, "实施范围证据不能扩写为上线或验收完成");
      }
    }
  }
  return result.rows;
}
async function validateAssets(ctx: ServiceContext, tx: SqlExecutor, ids: string[], verifyObject?: AssetVerifier, requiredKinds: string[] = []) {
  const unique = [...new Set(ids)]; unique.forEach(validId);
  const rows = unique.length ? (await tx.query<Row>("SELECT * FROM media_assets WHERE org_id=$1 AND id=ANY($2::uuid[])", [ctx.orgId, unique])).rows : [];
  if (rows.length !== unique.length) throw new DomainError("MEDIA_MISSING", 422, "实际素材不存在或不属于当前组织");
  for (const kind of requiredKinds) if (!rows.some((row) => row.kind === kind || (kind === "image" && row.kind === "cover"))) throw new DomainError("MEDIA_MISSING", 422, `缺少实际${kind}文件；脚本或素材清单不能替代成品`);
  for (const row of rows) {
    if (row.state !== "ready" || row.public_permission !== "allowed" || !row.object_key || !/^[a-f0-9]{64}$/.test(String(row.content_hash)) || !row.license_evidence_ref || !["image", "cover", "video", "audio"].includes(String(row.kind))) throw new DomainError("MEDIA_NOT_PUBLISHABLE", 422, "素材未就绪、公开许可未知或并非实际媒体文件", { asset_id: row.id });
    if (!verifyObject) throw new DomainError("ASSET_VERIFIER_REQUIRED", 503, "尚未配置实际素材存储核验能力");
    const file = await verifyObject(row as unknown as AssetFile);
    if (!file.bytes.byteLength || file.mimeType !== row.mime_type || createHash("sha256").update(file.bytes).digest("hex") !== row.content_hash) throw new DomainError("MEDIA_HASH_MISMATCH", 422, "实际素材字节、类型或哈希与登记不一致");
    const bytes = file.bytes;
    const mime = String(row.mime_type);
    const valid = mime === "image/png" ? bytes.length >= 24 && Buffer.from(bytes.subarray(0, 8)).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])) : mime === "image/jpeg" ? bytes[0] === 255 && bytes[1] === 216 && bytes[bytes.length - 2] === 255 && bytes[bytes.length - 1] === 217 : mime === "image/webp" ? Buffer.from(bytes.subarray(0, 4)).toString() === "RIFF" && Buffer.from(bytes.subarray(8, 12)).toString() === "WEBP" : mime === "video/mp4" ? Buffer.from(bytes.subarray(4, 8)).toString() === "ftyp" : mime === "audio/mpeg" ? Buffer.from(bytes.subarray(0, 3)).toString() === "ID3" || (bytes[0] === 255 && ((bytes[1] ?? 0) & 224) === 224) : false;
    if (!valid) throw new DomainError("UNSUPPORTED_MEDIA_TYPE", 422, "媒体类型或文件签名不受支持；不接受 SVG、HTML 或脚本文件");
  }
  return rows;
}

export async function createContentItem(ctx: ServiceContext, input: ContentItemInput) {
  await requireContentAccess(ctx, "owner", "admin", "marketer"); safeText(input.title, 300);
  if (!contentKinds.has(input.kind) || !["yonyou", "seeyon", "shared"].includes(input.business_line)) throw new DomainError("INVALID_CONTENT", 422, "内容类型或业务线无效");
  return ctx.db.transaction(async (tx) => {
    await requireActiveRole(ctx, tx, "owner", "marketer");
    if (input.topic_id) { validId(input.topic_id); assertContentMode(ctx,await one(tx, "SELECT id,execution_mode FROM topics WHERE org_id=$1 AND id=$2", [ctx.orgId, input.topic_id], "主题")); }
    if (input.task_id) { validId(input.task_id); await one(tx, "SELECT id FROM tasks WHERE org_id=$1 AND id=$2", [ctx.orgId, input.task_id], "任务"); }
    const id = uuid();
    await tx.query("INSERT INTO content_items (id,org_id,kind,business_line,owner_user_id,title,topic_id,task_id,execution_mode) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)", [id, ctx.orgId, input.kind, input.business_line, ctx.actorId, input.title, input.topic_id ?? null, input.task_id ?? null,ctx.mode]);
    await audit(ctx, tx, "content.created", "content_item", id); return { id, version: 0 };
  });
}
export async function createContentVersion(ctx: ServiceContext, itemId: string, input: ContentVersionInput, expectedVersion: number) {
  await requireContentAccess(ctx, "owner", "admin", "marketer"); validId(itemId); safeText(input.title, 300); const modules = moduleValidation(input.modules);
  return ctx.db.transaction(async (tx) => {
    await requireActiveRole(ctx, tx, "owner", "marketer");
    assertContentMode(ctx,await one(tx, "SELECT id,execution_mode FROM content_items WHERE org_id=$1 AND id=$2 AND deleted_at IS NULL FOR UPDATE", [ctx.orgId, itemId], "内容"));
    const current = await tx.query<Row>("SELECT COALESCE(MAX(version_no),0)::integer AS version FROM content_versions WHERE org_id=$1 AND content_item_id=$2", [ctx.orgId, itemId]);
    assertVersion(Number(current.rows[0]?.version), expectedVersion); await validateClaims(ctx, tx, input.claim_ids, modules);
    const id = uuid(); const version = expectedVersion + 1; const body = { title: input.title, modules }; const payloadHash = stableHash(body);
    await tx.query("INSERT INTO content_versions (id,org_id,content_item_id,version_no,body_json,claim_ids,payload_hash,review_status,warnings) VALUES ($1,$2,$3,$4,$5,$6,$7,'draft','[]')", [id, ctx.orgId, itemId, version, JSON.stringify(body), input.claim_ids, payloadHash]);
    await audit(ctx, tx, "content.version.created", "content_version", id, { payload_hash: payloadHash }); return { id, version, payload_hash: payloadHash };
  });
}
export async function reviewContentVersion(ctx: ServiceContext, versionId: string, input: { review_status: "in_review" | "approved" | "changes_requested"; reason?: string }) {
  await requireContentAccess(ctx, "owner", "admin", "marketer"); validId(versionId);
  if (!["in_review", "approved", "changes_requested"].includes(input.review_status)) throw new DomainError("INVALID_REVIEW", 422, "审核状态无效");
  return ctx.db.transaction(async (tx) => {
    await requireActiveRole(ctx, tx, "owner", "marketer");
    const version = await one<VersionRecord>(tx, "SELECT * FROM content_versions WHERE org_id=$1 AND id=$2 FOR UPDATE", [ctx.orgId, versionId], "版本");
    await assertVersionMode(ctx,tx,version);
    if (input.review_status === "approved") {
      if (stableHash(version.body_json) !== version.payload_hash) throw new DomainError("CONTENT_VERSION_MISMATCH", 409, "内容版本与保存的摘要不一致");
      if (version.body_json.modules !== undefined) await validateClaims(ctx, tx, version.claim_ids, moduleValidation(version.body_json.modules));
      else {
        const variant = (await tx.query<Row>("SELECT id FROM content_variants WHERE org_id=$1 AND content_version_id=$2 AND validation_status='passed' AND validated_payload_hash=$3 AND validated_at IS NOT NULL", [ctx.orgId, version.id, version.payload_hash])).rows[0];
        if (!variant) throw new DomainError("CONTENT_VERSION_NOT_VALIDATED", 422, "原生平台内容尚未通过完整素材校验");
        await validateClaims(ctx, tx, version.claim_ids);
      }
    }
    await tx.query("UPDATE content_versions SET review_status=$3,reviewed_by=$4,reviewed_at=$5,updated_at=$5 WHERE org_id=$1 AND id=$2", [ctx.orgId, versionId, input.review_status, ctx.actorId, nowIso(ctx)]);
    await audit(ctx, tx, "content.quality.review", "content_version", versionId, { status: input.review_status, reason: input.reason ?? "" }); return { id: versionId, review_status: input.review_status, execution_authorized: false };
  });
}
export async function createPage(ctx: ServiceContext, input: PageInput, policy: SitePolicy) {
  await requireContentAccess(ctx, "owner", "admin", "marketer"); const origin = originFor(policy); const path = assertSitePath(input.path, policy);
  if (input.host.toLowerCase() !== origin.host.toLowerCase()) throw new DomainError("CROSS_ORIGIN_HOST", 422, "新页面必须与现有官网同一主机");
  assertSameSiteUrl(input.canonical_url, policy, path); safeText(input.seo_title, 300); safeText(input.description, 1000); validId(input.content_item_id);
  if (!["service", "industry", "case", "article"].includes(input.template_key) || !["index", "noindex"].includes(input.index_policy)) throw new DomainError("INVALID_PAGE", 422, "模板或索引策略无效");
  return ctx.db.transaction(async (tx) => {
    await requireActiveRole(ctx, tx, "owner", "marketer");
    assertContentMode(ctx,await one(tx, "SELECT id,execution_mode FROM content_items WHERE org_id=$1 AND id=$2 AND deleted_at IS NULL", [ctx.orgId, input.content_item_id], "内容"));
    const collision = await tx.query("SELECT id FROM pages WHERE org_id=$1 AND host=$2 AND path=$3", [ctx.orgId, origin.host, path]);
    if (collision.rows.length) throw new DomainError("PAGE_PATH_CONFLICT", 409, "此路径已被现有网站或新页面占用");
    const id = uuid();
    await tx.query("INSERT INTO pages (id,org_id,host,path,owner_system,business_line,template_key,content_item_id,seo_title,description,canonical_url,index_policy,form_schema_id,owner_user_id,version) VALUES ($1,$2,$3,$4,'marketing',$5,$6,$7,$8,$9,$10,$11,$12,$13,1)", [id, ctx.orgId, origin.host, path, input.business_line, input.template_key, input.content_item_id, input.seo_title, input.description, input.canonical_url, input.index_policy, input.form_schema_id ?? null, ctx.actorId]);
    await audit(ctx, tx, "page.created", "page", id); return { page_id: id, version: 1 };
  });
}
export async function getPagePreview(ctx: ServiceContext, pageId: string) {
  await requireContentAccess(ctx, "owner", "admin", "marketer", "reviewer"); validId(pageId);
  const page = await one<PageRecord>(ctx.db, "SELECT * FROM pages WHERE org_id=$1 AND id=$2", [ctx.orgId, pageId], "页面");
  const item=await one<Row>(ctx.db,'SELECT execution_mode FROM content_items WHERE org_id=$1 AND id=$2',[ctx.orgId,page.content_item_id],'内容');
  if(ctx.mode==='mock'&&item.execution_mode==='live')throw new DomainError('NOT_FOUND',404,'页面不存在或无权访问');
  const content = await one<VersionRecord>(ctx.db, "SELECT * FROM content_versions WHERE org_id=$1 AND content_item_id=$2 ORDER BY version_no DESC LIMIT 1", [ctx.orgId, page.content_item_id], "正文版本");
  return { page, content, modules: moduleValidation(content.body_json.modules), preview: true, robots: "noindex, nofollow", data_mode: item.execution_mode??'mock' };
}

export interface PublishPageInput { pageId: string; contentVersionId: string; actionId: string; expectedVersion: number; verifyObject?: AssetVerifier }
async function publicationChecks(ctx: ServiceContext, tx: SqlExecutor, page: PageRecord, version: VersionRecord, policy: SitePolicy, verifyObject?: AssetVerifier) {
  await assertVersionMode(ctx,tx,version);
  const origin = originFor(policy);
  if (ctx.mode === "live" && origin.protocol !== "https:") throw new DomainError("HTTPS_REQUIRED", 422, "生产网站必须配置 HTTPS");
  if (ctx.mode === "mock" && origin.protocol === "http:" && !["localhost", "127.0.0.1", "[::1]"].includes(origin.hostname)) throw new DomainError("MOCK_SITE_LOCAL_ONLY", 403, "模拟网站仅允许本地 HTTP 主机");
  if (page.owner_system !== "marketing" || page.host !== origin.host) throw new DomainError("LEGACY_PAGE_PROTECTED", 403, "不能改写现有官网路由");
  assertSitePath(page.path, policy); assertSameSiteUrl(page.canonical_url, policy, page.path); safeText(page.seo_title, 300); safeText(page.description, 1000);
  if (version.content_item_id !== page.content_item_id || version.review_status !== "approved" || stableHash(version.body_json) !== version.payload_hash) throw new DomainError("CONTENT_NOT_APPROVED", 422, "页面正文不匹配、尚未通过质量审核或载荷已改变");
  const modules = moduleValidation(version.body_json.modules); assertPageLinks(modules, policy);
  if (["service", "industry"].includes(page.template_key) && ["hero", "problem", "solution", "scope", "proof", "faq", "lead_form"].some((type) => !modules.some((module) => module.type === type))) throw new DomainError("PAGE_MODULES_INCOMPLETE", 422, "服务及行业模板缺少必需模块");
  const form = modules.find((module) => module.type === "lead_form");
  if (form) {
    const internalTest = ctx.mode === "mock" && ["development", "test"].includes(process.env.APP_ENV ?? "production") && process.env.PUBLIC_SITE_ALLOW_MOCK_FORMS === "true";
    const configured = await requirePrivacyConfiguration(ctx, { internalTest }, tx);
    if (configured.notice_version !== form.data.privacy_notice_version || page.form_schema_id !== "lead_form_v1") throw new DomainError("FORM_NOT_READY", 503, "咨询表单隐私配置或接收版本未就绪");
  }
  await validateClaims(ctx, tx, version.claim_ids, modules);
  await validateAssets(ctx, tx, references(modules).assets, verifyObject);
  return modules;
}
async function commitRelease(ctx: ServiceContext, tx: SqlExecutor, page: PageRecord, version: VersionRecord, actionId: string, rollbackOf: string | null) {
  const id = uuid(); const time = nowIso(ctx);
  const seo = { title: page.seo_title, description: page.description, canonical: page.canonical_url, index_policy: page.index_policy, payload_hash: version.payload_hash, mode: ctx.mode };
  await tx.query("INSERT INTO releases (id,org_id,page_id,content_version_id,action_id,published_at,previous_release_id,rollback_of_id,seo_snapshot,route_config_version) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)", [id, ctx.orgId, page.id, version.id, actionId, time, page.published_release_id, rollbackOf, JSON.stringify(seo), stableHash({ host: page.host, path: page.path, owner_system: page.owner_system })]);
  await tx.query("UPDATE pages SET published_release_id=$3,version=version+1,updated_at=$4 WHERE org_id=$1 AND id=$2", [ctx.orgId, page.id, id, time]);
  await tx.query("UPDATE execution_actions SET state='verification_pending',after_snapshot=$3,external_id=$4,version=version+1,updated_at=$5 WHERE org_id=$1 AND id=$2", [ctx.orgId, actionId, JSON.stringify({ release_id: id, content_version_id: version.id, path: page.path, mode: ctx.mode }), id, time]);
  await audit(ctx, tx, rollbackOf ? "page.rollback" : "page.release.created", "release", id, { page_id: page.id, previous_release_id: page.published_release_id, rollback_of_id: rollbackOf, payload_hash: version.payload_hash, mode: ctx.mode });
  await emitOutbox(ctx, tx, "page.release.verification_requested", id, { page_id: page.id, release_id: id, mode: ctx.mode });
  // No deletion: every immutable release is retained, including at least the last ten.
  return { release_id: id, page_id: page.id, version: page.version + 1, state: "verification_pending" as const, mode: ctx.mode };
}
async function authorizedPublication(ctx: ServiceContext, tx: SqlExecutor, actionId: string, page: PageRecord, version: VersionRecord) {
  const { assertActionExecutable } = await import("./execution");
  const action = await assertActionExecutable(ctx, tx, actionId);
  const target = action.target as Record<string, unknown>;
  if (action.action_type !== "content.publish" || target.page_id !== page.id || action.version_id !== version.id || action.payload_hash !== version.payload_hash) throw new DomainError("ACTION_BINDING_MISMATCH", 403, "发布授权与页面、正文版本或载荷不一致");
  return action;
}
export async function publishPage(ctx: ServiceContext, input: PublishPageInput, policy: SitePolicy) {
  await requireContentAccess(ctx, "owner", "admin", "marketer"); [input.pageId, input.contentVersionId, input.actionId].forEach(validId);
  return ctx.db.transaction(async (tx) => {
    await requireActiveRole(ctx, tx, "owner", "marketer");
    const page = await one<PageRecord>(tx, "SELECT * FROM pages WHERE org_id=$1 AND id=$2 FOR UPDATE", [ctx.orgId, input.pageId], "页面");
    const content = await one<VersionRecord>(tx, "SELECT * FROM content_versions WHERE org_id=$1 AND id=$2", [ctx.orgId, input.contentVersionId], "正文版本");
    await assertVersionMode(ctx,tx,content);
    const existing = (await tx.query<Row>("SELECT r.*,a.state AS action_state FROM releases r JOIN execution_actions a ON a.org_id=r.org_id AND a.id=r.action_id WHERE r.org_id=$1 AND r.action_id=$2", [ctx.orgId, input.actionId])).rows[0];
    if (existing) {
      if (existing.page_id !== page.id || existing.content_version_id !== content.id || existing.rollback_of_id) throw new DomainError("ACTION_BINDING_MISMATCH", 403, "既有发布动作与本次请求不一致");
      return { release_id: String(existing.id), page_id: page.id, version: page.version, state: String(existing.action_state), mode: ctx.mode };
    }
    await authorizedPublication(ctx, tx, input.actionId, page, content);
    assertVersion(page.version, input.expectedVersion); await publicationChecks(ctx, tx, page, content, policy, input.verifyObject);
    return commitRelease(ctx, tx, page, content, input.actionId, null);
  });
}
export async function rollbackPage(ctx: ServiceContext, input: { pageId: string; releaseId: string; actionId: string; expectedVersion: number; verifyObject?: AssetVerifier }, policy: SitePolicy) {
  await requireContentAccess(ctx, "owner", "admin", "marketer"); [input.pageId, input.releaseId, input.actionId].forEach(validId);
  return ctx.db.transaction(async (tx) => {
    await requireActiveRole(ctx, tx, "owner", "marketer");
    const page = await one<PageRecord>(tx, "SELECT * FROM pages WHERE org_id=$1 AND id=$2 FOR UPDATE", [ctx.orgId, input.pageId], "页面");
    const existing = (await tx.query<Row>("SELECT r.*,a.state AS action_state FROM releases r JOIN execution_actions a ON a.org_id=r.org_id AND a.id=r.action_id WHERE r.org_id=$1 AND r.action_id=$2", [ctx.orgId, input.actionId])).rows[0];
    if (existing) {
      if (existing.page_id !== page.id || existing.rollback_of_id !== input.releaseId) throw new DomainError("ACTION_BINDING_MISMATCH", 403, "既有回滚动作与本次请求不一致");
      await assertVersionMode(ctx,tx,await one<VersionRecord>(tx,'SELECT * FROM content_versions WHERE org_id=$1 AND id=$2',[ctx.orgId,existing.content_version_id],'历史回滚正文'));
      return { release_id: String(existing.id), page_id: page.id, version: page.version, state: String(existing.action_state), mode: ctx.mode };
    }
    assertVersion(page.version, input.expectedVersion);
    const previous = await one<ReleaseRecord>(tx, "SELECT * FROM releases WHERE org_id=$1 AND id=$2 AND page_id=$3", [ctx.orgId, input.releaseId, page.id], "历史发布版本");
    const content = await one<VersionRecord>(tx, "SELECT * FROM content_versions WHERE org_id=$1 AND id=$2", [ctx.orgId, previous.content_version_id], "正文版本");
    await authorizedPublication(ctx, tx, input.actionId, page, content); await publicationChecks(ctx, tx, page, content, policy, input.verifyObject);
    const snapshotPage = { ...page, seo_title: previous.seo_snapshot.title, description: previous.seo_snapshot.description, canonical_url: previous.seo_snapshot.canonical, index_policy: previous.seo_snapshot.index_policy };
    return commitRelease(ctx, tx, snapshotPage, content, input.actionId, previous.id);
  });
}
export async function readPublishedPage(db: SqlExecutor, orgId: string, host: string, path: string, expectedMode?: 'mock'|'live'): Promise<PublishedPage | null> {
  const pages = await db.query<PageRecord>("SELECT * FROM pages WHERE org_id=$1 AND host=$2 AND path=$3 AND owner_system='marketing' AND published_release_id IS NOT NULL", [orgId, host, path]);
  const page = pages.rows[0]; if (!page) return null;
  const release = await one<ReleaseRecord>(db, "SELECT * FROM releases WHERE org_id=$1 AND id=$2 AND page_id=$3", [orgId, page.published_release_id, page.id], "发布版本");
  const content = await one<VersionRecord>(db, "SELECT * FROM content_versions WHERE org_id=$1 AND id=$2 AND content_item_id=$3", [orgId, release.content_version_id, page.content_item_id], "发布正文");
  if(expectedMode){
    const item=await one<Row>(db,'SELECT execution_mode FROM content_items WHERE org_id=$1 AND id=$2',[orgId,content.content_item_id],'内容');
    const action=await one<Row>(db,'SELECT after_snapshot FROM execution_actions WHERE org_id=$1 AND id=$2',[orgId,release.action_id],'发布动作');
    const actionMode=(action.after_snapshot as Row|null)?.mode;
    if(item.execution_mode&&item.execution_mode!==expectedMode || actionMode!==expectedMode || release.seo_snapshot.mode&&release.seo_snapshot.mode!==expectedMode || expectedMode==='live'&&(item.execution_mode!=='live'||release.seo_snapshot.mode!=='live')) return null;
  }
  if (stableHash(content.body_json) !== content.payload_hash || release.seo_snapshot.payload_hash !== content.payload_hash) throw new DomainError("RELEASE_INTEGRITY_FAILED", 503, "发布快照完整性检查失败");
  const modules = moduleValidation(content.body_json.modules); const ids = references(modules).assets;
  const mediaRows = ids.length ? (await db.query<Row>("SELECT id,mime_type,content_hash FROM media_assets WHERE org_id=$1 AND id=ANY($2::uuid[]) AND state='ready' AND public_permission='allowed' AND license_evidence_ref IS NOT NULL", [orgId, ids])).rows : [];
  return { page, release, content, modules, media: mediaRows.map((row) => ({ id: String(row.id), mimeType: String(row.mime_type), contentHash: String(row.content_hash) })) };
}
function decodeText(value: string): string {
  const entities: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " " };
  return value.replace(/&(#x[0-9a-f]+|#\d+|amp|lt|gt|quot|apos|nbsp);/gi, (_match, entity: string) => {
    if (entity.startsWith("#")) { const code = entity[1]?.toLowerCase() === "x" ? parseInt(entity.slice(2), 16) : parseInt(entity.slice(1), 10); return code >= 0 && code <= 0x10ffff ? String.fromCodePoint(code) : ""; }
    return entities[entity.toLowerCase()] ?? "";
  }).replace(/\s+/g, "").trim();
}
function assertReadbackContent(html: string, modules: PageModules, releaseId: string, payloadHash: string) {
  const body = html.replace(/<(script|style|template|noscript|iframe)\b[^>]*>[\s\S]*?<\/\1\s*>/gi, "").replace(/<!--[\s\S]*?-->/g, "");
  const articles = body.match(/<article\b[^>]*>/gi) ?? [];
  if (!articles.some(tag => tag.includes(`data-release-id="${releaseId}"`) && tag.includes(`data-content-hash="${payloadHash}"`))) throw new DomainError("PAGE_READBACK_MISMATCH", 503, "实际可见正文未绑定当前发布版本");
  const h1 = /<h1\b[^>]*>([\s\S]*?)<\/h1\s*>/i.exec(body)?.[1];
  const hero = modules.find((module) => module.type === "hero");
  if (!h1 || !hero || decodeText(h1.replace(/<[^>]*>/g, "")) !== decodeText(hero.data.headline)) throw new DomainError("PAGE_READBACK_CONTENT_MISMATCH", 503, "实际主标题与发布正文不一致");
  const visible = decodeText(body.replace(/<[^>]*>/g, ""));
  const keys = new Set(["headline", "description", "heading", "text", "display_text", "customer_display", "problem", "boran_scope", "result", "question", "answer", "label", "submit_label", "title", "included", "dependencies", "items"]);
  const strings: string[] = [];
  function collect(value: unknown, key = "") {
    if (typeof value === "string" && keys.has(key) && value) strings.push(value);
    else if (Array.isArray(value)) value.forEach((item) => collect(item, key));
    else if (value && typeof value === "object") Object.entries(value).forEach(([field, item]) => collect(item, field));
  }
  modules.forEach((module) => collect(module.data));
  if (strings.some((text) => !visible.includes(decodeText(text)))) throw new DomainError("PAGE_READBACK_CONTENT_MISMATCH", 503, "实际可抓取正文缺少发布版本中的关键内容");
  if (modules.some((module) => module.type === "lead_form")) {
    const form = /<form\b[^>]*>[\s\S]*?<\/form\s*>/gi;
    const forms = body.match(form) ?? [];
    if (!forms.some((markup) => {
      const inputs = markup.match(/<input\b[^>]*>/gi) ?? [];
      const contact = inputs.some(tag => tag.includes('name="contact"') && /type="(?:email|tel|text)"/i.test(tag) && !/\bdisabled(?:[\s=>])/i.test(tag));
      const consent = inputs.some(tag => tag.includes('name="consent"') && /type="checkbox"/i.test(tag) && !/\bdisabled(?:[\s=>])/i.test(tag));
      const buttons = markup.match(/<button\b[^>]*>/gi) ?? [];
      return contact && consent && buttons.some(tag => /type="submit"/i.test(tag) && !/\bdisabled(?:[\s=>])/i.test(tag));
    })) throw new DomainError("PAGE_READBACK_FORM_MISMATCH", 503, "实际咨询表单缺少联系方式、同意或可用提交入口");
  }
  for (const module of modules) if (module.type === "hero" && module.data.media && !body.includes(`src="/media/${module.data.media.asset_id}"`)) throw new DomainError("PAGE_READBACK_MEDIA_MISMATCH", 503, "实际页面缺少发布素材");
}
export async function verifyPageRelease(ctx: ServiceContext, releaseId: string, policy: SitePolicy, fetchPage: typeof fetch = fetch) {
  await requireContentAccess(ctx, "owner", "admin", "marketer"); validId(releaseId);
  const release = await one<ReleaseRecord>(ctx.db, "SELECT * FROM releases WHERE org_id=$1 AND id=$2", [ctx.orgId, releaseId], "发布版本");
  const page = await one<PageRecord>(ctx.db, "SELECT * FROM pages WHERE org_id=$1 AND id=$2", [ctx.orgId, release.page_id], "页面");
  const published = await one<VersionRecord>(ctx.db, "SELECT * FROM content_versions WHERE org_id=$1 AND id=$2", [ctx.orgId, release.content_version_id], "发布正文");
  const provenance = async(tx:SqlExecutor,lock=false)=>{
    await assertVersionMode(ctx,tx,published);
    const action=await one<Row>(tx,`SELECT * FROM execution_actions WHERE org_id=$1 AND id=$2${lock?' FOR UPDATE':''}`,[ctx.orgId,release.action_id],'发布动作');
    const snapshot=action.after_snapshot as Row|null;
    if(action.action_type!=='content.publish'||action.version_id!==published.id||action.payload_hash!==published.payload_hash||snapshot?.release_id!==release.id||snapshot.mode!==ctx.mode||release.seo_snapshot.mode&&release.seo_snapshot.mode!==ctx.mode||ctx.mode==='live'&&release.seo_snapshot.mode!=='live')throw new DomainError('RELEASE_MODE_MISMATCH',409,'发布版本与原执行动作的运行模式或不可变载荷不一致');
  };
  await provenance(ctx.db);
  if (page.published_release_id !== release.id) throw new DomainError("RELEASE_SUPERSEDED", 409, "此发布版本已不是当前页面版本");
  const url = assertSameSiteUrl(release.seo_snapshot.canonical, policy, assertSitePath(page.path, policy));
  const response = await fetchPage(url, { redirect: "manual", cache: "no-store", signal: AbortSignal.timeout(10000), headers: { "X-Boran-Readback": release.id } });
  if (response.status !== 200 || !response.headers.get("content-type")?.includes("text/html")) throw new DomainError("PAGE_READBACK_FAILED", 503, "实际页面 HTTP 或正文类型核验失败");
  const html = await response.text();
  if (html.length > 2_000_000 || !html.includes(`data-release-id="${release.id}"`) || !html.includes(`data-content-hash="${release.seo_snapshot.payload_hash}"`) || !html.includes('<h1')) throw new DomainError("PAGE_READBACK_MISMATCH", 503, "实际页面与当前发布版本不一致");
  assertReadbackContent(html, moduleValidation(published.body_json.modules), release.id, published.payload_hash);
  if (ctx.mode === "live" && html.includes('data-mode="mock"')) throw new DomainError("MOCK_READBACK_REJECTED", 503, "模拟页面不能用作真实发布核验证据");
  const evidence = { kind: "website_http_readback", mode: ctx.mode, url, http_status: response.status, response_hash: createHash("sha256").update(html).digest("hex"), release_id: release.id, verified_at: nowIso(ctx) };
  return ctx.db.transaction(async (tx) => {
    await requireActiveRole(ctx, tx, "owner", "marketer");
    const current = await one<PageRecord>(tx, "SELECT * FROM pages WHERE org_id=$1 AND id=$2 FOR UPDATE", [ctx.orgId, page.id], "页面");
    await provenance(tx,true);
    if (current.published_release_id !== release.id) throw new DomainError("RELEASE_SUPERSEDED", 409, "读回期间页面版本发生变化");
    const state = ctx.mode === "live" ? "succeeded" : "verification_pending";
    const updated = await tx.query("UPDATE execution_actions SET state=$5,verified_at=$3,verification_evidence_ref=$4,version=version+1,updated_at=$6 WHERE org_id=$1 AND id=$2 AND state='verification_pending'", [ctx.orgId, release.action_id, ctx.mode === "live" ? evidence.verified_at : null, JSON.stringify(evidence), state, evidence.verified_at]);
    if (updated.rowCount !== 1) throw new DomainError("ACTION_STATE_CHANGED", 409, "读回期间执行动作状态发生变化");
    await audit(ctx, tx, ctx.mode === "live" ? "page.release.verified" : "page.release.mock_readback", "release", release.id, { mode: ctx.mode, response_hash: evidence.response_hash });
    return { release_id: release.id, state: ctx.mode === "live" ? "succeeded" : "mock_verified", verification: evidence, real_integration_accepted: ctx.mode === "live" };
  });
}

export interface PlatformVariantInput {
  mother_content_version_id: string; content_item_id: string; platform_account_id: string; platform_profile_version_id: string;
  format: string; title: string; body: string; cta: string; target_url: string; claim_ids: string[]; asset_ids: string[];
  ai_generated?: boolean; ai_label_applied?: Record<string, unknown>;
}
export async function createPlatformVariant(ctx: ServiceContext, input: PlatformVariantInput, policy: SitePolicy, verifyObject?: AssetVerifier) {
  await requireContentAccess(ctx, "owner", "admin", "marketer"); safeText(input.title, 300); safeText(input.body, 20000); safeText(input.cta, 300); assertSameSiteUrl(input.target_url, policy);
  return ctx.db.transaction(async (tx) => {
    await requireActiveRole(ctx, tx, "owner", "marketer");
    const mother = await one<VersionRecord>(tx, "SELECT * FROM content_versions WHERE org_id=$1 AND id=$2", [ctx.orgId, input.mother_content_version_id], "母稿");
    await assertVersionMode(ctx,tx,mother);
    assertContentMode(ctx,await one(tx, "SELECT id,execution_mode FROM content_items WHERE org_id=$1 AND id=$2 AND topic_id IS NOT NULL FOR UPDATE", [ctx.orgId, input.content_item_id], "平台内容"));
    const profile = await one<Row>(tx, "SELECT v.*,p.platform_account_id FROM platform_profile_versions v JOIN platform_profiles p ON p.org_id=v.org_id AND p.id=v.profile_id WHERE v.org_id=$1 AND v.id=$2", [ctx.orgId, input.platform_profile_version_id], "平台档案");
    if (profile.platform_account_id !== input.platform_account_id || !(profile.allowed_formats as string[]).includes(input.format) || !profile.calibrated_at || !(profile.style_samples as unknown[]).length || !(profile.rules_source_urls as string[]).length) throw new DomainError("PLATFORM_PROFILE_NOT_READY", 422, "目标账号、风格样稿或平台规则未完成校准");
    const rules = profile.rules_json as Record<string, unknown>; const needs = profile.asset_requirements as Record<string, unknown>;
    if (!profile.rules_checked_at || (rules.valid_until && Date.parse(String(rules.valid_until)) <= Date.parse(nowIso(ctx)))) throw new DomainError("PLATFORM_RULES_EXPIRED", 422, "平台要求未核验或已过期");
    if (typeof rules.title_max_length !== "number" || typeof rules.body_max_length !== "number" || input.title.length > rules.title_max_length || input.body.length > rules.body_max_length) throw new DomainError("PLATFORM_FORMAT_INVALID", 422, "平台字段与已核验字数规则不一致");
    if (input.ai_generated && (rules.ai_label_capability_tested !== true || !input.ai_label_applied || input.ai_label_applied.applied !== true)) throw new DomainError("AI_LABEL_NOT_READY", 422, "AI 原生声明要求未实测或尚未应用");
    await validateClaims(ctx, tx, input.claim_ids);
    const required = Array.isArray(needs.required_kinds) ? needs.required_kinds.filter((value): value is string => typeof value === "string") : [];
    if (input.format === "video" && !required.includes("video")) required.push("video");
    await validateAssets(ctx, tx, input.asset_ids, verifyObject, required);
    const previous = (await tx.query<Row>("SELECT v.body_json FROM content_variants cv JOIN content_versions v ON v.org_id=cv.org_id AND v.id=cv.content_version_id WHERE cv.org_id=$1 AND cv.mother_content_version_id=$2 AND cv.platform_account_id<>$3", [ctx.orgId, mother.id, input.platform_account_id])).rows;
    if (previous.some((row) => (row.body_json as Record<string, unknown>).body === input.body)) throw new DomainError("PLATFORM_COPY_NOT_ADAPTED", 422, "不同平台不能仅换标题复用相同正文");
    const body = { title: input.title, body: input.body, cta: input.cta, target_url: input.target_url, platform_audience: profile.audience, profile_version_id: input.platform_profile_version_id, format: input.format };
    const payloadHash = stableHash(body); const contentId = uuid(); const variantId = uuid();
    const count = (await tx.query<Row>("SELECT COALESCE(MAX(version_no),0)+1 AS version FROM content_versions WHERE org_id=$1 AND content_item_id=$2", [ctx.orgId, input.content_item_id])).rows[0];
    const revision = (await tx.query<Row>("SELECT COALESCE(MAX(revision),0)+1 AS revision FROM content_variants WHERE org_id=$1 AND mother_content_version_id=$2 AND platform_account_id=$3 AND format=$4", [ctx.orgId, mother.id, input.platform_account_id, input.format])).rows[0];
    await tx.query("INSERT INTO content_versions (id,org_id,content_item_id,version_no,body_json,claim_ids,payload_hash,review_status,warnings) VALUES ($1,$2,$3,$4,$5,$6,$7,'draft','[]')", [contentId, ctx.orgId, input.content_item_id, Number(count?.version), JSON.stringify(body), input.claim_ids, payloadHash]);
    await tx.query("INSERT INTO content_variants (id,org_id,mother_content_version_id,content_version_id,platform_account_id,platform_profile_version_id,format,revision,asset_ids,validation_status,validation_json,validated_at,validated_payload_hash,ai_generated,ai_label_requirement,ai_label_applied) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,'passed',$10,$11,$12,$13,$14,$15)", [variantId, ctx.orgId, mother.id, contentId, input.platform_account_id, input.platform_profile_version_id, input.format, Number(revision?.revision), input.asset_ids, JSON.stringify({ facts: "passed", media: input.asset_ids.length ? "actual_bytes_verified" : "not_required", platform_rules: "passed", execution_authorized: false }), nowIso(ctx), payloadHash, input.ai_generated ?? false, JSON.stringify({ tested: rules.ai_label_capability_tested === true }), JSON.stringify(input.ai_label_applied ?? {})]);
    await audit(ctx, tx, "content.variant.created", "content_variant", variantId, { profile_version_id: input.platform_profile_version_id, mode: ctx.mode });
    return { id: variantId, content_version_id: contentId, payload_hash: payloadHash, validation_status: "passed", execution_authorized: false, mode: ctx.mode };
  });
}

export interface PlatformCopyGenerator {
  mode: "mock" | "live";
  generate(input: { topic: Row; profile: Row; verifiedClaims: Row[]; format: string; targetUrl: string }): Promise<{ title: string; body: string; cta: string; asset_ids: string[]; ai_generated?: boolean; ai_label_applied?: Record<string, unknown> }>;
}
/** Each target receives its own calibrated account profile; no shared-body title substitution. */
export async function generatePlatformVariants(ctx: ServiceContext, input: { topicId: string; motherContentVersionId: string; targetUrl: string; targets: { platformAccountId: string; profileVersionId: string; format: string }[] }, policy: SitePolicy, generator: PlatformCopyGenerator, verifyObject?: AssetVerifier) {
  await requireContentAccess(ctx, "owner", "admin", "marketer");
  if (generator.mode !== ctx.mode) throw new DomainError("GENERATOR_MODE_MISMATCH", 503, "真实流程不能回退到模拟内容生成器");
  if (input.targets.length < 1 || input.targets.length > 20) throw new DomainError("INVALID_TARGETS", 422, "平台目标数量无效");
  assertSameSiteUrl(input.targetUrl, policy);
  const topic = await one<Row>(ctx.db, "SELECT * FROM topics WHERE org_id=$1 AND id=$2", [ctx.orgId, input.topicId], "主题");
  const mother = await one<VersionRecord>(ctx.db, "SELECT v.* FROM content_versions v JOIN content_items i ON i.org_id=v.org_id AND i.id=v.content_item_id WHERE v.org_id=$1 AND v.id=$2 AND i.topic_id=$3", [ctx.orgId, input.motherContentVersionId, input.topicId], "主题母稿");
  const claims = await validateClaims(ctx, ctx.db, mother.claim_ids);
  const variants: Awaited<ReturnType<typeof createPlatformVariant>>[] = []; const blocked: { platform_account_id: string; code: string; message: string }[] = [];
  for (const target of input.targets) {
    try {
      const profile = await one<Row>(ctx.db, "SELECT v.*,p.platform_account_id FROM platform_profile_versions v JOIN platform_profiles p ON p.org_id=v.org_id AND p.id=v.profile_id WHERE v.org_id=$1 AND v.id=$2 AND p.platform_account_id=$3", [ctx.orgId, target.profileVersionId, target.platformAccountId], "账号档案");
      if (!profile.calibrated_at || !(profile.style_samples as unknown[]).length || !(profile.rules_source_urls as string[]).length) throw new DomainError("PLATFORM_PROFILE_NOT_READY", 422, "风格或平台要求尚未校准");
      const copy = await generator.generate({ topic, profile, verifiedClaims: claims, format: target.format, targetUrl: input.targetUrl });
      const item = await createContentItem(ctx, { title: copy.title, business_line: String(topic.business_line) as ContentItemInput["business_line"], kind: target.format === "video" ? "video_script" : "article", topic_id: input.topicId });
      variants.push(await createPlatformVariant(ctx, { mother_content_version_id: mother.id, content_item_id: item.id, platform_account_id: target.platformAccountId, platform_profile_version_id: target.profileVersionId, format: target.format, title: copy.title, body: copy.body, cta: copy.cta, target_url: input.targetUrl, claim_ids: mother.claim_ids, asset_ids: copy.asset_ids, ...(copy.ai_generated !== undefined ? { ai_generated: copy.ai_generated } : {}), ...(copy.ai_label_applied ? { ai_label_applied: copy.ai_label_applied } : {}) }, policy, verifyObject));
    } catch (error) {
      if (!(error instanceof DomainError)) throw error;
      blocked.push({ platform_account_id: target.platformAccountId, code: error.code, message: error.message });
    }
  }
  return { variants, blocked, state: blocked.length ? variants.length ? "partial" : "blocked" : "ready", mode: ctx.mode, execution_authorized: false };
}

export async function createPlatformProfile(ctx: ServiceContext, input: { platform_account_id: string; name: string }) {
  await requireContentAccess(ctx, "owner", "marketer"); safeText(input.name, 200); validId(input.platform_account_id);
  return ctx.db.transaction(async (tx) => {
    await requireActiveRole(ctx, tx, "owner", "marketer");
    await one(tx, "SELECT id FROM platform_accounts WHERE org_id=$1 AND id=$2", [ctx.orgId, input.platform_account_id], "平台账号");
    const existing = (await tx.query<Row>("SELECT * FROM platform_profiles WHERE org_id=$1 AND platform_account_id=$2", [ctx.orgId, input.platform_account_id])).rows[0];
    if (existing) return { id: String(existing.id), version: Number(existing.version) };
    const id = uuid(); await tx.query("INSERT INTO platform_profiles (id,org_id,platform_account_id,name,version) VALUES ($1,$2,$3,$4,1)", [id, ctx.orgId, input.platform_account_id, input.name]);
    await audit(ctx, tx, "platform.profile.created", "platform_profile", id); return { id, version: 1 };
  });
}
export interface PlatformProfileVersionInput {
  audience: string; style_samples: Record<string, unknown>[]; allowed_formats: string[]; rules_json: Record<string, unknown>;
  rules_source_urls: string[]; rules_checked_at: string; asset_requirements: Record<string, unknown>;
}
export async function createPlatformProfileVersion(ctx: ServiceContext, id: string, input: PlatformProfileVersionInput, expectedVersion: number) {
  await requireContentAccess(ctx, "owner", "marketer"); safeText(input.audience, 3000); validId(id);
  const rules = input.rules_json;
  const known = ["title_max_length", "body_max_length", "valid_until", "ai_label_capability_tested"];
  if (Object.keys(rules).some((key) => !known.includes(key)) || !Number.isSafeInteger(rules.title_max_length) || Number(rules.title_max_length) < 1 || Number(rules.title_max_length) > 1000 || !Number.isSafeInteger(rules.body_max_length) || Number(rules.body_max_length) < 1 || Number(rules.body_max_length) > 100000) throw new DomainError("UNKNOWN_PLATFORM_RULES", 422, "平台要求必须使用已实现的固定规则字段");
  if (!input.allowed_formats.length || input.allowed_formats.some((format) => !["article", "image_text", "qa", "video", "audio", "ad_copy"].includes(format)) || !input.rules_source_urls.length || input.rules_source_urls.some((url) => { try { const parsed = new URL(url); return parsed.protocol !== "https:" || Boolean(parsed.username || parsed.password) || ["localhost", "127.0.0.1"].includes(parsed.hostname); } catch { return true; } })) throw new DomainError("INVALID_PLATFORM_PROFILE", 422, "平台格式或规则来源尚未明确");
  if (!Number.isFinite(Date.parse(input.rules_checked_at)) || Date.parse(input.rules_checked_at) > Date.parse(nowIso(ctx)) + 300000 || (rules.valid_until && (!Number.isFinite(Date.parse(String(rules.valid_until))) || Date.parse(String(rules.valid_until)) <= Date.parse(nowIso(ctx))))) throw new DomainError("INVALID_RULE_CHECK_TIME", 422, "平台要求的核验时间或有效期无效");
  if (Object.keys(input.asset_requirements).some((key) => key !== "required_kinds") || (input.asset_requirements.required_kinds !== undefined && (!Array.isArray(input.asset_requirements.required_kinds) || input.asset_requirements.required_kinds.some((kind) => !["image", "cover", "video", "audio"].includes(String(kind)))))) throw new DomainError("UNKNOWN_ASSET_REQUIREMENTS", 422, "素材要求必须使用固定媒体类型清单");
  return ctx.db.transaction(async (tx) => {
    await requireActiveRole(ctx, tx, "owner", "marketer");
    const profile = await one<Row>(tx, "SELECT * FROM platform_profiles WHERE org_id=$1 AND id=$2 FOR UPDATE", [ctx.orgId, id], "平台档案"); assertVersion(Number(profile.version), expectedVersion);
    if (rules.ai_label_capability_tested === true) {
      const account = await one<Row>(tx, "SELECT a.*,c.capabilities,c.capabilities_verified_at FROM platform_accounts a JOIN connections c ON c.org_id=a.org_id AND c.id=a.connection_id WHERE a.org_id=$1 AND a.id=$2", [ctx.orgId, profile.platform_account_id], "平台账号");
      const capability = (account.capabilities as Row)?.ai_label;
      if (!account.capabilities_verified_at || !capability || typeof capability !== "object" || (capability as Row).tested !== true) throw new DomainError("UNVERIFIED_LABEL_CAPABILITY", 422, "AI 原生声明能力不能由配置字段自行宣告已实测");
    }
    const versionNo = Number((await tx.query<Row>("SELECT COALESCE(MAX(version_no),0)+1 AS version FROM platform_profile_versions WHERE org_id=$1 AND profile_id=$2", [ctx.orgId, id])).rows[0]?.version); const versionId = uuid();
    await tx.query("INSERT INTO platform_profile_versions (id,org_id,profile_id,version_no,audience,style_samples,allowed_formats,rules_json,rules_source_urls,rules_checked_at,asset_requirements,payload_hash) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)", [versionId, ctx.orgId, id, versionNo, input.audience, JSON.stringify(input.style_samples), input.allowed_formats, JSON.stringify(rules), input.rules_source_urls, input.rules_checked_at, JSON.stringify(input.asset_requirements), stableHash(input)]);
    await tx.query("UPDATE platform_profiles SET current_version_id=$3,version=version+1,updated_at=$4 WHERE org_id=$1 AND id=$2", [ctx.orgId, id, versionId, nowIso(ctx)]);
    await audit(ctx, tx, "platform.profile.version.created", "platform_profile", id, { version_id: versionId }); return { id: versionId, profile_id: id, version: expectedVersion + 1, version_no: versionNo, calibrated: false };
  });
}
export async function calibratePlatformProfile(ctx: ServiceContext, id: string, expectedVersion: number) {
  const { requireOwner } = await import("./authz");
  return ctx.db.transaction(async (tx) => {
    await requireActiveRole(ctx, tx, "owner", "marketer");
    await requireOwner(ctx, tx); const profile = await one<Row>(tx, "SELECT * FROM platform_profiles WHERE org_id=$1 AND id=$2 FOR UPDATE", [ctx.orgId, id], "平台档案"); assertVersion(Number(profile.version), expectedVersion);
    const version = await one<Row>(tx, "SELECT * FROM platform_profile_versions WHERE org_id=$1 AND id=$2 AND profile_id=$3", [ctx.orgId, profile.current_version_id, id], "当前平台要求");
    if (!(version.style_samples as unknown[]).length) throw new DomainError("STYLE_SAMPLES_REQUIRED", 422, "首次校准需要实际风格样稿");
    await tx.query("UPDATE platform_profile_versions SET calibrated_by=$3,calibrated_at=$4,updated_at=$4 WHERE org_id=$1 AND id=$2", [ctx.orgId, version.id, ctx.actorId, nowIso(ctx)]);
    await tx.query("UPDATE platform_profiles SET version=version+1,updated_at=$3 WHERE org_id=$1 AND id=$2", [ctx.orgId, id, nowIso(ctx)]);
    await audit(ctx, tx, "platform.profile.calibrated", "platform_profile", id, { version_id: version.id }); return { id, version: expectedVersion + 1, calibrated: true, native_capabilities_verified: false };
  });
}
export async function createPublishJob(ctx: ServiceContext, input: { content_variant_id: string; platform_account_id: string; scheduled_at: string; policy_version_id?: string; approval_id?: string; idempotency_key: string }, verifyObject?: AssetVerifier) {
  await requireContentAccess(ctx, "owner", "marketer");
  if (Boolean(input.policy_version_id) === Boolean(input.approval_id) || !Number.isFinite(Date.parse(input.scheduled_at))) throw new DomainError("INVALID_PUBLISH_JOB", 422, "发布排期必须有一种明确授权来源与有效时间");
  const { createExecutionAction } = await import("./execution");
  return ctx.db.transaction(async (tx) => {
    await requireActiveRole(ctx, tx, "owner", "marketer");
    const variant = await one<Row>(tx, "SELECT v.*,c.body_json,c.claim_ids,c.payload_hash,i.business_line,i.topic_id,p.rules_json,p.asset_requirements FROM content_variants v JOIN content_versions c ON c.org_id=v.org_id AND c.id=v.content_version_id JOIN content_items i ON i.org_id=c.org_id AND i.id=c.content_item_id JOIN platform_profile_versions p ON p.org_id=v.org_id AND p.id=v.platform_profile_version_id WHERE v.org_id=$1 AND v.id=$2 FOR UPDATE OF v", [ctx.orgId, input.content_variant_id], "平台素材");
    await assertVersionMode(ctx,tx,await one<VersionRecord>(tx,'SELECT * FROM content_versions WHERE org_id=$1 AND id=$2',[ctx.orgId,variant.content_version_id],'平台正文'));
    if (variant.platform_account_id !== input.platform_account_id || variant.validation_status !== "passed" || variant.validated_payload_hash !== variant.payload_hash || !variant.validated_at) throw new DomainError("VARIANT_NOT_READY", 422, "平台素材尚未通过校验或与目标账号不一致");
    await validateClaims(ctx, tx, variant.claim_ids as string[]);
    const needs = (variant.asset_requirements as Row).required_kinds; await validateAssets(ctx, tx, variant.asset_ids as string[], verifyObject, Array.isArray(needs) ? needs.map(String) : []);
    if (input.policy_version_id) {
      const policy = await one<Row>(tx, "SELECT * FROM policy_versions WHERE org_id=$1 AND id=$2", [ctx.orgId, input.policy_version_id], "执行规则");
      if (Date.parse(input.scheduled_at) < Date.parse(String(policy.valid_from)) || (policy.valid_until && Date.parse(input.scheduled_at) >= Date.parse(String(policy.valid_until)))) throw new DomainError("SCHEDULE_OUT_OF_SCOPE", 422, "发布时间超出批准规则有效期");
      const account = await one<Row>(tx, "SELECT timezone FROM platform_accounts WHERE org_id=$1 AND id=$2", [ctx.orgId, input.platform_account_id], "平台账号");
      const local = new Intl.DateTimeFormat("en-GB", { timeZone: String(account.timezone), weekday: "short", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).formatToParts(new Date(input.scheduled_at));
      const get = (part: string) => local.find((value) => value.type === part)?.value ?? "";
      const windows = policy.publish_windows as Row[];
      const weekday = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].indexOf(get("weekday")); const minute = Number(get("hour")) * 60 + Number(get("minute"));
      if (!windows.length || !windows.some((window) => { const days = window.days ?? window.weekdays; const start = String(window.start ?? window.start_time ?? ""); const end = String(window.end ?? window.end_time ?? ""); const parse = (text: string) => /^\d{2}:\d{2}$/.test(text) ? Number(text.slice(0, 2)) * 60 + Number(text.slice(3)) : -1; return Array.isArray(days) && days.includes(weekday) && parse(start) >= 0 && minute >= parse(start) && minute < parse(end); })) throw new DomainError("SCHEDULE_WINDOW_REQUIRED", 422, "发布时间不在批准的账号本地时区窗口内");
    }
    const slot = stableHash({ account_id: input.platform_account_id, variant_id: input.content_variant_id, scheduled_at: new Date(input.scheduled_at).toISOString() });
    const prior = (await tx.query<Row>("SELECT * FROM publish_jobs WHERE org_id=$1 AND platform_account_id=$2 AND content_variant_id=$3 AND schedule_slot_key=$4", [ctx.orgId, input.platform_account_id, input.content_variant_id, slot])).rows[0];
    if (prior) return { id: String(prior.id), job_id: String(prior.id), action_id: String(prior.execution_action_id), status: String(prior.delivery_state), verification_status: String(prior.verification_status), mode: ctx.mode };
    const txContext: ServiceContext = { ...ctx, db: { query: tx.query.bind(tx), transaction: async (fn) => fn(tx), close: async () => undefined } };
    const action = await createExecutionAction(txContext, { idempotencyKey: input.idempotency_key, actionType: "external.publish", target: { platform_account_id: input.platform_account_id, content_variant_id: input.content_variant_id, business_line: variant.business_line, ...(variant.topic_id ? { topic_id: variant.topic_id } : {}) }, versionId: String(variant.content_version_id), payload: variant.body_json as Row, beforeSnapshot: {}, ...(input.policy_version_id ? { policyVersionId: input.policy_version_id } : {}), ...(input.approval_id ? { approvalId: input.approval_id } : {}) });
    const id = uuid(); await tx.query("INSERT INTO publish_jobs (id,org_id,execution_action_id,platform_account_id,content_variant_id,scheduled_at,schedule_slot_key,delivery_state,verification_status) VALUES ($1,$2,$3,$4,$5,$6,$7,'scheduled','unverified')", [id, ctx.orgId, action.id, input.platform_account_id, input.content_variant_id, input.scheduled_at, slot]);
    await emitOutbox(ctx, tx, "content.platform_publish.requested", id, { job_id: id, action_id: action.id, mode: ctx.mode }); await audit(ctx, tx, "publish.job.scheduled", "publish_job", id, { scheduled_at: input.scheduled_at });
    return { id, job_id: id, action_id: action.id, status: "scheduled", verification_status: "unverified", mode: ctx.mode };
  });
}

export async function updatePageMetadata(ctx: ServiceContext, id: string, input: { seo_title?: string; description?: string; index_policy?: "index" | "noindex" }, expectedVersion: number) {
  await requireContentAccess(ctx, "owner", "marketer");
  if (input.seo_title !== undefined) safeText(input.seo_title, 300); if (input.description !== undefined) safeText(input.description, 1000);
  if (input.index_policy !== undefined && !["index", "noindex"].includes(input.index_policy)) throw new DomainError("INVALID_INDEX_POLICY", 422, "索引策略无效");
  return ctx.db.transaction(async (tx) => {
    await requireActiveRole(ctx, tx, "owner", "marketer");
    const page = await one<PageRecord>(tx, "SELECT * FROM pages WHERE org_id=$1 AND id=$2 FOR UPDATE", [ctx.orgId, id], "页面"); assertVersion(page.version, expectedVersion);
    if (page.owner_system !== "marketing") throw new DomainError("LEGACY_PAGE_PROTECTED", 403, "旧站页面设置不能由新 CMS 改写");
    await tx.query("UPDATE pages SET seo_title=$3,description=$4,index_policy=$5,version=version+1,updated_at=$6 WHERE org_id=$1 AND id=$2", [ctx.orgId, id, input.seo_title ?? page.seo_title, input.description ?? page.description, input.index_policy ?? page.index_policy, nowIso(ctx)]);
    await audit(ctx, tx, "page.metadata.draft_updated", "page", id);
    return { id, version: expectedVersion + 1, published_content_unchanged: true };
  });
}
export async function archiveContentItem(ctx: ServiceContext, id: string) {
  await requireContentAccess(ctx, "owner", "marketer");
  return ctx.db.transaction(async (tx) => {
    await requireActiveRole(ctx, tx, "owner", "marketer");
    await one(tx, "SELECT id FROM content_items WHERE org_id=$1 AND id=$2 FOR UPDATE", [ctx.orgId, id], "内容");
    if ((await tx.query("SELECT id FROM pages WHERE org_id=$1 AND content_item_id=$2 AND published_release_id IS NOT NULL", [ctx.orgId, id])).rows.length) throw new DomainError("CONTENT_STILL_PUBLISHED", 409, "已发布正文需先按授权下架");
    await tx.query("UPDATE content_items SET deleted_at=$3,updated_at=$3 WHERE org_id=$1 AND id=$2", [ctx.orgId, id, nowIso(ctx)]);
    await audit(ctx, tx, "content.archived", "content_item", id); return { id, archived: true };
  });
}
