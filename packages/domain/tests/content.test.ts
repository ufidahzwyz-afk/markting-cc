import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { createTestDatabase, DEMO_ORG_ID, DEMO_OWNER_ID } from "@boran/db";
import { DomainError, uuid } from "../src/core";
import type { ServiceContext } from "../src/core";
import { activatePolicy, createExecutionAction, createPolicy, revokePolicy } from "../src/execution";
import { assertSameSiteUrl, assertSitePath, calibratePlatformProfile, createContentItem, createContentVersion, createPage, createPlatformProfile, createPlatformProfileVersion, createPlatformVariant, getPagePreview, publishPage, readPublishedPage, reviewContentVersion, rollbackPage, verifyPageRelease } from "../src/content";
import type { SitePolicy } from "../src/content";

const policy: SitePolicy = { publicOrigin: "http://localhost:3001", allowedPathPrefixes: ["/articles", "/services"] };
const modules = (headline = "企业集成准备事项", mediaId?: string) => [
  { type: "hero", schema_version: 1, data: { headline, description: "了解组织、人员与业务基础数据的协作准备。", cta: { label: "阅读服务说明", href: "/articles/integration", action: "navigate" }, ...(mediaId ? { media: { asset_id: mediaId, alt: "服务说明配图" } } : {}) } },
  { type: "solution", schema_version: 1, data: { heading: "准备方法", body: [{ type: "paragraph", text: "先梳理现有应用与业务问题，再确认系统边界。" }], claim_ids: [] } },
  { type: "cta", schema_version: 1, data: { heading: "进一步了解", button: { label: "查看服务说明", href: "/articles/integration", action: "navigate" } } },
];
async function setup() {
  const db = await createTestDatabase();
  const ctx: ServiceContext = { db, orgId: DEMO_ORG_ID, actorId: DEMO_OWNER_ID, roles: ["owner", "marketer"], mode: "mock" };
  const created = await createPolicy(ctx, { name: "本地页面发布规则", businessScope: { business_lines: ["shared"] }, accountIds: [], allowedActions: ["content.publish"], stopConditions: { manual_stop: true }, approvedPathPrefixes: ["/articles", "/services"] });
  const version = (await db.query("SELECT id FROM policy_versions WHERE policy_id=$1", [created.id])).rows[0]!;
  await activatePolicy(ctx, String(created.id), String(version.id), 1);
  const item = await createContentItem(ctx, { title: "集成服务说明", business_line: "shared", kind: "article" });
  const content = await createContentVersion(ctx, item.id, { title: "企业集成准备事项", modules: modules(), claim_ids: [] }, 0);
  await reviewContentVersion(ctx, content.id, { review_status: "approved" });
  const page = await createPage(ctx, { host: "localhost:3001", path: "/articles/integration", business_line: "shared", template_key: "article", content_item_id: item.id, seo_title: "企业集成准备事项", description: "梳理企业应用与系统集成的准备事项。", canonical_url: "http://localhost:3001/articles/integration", index_policy: "noindex" }, policy);
  async function action(contentId = content.id) {
    const body = (await db.query("SELECT body_json FROM content_versions WHERE id=$1", [contentId])).rows[0]!.body_json as Record<string, unknown>;
    return createExecutionAction(ctx, { idempotencyKey: `test-publish-${uuid()}`, actionType: "content.publish", target: { page_id: page.page_id, business_line: "shared" }, versionId: contentId, payload: body, beforeSnapshot: {}, policyVersionId: String(version.id) });
  }
  return { db, ctx, item, content, page, action, policyId: String(created.id) };
}
function expectCode(code: string) { return (error: unknown) => error instanceof DomainError && error.code === code; }

test("same-host routes reject traversal, encoded paths, reserved routes, unapproved prefixes and cross-domain canonical", () => {
  for (const path of ["//evil.example/a", "/articles/../admin", "/articles/%2e%2e/admin", "/articles/a%2fb", "/articles/a?token=x", "/articles/a#x", "/articles/a\\b", "/api/leads", "/articles2/a"]) assert.throws(() => assertSitePath(path, policy), DomainError);
  assert.equal(assertSitePath("/articles/integration", policy), "/articles/integration");
  assert.throws(() => assertSameSiteUrl("https://evil.example/articles/integration", policy, "/articles/integration"), expectCode("CROSS_ORIGIN_URL"));
});

test("strict modules reject HTML, JavaScript links, unknown fields and raw embeds", async () => {
  const value = await setup();
  try {
    const malicious = modules(); (malicious[0]!.data as { headline: string }).headline = "<script>alert(1)</script>";
    await assert.rejects(createContentVersion(value.ctx, value.item.id, { title: "恶意模块", modules: malicious, claim_ids: [] }, 1), expectCode("INVALID_PAGE_MODULES"));
    const unsafeLink = modules(); (unsafeLink[0]!.data as { cta: { href: string } }).cta.href = "javascript:alert(1)";
    await assert.rejects(createContentVersion(value.ctx, value.item.id, { title: "不安全链接", modules: unsafeLink, claim_ids: [] }, 1), expectCode("INVALID_PAGE_MODULES"));
    await assert.rejects(createContentVersion(value.ctx, value.item.id, { title: "嵌入模块", modules: [{ type: "iframe", schema_version: 1, data: { src: "https://example.invalid" } }], claim_ids: [] }, 1), expectCode("INVALID_PAGE_MODULES"));
    await assert.rejects(createContentVersion(value.ctx, value.item.id, { title: "注入字段", modules: [{ ...modules()[0], onclick: "alert(1)" }], claim_ids: [] }, 1), expectCode("INVALID_PAGE_MODULES"));
    await assert.rejects(createContentVersion(value.ctx, value.item.id, { title: "旧编辑版本", modules: modules(), claim_ids: [] }, 0), expectCode("VERSION_CONFLICT"));
  } finally { await value.db.close(); }
});

test("release creation is atomic, immutable, only current published content is public, rollback appends a release", async () => {
  const value = await setup();
  try {
    assert.equal(await readPublishedPage(value.db, DEMO_ORG_ID, "localhost:3001", "/articles/integration"), null);
    const firstAction = await value.action();
    const first = await publishPage(value.ctx, { pageId: value.page.page_id, contentVersionId: value.content.id, actionId: String(firstAction.id), expectedVersion: 1 }, policy);
    assert.equal(first.state, "verification_pending");
    const repeat = await publishPage(value.ctx, { pageId: value.page.page_id, contentVersionId: value.content.id, actionId: String(firstAction.id), expectedVersion: 1 }, policy);
    assert.equal(repeat.release_id, first.release_id);
    const secondContent = await createContentVersion(value.ctx, value.item.id, { title: "更新后的准备事项", modules: modules("更新后的准备事项"), claim_ids: [] }, 1);
    await reviewContentVersion(value.ctx, secondContent.id, { review_status: "approved" });
    const secondAction = await value.action(secondContent.id);
    const second = await publishPage(value.ctx, { pageId: value.page.page_id, contentVersionId: secondContent.id, actionId: String(secondAction.id), expectedVersion: 2 }, policy);
    assert.equal((await readPublishedPage(value.db, DEMO_ORG_ID, "localhost:3001", "/articles/integration"))?.content.id, secondContent.id);
    const rollbackAction = await value.action(value.content.id);
    const rollback = await rollbackPage(value.ctx, { pageId: value.page.page_id, releaseId: first.release_id, actionId: String(rollbackAction.id), expectedVersion: 3 }, policy);
    assert.notEqual(rollback.release_id, first.release_id);
    const release = (await value.db.query("SELECT * FROM releases WHERE id=$1", [rollback.release_id])).rows[0]!;
    assert.equal(release.previous_release_id, second.release_id); assert.equal(release.rollback_of_id, first.release_id);
    assert.equal((await readPublishedPage(value.db, DEMO_ORG_ID, "localhost:3001", "/articles/integration"))?.content.id, value.content.id);
    await assert.rejects(value.db.query("UPDATE releases SET route_config_version='tampered' WHERE id=$1", [first.release_id]));
    await assert.rejects(value.db.query("UPDATE content_versions SET body_json='{}' WHERE id=$1", [value.content.id]));
  } finally { await value.db.close(); }
});

test("missing actual media and path collisions block publication without changing the pointer", async () => {
  const value = await setup();
  try {
    const content = await createContentVersion(value.ctx, value.item.id, { title: "需要配图", modules: modules("需要配图", uuid()), claim_ids: [] }, 1);
    await reviewContentVersion(value.ctx, content.id, { review_status: "approved" }); const action = await value.action(content.id);
    await assert.rejects(publishPage(value.ctx, { pageId: value.page.page_id, contentVersionId: content.id, actionId: String(action.id), expectedVersion: 1 }, policy), expectCode("MEDIA_MISSING"));
    assert.equal((await value.db.query("SELECT published_release_id FROM pages WHERE id=$1", [value.page.page_id])).rows[0]!.published_release_id, null);
    await assert.rejects(createPage(value.ctx, { host: "localhost:3001", path: "/articles/integration", business_line: "shared", template_key: "article", content_item_id: value.item.id, seo_title: "重复路径", description: "此测试应保护现有路由", canonical_url: "http://localhost:3001/articles/integration", index_policy: "noindex" }, policy), expectCode("PAGE_PATH_CONFLICT"));
    await revokePolicy(value.ctx, value.policyId, 2);
    await assert.rejects(publishPage(value.ctx, { pageId: value.page.page_id, contentVersionId: value.content.id, actionId: String((await value.db.query("SELECT id FROM execution_actions LIMIT 1")).rows[0]!.id), expectedVersion: 1 }, policy));
  } finally { await value.db.close(); }
});

test("actual HTTP readback rejects wrong versions, mock evidence never marks a real succeeded action", async () => {
  const value = await setup();
  try {
    const action = await value.action(); const release = await publishPage(value.ctx, { pageId: value.page.page_id, contentVersionId: value.content.id, actionId: String(action.id), expectedVersion: 1 }, policy);
    await assert.rejects(verifyPageRelease(value.ctx, release.release_id, policy, async () => new Response("<h1>错误版本</h1>", { headers: { "content-type": "text/html" } })), expectCode("PAGE_READBACK_MISMATCH"));
    await assert.rejects(verifyPageRelease(value.ctx, release.release_id, policy, async () => new Response(`<script data-release-id="${release.release_id}" data-content-hash="${value.content.payload_hash}">window.current=true</script><article><h1>企业集成准备事项</h1></article>`, { headers: { "content-type": "text/html" } })), expectCode("PAGE_READBACK_MISMATCH"));
    const verified = await verifyPageRelease(value.ctx, release.release_id, policy, async () => new Response(`<article data-mode="mock" data-release-id="${release.release_id}" data-content-hash="${value.content.payload_hash}"><h1>企业集成准备事项</h1><p>了解组织、人员与业务基础数据的协作准备。</p><a>阅读服务说明</a><h2>准备方法</h2><p>先梳理现有应用与业务问题，再确认系统边界。</p><h2>进一步了解</h2><a>查看服务说明</a></article>`, { headers: { "content-type": "text/html" } }));
    assert.equal(verified.state, "mock_verified"); assert.equal(verified.real_integration_accepted, false);
    const stored = (await value.db.query("SELECT state,verified_at,verification_evidence_ref FROM execution_actions WHERE id=$1", [action.id])).rows[0]!;
    assert.equal(stored.state, "verification_pending"); assert.equal(stored.verified_at, null); assert.equal((stored.verification_evidence_ref as Record<string, unknown>).mode, "mock");
  } finally { await value.db.close(); }
});

test("native platform review accepts only hash-bound validated variants and never grants execution authority", async () => {
  const value = await setup();
  try {
    const topic = uuid(), connection = uuid(), account = uuid();
    await value.db.query("INSERT INTO topics(id,org_id,business_line,title,audience,problem,offer,angle,dedupe_key) VALUES($1,$2,'shared','测试集成准备','业务负责人','应用边界','准备说明','业务准备',$3)", [topic, value.ctx.orgId, "1".repeat(64)]);
    await value.db.query("UPDATE content_items SET topic_id=$3 WHERE org_id=$1 AND id=$2", [value.ctx.orgId, value.item.id, topic]);
    await value.db.query("INSERT INTO connections(id,org_id,provider,account_external_id,display_name,timezone,currency,read_mode) VALUES($1,$2,'mock','native-test','平台隔离测试','Asia/Shanghai','CNY','mock')", [connection, value.ctx.orgId]);
    await value.db.query("INSERT INTO platform_accounts(id,org_id,connection_id,provider,account_external_id,display_name) VALUES($1,$2,$3,'mock','native-test','原生测试账号')", [account, value.ctx.orgId, connection]);
    const profile = await createPlatformProfile(value.ctx, { platform_account_id: account, name: "测试专业文章规则" });
    assert.deepEqual(await createPlatformProfile(value.ctx, { platform_account_id: account, name: "测试专业文章规则" }), profile);
    const profileVersion = await createPlatformProfileVersion(value.ctx, profile.id, { audience: "业务负责人", style_samples: [{ text: "先梳理业务问题，再明确集成边界。" }], allowed_formats: ["article"], rules_json: { title_max_length: 80, body_max_length: 3000 }, rules_source_urls: ["https://example.invalid/platform-rules"], rules_checked_at: new Date().toISOString(), asset_requirements: {} }, 1);
    await calibratePlatformProfile(value.ctx, profile.id, 2);
    const nativeItem = await createContentItem(value.ctx, { title: "平台集成准备说明", business_line: "shared", kind: "article", topic_id: topic });
    const variant = await createPlatformVariant(value.ctx, { mother_content_version_id: value.content.id, content_item_id: nativeItem.id, platform_account_id: account, platform_profile_version_id: profileVersion.id, format: "article", title: "应用集成的准备问题", body: "整理现有应用和业务问题，说明系统边界后再确定准备事项。", cta: "阅读准备说明", target_url: "http://localhost:3001/articles/integration", claim_ids: [], asset_ids: [], ai_generated: false }, policy);
    const review = await reviewContentVersion(value.ctx, variant.content_version_id, { review_status: "approved" });
    assert.equal(review.review_status, "approved"); assert.equal(review.execution_authorized, false);
    await value.db.query("UPDATE content_variants SET validation_status='blocked' WHERE org_id=$1 AND id=$2", [value.ctx.orgId, variant.id]);
    await assert.rejects(reviewContentVersion(value.ctx, variant.content_version_id, { review_status: "approved" }), expectCode("CONTENT_VERSION_NOT_VALIDATED"));
  } finally { await value.db.close(); }
});

test("all release history is retained beyond ten and restricted preview shares immutable modules", async () => {
  const value = await setup();
  try {
    for (let i = 0; i < 11; i++) {
      const action = await value.action();
      await publishPage(value.ctx, { pageId: value.page.page_id, contentVersionId: value.content.id, actionId: String(action.id), expectedVersion: i + 1 }, policy);
    }
    assert.equal((await value.db.query("SELECT count(*)::integer AS count FROM releases WHERE page_id=$1", [value.page.page_id])).rows[0]!.count, 11);
    const preview = await getPagePreview(value.ctx, value.page.page_id); assert.deepEqual(preview.modules, modules()); assert.equal(preview.robots, "noindex, nofollow");
    await assert.rejects(getPagePreview({ ...value.ctx, roles: [] }, value.page.page_id), expectCode("FORBIDDEN"));
  } finally { await value.db.close(); }
});

test("ready media still requires allowed license and actual matching file bytes", async () => {
  const value = await setup();
  try {
    const bytes = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jO2sAAAAASUVORK5CYII=", "base64");
    const id = uuid(); const hash = createHash("sha256").update(bytes).digest("hex");
    await value.db.query("INSERT INTO media_assets (id,org_id,kind,mime_type,object_key,content_hash,public_permission,state,metadata_json,license_evidence_ref) VALUES ($1,$2,'image','image/png','test/fixture.png',$3,'unknown','ready','{}',$4)", [id, DEMO_ORG_ID, hash, JSON.stringify({ kind: "local_test_fixture", scope: "test_only" })]);
    const content = await createContentVersion(value.ctx, value.item.id, { title: "带配图内容", modules: modules("带配图内容", id), claim_ids: [] }, 1);
    await reviewContentVersion(value.ctx, content.id, { review_status: "approved" }); const action = await value.action(content.id);
    const input = { pageId: value.page.page_id, contentVersionId: content.id, actionId: String(action.id), expectedVersion: 1 };
    await assert.rejects(publishPage(value.ctx, { ...input, verifyObject: async () => ({ bytes, mimeType: "image/png" }) }, policy), expectCode("MEDIA_NOT_PUBLISHABLE"));
    await value.db.query("UPDATE media_assets SET public_permission='allowed' WHERE id=$1", [id]);
    await assert.rejects(publishPage(value.ctx, input, policy), expectCode("ASSET_VERIFIER_REQUIRED"));
    await assert.rejects(publishPage(value.ctx, { ...input, verifyObject: async () => ({ bytes: Buffer.from("fake manifest is not an image"), mimeType: "image/png" }) }, policy), expectCode("MEDIA_HASH_MISMATCH"));
    const release = await publishPage(value.ctx, { ...input, verifyObject: async () => ({ bytes, mimeType: "image/png" }) }, policy);
    assert.equal(release.state, "verification_pending");
  } finally { await value.db.close(); }
});
