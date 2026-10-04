import type { Database, SqlExecutor } from "@boran/db";
import { DomainError, audit, emitOutbox, type ServiceContext } from "@boran/domain/core";
import { enqueueReportNotifications, processNotification, archiveReportToDrive, type NotificationAdapter, type DriveArchiveAdapter } from "@boran/domain/reporting";

type Row = Record<string, unknown>;
type Mode = "mock" | "live";
type Adapters = { orgId: string; mode: Mode; notification?: NotificationAdapter; drive?: DriveArchiveAdapter };
const deliveryAdapters = new Map<string, Adapters>();
const registryKey = (orgId: string, mode: Mode) => `${orgId}:${mode}`;

/** Private process initialization only. No HTTP route accepts adapters, credentials or receipts. */
export function registerReportDeliveryAdapters(input: Adapters): () => void {
  if (!/^[a-f\d-]{36}$/i.test(input.orgId) || !["mock", "live"].includes(input.mode) || input.notification && input.notification.mode !== input.mode || input.drive && input.drive.mode !== input.mode) throw new DomainError("MODE_MISMATCH", 422, "报告适配器须绑定组织与一致模式");
  const key = registryKey(input.orgId, input.mode); const registration = { ...input };
  deliveryAdapters.set(key, registration);
  return () => { if (deliveryAdapters.get(key) === registration) deliveryAdapters.delete(key); };
}
function scopedContext(db: Database, tx: SqlExecutor, ctx: ServiceContext): ServiceContext {
  return { ...ctx, db: { query: tx.query.bind(tx), transaction: async (fn) => fn(tx), close: async () => undefined } };
}
async function context(db: Database, orgId: string, mode: Mode, tx: SqlExecutor = db): Promise<ServiceContext | null> {
  const member = (await tx.query("SELECT m.user_id,m.roles FROM memberships m JOIN users u ON u.id=m.user_id WHERE m.org_id=$1 AND m.active AND u.active AND ('owner'=ANY(m.roles) OR 'marketer'=ANY(m.roles)) ORDER BY CASE WHEN 'owner'=ANY(m.roles) THEN 0 ELSE 1 END,m.created_at,m.user_id LIMIT 1", [orgId])).rows[0];
  return member ? { db, orgId, actorId: String(member.user_id), roles: member.roles as string[], actorType: "service", mode } : null;
}
function modeOf(report: Row): Mode | null { const mode = (report.body_json as Row | null)?.mode; return mode === "live" || mode === "mock" ? mode : null; }
async function blocked(db: Database, eventId: string, code: string, gap: string) {
  // Configuration absence consumes no submit attempts and leaves the durable intent available for recovery.
  await db.query("UPDATE outbox_events SET payload=payload||$2::jsonb,next_attempt_at=now()+interval '1 minute' WHERE id=$1 AND dispatched_at IS NULL AND next_attempt_at<=now()", [eventId, JSON.stringify({ dispatch_state: "needs_human", processing_error: code, missing: [gap] })]);
}

/** The database row is the in-app receipt; no external acknowledgement is invented. */
function inboxAdapter(db: Database, orgId: string, mode: Mode): NotificationAdapter {
  const read = async (key: string) => {
    const id = key.startsWith("notification:") ? key.slice("notification:".length) : "";
    if (!/^[a-f\d-]{36}$/i.test(id)) return null;
    return (await db.query("SELECT n.id FROM notifications n JOIN memberships m ON m.org_id=n.org_id AND n.recipient_ref='user:'||m.user_id::text JOIN users u ON u.id=m.user_id JOIN report_snapshots r ON r.org_id=n.org_id AND r.id=n.report_id WHERE n.org_id=$1 AND n.id=$2 AND n.channel='in_app' AND m.active AND u.active AND r.body_json->>'mode'=$3", [orgId, id, mode])).rows[0];
  };
  return {
    mode,
    async send(input) { const found = await read(input.idempotencyKey); if (!found || input.channel !== "in_app") throw new DomainError("INBOX_RECIPIENT_UNAVAILABLE", 409, "站内通知收件人已停用或记录缺失"); return { delivered: true, providerMessageId: `in_app:${found.id}` }; },
    async reconcile(input) { const found = await read(input.idempotencyKey); return { state: found ? "delivered" : "absent", providerMessageId: found ? `in_app:${found.id}` : null }; },
  };
}
export interface ReportDispatchResult { ready: number; inApp: number; external: number; archived: number; blocked: number; failed: number; }

/** Polls persisted report events. External deliveries keep the domain's lease/unknown/reconcile protocol. */
export async function dispatchReports(db: Database, scope: {orgId?: string; mode?: Mode} = {}): Promise<ReportDispatchResult> {
  const result: ReportDispatchResult = { ready: 0, inApp: 0, external: 0, archived: 0, blocked: 0, failed: 0 };
  const ready = await db.transaction(async (tx) => {
    const events = (await tx.query("SELECT * FROM outbox_events WHERE event_type='report.ready' AND dispatched_at IS NULL AND next_attempt_at<=now() AND ($1::uuid IS NULL OR org_id=$1) AND ($2::text IS NULL OR payload->>'mode'=$2) ORDER BY next_attempt_at,id LIMIT 20 FOR UPDATE SKIP LOCKED", [scope.orgId ?? null, scope.mode ?? null])).rows;
    let processed = 0; let needsHuman = 0;
    for (const event of events) {
      const report = (await tx.query("SELECT * FROM report_snapshots WHERE org_id=$1 AND id=$2 FOR UPDATE", [event.org_id, event.aggregate_id])).rows[0];
      const mode = report ? modeOf(report) : null;
      const actor = mode ? await context(db, String(event.org_id), mode, tx) : null;
      if (!actor || !report || !mode || (event.payload as Row).mode !== mode) {
        await tx.query("UPDATE outbox_events SET payload=payload||$2::jsonb,next_attempt_at=now()+interval '1 minute' WHERE id=$1", [event.id, JSON.stringify({ dispatch_state: "needs_human", processing_error: "REPORT_CONTEXT_UNAVAILABLE", missing: ["active_report_context"] })]); needsHuman++; continue;
      }
      const members = (await tx.query("SELECT m.user_id FROM memberships m JOIN users u ON u.id=m.user_id WHERE m.org_id=$1 AND m.active AND u.active AND ('owner'=ANY(m.roles) OR 'marketer'=ANY(m.roles)) ORDER BY m.user_id", [event.org_id])).rows;
      const current = scopedContext(db, tx, actor);
      await enqueueReportNotifications(current, String(report.id), members.flatMap((member) => ([{ channel: "in_app" as const, recipientRef: `user:${member.user_id}` }, { channel: "email" as const, recipientRef: `user:${member.user_id}` }])));
      if (!(await tx.query("SELECT id FROM outbox_events WHERE org_id=$1 AND aggregate_id=$2 AND event_type='report.archive' LIMIT 1", [event.org_id, report.id])).rows.length) await emitOutbox(current, tx, "report.archive", String(report.id), { reportId: report.id, mode });
      await tx.query("UPDATE outbox_events SET dispatched_at=now(),payload=payload||$2::jsonb WHERE id=$1", [event.id, JSON.stringify({ dispatch_state: "delivery_intents_persisted", recipient_count: members.length, external_delivery_verified: false })]);
      await audit(current, tx, "report.deliveries_enqueued", "report_snapshot", String(report.id), { mode, recipient_count: members.length }); processed++;
    }
    return { processed, needsHuman };
  });
  result.ready = ready.processed; result.blocked += ready.needsHuman;
  const notifications = (await db.query("SELECT e.id AS event_id,n.*,r.body_json FROM outbox_events e JOIN notifications n ON n.org_id=e.org_id AND n.id=e.aggregate_id JOIN report_snapshots r ON r.org_id=n.org_id AND r.id=n.report_id WHERE e.event_type='notification.deliver' AND e.dispatched_at IS NULL AND e.next_attempt_at<=now() AND ($1::uuid IS NULL OR e.org_id=$1) AND ($2::text IS NULL OR r.body_json->>'mode'=$2) ORDER BY e.next_attempt_at,e.id LIMIT 40", [scope.orgId ?? null, scope.mode ?? null])).rows;
  for (const notification of notifications) {
    const mode = modeOf(notification); const ctx = mode ? await context(db, String(notification.org_id), mode) : null;
    const adapter = mode && (notification.channel === "in_app" ? inboxAdapter(db, String(notification.org_id), mode) : deliveryAdapters.get(registryKey(String(notification.org_id), mode))?.notification);
    if (!ctx || !adapter) { await blocked(db, String(notification.event_id), !ctx ? "REPORT_CONTEXT_UNAVAILABLE" : "NOTIFICATION_ADAPTER_NOT_CONFIGURED", !ctx ? "active_operator" : "trusted_notification_adapter"); result.blocked++; continue; }
    try { const delivered = await processNotification(ctx, String(notification.id), adapter); if (delivered.state === "succeeded") { if (!("duplicate" in delivered && delivered.duplicate)) { if (notification.channel === "in_app") result.inApp++; else result.external++; } } else if (delivered.state === "pending") result.blocked++; else result.failed++; }
    catch (error) {
      if (error instanceof DomainError && ["RETRY_NOT_DUE", "STALE_NOTIFICATION_LEASE"].includes(error.code)) continue;
      await blocked(db, String(notification.event_id), error instanceof DomainError ? error.code : "NOTIFICATION_DISPATCH_FAILED", "notification_recovery"); result.blocked++;
    }
  }
  const archives = (await db.query("SELECT e.id AS event_id,r.* FROM outbox_events e JOIN report_snapshots r ON r.org_id=e.org_id AND r.id=e.aggregate_id WHERE e.event_type='report.archive' AND e.dispatched_at IS NULL AND e.next_attempt_at<=now() AND ($1::uuid IS NULL OR e.org_id=$1) AND ($2::text IS NULL OR r.body_json->>'mode'=$2) ORDER BY e.next_attempt_at,e.id LIMIT 20", [scope.orgId ?? null, scope.mode ?? null])).rows;
  for (const report of archives) {
    const mode = modeOf(report); const ctx = mode ? await context(db, String(report.org_id), mode) : null;
    const adapter = mode ? deliveryAdapters.get(registryKey(String(report.org_id), mode))?.drive : undefined;
    if (!ctx || !adapter) { await blocked(db, String(report.event_id), !ctx ? "REPORT_CONTEXT_UNAVAILABLE" : "DRIVE_ADAPTER_NOT_CONFIGURED", !ctx ? "active_operator" : "trusted_drive_adapter"); result.blocked++; continue; }
    try { const archived = await archiveReportToDrive(ctx, String(report.id), adapter); if (archived.state === "succeeded") { if (!("duplicate" in archived && archived.duplicate)) result.archived++; } else if (archived.state === "pending") result.blocked++; else result.failed++; }
    catch (error) {
      if (error instanceof DomainError && ["ARCHIVE_BUSY", "STALE_ARCHIVE_LEASE"].includes(error.code)) continue;
      await blocked(db, String(report.event_id), error instanceof DomainError ? error.code : "ARCHIVE_DISPATCH_FAILED", "archive_recovery"); result.blocked++;
    }
  }
  return result;
}
