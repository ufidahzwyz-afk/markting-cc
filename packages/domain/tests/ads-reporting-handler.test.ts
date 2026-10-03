import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { createTestDatabase, DEMO_ORG_ID, DEMO_OWNER_ID, DEMO_MARKETER_ID } from "@boran/db";
import type { Database } from "@boran/db";
import { uuid } from "../src/core";
import type { ServiceContext } from "../src/core";
import { handleAdsReporting } from "../../../apps/ops/src/lib/handlers/ads-reporting";

let db: Database; let ctx: ServiceContext; let connectionId: string;
before(async () => { db = await createTestDatabase(); ctx = { db, orgId: DEMO_ORG_ID, actorId: DEMO_OWNER_ID, roles: ["owner", "marketer"], mode: "mock", now: () => new Date("2026-10-03T01:00:00Z") }; connectionId = uuid(); await db.query("INSERT INTO connections(id,org_id,provider,account_external_id,display_name,timezone,currency,read_mode,enabled_for_reporting,authoritative_report_type) VALUES($1,$2,'mock','demo_baidu','模拟接口账号','Asia/Shanghai','CNY','mock',true,'campaign_daily')", [connectionId, ctx.orgId]); });
after(async () => { await db?.close(); });
function request(path: string, method = "GET", key = uuid()) { return new Request(`http://localhost/api/v1/${path}`, { method, headers: { "Idempotency-Key": key } }); }
test("canonical import API preflight/commit and metrics export are persistent and mode separated", async () => {
  const fixturesResponse = await handleAdsReporting(ctx, request("imports/fixtures"), ["imports", "fixtures"]); const fixtures = await fixturesResponse!.json() as { data: { object_key: string; file_hash: string }[] }; const fixture = fixtures.data.find((row) => row.object_key === "mock:campaign_daily")!;
  const body = { connection_id: connectionId, report_type: "campaign_daily", object_key: fixture.object_key, file_hash: fixture.file_hash, window_start: "2026-09-30", window_end: "2026-10-01", currency: "CNY", timezone: "Asia/Shanghai", mapping: {} }; const create = await handleAdsReporting(ctx, request("imports", "POST"), ["imports"], body); assert.equal(create!.status, 201); const batch = (await create!.json() as { data: { id: string; fileHash: string } }).data;
  const commit = await handleAdsReporting(ctx, request(`imports/${batch.id}/commit`, "POST"), ["imports", batch.id, "commit"], { expected_file_hash: batch.fileHash, confirm_complete_window: true, revision_policy: "upsert_by_natural_key" }); assert.equal(commit!.status, 200);
  const result = await handleAdsReporting(ctx, request("metrics?start=2026-09-30&end=2026-10-01"), ["metrics"]); const metrics = await result!.json() as { data: { spendMinor: number; mode: string } }; assert.equal(metrics.data.spendMinor, 22000); assert.equal(metrics.data.mode, "mock");
  const csv = await handleAdsReporting(ctx, request("metrics.csv?start=2026-09-30&end=2026-10-02"), ["metrics.csv"]); assert.match(csv!.headers.get("content-type")!, /text\/csv/); const text = await csv!.text(); assert.match(text, /2026-10-02.*missing/); assert.match(text, /"mock"/);
  await assert.rejects(handleAdsReporting({ ...ctx, mode: "live" }, request("imports/fixtures"), ["imports", "fixtures"]), { code: "MOCK_BOUNDARY" });
  await assert.rejects(handleAdsReporting(ctx, request("imports", "POST"), ["imports"], { ...body, source_kind: "connector" }), { code: "CONTRACT_INVALID" });
});
test("metric policy defaults never infer attribution from dedupe; owner approves exact immutable draft", async () => {
  const defaultResponse = await handleAdsReporting(ctx, request("metric-policies/current"), ["metric-policies", "current"]); const initial = (await defaultResponse!.json() as { data: Record<string, unknown> }).data; assert.equal(initial.attribution_window_days, null); assert.equal(initial.dedupe_window_days, 30); assert.equal(initial.optimization_enabled, false);
  const input = { dedupe_window_days: 30, attribution_window_days: null, cohort_maturation_window_days: null, scoring_mode: "qualitative", scoring_config: {}, calibration_evidence_refs: [], optimization_enabled: false };
  const created = await handleAdsReporting(ctx, request("metric-policies/versions", "POST"), ["metric-policies", "versions"], input); const draft = (await created!.json() as { data: { id: string; payloadHash: string } }).data;
  await assert.rejects(handleAdsReporting({ ...ctx, actorId: DEMO_MARKETER_ID, roles: ["owner"] }, request(`metric-policies/${draft.id}/approve`, "POST"), ["metric-policies", draft.id, "approve"], { payload_hash: draft.payloadHash }), { code: "FORBIDDEN" });
  await assert.rejects(handleAdsReporting(ctx, request(`metric-policies/${draft.id}/approve`, "POST"), ["metric-policies", draft.id, "approve"], { payload_hash: "a".repeat(64) }), { code: "HASH_MISMATCH" });
  const approved = await handleAdsReporting(ctx, request(`metric-policies/${draft.id}/approve`, "POST"), ["metric-policies", draft.id, "approve"], { payload_hash: draft.payloadHash }); assert.equal(approved!.status, 200);
  await assert.rejects(handleAdsReporting(ctx, request("metric-policies/versions", "POST"), ["metric-policies", "versions"], { ...input, optimization_enabled: true }), { code: "ATTRIBUTION_NOT_CONFIGURED" });
});
