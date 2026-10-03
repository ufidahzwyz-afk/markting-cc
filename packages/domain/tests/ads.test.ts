import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { createTestDatabase, DEMO_ORG_ID, DEMO_OWNER_ID } from "@boran/db";
import type { Database } from "@boran/db";
import { stableHash, uuid } from "../src/core";
import type { ServiceContext } from "../src/core";
import { assertAdsPolicyGate, assertNegativeKeywordSafety, commitImport, executeBaiduAction, getAdMetrics, parseAdCsv, preflightImport, validateAdsPayload, type AdsPayload, type BaiduExecutionAdapter } from "../src/ads";
import { activatePolicy, createExecutionAction, createPolicy } from "../src/execution";

let db: Database; let ctx: ServiceContext; let current = new Date("2026-10-03T01:00:00Z");
const header = "business_date,account_id,entity_level,entity_id,parent_id,currency,impressions,clicks,spend_minor,platform_conversions,device,conversion_definition";
const campaign = `${header}\n2026-09-30,demo_baidu,campaign,c1,,CNY,1000,50,10000,4,all,form_submit\n2026-10-01,demo_baidu,campaign,c1,,CNY,1200,60,12000,5,all,form_submit\n`;
const keyword = `${header}\n2026-09-30,demo_baidu,keyword,k1,c1,CNY,1000,50,10000,4,all,form_submit\n2026-10-01,demo_baidu,keyword,k1,c1,CNY,1200,60,12000,5,all,form_submit\n`;
let connectionId: string;
before(async () => { db = await createTestDatabase(); ctx = { db, orgId: DEMO_ORG_ID, actorId: DEMO_OWNER_ID, roles: ["owner", "marketer"], mode: "mock", now: () => current }; connectionId = uuid(); await db.query("INSERT INTO connections(id,org_id,provider,account_external_id,display_name,timezone,currency,capabilities,health,enabled_for_reporting,authoritative_report_type,scope_json,read_mode,access_status) VALUES($1,$2,'mock','demo_baidu','模拟百度','Asia/Shanghai','CNY','{}','unknown',true,'campaign_daily','{}','mock','not_configured')", [connectionId, DEMO_ORG_ID]); });
after(async () => { await db?.close(); });
const input = (csv: string, reportType: "campaign_daily" | "keyword_daily" = "campaign_daily") => ({ connectionId, reportType, windowStart: "2026-09-30", windowEnd: "2026-10-01", currency: "CNY", timezone: "Asia/Shanghai", csv, sourceWatermark: current.toISOString() });
async function commit(csv: string, reportType: "campaign_daily" | "keyword_daily" = "campaign_daily") { const batch = await preflightImport(ctx, input(csv, reportType)); await commitImport(ctx, batch.id, { expectedFileHash: batch.fileHash as string, confirmCompleteWindow: true, revisionPolicy: "upsert_by_natural_key" }); return batch; }

test("AC02/03: preflight commit is idempotent and keyword diagnostics do not duplicate authoritative spend", async () => {
  const batch = await commit(campaign); await commit(keyword, "keyword_daily");
  const repeat = await preflightImport(ctx, input(campaign)); assert.equal(repeat.id, batch.id); assert.equal(repeat.duplicate, true);
  const again = await commitImport(ctx, batch.id, { expectedFileHash: batch.fileHash as string, confirmCompleteWindow: true, revisionPolicy: "upsert_by_natural_key" }); assert.equal(again.duplicate, true);
  const metrics = await getAdMetrics(ctx, { start: "2026-09-30", end: "2026-10-01", connectionIds: [connectionId] }); assert.equal(metrics.spendMinor, 22000); assert.equal(metrics.accounts[0]!.clicks, 110); assert.equal(metrics.accounts[0]!.platformConversions, 9); assert.equal(metrics.accounts[0]!.cpcMinor, 200); assert.equal(metrics.attribution.paidCplMinor, null);
});
test("AC19: newer corrections replace natural keys, older source watermarks never regress totals", async () => {
  current = new Date("2026-10-03T01:01:00Z"); const corrected = campaign.replace("12000,5", "12000,6"); await commit(corrected);
  let metrics = await getAdMetrics(ctx, { start: "2026-09-30", end: "2026-10-01", connectionIds: [connectionId] }); assert.equal(metrics.accounts[0]!.platformConversions, 10); assert.equal(metrics.spendMinor, 22000);
  current = new Date("2026-10-03T00:59:00Z"); await commit(campaign.replace("12000,5", "12000,7")); current = new Date("2026-10-03T01:02:00Z");
  metrics = await getAdMetrics(ctx, { start: "2026-09-30", end: "2026-10-01", connectionIds: [connectionId] }); assert.equal(metrics.accounts[0]!.platformConversions, 10); assert.equal(metrics.spendMinor, 22000);
});
test("AC04/05: missing dates remain null and cannot become approved-window totals", async () => {
  const metrics = await getAdMetrics(ctx, { start: "2026-09-30", end: "2026-10-02", connectionIds: [connectionId] }); assert.equal(metrics.quality, "partial"); assert.equal(metrics.spendMinor, null); assert.equal(metrics.accounts[0]!.observedSpendMinor, 22000); assert.equal(metrics.accounts[0]!.daily[2]!.quality, "missing"); assert.equal(metrics.accounts[0]!.daily[2]!.spendMinor, null);
});
test("equal-watermark conflicting revision is rejected, and mixed currencies are never summed", async () => {
  const conflict = await preflightImport(ctx, { ...input(campaign.replace("12000,5", "12000,12")), sourceWatermark: "2026-10-03T01:01:00Z" }); await assert.rejects(commitImport(ctx, conflict.id, { expectedFileHash: conflict.fileHash, confirmCompleteWindow: true, revisionPolicy: "upsert_by_natural_key" }), { code: "SOURCE_WATERMARK_CONFLICT" });
  const usdId = uuid(); await db.query("INSERT INTO connections(id,org_id,provider,account_external_id,display_name,timezone,currency,read_mode,enabled_for_reporting,authoritative_report_type) VALUES($1,$2,'mock','demo_usd','模拟美元','Asia/Shanghai','USD','mock',true,'campaign_daily')", [usdId, ctx.orgId]); const batch = await preflightImport(ctx, { ...input(campaign.replaceAll("demo_baidu", "demo_usd").replaceAll("CNY", "USD")), connectionId: usdId, currency: "USD" }); await commitImport(ctx, batch.id, { expectedFileHash: batch.fileHash, confirmCompleteWindow: true, revisionPolicy: "upsert_by_natural_key" }); const metrics = await getAdMetrics(ctx, { start: "2026-09-30", end: "2026-10-01", connectionIds: [connectionId, usdId] }); assert.equal(metrics.currency, null); assert.equal(metrics.spendMinor, null); assert.equal(metrics.accounts.length, 2); assert.equal(metrics.accounts[0]!.spendMinor, 22000);
});
test("import rejects negative/non-integer minor currency/missing required fields/hash mismatch before commit", async () => {
  for (const csv of [campaign.replace("10000,4", "-100,4"), campaign.replace("10000,4", "1.50,4"), campaign.replace("CNY,1000", "ZZZ,1000"), campaign.replace("CNY,1000", "CNY,")]) { const preflight = await preflightImport(ctx, input(csv)); assert.equal(preflight.state, "rejected"); assert.ok(preflight.errors.length); await assert.rejects(commitImport(ctx, preflight.id, { expectedFileHash: preflight.fileHash as string, confirmCompleteWindow: true, revisionPolicy: "upsert_by_natural_key" }), { code: "INVALID_IMPORT_STATE" }); }
  await assert.rejects(preflightImport(ctx, { ...input(campaign), fileHash: "a".repeat(64) }), { code: "HASH_MISMATCH" });
  const rows = parseAdCsv(campaign); rows.push({ ...rows[0]! }); const { csv: _csv, ...metadata } = input(campaign); const duplicate = await preflightImport(ctx, { ...metadata, rows }); assert.equal(duplicate.state, "rejected");
});
test("CSV parser handles BOM/escaped quotes and does not accept overlapping all/segment totals", async () => {
  assert.equal(parseAdCsv('\uFEFFa,b\n"one,two","a""b"\n')[0]!.b, 'a"b');
  const overlap = `${campaign}2026-09-30,demo_baidu,campaign,c1,,CNY,500,25,5000,2,desktop,form_submit\n`; const batch = await preflightImport(ctx, input(overlap)); assert.equal(batch.state, "rejected"); assert.ok(batch.errors.some((error) => error.code === "OVERLAPPING_DIMENSIONS"));
});
test("rejected column mappings can be corrected without changing raw bytes; validated and committed mappings remain fixed", async () => {
  const csv = campaign.replace("spend_minor", "source_spend_minor"); const missing = await preflightImport(ctx, input(csv)); assert.equal(missing.state, "rejected");
  const corrected = await preflightImport(ctx, { ...input(csv), mapping: { source_spend_minor: "spend_minor" } }); assert.equal(corrected.id, missing.id); assert.equal(corrected.fileHash, missing.fileHash); assert.equal(corrected.state, "validated"); assert.deepEqual(corrected.errors, []);
  assert.equal((await db.query("SELECT id FROM audit_logs WHERE target_id=$1 AND action='import.mapping_corrected'", [missing.id])).rows.length, 1);
  await assert.rejects(preflightImport(ctx, input(csv)), { code: "MAPPING_CONFLICT" });
  await commitImport(ctx, corrected.id, { expectedFileHash: corrected.fileHash, confirmCompleteWindow: true, revisionPolicy: "upsert_by_natural_key" });
  const duplicate = await preflightImport(ctx, { ...input(csv), mapping: { source_spend_minor: "spend_minor" } }); assert.equal(duplicate.state, "committed"); assert.equal(duplicate.duplicate, true);
  await assert.rejects(preflightImport(ctx, { ...input(csv), mapping: { source_spend_minor: "clicks" } }), { code: "MAPPING_CONFLICT" });
});
test("typed ads rejects arbitrary fields, unsafe script URL, wrong pause and budget expansion", () => {
  const payload: AdsPayload = { operation: "update", entity_level: "campaign", changes: [{ field: "daily_budget_minor", value: 1000 }], expected_before_hash: stableHash({}) };
  validateAdsPayload(payload); assert.throws(() => validateAdsPayload({ ...payload, changes: [{ field: "script", value: "run" }] }), { code: "FIELD_NOT_ALLOWED" }); assert.throws(() => validateAdsPayload({ ...payload, changes: [{ field: "landing_url", value: "javascript:alert(1)" }] }), { code: "INVALID_URL" }); assert.throws(() => validateAdsPayload({ ...payload, operation: "pause" }), { code: "INVALID_ADS_PAYLOAD" });
  const policy = { allowed_ad_operations: ["update"], allowed_ad_entity_levels: ["campaign"], currency: "CNY", daily_budget_minor: 2000, total_budget_minor: 4000, max_bid_change_pct: 10 };
  const evidence = { currency: "CNY", dailySpendMinor: 500, totalSpendMinor: 1000, quality: "complete" as const, nativeBudgetMinor: 2000, before: {} };
  assertAdsPolicyGate(payload, policy, evidence); assert.throws(() => assertAdsPolicyGate({ ...payload, changes: [{ field: "daily_budget_minor", value: 3000 }] }, policy, evidence), { code: "BUDGET_EXPANSION_NOT_AUTHORIZED" }); assert.throws(() => assertAdsPolicyGate(payload, policy, { ...evidence, dailySpendMinor: null }), { code: "BUDGET_EVIDENCE_REQUIRED" });
});
test("negative keywords require observed complete intent and preserve legitimate business/root terms", () => {
  const base = { phrase: "下载破解教程", observedSearchTerms: ["下载破解教程"], matchType: "exact" as const, scope: "unit" as const, quality: "complete" as const, observationWindowApproved: true };
  assert.equal(assertNegativeKeywordSafety(base), "下载破解教程");
  for (const phrase of ["登录", "CRM", "发票", "单点登录集成", "U8怎么迁移", "原供应商太贵"]) assert.throws(() => assertNegativeKeywordSafety({ ...base, phrase, observedSearchTerms: [phrase] }), { code: "PROTECTED_BUSINESS_INTENT" });
  assert.throws(() => assertNegativeKeywordSafety({ ...base, observedSearchTerms: [] }), { code: "NEGATIVE_KEYWORD_EVIDENCE_REQUIRED" }); assert.throws(() => assertNegativeKeywordSafety({ ...base, scope: "account" }), { code: "ACCOUNT_NEGATIVE_NOT_AUTHORIZED" });
});
test("AC09/32: injected Baidu writes/readback preserve action ID; mock verification never becomes live success", async () => {
  current = new Date("2026-10-03T02:00:00Z"); const adConnection = uuid(); const accountId = uuid();
  await db.query("INSERT INTO connections(id,org_id,provider,account_external_id,display_name,timezone,currency,read_mode,enabled_for_reporting,authoritative_report_type) VALUES($1,$2,'mock','mock-action-account','模拟广告执行','Asia/Shanghai','CNY','mock',true,'campaign_daily')", [adConnection, ctx.orgId]);
  await db.query("INSERT INTO platform_accounts(id,org_id,connection_id,provider,account_external_id,display_name,timezone) VALUES($1,$2,$3,'mock','mock-action-account','模拟广告','Asia/Shanghai')", [accountId, ctx.orgId, adConnection]);
  const csv = `${header}\n2026-10-03,mock-action-account,campaign,c1,,CNY,10,1,100,0,all,form_submit\n`;
  const batch = await preflightImport(ctx, { connectionId: adConnection, reportType: "campaign_daily", windowStart: "2026-10-03", windowEnd: "2026-10-03", currency: "CNY", timezone: "Asia/Shanghai", csv, sourceWatermark: current.toISOString() }); await commitImport(ctx, batch.id, { expectedFileHash: batch.fileHash, confirmCompleteWindow: true, revisionPolicy: "upsert_by_natural_key" });
  const policy = await createPolicy(ctx, { name: "mock typed ads", businessScope: { business_lines: ["shared"], budget_period: { start: "2026-10-03", end: "2026-10-03" } }, accountIds: [accountId], allowedActions: ["ads.update"], dailyBudgetMinor: 2000, totalBudgetMinor: 4000, maxBidChangePct: 10, allowedAdOperations: ["update"], allowedAdEntityLevels: ["keyword"], stopConditions: { max_errors: 1 } });
  const versionId = String((await db.query("SELECT id FROM policy_versions WHERE policy_id=$1", [policy.id])).rows[0]!.id); await activatePolicy(ctx, String(policy.id), versionId, 1);
  const before = { bid_minor: 100, daily_budget_minor: 2000 }; const payload = { operation: "update", entity_level: "keyword", changes: [{ field: "bid_minor", value: 105 }], expected_before_hash: stableHash(before) };
  const makeAction = async (key: string) => createExecutionAction(ctx, { idempotencyKey: key, actionType: "ads.update", target: { platform_account_id: accountId, connection_id: adConnection, external_resource_id: "k1", business_line: "shared" }, payload, beforeSnapshot: before, policyVersionId: versionId });
  let writes = 0; let unknown = false; const adapter: BaiduExecutionAdapter = { mode: "mock", capabilitiesVerified: true, async read() { return before; }, async write(request) { assert.equal(request.idempotencyKey.startsWith("typed-"), true); writes++; return { status: "submitted", externalId: "mock-keyword" }; }, async readback() { if (unknown) throw new Error("timeout"); return { verified: true, state: { ...before, bid_minor: 105 }, evidenceRef: "mock:readback" }; } };
  const first = await makeAction("typed-first"); const result = await executeBaiduAction(ctx, String(first.id), adapter); assert.equal(result.state, "verification_pending"); assert.equal(result.realAcceptance, false); assert.equal(writes, 1); await assert.rejects(executeBaiduAction(ctx, String(first.id), adapter), { code: "RECONCILIATION_REQUIRED" }); assert.equal(writes, 1);
  const second = await makeAction("typed-unknown"); unknown = true; const timedOut = await executeBaiduAction(ctx, String(second.id), adapter); assert.equal(timedOut.state, "unknown"); await assert.rejects(executeBaiduAction(ctx, String(second.id), adapter), { code: "RECONCILIATION_REQUIRED" }); assert.equal(writes, 2);
  await assert.rejects(executeBaiduAction({ ...ctx, mode: "live" }, String(second.id), { ...adapter, mode: "live", capabilitiesVerified: false }), { code: "INTEGRATION_REQUIRED" }); assert.equal(writes, 2);
});
