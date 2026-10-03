import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { createTestDatabase, DEMO_ORG_ID, DEMO_OWNER_ID } from "@boran/db";
import type { Database } from "@boran/db";
import { uuid } from "../src/core";
import type { ServiceContext } from "../src/core";
import { commitImport, preflightImport } from "../src/ads";
import { advertisingRetention, archiveReportToDrive, calculateSeoMetrics, createReportSnapshot, enqueueReportNotifications, getGeoMetrics, getReports, getSevenDayCompleteness, processNotification, recordGeoObservation } from "../src/reporting";
import type { DriveArchiveAdapter, NotificationAdapter } from "../src/reporting";

let db: Database; let ctx: ServiceContext; let current = new Date("2026-10-03T01:00:00Z"); let connectionId: string; let reportId: string; let questionId: string;
const header = "business_date,account_id,entity_level,entity_id,parent_id,currency,impressions,clicks,spend_minor,platform_conversions,device,conversion_definition";
const campaign = `${header}\n2026-10-01,demo_reporting,campaign,c1,,CNY,1200,60,12000,5,all,form_submit\n`;
before(async () => { db = await createTestDatabase(); ctx = { db, orgId: DEMO_ORG_ID, actorId: DEMO_OWNER_ID, roles: ["owner", "marketer"], mode: "mock", now: () => current }; connectionId = uuid(); questionId = uuid(); await db.query("INSERT INTO connections(id,org_id,provider,account_external_id,display_name,timezone,currency,capabilities,health,enabled_for_reporting,authoritative_report_type,scope_json,read_mode,access_status) VALUES($1,$2,'mock','demo_reporting','模拟报告账号','Asia/Shanghai','CNY','{}','unknown',true,'campaign_daily','{}','mock','not_configured')", [connectionId, DEMO_ORG_ID]); await db.query("INSERT INTO geo_questions(id,org_id,question_key,version,question_text,business_line,active) VALUES($1,$2,'mock-q',1,'企业协同选型','shared',true)", [questionId, DEMO_ORG_ID]); });
after(async () => { await db?.close(); });
async function importCampaign(csv: string) { const batch = await preflightImport(ctx, { connectionId, reportType: "campaign_daily", windowStart: "2026-10-01", windowEnd: "2026-10-01", currency: "CNY", timezone: "Asia/Shanghai", csv, sourceWatermark: current.toISOString() }); await commitImport(ctx, batch.id, { expectedFileHash: batch.fileHash, confirmCompleteWindow: true, revisionPolicy: "upsert_by_natural_key" }); }
test("AC18/19: repeated report scheduling is idempotent; corrected data produces immutable r2", async () => {
  await importCampaign(campaign); const request = { kind: "daily" as const, start: "2026-10-01", end: "2026-10-01", connectionIds: [connectionId] }; const first = await createReportSnapshot(ctx, request); reportId = first.id;
  current = new Date("2026-10-03T01:01:00Z"); const duplicate = await createReportSnapshot(ctx, request); assert.equal(duplicate.id, first.id); assert.equal(duplicate.duplicate, true);
  await importCampaign(campaign.replace("12000,5", "12000,6")); const corrected = await createReportSnapshot(ctx, request); assert.equal(corrected.revision, 2); assert.notEqual(corrected.id, first.id);
  const reports = await getReports(ctx); assert.equal(reports.reports.length, 2); const r1 = reports.reports.find((row) => row.id === first.id)!; const metrics = r1.metrics_json as { accounts: { platformConversions: number }[] }; assert.equal(metrics.accounts[0]!.platformConversions, 5);
});
test("AC16: only 2 of 3 valid actual observations participate; failed samples are not synthesized", async () => {
  for (let repetitionNo = 1; repetitionNo <= 3; repetitionNo++) await recordGeoObservation(ctx, { questionId, batchKey: "sample", repetitionNo, platform: "mock-web", productMode: "web_search", region: "上海", observedAt: current.toISOString(), status: repetitionNo === 3 ? "timeout" : "valid", ...(repetitionNo !== 3 ? { answerText: `固定模拟回答${repetitionNo}`, citations: ["https://example.invalid/reference"], reviewed: true, brandMentioned: repetitionNo === 1, websiteCited: true } : {}) });
  const metrics = await getGeoMetrics(ctx, { batchKey: "sample", expectedSamples: 3 }); assert.equal(metrics.denominator, 2); assert.equal(metrics.completeness, 2 / 3); assert.equal(metrics.samples[0]!.brandRate, 0.5); assert.equal(metrics.samples[0]!.citationRate, 1); assert.equal(metrics.realAcceptance, false);
  await assert.rejects(recordGeoObservation(ctx, { questionId, batchKey: "bad", repetitionNo: 1, platform: "mock", productMode: "api", region: "上海", observedAt: current.toISOString(), status: "valid" }), { code: "EVIDENCE_REQUIRED" });
});
test("SEO missing/zero denominator stay unavailable; average rank is observation weighted", () => {
  assert.equal(calculateSeoMetrics({ source: "search-console", observedAt: null, evidenceRef: null, clicks: null, impressions: null, positions: null }).ctr, null);
  const metrics = calculateSeoMetrics({ source: "mock", observedAt: current.toISOString(), evidenceRef: "mock:seo", clicks: 0, impressions: 0, positions: [{ position: 2, impressions: 1 }, { position: 6, impressions: 3 }] }); assert.equal(metrics.ctr, null); assert.equal(metrics.averagePosition, 5);
});
test("AC18/33: notifications are durable, timeout reconciles before retry, duplicate send is avoided", async () => {
  const enqueued = await enqueueReportNotifications(ctx, reportId, [{ channel: "webhook", recipientRef: "secret:ops-a" }, { channel: "webhook", recipientRef: "secret:ops-b" }]);
  const repeated = await enqueueReportNotifications(ctx, reportId, [{ channel: "webhook", recipientRef: "secret:ops-a" }]); assert.equal(repeated.ids[0], enqueued.ids[0]);
  let sends = 0; let checks = 0; const adapter: NotificationAdapter = { mode: "mock", async send() { sends++; throw new Error("connection closed after remote delivery"); }, async reconcile() { checks++; return { state: "delivered", providerMessageId: "mock-receipt" }; } };
  const failed = await processNotification(ctx, enqueued.ids[0]!, adapter); assert.equal(failed.state, "failed"); assert.equal(sends, 1); const kept = (await db.query("SELECT * FROM notifications WHERE id=$1", [enqueued.ids[0]])).rows[0]!; assert.equal(kept.status, "failed");
  current = new Date(current.getTime() + 5000); const recovered = await processNotification(ctx, enqueued.ids[0]!, adapter); assert.equal(recovered.state, "succeeded"); assert.equal(sends, 1); assert.equal(checks, 1); await processNotification(ctx, enqueued.ids[0]!, adapter); assert.equal(sends, 1);
});
test("AC24: archive succeeds only after exact content+revision readback and finds previous unknown writes", async () => {
  let writes = 0; let contents = ""; let exists = false; let wrong = true;
  const adapter: DriveArchiveAdapter = { mode: "mock", async findByIdempotencyKey() { return exists ? { fileId: "mock-drive-file" } : null; }, async write(input) { writes++; exists = true; contents = input.content; return { fileId: "mock-drive-file" }; }, async read() { return { content: wrong ? "wrong" : contents, revision: "mock-r1" }; } };
  const failed = await archiveReportToDrive(ctx, reportId, adapter); assert.equal(failed.state, "failed"); assert.equal(writes, 1);
  current = new Date(current.getTime() + 6000); wrong = false; const recovered = await archiveReportToDrive(ctx, reportId, adapter); assert.equal(recovered.state, "succeeded"); assert.equal(writes, 1); assert.equal(recovered.realAcceptance, false); await archiveReportToDrive(ctx, reportId, adapter); assert.equal(writes, 1);
});
test("AC46: advertisements never expire before ended+3 years or during legal hold", () => {
  assert.equal(advertisingRetention({ endedAt: null, retainUntil: "2020-01-01T00:00:00Z", legalHold: false }).deletable, false);
  const before = advertisingRetention({ endedAt: "2026-10-03T01:00:00Z", retainUntil: "2027-01-01T00:00:00Z", legalHold: false }, new Date("2029-10-03T00:59:59Z")); assert.equal(before.deletable, false); assert.equal(before.retainUntil, "2029-10-03T01:00:00.000Z");
  assert.equal(advertisingRetention({ endedAt: "2026-10-03T01:00:00Z", retainUntil: null, legalHold: true }, new Date("2030-01-01T00:00:00Z")).deletable, false);
});
test("seven complete business days cannot be claimed from two-day mocks or CSV imports", async () => {
  const result = await getSevenDayCompleteness(ctx, { start: "2026-09-27", end: "2026-10-03", connectionIds: [connectionId] }); assert.equal(result.expectedDates.length, 7); assert.equal(result.completeBusinessDays, 1); assert.equal(result.passed, false); assert.equal(result.realAcceptance, false); assert.equal(result.sourceValidated, false);
});


test("stop refunds attempts without reusing a lease generation or accepting an older external receipt", async () => {
  const previous = process.env.WRITE_ENABLED;
  const live = { ...ctx, mode: "live" as const };
  const deferred = () => { let resolve!: () => void; const promise = new Promise<void>((done) => { resolve = done; }); return { promise, resolve }; };
  try {
    process.env.WRITE_ENABLED = "true"; await db.query("UPDATE organizations SET write_enabled=true WHERE id=$1", [ctx.orgId]);
    const report = await createReportSnapshot(live, { kind: "daily", start: "2026-10-02", end: "2026-10-02" });
    const id = (await enqueueReportNotifications(live, report.id, [{ channel: "email", recipientRef: `user:${ctx.actorId}` }])).ids[0]!;
    const entered = deferred(), release = deferred();
    const oldNotification = processNotification(live, id, { mode: "live", async send() { entered.resolve(); await release.promise; return { delivered: true, providerMessageId: "synthetic-old-receipt" }; }, async reconcile() { return { state: "unknown", providerMessageId: null }; } });
    // Attach the rejection assertion immediately so a late worker error is always handled.
    const oldNotificationResult = assert.rejects(oldNotification, { code: "STALE_NOTIFICATION_LEASE" });
    await entered.promise;
    process.env.WRITE_ENABLED = "false"; await db.query("UPDATE outbox_events SET next_attempt_at='2000-01-01' WHERE aggregate_id=$1 AND event_type='notification.deliver'", [id]);
    const stopped = await processNotification(live, id, { mode: "live", async send() { throw new Error("Stop must block replacement submission"); }, async reconcile() { return { state: "absent", providerMessageId: null }; } });
    assert.equal(stopped.state, "pending");
    const stoppedEvent = (await db.query("SELECT * FROM outbox_events WHERE aggregate_id=$1 AND event_type='notification.deliver'", [id])).rows[0]!;
    assert.equal(Number(stoppedEvent.attempts), 1); assert.equal((stoppedEvent.payload as Record<string, unknown>).leaseGeneration, 2);
    release.resolve(); await oldNotificationResult;
    const notification = (await db.query("SELECT * FROM notifications WHERE id=$1", [id])).rows[0]!;
    assert.equal(notification.status, "pending"); assert.equal(notification.provider_message_id, null); assert.equal(Number(notification.attempts), 1);

    process.env.WRITE_ENABLED = "true";
    const archiveEntered = deferred(), archiveRelease = deferred(); let content = "";
    const oldArchive = archiveReportToDrive(live, report.id, { mode: "live", async findByIdempotencyKey() { return null; }, async write(input) { content = input.content; archiveEntered.resolve(); await archiveRelease.promise; return { fileId: "synthetic-old-file" }; }, async read() { return { content, revision: "synthetic-r1" }; } });
    const oldArchiveResult = assert.rejects(oldArchive, { code: "STALE_ARCHIVE_LEASE" });
    await archiveEntered.promise;
    process.env.WRITE_ENABLED = "false"; await db.query("UPDATE outbox_events SET next_attempt_at='2000-01-01' WHERE aggregate_id=$1 AND event_type='report.archive'", [report.id]);
    const archiveStopped = await archiveReportToDrive(live, report.id, { mode: "live", async findByIdempotencyKey() { return null; }, async reconcile() { return { state: "absent" }; }, async write() { throw new Error("Stop must block replacement archive write"); }, async read() { throw new Error("No new archive file exists"); } });
    assert.equal(archiveStopped.state, "pending");
    const archiveEvent = (await db.query("SELECT * FROM outbox_events WHERE aggregate_id=$1 AND event_type='report.archive'", [report.id])).rows[0]!;
    assert.equal(Number(archiveEvent.attempts), 1); assert.equal((archiveEvent.payload as Record<string, unknown>).leaseGeneration, 2);
    archiveRelease.resolve(); await oldArchiveResult;
    const kept = (await db.query("SELECT archive_status,drive_file_id FROM report_snapshots WHERE id=$1", [report.id])).rows[0]!;
    assert.equal(kept.archive_status, "pending"); assert.equal(kept.drive_file_id, null);
  } finally { if (previous === undefined) delete process.env.WRITE_ENABLED; else process.env.WRITE_ENABLED = previous; await db.query("UPDATE organizations SET write_enabled=false WHERE id=$1", [ctx.orgId]); }
});

test("adapter errors after an attempted external write remain unknown rather than refundable stops", async () => {
  const previous = process.env.WRITE_ENABLED;
  const live = { ...ctx, mode: "live" as const };
  try {
    process.env.WRITE_ENABLED = "true"; await db.query("UPDATE organizations SET write_enabled=true WHERE id=$1", [ctx.orgId]);
    const report = await createReportSnapshot(live, { kind: "daily", start: "2026-10-03", end: "2026-10-03" });
    const id = (await enqueueReportNotifications(live, report.id, [{ channel: "email", recipientRef: `user:${ctx.actorId}` }])).ids[0]!;
    const { DomainError } = await import("../src/core");
    const failed = await processNotification(live, id, { mode: "live", async send() { throw new DomainError("WRITE_DISABLED", 409, "Synthetic provider response after submit"); }, async reconcile() { return { state: "unknown", providerMessageId: null }; } });
    assert.equal(failed.state, "failed"); assert.ok("receiptState" in failed); assert.equal(failed.receiptState, "unknown");
    const notificationEvent = (await db.query("SELECT attempts,payload FROM outbox_events WHERE aggregate_id=$1 AND event_type='notification.deliver'", [id])).rows[0]!;
    assert.equal(Number(notificationEvent.attempts), 1); assert.equal((notificationEvent.payload as Record<string, unknown>).processing_error, undefined);
    const archive = await archiveReportToDrive(live, report.id, { mode: "live", async findByIdempotencyKey() { return null; }, async write() { throw new DomainError("WRITE_DISABLED", 409, "Synthetic provider response after submit"); }, async read() { throw new Error("No known file"); } });
    assert.equal(archive.state, "failed");
    const archiveEvent = (await db.query("SELECT attempts,payload FROM outbox_events WHERE aggregate_id=$1 AND event_type='report.archive'", [report.id])).rows[0]!;
    assert.equal(Number(archiveEvent.attempts), 1); assert.equal((archiveEvent.payload as Record<string, unknown>).receiptState, "unknown");
  } finally { if (previous === undefined) delete process.env.WRITE_ENABLED; else process.env.WRITE_ENABLED = previous; await db.query("UPDATE organizations SET write_enabled=false WHERE id=$1", [ctx.orgId]); }
});
