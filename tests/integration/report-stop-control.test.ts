import test from 'node:test';
import assert from 'node:assert/strict';
import { createTestDatabase, DEMO_ORG_ID, DEMO_OWNER_ID, type Database } from '@boran/db';
import type { ServiceContext } from '@boran/domain/core';
import { createReportSnapshot, enqueueReportNotifications, processNotification, archiveReportToDrive, type NotificationAdapter, type DriveArchiveAdapter } from '@boran/domain/reporting';
import { dispatchReports, registerReportDeliveryAdapters } from '../../apps/worker/src/report-dispatch';

// Live domain paths with deliberately local, no-network adapters. No external account is contacted.
async function fixture() {
  const db = await createTestDatabase();
  const ctx: ServiceContext = { db, orgId: DEMO_ORG_ID, actorId: DEMO_OWNER_ID, roles: ['owner', 'marketer'], mode: 'live' };
  const report = await createReportSnapshot(ctx, { kind: 'daily', start: '2026-10-01', end: '2026-10-01' });
  await db.query('UPDATE organizations SET write_enabled=true WHERE id=$1', [ctx.orgId]);
  return { db, ctx, report };
}
async function notification(ctx: ServiceContext, reportId: string, channel: 'email' | 'webhook' = 'email') {
  return (await enqueueReportNotifications(ctx, reportId, [{ channel, recipientRef: `user:${DEMO_OWNER_ID}` }])).ids[0]!;
}
async function due(ctx: ServiceContext, id: string, type: 'report.archive' | 'notification.deliver') {
  await ctx.db.query("UPDATE outbox_events SET next_attempt_at='2000-01-01T00:00:00Z' WHERE org_id=$1 AND aggregate_id=$2 AND event_type=$3 AND dispatched_at IS NULL", [ctx.orgId, id, type]);
}
async function pending(ctx: ServiceContext, id: string, type: 'report.archive' | 'notification.deliver', attempts: number) {
  const event = (await ctx.db.query("SELECT * FROM outbox_events WHERE org_id=$1 AND aggregate_id=$2 AND event_type=$3 AND dispatched_at IS NULL", [ctx.orgId, id, type])).rows[0]!;
  assert.ok(event, 'Stopped work must keep its durable delivery intent');
  assert.equal(Number(event.attempts), attempts, 'Stopping must preserve the prior submission attempt count');
  const payload = event.payload as Record<string, unknown>;
  assert.equal(payload.dispatch_state, 'needs_human');
  assert.equal(payload.processing_error, 'WRITE_DISABLED');
  if (type === 'notification.deliver') assert.equal((await ctx.db.query('SELECT status FROM notifications WHERE org_id=$1 AND id=$2', [ctx.orgId, id])).rows[0]!.status, 'pending');
  else assert.equal((await ctx.db.query('SELECT archive_status FROM report_snapshots WHERE org_id=$1 AND id=$2', [ctx.orgId, id])).rows[0]!.archive_status, 'pending');
}
function localAdapters() {
  const counters = { sends: 0, writes: 0, notificationReads: 0, archiveReads: 0 };
  let content = '';
  const notifier: NotificationAdapter = { mode: 'live', async send() { counters.sends++; return { delivered: true, providerMessageId: 'qa-local-delivered' }; }, async reconcile() { counters.notificationReads++; return { state: 'unknown', providerMessageId: null }; } };
  const drive: DriveArchiveAdapter = { mode: 'live', async findByIdempotencyKey() { counters.archiveReads++; return null; }, async reconcile() { counters.archiveReads++; return { state: 'unknown' }; }, async write(input) { counters.writes++; content = input.content; return { fileId: 'qa-local-file' }; }, async read() { counters.archiveReads++; return { content, revision: 'qa-local-r1' }; } };
  return { counters, notifier, drive, getContent: () => content };
}

// Changes stop state only after the durable claim transaction has returned, before adapter submission.
function stopAfterNotificationClaim(db: Database, id: string, stop: () => Promise<void>): Database {
  let armed = true;
  return { query: db.query.bind(db), close: db.close.bind(db), transaction: async fn => {
    const result = await db.transaction(fn);
    if (armed && (await db.query('SELECT status FROM notifications WHERE id=$1', [id])).rows[0]?.status === 'sending') { armed = false; await stop(); }
    return result;
  } };
}

test('independent report stop controls gate new external effects and preserve read-only recovery', async t => {
  const previous = process.env.WRITE_ENABLED;
  try {
    await t.test('deployment write switch defaults to stopped for email and Drive', async () => {
      const { db, ctx, report } = await fixture(); const { counters, notifier, drive } = localAdapters();
      try {
        delete process.env.WRITE_ENABLED;
        const id = await notification(ctx, report.id);
        const mail = await processNotification(ctx, id, notifier); const archive = await archiveReportToDrive(ctx, report.id, drive);
        assert.equal(mail.state, 'pending'); assert.equal(archive.state, 'pending');
        assert.equal(counters.sends, 0); assert.equal(counters.writes, 0);
        await pending(ctx, id, 'notification.deliver', 0); await pending(ctx, report.id, 'report.archive', 0);
        process.env.WRITE_ENABLED = 'true'; await due(ctx, id, 'notification.deliver'); await due(ctx, report.id, 'report.archive');
        assert.equal((await processNotification(ctx, id, notifier)).state, 'succeeded'); assert.equal((await archiveReportToDrive(ctx, report.id, drive)).state, 'succeeded');
        assert.equal(counters.sends, 1); assert.equal(counters.writes, 1); assert.equal(counters.notificationReads, 0, 'An unsent stopped intent must not acquire a false unknown receipt');
      } finally { await db.close(); }
    });
    await t.test('organization stop overrides an enabled deployment switch', async () => {
      const { db, ctx, report } = await fixture(); const { counters, notifier, drive } = localAdapters();
      try {
        process.env.WRITE_ENABLED = 'true'; await db.query('UPDATE organizations SET write_enabled=false WHERE id=$1', [ctx.orgId]);
        const id = await notification(ctx, report.id, 'webhook');
        assert.equal((await processNotification(ctx, id, notifier)).state, 'pending'); assert.equal((await archiveReportToDrive(ctx, report.id, drive)).state, 'pending');
        assert.equal(counters.sends, 0); assert.equal(counters.writes, 0);
        await pending(ctx, id, 'notification.deliver', 0); await pending(ctx, report.id, 'report.archive', 0);
      } finally { await db.close(); }
    });
    await t.test('private worker registration cannot bypass stop; both active operators still receive SQL inbox receipts', async () => {
      const { db, ctx, report } = await fixture(); const { counters, notifier, drive } = localAdapters();
      const unregister = registerReportDeliveryAdapters({ orgId: ctx.orgId, mode: 'live', notification: notifier, drive });
      try {
        process.env.WRITE_ENABLED = 'false'; await db.query('UPDATE organizations SET write_enabled=false WHERE id=$1', [ctx.orgId]);
        const result = await dispatchReports(db);
        assert.equal(result.inApp, 2); assert.equal(result.external, 0); assert.equal(result.archived, 0);
        assert.equal(counters.sends, 0); assert.equal(counters.writes, 0);
        const inbox = (await db.query("SELECT * FROM notifications WHERE org_id=$1 AND report_id=$2 AND channel='in_app'", [ctx.orgId, report.id])).rows;
        assert.equal(inbox.length, 2); assert.ok(inbox.every(row => row.status === 'succeeded' && row.provider_message_id === `in_app:${row.id}`));
        const external = (await db.query("SELECT id FROM notifications WHERE org_id=$1 AND report_id=$2 AND channel='email'", [ctx.orgId, report.id])).rows;
        assert.equal(external.length, 2); for (const row of external) await pending(ctx, String(row.id), 'notification.deliver', 0);
        await pending(ctx, report.id, 'report.archive', 0);
      } finally { unregister(); await db.close(); }
    });
    await t.test('enabled deployment and organization can submit one effect with the required receipt/readback', async () => {
      const { db, ctx, report } = await fixture(); const { counters, notifier, drive } = localAdapters();
      try {
        process.env.WRITE_ENABLED = 'true'; const id = await notification(ctx, report.id);
        assert.equal((await processNotification(ctx, id, notifier)).state, 'succeeded'); assert.equal((await archiveReportToDrive(ctx, report.id, drive)).state, 'succeeded');
        assert.equal(counters.sends, 1); assert.equal(counters.writes, 1); assert.ok(counters.archiveReads >= 2);
      } finally { await db.close(); }
    });
    for (const outcome of ['delivered', 'absent'] as const) await t.test(`notification unknown receipt ${outcome} stays read-only while stopped`, async () => {
      const { db, ctx, report } = await fixture(); let sends = 0, reads = 0;
      const adapter: NotificationAdapter = { mode: 'live', async send() { sends++; throw new Error('qa acknowledgement lost'); }, async reconcile() { reads++; return { state: outcome, providerMessageId: outcome === 'delivered' ? 'qa-existing-receipt' : null }; } };
      try {
        process.env.WRITE_ENABLED = 'true'; const id = await notification(ctx, report.id);
        assert.equal((await processNotification(ctx, id, adapter)).state, 'failed'); assert.equal(sends, 1);
        process.env.WRITE_ENABLED = 'false'; await db.query('UPDATE organizations SET write_enabled=false WHERE id=$1', [ctx.orgId]); await due(ctx, id, 'notification.deliver');
        const recovered = await processNotification(ctx, id, adapter);
        assert.equal(recovered.state, outcome === 'delivered' ? 'succeeded' : 'pending'); assert.equal(sends, 1); assert.equal(reads, 1);
        if (outcome === 'absent') await pending(ctx, id, 'notification.deliver', 1);
      } finally { await db.close(); }
    });
    for (const outcome of ['found', 'absent'] as const) await t.test(`Drive unknown receipt ${outcome} stays read-only while stopped`, async () => {
      const { db, ctx, report } = await fixture(); let writes = 0, reads = 0, content = '';
      const adapter: DriveArchiveAdapter = { mode: 'live', async findByIdempotencyKey() { reads++; return null; }, async reconcile() { reads++; return { state: outcome, ...(outcome === 'found' ? { fileId: 'qa-existing-file' } : {}) }; }, async write(input) { writes++; content = input.content; throw new Error('qa archive acknowledgement lost'); }, async read() { reads++; return { content, revision: 'qa-existing-r1' }; } };
      try {
        process.env.WRITE_ENABLED = 'true'; assert.equal((await archiveReportToDrive(ctx, report.id, adapter)).state, 'failed'); assert.equal(writes, 1);
        process.env.WRITE_ENABLED = 'false'; await db.query('UPDATE organizations SET write_enabled=false WHERE id=$1', [ctx.orgId]); await due(ctx, report.id, 'report.archive');
        const recovered = await archiveReportToDrive(ctx, report.id, adapter);
        assert.equal(recovered.state, outcome === 'found' ? 'succeeded' : 'pending'); assert.equal(writes, 1); assert.ok(reads >= 3);
        if (outcome === 'absent') await pending(ctx, report.id, 'report.archive', 1);
      } finally { await db.close(); }
    });
    await t.test('worker continues read-only delivery/archive recovery under stop without resubmission', async () => {
      const { db, ctx, report } = await fixture(); const files = new Map<string, string>(); let sends = 0, writes = 0, notificationReads = 0, fileReads = 0; let recovered = false;
      const notifier: NotificationAdapter = { mode: 'live', async send() { sends++; throw new Error('qa provider acknowledgement lost'); }, async reconcile(input) { notificationReads++; return { state: recovered ? 'delivered' : 'unknown', providerMessageId: recovered ? `qa-existing:${input.idempotencyKey}` : null }; } };
      const drive: DriveArchiveAdapter = { mode: 'live', async findByIdempotencyKey() { return null; }, async reconcile(key) { return { state: recovered && files.has(key) ? 'found' : 'unknown', ...(recovered && files.has(key) ? { fileId: key } : {}) }; }, async write(input) { writes++; files.set(input.idempotencyKey, input.content); throw new Error('qa Drive acknowledgement lost'); }, async read(fileId) { fileReads++; return { content: files.get(fileId)!, revision: 'qa-existing-r1' }; } };
      const unregister = registerReportDeliveryAdapters({ orgId: ctx.orgId, mode: 'live', notification: notifier, drive });
      try {
        process.env.WRITE_ENABLED = 'true'; await dispatchReports(db); assert.equal(sends, 2); assert.equal(writes, 1);
        process.env.WRITE_ENABLED = 'false'; await db.query('UPDATE organizations SET write_enabled=false WHERE id=$1', [ctx.orgId]);
        await db.query("UPDATE outbox_events SET next_attempt_at='2000-01-01T00:00:00Z' WHERE org_id=$1 AND dispatched_at IS NULL AND event_type IN ('notification.deliver','report.archive')", [ctx.orgId]);
        recovered = true; const result = await dispatchReports(db); assert.equal(result.external, 2); assert.equal(result.archived, 1); assert.equal(sends, 2); assert.equal(writes, 1); assert.equal(notificationReads, 2); assert.equal(fileReads, 1);
        assert.equal((await db.query('SELECT archive_status FROM report_snapshots WHERE id=$1', [report.id])).rows[0]!.archive_status, 'succeeded');
      } finally { unregister(); await db.close(); }
    });
    for (const stop of ['organization', 'deployment'] as const) await t.test(`notification rechecks ${stop} stop after claiming, immediately before send`, async () => {
      const { db, ctx, report } = await fixture(); const { counters, notifier } = localAdapters();
      try {
        process.env.WRITE_ENABLED = 'true'; const id = await notification(ctx, report.id);
        const guarded = stopAfterNotificationClaim(db, id, async () => { if (stop === 'deployment') process.env.WRITE_ENABLED = 'false'; else await db.query('UPDATE organizations SET write_enabled=false WHERE id=$1', [ctx.orgId]); });
        const result = await processNotification({ ...ctx, db: guarded }, id, notifier);
        assert.equal(result.state, 'pending'); assert.equal(counters.sends, 0); await pending(ctx, id, 'notification.deliver', 0);
      } finally { await db.close(); }
    });
    await t.test('a stopped newer notification claim fences the old response even when attempts are refunded', async () => {
      const { db, ctx, report } = await fixture(); let clock = new Date(); const current = { ...ctx, now: () => clock }; let enter!: () => void, release!: () => void;
      const entered = new Promise<void>(resolve => { enter = resolve; }); const paused = new Promise<void>(resolve => { release = resolve; });
      let oldSends = 0, newSends = 0; let completed: Promise<unknown> | undefined;
      try {
        process.env.WRITE_ENABLED = 'true'; const id = await notification(current, report.id);
        const old: NotificationAdapter = { mode: 'live', async send() { oldSends++; enter(); await paused; return { delivered: true, providerMessageId: 'qa-stale-old-receipt' }; }, async reconcile() { return { state: 'unknown', providerMessageId: null }; } };
        completed = processNotification(current, id, old).then(value => ({ value }), error => ({ error }));
        await entered; clock = new Date(clock.getTime() + 60001); await db.query('UPDATE organizations SET write_enabled=false WHERE id=$1', [ctx.orgId]);
        const newer: NotificationAdapter = { mode: 'live', async send() { newSends++; return { delivered: true, providerMessageId: 'unreachable' }; }, async reconcile() { return { state: 'absent', providerMessageId: null }; } };
        assert.equal((await processNotification(current, id, newer)).state, 'pending');
        await pending(current, id, 'notification.deliver', 1); release();
        const result = await completed as { error?: { code?: string } }; assert.equal(result.error?.code, 'STALE_NOTIFICATION_LEASE');
        assert.equal(oldSends, 1); assert.equal(newSends, 0); const row = (await db.query('SELECT status,provider_message_id FROM notifications WHERE id=$1', [id])).rows[0]!;
        assert.equal(row.status, 'pending'); assert.equal(row.provider_message_id, null); await pending(current, id, 'notification.deliver', 1);
      } finally { release?.(); await completed; await db.close(); }
    });
    await t.test('a stopped newer Drive claim fences the old readback even when attempts are refunded', async () => {
      const { db, ctx, report } = await fixture(); let clock = new Date(); const current = { ...ctx, now: () => clock }; let enter!: () => void, release!: () => void; let content = '';
      const entered = new Promise<void>(resolve => { enter = resolve; }); const paused = new Promise<void>(resolve => { release = resolve; });
      let oldWrites = 0, newWrites = 0; let completed: Promise<unknown> | undefined;
      try {
        process.env.WRITE_ENABLED = 'true'; const old: DriveArchiveAdapter = { mode: 'live', async findByIdempotencyKey() { return null; }, async reconcile() { return { state: 'unknown' }; }, async write(input) { oldWrites++; content = input.content; enter(); await paused; return { fileId: 'qa-stale-old-file' }; }, async read() { return { content, revision: 'qa-stale-old-r1' }; } };
        completed = archiveReportToDrive(current, report.id, old).then(value => ({ value }), error => ({ error }));
        await entered; clock = new Date(clock.getTime() + 60001); await db.query('UPDATE organizations SET write_enabled=false WHERE id=$1', [ctx.orgId]);
        const newer: DriveArchiveAdapter = { mode: 'live', async findByIdempotencyKey() { return null; }, async reconcile() { return { state: 'absent' }; }, async write() { newWrites++; return { fileId: 'unreachable' }; }, async read() { throw new Error('unreachable'); } };
        assert.equal((await archiveReportToDrive(current, report.id, newer)).state, 'pending');
        await pending(current, report.id, 'report.archive', 1); release();
        const result = await completed as { error?: { code?: string } }; assert.equal(result.error?.code, 'STALE_ARCHIVE_LEASE');
        assert.equal(oldWrites, 1); assert.equal(newWrites, 0); const row = (await db.query('SELECT archive_status,drive_file_id FROM report_snapshots WHERE id=$1', [report.id])).rows[0]!;
        assert.equal(row.archive_status, 'pending'); assert.equal(row.drive_file_id, null); await pending(current, report.id, 'report.archive', 1);
      } finally { release?.(); await completed; await db.close(); }
    });
    await t.test('Drive rechecks current organization stop after lookup, immediately before write', async () => {
      const { db, ctx, report } = await fixture(); const { counters, drive } = localAdapters();
      try {
        process.env.WRITE_ENABLED = 'true'; const adapter: DriveArchiveAdapter = { ...drive, async findByIdempotencyKey() { await db.query('UPDATE organizations SET write_enabled=false WHERE id=$1', [ctx.orgId]); return null; } };
        assert.equal((await archiveReportToDrive(ctx, report.id, adapter)).state, 'pending'); assert.equal(counters.writes, 0); await pending(ctx, report.id, 'report.archive', 0);
      } finally { await db.close(); }
    });
  } finally { if (previous === undefined) delete process.env.WRITE_ENABLED; else process.env.WRITE_ENABLED = previous; }
});
