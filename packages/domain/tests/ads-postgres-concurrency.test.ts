import assert from "node:assert/strict";
import test from "node:test";
import { openDatabase, migrateDatabase, seedDemo, DEMO_ORG_ID, DEMO_OWNER_ID } from "@boran/db";
import { uuid } from "../src/core";
import type { ServiceContext } from "../src/core";
import { preflightImport, commitImport, getAdMetrics } from "../src/ads";

test("PostgreSQL imports serialize duplicate preflights and conflicting equal-watermark commits", { skip: !process.env.BORAN_TEST_PG_URL }, async () => {
  const schema = `test_ads_${uuid().replaceAll("-", "")}`;
  const admin = await openDatabase({ url: process.env.BORAN_TEST_PG_URL!, mode: "live" });
  await admin.query(`CREATE SCHEMA ${schema}`);
  const scoped = new URL(process.env.BORAN_TEST_PG_URL!); scoped.searchParams.set("options", `-csearch_path=${schema}`);
  const db = await openDatabase({ url: scoped.toString(), mode: "live" });
  try {
    await migrateDatabase(db); await seedDemo(db);
    const ctx: ServiceContext = { db, orgId: DEMO_ORG_ID, actorId: DEMO_OWNER_ID, roles: ["owner", "marketer"], mode: "mock" };
    const connectionId = uuid(); await db.query("INSERT INTO connections(id,org_id,provider,account_external_id,display_name,timezone,currency,read_mode,enabled_for_reporting,authoritative_report_type) VALUES($1,$2,'mock','pg-ad-account','PG隔离模拟账号','Asia/Shanghai','CNY','mock',true,'campaign_daily')", [connectionId, ctx.orgId]);
    const header = "business_date,account_id,entity_level,entity_id,parent_id,currency,impressions,clicks,spend_minor,platform_conversions,device,conversion_definition";
    const csv = `${header}\n2026-10-01,pg-ad-account,campaign,c1,,CNY,100,10,200,1,all,form_submit\n`;
    const input = { connectionId, reportType: "campaign_daily" as const, windowStart: "2026-10-01", windowEnd: "2026-10-01", currency: "CNY", timezone: "Asia/Shanghai", csv, sourceWatermark: "2026-10-03T00:00:00Z" };
    const concurrent = await Promise.all(Array.from({ length: 8 }, () => preflightImport(ctx, input)));
    assert.equal(new Set(concurrent.map((batch) => batch.id)).size, 1);
    await Promise.all(concurrent.map((batch) => commitImport(ctx, batch.id, { expectedFileHash: batch.fileHash, confirmCompleteWindow: true, revisionPolicy: "upsert_by_natural_key" })));
    assert.equal((await db.query("SELECT count(*)::integer AS n FROM ad_daily_facts WHERE connection_id=$1", [connectionId])).rows[0]!.n, 1);
    // Also run with TZ=Asia/Shanghai: SQL DATE must stay the source's business date.
    const metrics = await getAdMetrics(ctx, { start: "2026-10-01", end: "2026-10-01", connectionIds: [connectionId] });
    assert.equal(metrics.quality, "complete"); assert.equal(metrics.spendMinor, 200); assert.equal(metrics.accounts[0]!.daily[0]!.date, "2026-10-01");
    const revisions = await Promise.all([201, 202].map((spend) => preflightImport(ctx, { ...input, csv: csv.replace(",200,1,all", `,${spend},1,all`), sourceWatermark: "2026-10-03T00:01:00Z" })));
    const commits = await Promise.allSettled(revisions.map((batch) => commitImport(ctx, batch.id, { expectedFileHash: batch.fileHash, confirmCompleteWindow: true, revisionPolicy: "upsert_by_natural_key" })));
    assert.equal(commits.filter((result) => result.status === "fulfilled").length, 1);
    assert.equal(commits.filter((result) => result.status === "rejected" && result.reason.code === "SOURCE_WATERMARK_CONFLICT").length, 1);
  } finally { await db.close(); await admin.query(`DROP SCHEMA ${schema} CASCADE`); await admin.close(); }
});
