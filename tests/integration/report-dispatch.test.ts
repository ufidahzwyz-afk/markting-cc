import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { createTestDatabase, openDatabase, migrateDatabase, seedDemo, DEMO_ORG_ID, DEMO_OWNER_ID, DEMO_MARKETER_ID, type Database } from "@boran/db";
import { uuid, type ServiceContext } from "@boran/domain/core";
import { createReportSnapshot, type NotificationAdapter, type DriveArchiveAdapter } from "@boran/domain/reporting";
import { dispatchReports, registerReportDeliveryAdapters } from "../../apps/worker/src/report-dispatch";

let db: Database; let ctx: ServiceContext; let admin: Database | undefined; let schema: string | undefined;
before(async () => {
  if (process.env.BORAN_QA_TEST_PG_URL) {
    schema = `test_delivery_${uuid().replaceAll("-", "")}`; admin = await openDatabase({ url: process.env.BORAN_QA_TEST_PG_URL, mode: "live" }); await admin.query(`CREATE SCHEMA ${schema}`);
    const url = new URL(process.env.BORAN_QA_TEST_PG_URL); url.searchParams.set("options", `-csearch_path=${schema}`); db = await openDatabase({ url: url.toString(), mode: "live" }); await migrateDatabase(db); await seedDemo(db);
  } else db = await createTestDatabase();
  ctx = { db, orgId: DEMO_ORG_ID, actorId: DEMO_OWNER_ID, roles: ["owner", "marketer"], mode: "mock" };
});
after(async () => { await db?.close(); if (admin && schema) { await admin.query(`DROP SCHEMA ${schema} CASCADE`); await admin.close(); } });
async function due() { await db.query("UPDATE outbox_events SET next_attempt_at='2000-01-01T00:00:00Z' WHERE dispatched_at IS NULL AND event_type IN ('notification.deliver','report.archive','report.ready')"); }

test("report.ready persists both operators' in-app inbox receipts and explicit unconfigured external gaps", async () => {
  const report = await createReportSnapshot(ctx, { kind: "daily", start: "2026-10-01", end: "2026-10-01" });
  const first = await dispatchReports(db); assert.equal(first.ready, 1); assert.equal(first.inApp, 2); assert.equal(first.external, 0); assert.equal(first.archived, 0); assert.equal(first.blocked, 3);
  const inbox = (await db.query("SELECT * FROM notifications WHERE report_id=$1 AND channel='in_app' ORDER BY recipient_ref", [report.id])).rows;
  assert.deepEqual(inbox.map((row) => row.recipient_ref), [`user:${DEMO_OWNER_ID}`, `user:${DEMO_MARKETER_ID}`]);
  assert.ok(inbox.every((row) => row.status === "succeeded" && row.provider_message_id === `in_app:${row.id}` && row.sent_at));
  assert.equal((await db.query("SELECT count(*)::integer AS n FROM notifications WHERE report_id=$1 AND channel='email' AND status='pending'", [report.id])).rows[0]!.n, 2);
  const missing = (await db.query("SELECT event_type,payload FROM outbox_events WHERE event_type IN ('notification.deliver','report.archive') AND dispatched_at IS NULL")).rows;
  assert.equal(missing.length, 3); assert.ok(missing.every((event) => (event.payload as Record<string, unknown>).dispatch_state === "needs_human"));
  assert.equal((await db.query("SELECT archive_status FROM report_snapshots WHERE id=$1", [report.id])).rows[0]!.archive_status, "pending");
  const repeat = await dispatchReports(db); assert.equal(repeat.ready, 0); assert.equal(repeat.inApp, 0); assert.equal((await db.query("SELECT count(*)::integer AS n FROM notifications WHERE report_id=$1", [report.id])).rows[0]!.n, 4);
});

test("trusted private adapters recover uncertain receipts before repeating sends or archive writes", async () => {
  const report = await createReportSnapshot(ctx, { kind: "daily", start: "2026-10-02", end: "2026-10-02" });
  const submitted = new Set<string>(); let sends = 0; let reconcileDelivered = false;
  const notification: NotificationAdapter = { mode: "mock", async send(input) { sends++; submitted.add(input.idempotencyKey); throw new Error("provider acknowledged but response lost"); }, async reconcile(input) { return { state: reconcileDelivered && submitted.has(input.idempotencyKey) ? "delivered" : "unknown", providerMessageId: reconcileDelivered ? `mock:${input.idempotencyKey}` : null }; } };
  const files = new Map<string, { id: string; content: string }>(); let writes = 0; let correctRead = false;
  const drive: DriveArchiveAdapter = { mode: "mock", async findByIdempotencyKey(key) { const saved = files.get(key); return saved ? { fileId: saved.id } : null; }, async reconcile() { return { state: "unknown" }; }, async write(input) { writes++; const id = `mock-file-${writes}`; files.set(input.idempotencyKey, { id, content: input.content }); return { fileId: id }; }, async read(id) { const found = [...files.values()].find((file) => file.id === id)!; return { content: correctRead ? found.content : "wrong readback", revision: "mock-r1" }; } };
  const unregister = registerReportDeliveryAdapters({ orgId: ctx.orgId, mode: "mock", notification, drive });
  try {
    await due(); const first = await dispatchReports(db); assert.equal(first.inApp, 2); assert.equal(first.external, 0); assert.equal(first.archived, 0); assert.ok(first.failed > 0); const firstSends = sends; const firstWrites = writes;
    await due(); const unknown = await dispatchReports(db); assert.equal(unknown.external, 0); assert.equal(sends, firstSends); assert.equal(writes, firstWrites);
    reconcileDelivered = true; correctRead = true; await due(); const recovered = await dispatchReports(db); assert.equal(recovered.external, 4); assert.equal(recovered.archived, 2); assert.equal(sends, firstSends); assert.equal(writes, firstWrites);
    assert.equal((await db.query("SELECT archive_status FROM report_snapshots WHERE id=$1", [report.id])).rows[0]!.archive_status, "succeeded");
    assert.equal((await dispatchReports(db)).external, 0); assert.equal((await dispatchReports(db)).archived, 0);
  } finally { unregister(); }
});

test("concurrent dispatchers persist one receipt per operator and cannot use another mode's adapter", async () => {
  const report = await createReportSnapshot(ctx, { kind: "daily", start: "2026-10-03", end: "2026-10-03" });
  const results = await Promise.all([dispatchReports(db), dispatchReports(db), dispatchReports(db)]);
  assert.equal(results.reduce((sum, result) => sum + result.ready, 0), 1); assert.equal(results.reduce((sum, result) => sum + result.inApp, 0), 2);
  assert.equal((await db.query("SELECT count(*)::integer AS n FROM notifications WHERE report_id=$1", [report.id])).rows[0]!.n, 4);
  assert.throws(() => registerReportDeliveryAdapters({ orgId: ctx.orgId, mode: "live", notification: { mode: "mock", async send() { throw new Error("unreachable"); }, async reconcile() { throw new Error("unreachable"); } } }), { code: "MODE_MISMATCH" });
  const liveReport = await createReportSnapshot({ ...ctx, mode: "live" }, { kind: "daily", start: "2026-10-04", end: "2026-10-04" });
  let sends = 0; const unregister = registerReportDeliveryAdapters({ orgId: ctx.orgId, mode: "mock", notification: { mode: "mock", async send() { sends++; return { delivered: true, providerMessageId: "mock-receipt" }; }, async reconcile() { return { state: "delivered", providerMessageId: "mock-receipt" }; } } });
  try { const live = await dispatchReports(db); assert.equal(live.inApp, 2); assert.equal(sends, 0); assert.equal((await db.query("SELECT archive_status FROM report_snapshots WHERE id=$1", [liveReport.id])).rows[0]!.archive_status, "pending"); }
  finally { unregister(); }
});

test("inactive operators receive no newly generated report delivery intents", async () => {
  await db.query("UPDATE memberships SET active=false WHERE org_id=$1 AND user_id=$2", [ctx.orgId, DEMO_MARKETER_ID]);
  try {
    const report = await createReportSnapshot(ctx, { kind: "daily", start: "2026-10-05", end: "2026-10-05" }); const dispatched = await dispatchReports(db); assert.equal(dispatched.inApp, 1);
    assert.equal((await db.query("SELECT count(*)::integer AS n FROM notifications WHERE report_id=$1 AND recipient_ref=$2", [report.id, `user:${DEMO_MARKETER_ID}`])).rows[0]!.n, 0);
  } finally { await db.query("UPDATE memberships SET active=true WHERE org_id=$1 AND user_id=$2", [ctx.orgId, DEMO_MARKETER_ID]); }
});

test("deployment-scoped delivery leaves other modes and organizations untouched",async()=>{
  const mock=await createReportSnapshot(ctx,{kind:"daily",start:"2026-10-07",end:"2026-10-07"});
  const live=await createReportSnapshot({...ctx,mode:"live"},{kind:"daily",start:"2026-10-08",end:"2026-10-08"});
  const pending=async()=> (await db.query("SELECT * FROM outbox_events WHERE aggregate_id=$1 AND event_type='report.ready'",[mock.id])).rows;
  const before=await pending();
  const other=await dispatchReports(db,{orgId:"10000000-0000-4000-8000-000000000001",mode:"live"});
  assert.equal(other.ready,0);assert.deepEqual(await pending(),before);
  const selected=await dispatchReports(db,{orgId:ctx.orgId,mode:"live"});
  assert.equal(selected.ready,1);assert.deepEqual(await pending(),before);
  assert.equal((await db.query("SELECT count(*)::integer AS n FROM notifications WHERE report_id=$1",[mock.id])).rows[0]!.n,0);
  assert.equal((await db.query("SELECT count(*)::integer AS n FROM notifications WHERE report_id=$1",[live.id])).rows[0]!.n,4);
});

test("a replaced delivery worker cannot overwrite a newer unknown result; later readback restores the same receipt", { timeout: 10000 }, async () => {
  await createReportSnapshot(ctx, { kind: "daily", start: "2026-10-06", end: "2026-10-06" });
  let entered!: () => void; let release!: () => void; let uncertainKey = "";
  const enteredPromise = new Promise<void>((resolve) => { entered = resolve; }); const releasePromise = new Promise<void>((resolve) => { release = resolve; });
  const unregisterOld = registerReportDeliveryAdapters({ orgId: ctx.orgId, mode: "mock", notification: { mode: "mock", async send(input) { uncertainKey = input.idempotencyKey; entered(); await releasePromise; return { delivered: true, providerMessageId: "old-worker-receipt" }; }, async reconcile() { return { state: "unknown", providerMessageId: null }; } } });
  const oldDispatch = dispatchReports(db); let unregisterNew: (() => void) | undefined;
  try {
    await enteredPromise; const id = uncertainKey.slice("notification:".length);
    await db.query("UPDATE outbox_events SET next_attempt_at=now()-interval '1 second' WHERE event_type='notification.deliver' AND aggregate_id=$1 AND dispatched_at IS NULL", [id]);
    let actualReceipt = false; const newSends: string[] = [];
    unregisterNew = registerReportDeliveryAdapters({ orgId: ctx.orgId, mode: "mock", notification: { mode: "mock", async send(input) { newSends.push(input.idempotencyKey); return { delivered: true, providerMessageId: `new:${input.idempotencyKey}` }; }, async reconcile(input) { return { state: actualReceipt && input.idempotencyKey === uncertainKey ? "delivered" : "unknown", providerMessageId: actualReceipt && input.idempotencyKey === uncertainKey ? "verified-existing-receipt" : null }; } } });
    await dispatchReports(db); release(); await oldDispatch;
    const unknown = (await db.query("SELECT status,provider_message_id,attempts FROM notifications WHERE id=$1", [id])).rows[0]!;
    assert.equal(unknown.status, "failed"); assert.equal(unknown.provider_message_id, null); assert.equal(unknown.attempts, 2); assert.equal(newSends.includes(uncertainKey), false);
    actualReceipt = true; await db.query("UPDATE outbox_events SET next_attempt_at=now()-interval '1 second' WHERE event_type='notification.deliver' AND aggregate_id=$1 AND dispatched_at IS NULL", [id]);
    await dispatchReports(db); const restored = (await db.query("SELECT status,provider_message_id,attempts FROM notifications WHERE id=$1", [id])).rows[0]!;
    assert.equal(restored.status, "succeeded"); assert.equal(restored.provider_message_id, "verified-existing-receipt"); assert.equal(restored.attempts, 3); assert.equal(newSends.includes(uncertainKey), false);
  } finally { release(); await oldDispatch; unregisterNew?.(); unregisterOld(); }
});
