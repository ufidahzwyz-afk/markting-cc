import test from "node:test";
import assert from "node:assert/strict";
import { chromium } from "playwright";
import { createPlatformAdapter, getPlatformDescriptor, type PlatformExecutionContext } from "@boran/connectors";
import { BrowserRecipeRegistry, validateBrowserRecipe, type BrowserRecipe } from "../src/recipes";
import { createRecipePlatformHooks } from "../src/recipe-hooks";
import { safePlatformData } from "../src/service";

const recipe: BrowserRecipe = {
  id: "fixture-toutiao", version: "fixture-v1", channelId: "toutiao", allowedOrigins: ["https://mp.toutiao.com"],
  login: { method: "password", url: "https://mp.toutiao.com/login", accountUrl: "https://mp.toutiao.com/account", account: { selector: "#account", attribute: "data-account-id" }, usernameSelector: "#username", passwordSelector: "#password", submitSelector: "#sign-in", challengeSelectors: ["#mfa"] },
  publication: { format: "article", url: "https://mp.toutiao.com/editor", titleSelector: "#title", bodySelector: "#body", submitSelector: "#publish", externalId: { selector: "#receipt", attribute: "data-publication-id" }, readbackUrlTemplate: "https://mp.toutiao.com/posts/{externalId}", readbackAccount: { selector: "#account", attribute: "data-account-id" }, titleReadbackSelector: "h1", bodyReadbackSelector: "article", publishedSelector: "#published", inReviewSelector: "#reviewing", rejectedSelector: "#rejected", publicUrl: { selector: "#public-url", attribute: "href" }, labels: [{ selector: "#label", text: "AI 辅助生成" }] },
};
const base: PlatformExecutionContext = { orgId: "isolated-org", accountId: "isolated-account", externalAccountId: "fixture-account", adapterVersion: recipe.version, sessionVersion: 0, fencingToken: 1, commandId: "fixture-command", mode: "live", assertLease: async () => undefined };
test("recipes are scoped/versioned and cannot turn arbitrary URLs or scripts into an adapter", () => {
  assert.equal(new BrowserRecipeRegistry([recipe]).get(recipe.id, recipe.version, recipe.channelId).version, recipe.version);
  assert.throws(() => validateBrowserRecipe({ ...recipe, allowedOrigins: ["https://unapproved.example"] }), { code: "invalid_browser_recipe" });
  assert.throws(() => validateBrowserRecipe({ ...recipe, login: { ...recipe.login, url: "http://127.0.0.1/private" } }), { code: "recipe_url_outside_scope" });
  assert.throws(() => validateBrowserRecipe({ ...recipe, script: "arbitrary executable" }), { code: "invalid_browser_recipe" });
  assert.throws(() => new BrowserRecipeRegistry([recipe, recipe]), { code: "duplicate_browser_recipe" });
  assert.throws(() => new BrowserRecipeRegistry([recipe]).get(recipe.id, "wrong-version", recipe.channelId), { code: "browser_recipe_not_configured" });
});
test("command results preserve business receipts but omit provider secrets, raw source content and credential URLs", () => {
  assert.deepEqual(safePlatformData({ external_id: "post-1", review_status: "approved", published_url: "https://mp.toutiao.com/posts/post-1", password: "SYNTHETIC_PASSWORD", rawContent: "private input", cookie: "SYNTHETIC_COOKIE", effective_fields: { campaignId: 1, pause: true, password: "SYNTHETIC_PASSWORD" } }), { external_id: "post-1", review_status: "approved", published_url: "https://mp.toutiao.com/posts/post-1", effective_fields: { campaignId: 1, pause: true } });
  assert.deepEqual(safePlatformData({ published_url: "https://mp.toutiao.com/posts/1?token=SYNTHETIC" }), {});
});

test("actual Chromium password login verifies the account, renews sessions, observes review, and reconciles without a second publish", { skip: !process.env.CHROMIUM_EXECUTABLE_PATH }, async () => {
  const browser = await chromium.launch({ headless: true, executablePath: process.env.CHROMIUM_EXECUTABLE_PATH! });
  const session = await browser.newContext();
  let authenticated = false, accountId = base.externalAccountId, state = "in_review", loginCount = 0, publishCount = 0, challenge = false, body = "实际来源内容", title = "推广草稿";
  const escape = (value: string) => value.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll('"', "&quot;");
  await session.route("**/*", async route => {
    const request = route.request(), url = new URL(request.url());
    if (url.origin !== "https://mp.toutiao.com") return route.abort();
    let html = "";
    if (url.pathname === "/account") html = authenticated ? `<div id="account" data-account-id="${accountId}">已登录账号</div>` : '<a href="/login">请登录</a>';
    if (url.pathname === "/login") html = '<form method="post" action="/login-submit"><input id="username" name="username"><input id="password" type="password" name="password"><button id="sign-in">登录</button></form>';
    if (url.pathname === "/login-submit") {
      const values = new URLSearchParams(request.postData() ?? "");
      assert.equal(values.get("username"), "SYNTHETIC_USER"); assert.equal(values.get("password"), "SYNTHETIC_PASSWORD");
      loginCount++; authenticated = !challenge;
      html = challenge ? '<div id="mfa">人工强验证</div>' : `<div id="account" data-account-id="${accountId}">已登录账号</div>`;
    }
    if (url.pathname === "/editor") html = '<form method="post" action="/publish-result"><input id="title" name="title"><textarea id="body" name="body"></textarea><button id="publish">发布</button></form>';
    if (url.pathname === "/publish-result") { publishCount++; const values = new URLSearchParams(request.postData() ?? ""); title = values.get("title")!; body = values.get("body")!; html = '<div id="receipt" data-publication-id="post-1">真实提交回执</div>'; }
    if (url.pathname === "/posts/post-1") html = `<div id="account" data-account-id="${accountId}">已登录账号</div><h1>${escape(title)}</h1><article>${escape(body)}</article><div id="${state === "approved" ? "published" : state === "rejected" ? "rejected" : "reviewing"}">审核状态</div><a id="public-url" href="https://mp.toutiao.com/posts/post-1">查看发布</a><div id="label">AI 辅助生成</div>`;
    return route.fulfill({ status: 200, contentType: "text/html; charset=utf-8", body: html });
  });
  const material = { title: "推广草稿", body: "实际来源内容", payloadHash: "a".repeat(64), validated: true as const, format: "article" as const };
  const command = { commandType: "publish" as const, actionId: "approved-action", inputRef: {} };
  const hooks = createRecipePlatformHooks({ configuration: async () => ({ recipe, connectionId: "fixture-connection", secretRef: "boran-secret:fixture" }), resolveSecret: async (_ref, scope) => { assert.equal(scope.connectionId, "fixture-connection"); return { kind: "platform_password", username: "SYNTHETIC_USER", password: "SYNTHETIC_PASSWORD" }; }, material: async () => material, priorReceipt: async () => ({ externalId: "post-1", originalCommand: command }) });
  const context = { ...base, browserSession: session };
  try {
    assert.equal((await hooks.login!(context)).status, "verified"); assert.equal(loginCount, 1);
    assert.equal((await hooks.sessionVerify!(context)).status, "verified"); assert.equal(loginCount, 1);
    authenticated = false; assert.equal((await hooks.sessionVerify!(context)).status, "verified"); assert.equal(loginCount, 2);
    accountId = "other-account"; assert.equal((await hooks.login!(context)).status, "challenge_required"); assert.equal(loginCount, 2); accountId = base.externalAccountId;
    // A logged-in account alone cannot claim all publishing capabilities.
    const adapter = createPlatformAdapter("toutiao", { mode: "live", hooks });
    await assert.rejects(() => adapter.execute(context, command), { code: "capability_gap" }); assert.equal(publishCount, 0);
    const capabilityProof = { ...recipe, verification: { verified: true, externalAccountId: base.externalAccountId, adapterVersion: base.adapterVersion, evidenceRef: "synthetic-prior-capability-test", capturedAt: new Date().toISOString(), kind: "browser_readback" as const, capabilities: [...getPlatformDescriptor("toutiao").requiredCapabilities] } };
    const verifiedHooks = createRecipePlatformHooks({ configuration: async () => ({ recipe: capabilityProof, connectionId: "fixture-connection", secretRef: "boran-secret:fixture" }), resolveSecret: async () => ({ kind: "platform_password", username: "SYNTHETIC_USER", password: "SYNTHETIC_PASSWORD" }), material: async () => material, priorReceipt: async () => ({ externalId: "post-1", originalCommand: command }) });
    let journaled = false;
    const verifiedAdapter = createPlatformAdapter("toutiao", { mode: "live", hooks: verifiedHooks });
    const pending = await verifiedAdapter.execute({ ...context, recordSubmission: async receipt => { assert.equal(receipt.externalId, "post-1"); journaled = true; } }, command);
    assert.equal(pending.status, "in_review"); assert.equal(journaled, true); assert.equal(publishCount, 1);
    state = "approved";
    const result = await verifiedAdapter.reconcile(context, { commandType: "reconcile", actionId: "approved-action", inputRef: { reconcile_command_id: "fixture-command" } });
    assert.equal(result.status, "verified", JSON.stringify(result)); if (result.status === "verified") { assert.equal(result.data?.published_url, "https://mp.toutiao.com/posts/post-1"); assert.equal(result.evidence.contentHash, material.payloadHash); }
    assert.equal(publishCount, 1);
    body = "平台上被改写的正文";
    assert.equal((await verifiedHooks.reconcile!(context, { commandType: "reconcile", inputRef: {} })).status, "unknown"); assert.equal(publishCount, 1);
    body = material.body; state = "rejected";
    assert.equal((await verifiedHooks.reconcile!(context, { commandType: "reconcile", inputRef: {} })).status, "rejected");
    authenticated = false; challenge = true;
    assert.equal((await hooks.login!(context)).status, "challenge_required");
  } finally { await session.close(); await browser.close(); }
});
