import { createHash } from "node:crypto";
import type { SqlExecutor } from "@boran/db";
import { DomainError, uuid, stableHash, nowIso, audit, emitOutbox } from "./core";
import type { ServiceContext } from "./core";
import { requireActiveRole, requireOwner } from "./authz";
import { datesInWindow, getAdMetrics } from "./ads";

type Row = Record<string, unknown>;
export async function createReportSnapshot(ctx: ServiceContext, input: { kind: "daily" | "weekly"; start: string; end: string; connectionIds?: string[]; body?: { facts?: unknown[]; hypotheses?: unknown[]; actions?: unknown[]; dataGaps?: unknown[] }; metricVersion?: string }) {
  await requireActiveRole(ctx, ctx.db, "owner", "marketer"); datesInWindow(input.start, input.end);
  if (!["daily", "weekly"].includes(input.kind)) throw new DomainError("INVALID_REPORT", 422, "报告类型无效");
  const metrics = await getAdMetrics(ctx, { start: input.start, end: input.end, ...(input.connectionIds ? { connectionIds: input.connectionIds } : {}) });
  const gaps = metrics.accounts.filter((account) => account.quality !== "complete").map((account) => ({ connectionId: account.connectionId, accountName: account.accountName, quality: account.quality }));
  const actionRows = (await ctx.db.query("SELECT id,action_type,state,verified_at,verification_evidence_ref FROM execution_actions WHERE org_id=$1 AND created_at >= ($2::date::timestamp AT TIME ZONE 'Asia/Shanghai') AND created_at < (($3::date + interval '1 day') AT TIME ZONE 'Asia/Shanghai') ORDER BY created_at,id", [ctx.orgId, input.start, input.end])).rows;
  const actions = actionRows.filter((action) => (action.verification_evidence_ref as Row | null)?.mode === ctx.mode).map((action) => ({ id: action.id, actionType: action.action_type, state: action.state, verifiedAt: action.verified_at, evidence: action.verification_evidence_ref }));
  // Facts/actions are copied from durable, deterministic inputs, never from a model/client claim.
  const body = { facts: [{ kind: "deterministic_metrics", quality: metrics.quality, currency: metrics.currency, spendMinor: metrics.spendMinor, accounts: metrics.accounts }], hypotheses: input.body?.hypotheses ?? [], actions, dataGaps: [...gaps, ...(input.body?.dataGaps ?? [])], mode: ctx.mode, realAcceptance: false };
  // Revision identity excludes render time; repeating a schedule cannot produce a new report.
  const { dataCutoff: _cutoff, ...metricIdentity } = metrics;
  const queryHash = stableHash({ metrics: metricIdentity, body, metricVersion: input.metricVersion ?? "ads-v1" });
  return ctx.db.transaction(async (tx) => {
    await tx.query("SELECT id FROM organizations WHERE id=$1 FOR UPDATE", [ctx.orgId]);
    const latest = (await tx.query("SELECT * FROM report_snapshots WHERE org_id=$1 AND kind=$2 AND period_start=$3 AND period_end=$4 ORDER BY revision DESC LIMIT 1", [ctx.orgId, input.kind, input.start, input.end])).rows[0];
    if (latest?.query_hash === queryHash) return { id: String(latest.id), revision: Number(latest.revision), duplicate: true, mode: ctx.mode, quality: latest.quality };
    const id = uuid(); const revision = latest ? Number(latest.revision) + 1 : 1;
    await tx.query("INSERT INTO report_snapshots(id,org_id,kind,period_start,period_end,revision,metric_version,source_batch_ids,query_hash,data_cutoff,quality,metrics_json,body_json,archive_status) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,'pending')", [id, ctx.orgId, input.kind, input.start, input.end, revision, input.metricVersion ?? "ads-v1", metrics.batchIds, queryHash, metrics.dataCutoff, metrics.quality, JSON.stringify(metrics), JSON.stringify(body)]);
    await emitOutbox(ctx, tx, "report.ready", id, { reportId: id, revision, mode: ctx.mode });
    await audit(ctx, tx, "report.created", "report_snapshot", id, { revision, mode: ctx.mode, quality: metrics.quality });
    return { id, revision, duplicate: false, mode: ctx.mode, quality: metrics.quality };
  });
}
export async function getReports(ctx: ServiceContext, input: { start?: string; end?: string; limit?: number } = {}) {
  await requireActiveRole(ctx, ctx.db, "owner", "marketer", "viewer");
  const limit = Math.min(Math.max(Math.trunc(input.limit ?? 50), 1), 200);
  const rows = (await ctx.db.query("SELECT * FROM report_snapshots WHERE org_id=$1 AND ($2::date IS NULL OR period_start >= $2) AND ($3::date IS NULL OR period_end <= $3) AND body_json->>'mode'=$4 ORDER BY period_end DESC,revision DESC LIMIT $5", [ctx.orgId, input.start ?? null, input.end ?? null, ctx.mode, limit])).rows;
  return { mode: ctx.mode, reports: rows, realAcceptance: false };
}
export interface GeoObservationInput { questionId: string; batchKey: string; repetitionNo: number; platform: string; productMode: string; modelVersion?: string | null; region: string; observedAt: string; status: "valid" | "timeout" | "refused" | "invalid"; answerText?: string | null; evidenceObjectKey?: string | null; citations?: string[]; brandMentioned?: boolean | null; websiteCited?: boolean | null; reviewed?: boolean; }
export async function recordGeoObservation(ctx: ServiceContext, input: GeoObservationInput) {
  await requireActiveRole(ctx, ctx.db, "owner", "marketer", "reviewer");
  if (!input.batchKey || !input.platform || !input.productMode || !input.region || !Number.isInteger(input.repetitionNo) || input.repetitionNo < 1 || input.repetitionNo > 100 || !Number.isFinite(Date.parse(input.observedAt)) || !["valid", "timeout", "refused", "invalid"].includes(input.status)) throw new DomainError("INVALID_OBSERVATION", 422, "GEO实际观察元数据无效");
  if (input.status === "valid" && !input.answerText?.trim() && !input.evidenceObjectKey) throw new DomainError("EVIDENCE_REQUIRED", 422, "有效采样必须保存实际回答或观察证据");
  const citations = input.citations ?? [];
  if (citations.length > 100 || citations.some((url) => { try { return !["http:", "https:"].includes(new URL(url).protocol); } catch { return true; } })) throw new DomainError("INVALID_CITATION", 422, "引用须为实际HTTP(S)地址");
  if (input.status !== "valid" && (input.brandMentioned !== undefined || input.websiteCited !== undefined)) throw new DomainError("INVALID_REVIEW", 422, "失败采样不能产生品牌或网站命中结果");
  return ctx.db.transaction(async (tx) => {
    const question = (await tx.query("SELECT id FROM geo_questions WHERE org_id=$1 AND id=$2", [ctx.orgId, input.questionId])).rows[0]; if (!question) throw new DomainError("NOT_FOUND", 404, "问题不存在");
    const batchKey = `${ctx.mode}:${input.batchKey}`;
    const existing = (await tx.query("SELECT * FROM geo_observations WHERE org_id=$1 AND question_id=$2 AND batch_key=$3 AND platform=$4 AND product_mode=$5 AND repetition_no=$6", [ctx.orgId, input.questionId, batchKey, input.platform, input.productMode, input.repetitionNo])).rows[0];
    if (existing) { if (existing.status !== input.status || existing.answer_text !== (input.answerText ?? null) || JSON.stringify(existing.citations) !== JSON.stringify(citations)) throw new DomainError("OBSERVATION_CONFLICT", 409, "同批同采样位置不可覆盖已有证据"); return { id: String(existing.id), duplicate: true, mode: ctx.mode }; }
    const id = uuid();
    await tx.query("INSERT INTO geo_observations(id,org_id,question_id,batch_key,repetition_no,platform,product_mode,model_version,region,observed_at,status,answer_text,evidence_object_key,citations,brand_mentioned,website_cited,reviewed_by,reviewed_at) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18)", [id, ctx.orgId, input.questionId, batchKey, input.repetitionNo, input.platform, input.productMode, input.modelVersion ?? null, input.region, input.observedAt, input.status, input.answerText ?? null, input.evidenceObjectKey ?? null, JSON.stringify(citations), input.reviewed ? input.brandMentioned ?? null : null, input.reviewed ? input.websiteCited ?? null : null, input.reviewed ? ctx.actorId : null, input.reviewed ? nowIso(ctx) : null]);
    await audit(ctx, tx, "geo.observed", "geo_observation", id, { mode: ctx.mode, status: input.status, platform: input.platform, productMode: input.productMode });
    return { id, duplicate: false, mode: ctx.mode };
  });
}
export async function getGeoMetrics(ctx: ServiceContext, input: { batchKey: string; expectedSamples: number; questionId?: string; platform?: string; productMode?: string }) {
  await requireActiveRole(ctx, ctx.db, "owner", "marketer", "viewer"); if (!Number.isSafeInteger(input.expectedSamples) || input.expectedSamples < 1) throw new DomainError("INVALID_DENOMINATOR", 422, "预期采样数须为正整数");
  const rows = (await ctx.db.query("SELECT * FROM geo_observations WHERE org_id=$1 AND batch_key=$2 AND ($3::uuid IS NULL OR question_id=$3) AND ($4::text IS NULL OR platform=$4) AND ($5::text IS NULL OR product_mode=$5)", [ctx.orgId, `${ctx.mode}:${input.batchKey}`, input.questionId ?? null, input.platform ?? null, input.productMode ?? null])).rows;
  const groups = new Map<string, Row[]>(); for (const row of rows) { const key = `${row.question_id}:${row.platform}:${row.product_mode}:${row.region}`; groups.set(key, [...(groups.get(key) ?? []), row]); }
  const samples = [...groups.entries()].map(([key, group]) => { const valid = group.filter((row) => row.status === "valid"); const reviewed = valid.filter((row) => row.reviewed_by && row.reviewed_at); return { key, attempted: group.length, valid: valid.length, expected: input.expectedSamples, completeness: valid.length / input.expectedSamples, denominator: valid.length, brandRate: reviewed.length === valid.length && valid.length ? reviewed.filter((row) => row.brand_mentioned === true).length / valid.length : null, citationRate: reviewed.length === valid.length && valid.length ? reviewed.filter((row) => row.website_cited === true).length / valid.length : null, modelVersions: [...new Set(valid.map((row) => row.model_version))], evidenceIds: valid.map((row) => String(row.id)) }; });
  return { mode: ctx.mode, samples, denominator: samples.length === 1 ? samples[0]!.denominator : null, completeness: samples.length === 1 ? samples[0]!.completeness : null, realAcceptance: ctx.mode === "live" && samples.length > 0 && samples.every((sample) => sample.valid >= sample.expected) };
}
export function calculateSeoMetrics(input: { source: string; observedAt: string | null; clicks: number | null; impressions: number | null; positions: { position: number; impressions: number }[] | null; evidenceRef: string | null }) {
  if (!input.evidenceRef || !input.observedAt || !Number.isFinite(Date.parse(input.observedAt))) return { status: "missing", ctr: null, averagePosition: null };
  for (const value of [input.clicks, input.impressions]) if (value !== null && (!Number.isSafeInteger(value) || value < 0)) throw new DomainError("INVALID_SEO_METRIC", 422, "SEO计数须为真实非负整数");
  if (input.positions?.some((row) => !Number.isFinite(row.position) || row.position < 1 || !Number.isSafeInteger(row.impressions) || row.impressions < 0)) throw new DomainError("INVALID_SEO_METRIC", 422, "排名采样无效");
  const denominator = input.positions?.reduce((sum, row) => sum + row.impressions, 0) ?? 0;
  return { status: "observed", source: input.source, observedAt: input.observedAt, evidenceRef: input.evidenceRef, ctr: input.clicks !== null && input.impressions ? input.clicks / input.impressions : null, averagePosition: denominator ? input.positions!.reduce((sum, row) => sum + row.position * row.impressions, 0) / denominator : null };
}
export async function getSevenDayCompleteness(ctx: ServiceContext, input: { start: string; end: string; connectionIds?: string[] }) {
  const dates = datesInWindow(input.start, input.end); const metrics = await getAdMetrics(ctx, input);
  const completeDates = dates.filter((date) => metrics.accounts.length > 0 && metrics.accounts.every((account) => account.daily.find((day) => day.date === date)?.quality === "complete"));
  const actualConnector = metrics.accounts.length > 0 && metrics.accounts.every((account) => account.sourceKinds.length === 1 && account.sourceKinds[0] === "connector");
  return { mode: ctx.mode, expectedDates: dates, completeDates, incompleteDates: dates.filter((date) => !completeDates.includes(date)), completeBusinessDays: completeDates.length, sourceValidated: actualConnector, passed: ctx.mode === "live" && completeDates.length >= 7 && actualConnector, realAcceptance: ctx.mode === "live" && completeDates.length >= 7 && actualConnector };
}

export async function enqueueReportNotifications(ctx: ServiceContext, reportId: string, recipients: { channel: "in_app" | "email" | "webhook"; recipientRef: string }[]) {
  await requireActiveRole(ctx, ctx.db, "owner", "marketer");
  return ctx.db.transaction(async (tx) => {
    const report = (await tx.query("SELECT id FROM report_snapshots WHERE org_id=$1 AND id=$2 AND body_json->>'mode'=$3", [ctx.orgId, reportId, ctx.mode])).rows[0]; if (!report) throw new DomainError("NOT_FOUND", 404, "报告不存在或模式不同");
    const ids: string[] = [];
    for (const recipient of recipients) {
      if (!["in_app", "email", "webhook"].includes(recipient.channel) || !/^[a-z][a-z0-9_-]*:[^\s@]+$/i.test(recipient.recipientRef)) throw new DomainError("INVALID_RECIPIENT", 422, "通知只接受安全目的地引用");
      const id = uuid(); const result = await tx.query("INSERT INTO notifications(id,org_id,report_id,channel,recipient_ref,status,attempts) VALUES($1,$2,$3,$4,$5,'pending',0) ON CONFLICT(org_id,report_id,channel,recipient_ref) DO NOTHING RETURNING id", [id, ctx.orgId, reportId, recipient.channel, recipient.recipientRef]);
      if (result.rowCount) { ids.push(id); await emitOutbox(ctx, tx, "notification.deliver", id, { notificationId: id, mode: ctx.mode, receiptState: "not_submitted" }); }
      else { const existing = (await tx.query("SELECT id FROM notifications WHERE org_id=$1 AND report_id=$2 AND channel=$3 AND recipient_ref=$4", [ctx.orgId, reportId, recipient.channel, recipient.recipientRef])).rows[0]!; ids.push(String(existing.id)); }
    }
    return { ids, mode: ctx.mode };
  });
}
/** Checked immediately before each new external report write; read-only recovery is deliberately outside this gate. */
export async function assertReportExternalWriteAllowed(ctx: ServiceContext, tx: SqlExecutor = ctx.db) {
  if (ctx.mode === "mock") return;
  const org = (await tx.query("SELECT write_enabled FROM organizations WHERE id=$1", [ctx.orgId])).rows[0];
  if (process.env.WRITE_ENABLED !== "true" || org?.write_enabled !== true) throw new DomainError("WRITE_DISABLED", 409, "外送与归档已暂停", { deploymentEnabled: process.env.WRITE_ENABLED === "true", organizationEnabled: org?.write_enabled === true });
}
function nextLeaseGeneration(payload: Row) { const previous = Number(payload.leaseGeneration ?? 0); if (!Number.isSafeInteger(previous) || previous < 0 || previous >= Number.MAX_SAFE_INTEGER) throw new DomainError("INVALID_LEASE_GENERATION", 409, "持久租约代次无效"); return previous + 1; }
function assertReportLease(event: Row | undefined, generation: number, code: string, attempts: number) { if (!event || Number((event.payload as Row)?.leaseGeneration) !== generation || Number(event.attempts) !== attempts) throw new DomainError(code, 409, "较早的执行器不能覆盖新租约"); }
function deliveryPayload(payload: Row, extra: Row): Row {
  // A verified result replaces a prior stop notice; the independent generation is never refunded.
  const { dispatch_state: _state, processing_error: _error, missing: _missing, ...rest } = payload;
  return { ...rest, ...extra };
}
async function reportWriteStopped(ctx: ServiceContext, tx: SqlExecutor, event: Row, reportId: string, receiptState: string) {
  const payload = event.payload as Row;
  await tx.query("UPDATE outbox_events SET attempts=$3,next_attempt_at=$4,payload=$5 WHERE org_id=$1 AND id=$2", [ctx.orgId, event.id, Number(event.attempts) - 1, new Date(Date.parse(nowIso(ctx)) + 60000).toISOString(), JSON.stringify({ ...payload, receiptState, dispatch_state: "needs_human", processing_error: "WRITE_DISABLED", missing: ["WRITE_ENABLED", "organizations.write_enabled"], writeDisabledNotice: true })]);
  if (!payload.writeDisabledNotice) await emitOutbox(ctx, tx, "alert.write_disabled", reportId, { reportId, mode: ctx.mode, code: "WRITE_DISABLED", impact: "外送与归档已暂停", recovery: "enable_global_and_organization_write_then_retry" });
  await audit(ctx, tx, "report.write_disabled", "report_snapshot", reportId, { mode: ctx.mode, eventId: event.id, receiptState });
}
export interface NotificationAdapter { mode: "mock" | "live"; send(input: { idempotencyKey: string; channel: string; recipientRef: string; reportId: string }): Promise<{ delivered: boolean; providerMessageId: string | null }>; reconcile(input: { idempotencyKey: string; providerMessageId: string | null }): Promise<{ state: "delivered" | "absent" | "unknown"; providerMessageId: string | null }> }
type ClaimedNotification = { notification: Row; event: Row; reconcile: boolean; generation: number };
export async function processNotification(ctx: ServiceContext, id: string, adapter: NotificationAdapter, options: { maxAttempts?: number; leaseMs?: number } = {}) {
  await requireActiveRole(ctx, ctx.db, "owner", "marketer"); if (adapter.mode !== ctx.mode) throw new DomainError("MODE_MISMATCH", 422, "通知适配器模式不同");
  const maxAttempts = options.maxAttempts ?? 5; const leaseMs = options.leaseMs ?? 60000;
  const claimed = await ctx.db.transaction<ClaimedNotification | null>(async (tx) => {
    const notification = (await tx.query("SELECT n.* FROM notifications n JOIN report_snapshots r ON r.org_id=n.org_id AND r.id=n.report_id WHERE n.org_id=$1 AND n.id=$2 AND r.body_json->>'mode'=$3 FOR UPDATE OF n", [ctx.orgId, id, ctx.mode])).rows[0]; if (!notification) throw new DomainError("NOT_FOUND", 404, "通知不存在");
    if (notification.status === "succeeded") return null;
    const event = (await tx.query("SELECT * FROM outbox_events WHERE org_id=$1 AND aggregate_id=$2 AND event_type='notification.deliver' AND dispatched_at IS NULL ORDER BY created_at LIMIT 1 FOR UPDATE", [ctx.orgId, id])).rows[0];
    if (!event) throw new DomainError("DELIVERY_EXHAUSTED", 409, "通知已停止自动重试，需恢复处理");
    const eventPayload = event.payload as Row; if (Date.parse(String(event.next_attempt_at)) > Date.parse(nowIso(ctx))) throw new DomainError("RETRY_NOT_DUE", 409, "重试或租约尚未到期");
    if (Number(event.attempts) >= maxAttempts) throw new DomainError("DELIVERY_EXHAUSTED", 409, "通知达到重试上限，记录仍保留");
    const reconcile = eventPayload.receiptState === "unknown" || notification.status === "sending";
    const generation = nextLeaseGeneration(eventPayload);
    await tx.query("UPDATE notifications SET status='sending',attempts=attempts+1 WHERE org_id=$1 AND id=$2", [ctx.orgId, id]);
    await tx.query("UPDATE outbox_events SET attempts=attempts+1,next_attempt_at=$3,payload=$4 WHERE org_id=$1 AND id=$2", [ctx.orgId, event.id, new Date(Date.parse(nowIso(ctx)) + leaseMs).toISOString(), JSON.stringify({ ...eventPayload, receiptState: "unknown", leaseGeneration: generation })]);
    return { notification, event, reconcile, generation };
  });
  if (!claimed) return { id, state: "succeeded", duplicate: true, mode: ctx.mode };
  const { notification, event, generation } = claimed; const key = `notification:${id}`;
  let delivered = false; let stopped = false; let submissionStarted = false; let providerMessageId = typeof notification.provider_message_id === "string" ? notification.provider_message_id : null;
  let receiptState = claimed.reconcile ? "unknown" : String((event.payload as Row).receiptState ?? "not_submitted");
  try {
    if (claimed.reconcile) { const reconciled = await adapter.reconcile({ idempotencyKey: key, providerMessageId }); providerMessageId = reconciled.providerMessageId; delivered = reconciled.state === "delivered" && !!providerMessageId; receiptState = delivered ? "delivered" : reconciled.state === "absent" ? "absent" : "unknown"; }
    if (!claimed.reconcile || receiptState === "absent") {
      await ctx.db.transaction(async (tx) => {
        await tx.query("SELECT id FROM notifications WHERE org_id=$1 AND id=$2 FOR UPDATE", [ctx.orgId, id]);
        const lease = (await tx.query("SELECT payload,attempts FROM outbox_events WHERE org_id=$1 AND id=$2 FOR UPDATE", [ctx.orgId, event.id])).rows[0]; assertReportLease(lease, generation, "STALE_NOTIFICATION_LEASE", Number(event.attempts) + 1);
        await requireActiveRole(ctx, tx, "owner", "marketer");
        if (notification.channel !== "in_app") await assertReportExternalWriteAllowed(ctx, tx);
      });
      submissionStarted = true;
      const sent = await adapter.send({ idempotencyKey: key, channel: String(notification.channel), recipientRef: String(notification.recipient_ref), reportId: String(notification.report_id) }); delivered = sent.delivered && !!sent.providerMessageId; providerMessageId = sent.providerMessageId; receiptState = delivered ? "delivered" : "unknown";
    }
  } catch (error) {
    if (error instanceof DomainError && error.code === "STALE_NOTIFICATION_LEASE") throw error;
    if (error instanceof DomainError && error.code === "WRITE_DISABLED" && !submissionStarted) stopped = true;
    else receiptState = "unknown";
  }
  const attempts = Number(event.attempts) + 1;
  await ctx.db.transaction(async (tx) => {
    await tx.query("SELECT id FROM notifications WHERE org_id=$1 AND id=$2 FOR UPDATE", [ctx.orgId, id]);
    const lease = (await tx.query("SELECT * FROM outbox_events WHERE org_id=$1 AND id=$2 FOR UPDATE", [ctx.orgId, event.id])).rows[0]; assertReportLease(lease, generation, "STALE_NOTIFICATION_LEASE", Number(event.attempts) + 1);
    if (stopped) {
      await tx.query("UPDATE notifications SET status='pending',attempts=$3,provider_message_id=$4 WHERE org_id=$1 AND id=$2", [ctx.orgId, id, Number(notification.attempts), providerMessageId]);
      await reportWriteStopped(ctx, tx, lease!, String(notification.report_id), receiptState); return;
    }
    await tx.query("UPDATE notifications SET status=$3,sent_at=$4,provider_message_id=$5 WHERE org_id=$1 AND id=$2", [ctx.orgId, id, delivered ? "succeeded" : "failed", delivered ? nowIso(ctx) : null, providerMessageId]);
    await tx.query("UPDATE outbox_events SET dispatched_at=$3,next_attempt_at=$4,payload=$5 WHERE org_id=$1 AND id=$2", [ctx.orgId, event.id, delivered ? nowIso(ctx) : null, new Date(Date.parse(nowIso(ctx)) + Math.min(3600000, 1000 * 2 ** attempts)).toISOString(), JSON.stringify(deliveryPayload(lease!.payload as Row, { notificationId: id, mode: ctx.mode, receiptState, manualRecoveryRequired: attempts >= maxAttempts }))]);
    await audit(ctx, tx, "notification.result", "notification", id, { delivered, mode: ctx.mode, attempts, receiptState });
    if (!delivered) await emitOutbox(ctx, tx, "alert.delivery_failed", id, { notificationId: id, mode: ctx.mode, impact: "通知未送达", recovery: attempts >= maxAttempts ? "manual_required" : "reconcile_then_retry" });
  });
  return { id, state: stopped ? "pending" : delivered ? "succeeded" : "failed", ...(stopped ? { code: "WRITE_DISABLED" } : {}), mode: ctx.mode, receiptState, realAcceptance: delivered && ctx.mode === "live" };
}
export interface DriveArchiveAdapter { mode: "mock" | "live"; findByIdempotencyKey(key: string): Promise<{ fileId: string } | null>; reconcile?(key: string): Promise<{ state: "found" | "absent" | "unknown"; fileId?: string }>; write(input: { idempotencyKey: string; name: string; content: string }): Promise<{ fileId: string }>; read(fileId: string): Promise<{ content: string; revision: string }> }
export async function archiveReportToDrive(ctx: ServiceContext, reportId: string, adapter: DriveArchiveAdapter) {
  await requireActiveRole(ctx, ctx.db, "owner", "marketer"); if (adapter.mode !== ctx.mode) throw new DomainError("MODE_MISMATCH", 422, "归档适配器模式不同");
  const claim = await ctx.db.transaction(async (tx) => {
    const report = (await tx.query("SELECT * FROM report_snapshots WHERE org_id=$1 AND id=$2 AND body_json->>'mode'=$3 FOR UPDATE", [ctx.orgId, reportId, ctx.mode])).rows[0]; if (!report) throw new DomainError("NOT_FOUND", 404, "报告不存在");
    if (report.archive_status === "succeeded") return { report, event: null, duplicate: true, generation: 0 };
    let event = (await tx.query("SELECT * FROM outbox_events WHERE org_id=$1 AND aggregate_id=$2 AND event_type='report.archive' AND dispatched_at IS NULL ORDER BY created_at LIMIT 1 FOR UPDATE", [ctx.orgId, reportId])).rows[0];
    if (!event) { await emitOutbox(ctx, tx, "report.archive", reportId, { mode: ctx.mode }); event = (await tx.query("SELECT * FROM outbox_events WHERE org_id=$1 AND aggregate_id=$2 AND event_type='report.archive' AND dispatched_at IS NULL ORDER BY created_at LIMIT 1", [ctx.orgId, reportId])).rows[0]!; }
    if (Date.parse(String(event.next_attempt_at)) > Date.parse(nowIso(ctx))) throw new DomainError("ARCHIVE_BUSY", 409, "归档租约或重试尚未到期");
    if (Number(event.attempts) >= 5) throw new DomainError("ARCHIVE_EXHAUSTED", 409, "归档达到重试上限，需人工恢复");
    const generation = nextLeaseGeneration(event.payload as Row);
    await tx.query("UPDATE outbox_events SET attempts=attempts+1,next_attempt_at=$3,payload=$4 WHERE org_id=$1 AND id=$2", [ctx.orgId, event.id, new Date(Date.parse(nowIso(ctx)) + 60000).toISOString(), JSON.stringify({ ...(event.payload as Row), leaseGeneration: generation })]);
    return { report, event, duplicate: false, generation };
  });
  if (claim.duplicate) return { reportId, state: "succeeded", duplicate: true, mode: ctx.mode };
  const { report, event, generation } = claim;
  const content = JSON.stringify({ id: report.id, kind: report.kind, period_start: String(report.period_start), period_end: String(report.period_end), revision: Number(report.revision), metric_version: report.metric_version, source_batch_ids: report.source_batch_ids, query_hash: report.query_hash, data_cutoff: String(report.data_cutoff), quality: report.quality, metrics: report.metrics_json, body: report.body_json, mode: ctx.mode });
  const hash = createHash("sha256").update(content).digest("hex"); const key = `report:${reportId}:r${report.revision}`;
  let receiptState = (event!.payload as Row).receiptState === "absent" ? "absent" : "not_submitted"; let submissionStarted = false;
  try {
    let found = await adapter.findByIdempotencyKey(key);
    if (!found && Number(event!.attempts) > 0 && (event!.payload as Row).receiptState !== "absent") {
      const reconciled = await adapter.reconcile?.(key);
      if (reconciled?.state === "found" && reconciled.fileId) found = { fileId: reconciled.fileId };
      else if (reconciled?.state === "absent") receiptState = "absent";
      else { receiptState = "unknown"; throw new DomainError("ARCHIVE_RESULT_UNKNOWN", 409, "历史归档结果未确定，不可盲目重写"); }
    }
    if (!found) {
      await ctx.db.transaction(async (tx) => {
        await tx.query("SELECT id FROM report_snapshots WHERE org_id=$1 AND id=$2 FOR UPDATE", [ctx.orgId, reportId]);
        const lease = (await tx.query("SELECT payload,attempts FROM outbox_events WHERE org_id=$1 AND id=$2 FOR UPDATE", [ctx.orgId, event!.id])).rows[0]; assertReportLease(lease, generation, "STALE_ARCHIVE_LEASE", Number(event!.attempts) + 1);
        await requireActiveRole(ctx, tx, "owner", "marketer"); await assertReportExternalWriteAllowed(ctx, tx);
      });
      receiptState = "unknown"; submissionStarted = true;
      found = await adapter.write({ idempotencyKey: key, name: `泊冉_${ctx.mode}_${report.kind}_${report.period_end}_r${report.revision}.json`, content });
    }
    const file = found;
    const readback = await adapter.read(file.fileId);
    if (!readback.revision || createHash("sha256").update(readback.content).digest("hex") !== hash) throw new DomainError("ARCHIVE_READBACK_MISMATCH", 409, "归档回读内容或版本不一致");
    await ctx.db.transaction(async (tx) => {
      await tx.query("SELECT id FROM report_snapshots WHERE org_id=$1 AND id=$2 FOR UPDATE", [ctx.orgId, reportId]);
      const lease = (await tx.query("SELECT * FROM outbox_events WHERE org_id=$1 AND id=$2 FOR UPDATE", [ctx.orgId, event!.id])).rows[0]; assertReportLease(lease, generation, "STALE_ARCHIVE_LEASE", Number(event!.attempts) + 1);
      await tx.query("UPDATE report_snapshots SET archive_status='succeeded',drive_file_id=$3,archive_hash=$4,archived_at=$5 WHERE org_id=$1 AND id=$2", [ctx.orgId, reportId, file.fileId, hash, nowIso(ctx)]);
      await tx.query("UPDATE outbox_events SET dispatched_at=$3,payload=$4 WHERE org_id=$1 AND id=$2", [ctx.orgId, event!.id, nowIso(ctx), JSON.stringify(deliveryPayload(lease!.payload as Row, { mode: ctx.mode, fileId: file.fileId, revision: readback.revision, hash, receiptState: "found" }))]);
      await audit(ctx, tx, "report.archived", "report_snapshot", reportId, { mode: ctx.mode, fileId: file.fileId, revision: readback.revision });
    });
    return { reportId, state: "succeeded", mode: ctx.mode, realAcceptance: ctx.mode === "live", fileId: file.fileId };
  } catch (error) {
    if (error instanceof DomainError && error.code === "STALE_ARCHIVE_LEASE") throw error;
    const stopped = error instanceof DomainError && error.code === "WRITE_DISABLED" && !submissionStarted;
    await ctx.db.transaction(async (tx) => {
      await tx.query("SELECT id FROM report_snapshots WHERE org_id=$1 AND id=$2 FOR UPDATE", [ctx.orgId, reportId]);
      const lease = (await tx.query("SELECT * FROM outbox_events WHERE org_id=$1 AND id=$2 FOR UPDATE", [ctx.orgId, event!.id])).rows[0]; assertReportLease(lease, generation, "STALE_ARCHIVE_LEASE", Number(event!.attempts) + 1);
      if (stopped) { await tx.query("UPDATE report_snapshots SET archive_status='pending' WHERE org_id=$1 AND id=$2 AND archive_status<>'succeeded'", [ctx.orgId, reportId]); await reportWriteStopped(ctx, tx, lease!, reportId, receiptState); return; }
      await tx.query("UPDATE report_snapshots SET archive_status='failed' WHERE org_id=$1 AND id=$2 AND archive_status<>'succeeded'", [ctx.orgId, reportId]);
      await tx.query("UPDATE outbox_events SET next_attempt_at=$3,payload=$4 WHERE org_id=$1 AND id=$2", [ctx.orgId, event!.id, new Date(Date.parse(nowIso(ctx)) + 5000).toISOString(), JSON.stringify(deliveryPayload(lease!.payload as Row, { mode: ctx.mode, code: "ARCHIVE_NOT_VERIFIED", receiptState: "unknown", requiresReconciliation: true }))]);
      await audit(ctx, tx, "report.archive_failed", "report_snapshot", reportId, { code: "ARCHIVE_NOT_VERIFIED", mode: ctx.mode });
      await emitOutbox(ctx, tx, "alert.archive_failed", reportId, { reportId, mode: ctx.mode, impact: "报告未归档", recovery: "readback_reconcile_required" });
    });
    return { reportId, state: stopped ? "pending" : "failed", ...(stopped ? { code: "WRITE_DISABLED" } : {}), mode: ctx.mode, realAcceptance: false };
  }
}
export function advertisingRetention(input: { endedAt: string | null; retainUntil: string | null; legalHold: boolean }, at: Date = new Date()) {
  if (!input.endedAt) return { deletable: false, retainUntil: null, reason: "传播未结束不得清理" };
  const ended = new Date(input.endedAt); if (!Number.isFinite(ended.getTime())) throw new DomainError("INVALID_ARCHIVE_DATE", 422, "传播结束时间无效");
  const minimum = new Date(ended); const month = minimum.getUTCMonth(); minimum.setUTCFullYear(minimum.getUTCFullYear() + 3); if (minimum.getUTCMonth() !== month) minimum.setUTCDate(0);
  if (input.retainUntil && !Number.isFinite(Date.parse(input.retainUntil))) throw new DomainError("INVALID_ARCHIVE_DATE", 422, "保留截止时间无效");
  const retain = new Date(Math.max(minimum.getTime(), input.retainUntil ? Date.parse(input.retainUntil) : 0));
  return { deletable: !input.legalHold && at.getTime() >= retain.getTime(), retainUntil: retain.toISOString(), reason: input.legalHold ? "法律保留中" : at.getTime() < retain.getTime() ? "传播结束后至少三年" : "满足最短保留期；PII另按独立策略" };
}
export async function endAdvertisingArchive(ctx: ServiceContext, id: string, input: { expectedVersion: number; endedAt: string; retainUntil?: string; legalHold?: boolean }) {
  await requireActiveRole(ctx, ctx.db, "owner", "marketer"); const retention = advertisingRetention({ endedAt: input.endedAt, retainUntil: input.retainUntil ?? null, legalHold: input.legalHold ?? false }, new Date(nowIso(ctx)));
  return ctx.db.transaction(async (tx: SqlExecutor) => { const record = (await tx.query("SELECT * FROM advertising_archives WHERE org_id=$1 AND id=$2 FOR UPDATE", [ctx.orgId, id])).rows[0]; if (!record) throw new DomainError("NOT_FOUND", 404, "广告档案不存在"); if (Number(record.version) !== input.expectedVersion) throw new DomainError("VERSION_CONFLICT", 409, "广告档案已变化"); if (record.ended_at) throw new DomainError("ALREADY_ENDED", 409, "既有结束证据不能覆盖"); if (Date.parse(input.endedAt) > Date.parse(nowIso(ctx))) throw new DomainError("INVALID_ARCHIVE_DATE", 422, "传播结束不能在未来"); await tx.query("UPDATE advertising_archives SET ended_at=$3,retain_until=$4,legal_hold=$5,version=version+1 WHERE org_id=$1 AND id=$2", [ctx.orgId, id, input.endedAt, retention.retainUntil, input.legalHold ?? false]); await audit(ctx, tx, "advertising.ended", "advertising_archive", id, retention); return { id, version: Number(record.version) + 1, ...retention }; });
}

export interface MetricPolicyInput { dedupeWindowDays: number; attributionWindowDays: number | null; cohortMaturationWindowDays: number | null; scoringMode: "qualitative" | "numeric_calibrated"; scoringConfig: Row; calibrationEvidenceRefs: Row[]; optimizationEnabled: boolean; }
function validateMetricPolicy(input: MetricPolicyInput) {
  for (const [field, value] of [["dedupeWindowDays", input.dedupeWindowDays], ["attributionWindowDays", input.attributionWindowDays], ["cohortMaturationWindowDays", input.cohortMaturationWindowDays]] as const) if (value !== null && (!Number.isSafeInteger(value) || value < 1 || value > 365)) throw new DomainError("INVALID_METRIC_POLICY", 422, `${field}须为1至365天或独立空值`);
  if (input.optimizationEnabled && (input.attributionWindowDays === null || input.cohortMaturationWindowDays === null)) throw new DomainError("ATTRIBUTION_NOT_CONFIGURED", 422, "归因及成熟窗口未配置不得启用自动调优");
  if (input.scoringMode === "numeric_calibrated" && (!input.calibrationEvidenceRefs.length || !Object.keys(input.scoringConfig).length)) throw new DomainError("CALIBRATION_REQUIRED", 422, "数值评分需明确配置及真实线索校准依据");
  if (!["qualitative", "numeric_calibrated"].includes(input.scoringMode)) throw new DomainError("INVALID_METRIC_POLICY", 422, "评分模式不支持");
}
export async function createMetricPolicyVersion(ctx: ServiceContext, input: MetricPolicyInput) {
  await requireActiveRole(ctx, ctx.db, "owner", "marketer"); validateMetricPolicy(input);
  return ctx.db.transaction(async (tx) => { await tx.query("SELECT id FROM organizations WHERE id=$1 FOR UPDATE", [ctx.orgId]); const previous = (await tx.query("SELECT COALESCE(max(version_no),0)::integer AS version FROM metric_policy_versions WHERE org_id=$1 AND policy_key='marketing'", [ctx.orgId])).rows[0]!; const id = uuid(); const version = Number(previous.version) + 1;
    await tx.query("INSERT INTO metric_policy_versions(id,org_id,policy_key,version_no,status,dedupe_window_days,attribution_window_days,cohort_maturation_window_days,scoring_mode,scoring_config,calibration_evidence_refs,optimization_enabled,payload_hash) VALUES($1,$2,'marketing',$3,'draft',$4,$5,$6,$7,$8,$9,$10,$11)", [id, ctx.orgId, version, input.dedupeWindowDays, input.attributionWindowDays, input.cohortMaturationWindowDays, input.scoringMode, JSON.stringify(input.scoringConfig), JSON.stringify(input.calibrationEvidenceRefs), input.optimizationEnabled, stableHash(input)]); await audit(ctx, tx, "metric_policy.draft", "metric_policy_version", id, { version, mode: ctx.mode }); return { id, versionNo: version, status: "draft", payloadHash: stableHash(input), optimizationEnabled: false, proposedOptimizationEnabled: input.optimizationEnabled };
  });
}
export async function getCurrentMetricPolicy(ctx: ServiceContext) {
  await requireActiveRole(ctx, ctx.db, "owner", "marketer", "viewer");
  const policy = (await ctx.db.query("SELECT * FROM metric_policy_versions WHERE org_id=$1 AND policy_key='marketing' AND status='approved' ORDER BY version_no DESC LIMIT 1", [ctx.orgId])).rows[0];
  return policy ?? { id: null, version_no: null, status: "pending", dedupe_window_days: 30, attribution_window_days: null, cohort_maturation_window_days: null, scoring_mode: "qualitative", optimization_enabled: false, approved_by: null, approved_at: null };
}
export async function approveMetricPolicy(ctx: ServiceContext, id: string, expectedPayloadHash: string) {
  return ctx.db.transaction(async (tx) => { await requireOwner(ctx, tx); await tx.query("SELECT id FROM organizations WHERE id=$1 FOR UPDATE", [ctx.orgId]); const policy = (await tx.query("SELECT * FROM metric_policy_versions WHERE org_id=$1 AND id=$2 AND policy_key='marketing' FOR UPDATE", [ctx.orgId, id])).rows[0]; if (!policy) throw new DomainError("NOT_FOUND", 404, "指标规则版本不存在"); if (policy.payload_hash !== expectedPayloadHash) throw new DomainError("HASH_MISMATCH", 409, "批准须绑定精确指标策略版本"); if (policy.status === "approved") return { id, status: "approved", duplicate: true }; if (policy.status !== "draft") throw new DomainError("INVALID_POLICY_STATE", 409, "只有草稿可批准");
    const input: MetricPolicyInput = { dedupeWindowDays: Number(policy.dedupe_window_days), attributionWindowDays: policy.attribution_window_days === null ? null : Number(policy.attribution_window_days), cohortMaturationWindowDays: policy.cohort_maturation_window_days === null ? null : Number(policy.cohort_maturation_window_days), scoringMode: policy.scoring_mode as MetricPolicyInput["scoringMode"], scoringConfig: policy.scoring_config as Row, calibrationEvidenceRefs: policy.calibration_evidence_refs as Row[], optimizationEnabled: Boolean(policy.optimization_enabled) }; validateMetricPolicy(input);
    if (input.scoringMode === "numeric_calibrated") {
      for (const evidence of input.calibrationEvidenceRefs) { if (typeof evidence.lead_id !== "string") throw new DomainError("CALIBRATION_REQUIRED", 422, "校准依据须定位组织内实际销售反馈线索"); const lead = (await tx.query("SELECT id,test_record,qualified_at FROM leads WHERE org_id=$1 AND id=$2 AND quality_level='qualified_lead'", [ctx.orgId, evidence.lead_id])).rows[0]; if (!lead || lead.test_record || !lead.qualified_at) throw new DomainError("CALIBRATION_REQUIRED", 422, "测试、未确认或不可见线索不能用于数值校准"); }
    }
    await tx.query("UPDATE metric_policy_versions SET status='revoked' WHERE org_id=$1 AND policy_key='marketing' AND status='approved'", [ctx.orgId]); await tx.query("UPDATE metric_policy_versions SET status='approved',approved_by=$3,approved_at=$4 WHERE org_id=$1 AND id=$2", [ctx.orgId, id, ctx.actorId, nowIso(ctx)]); await audit(ctx, tx, "metric_policy.approved", "metric_policy_version", id, { payloadHash: expectedPayloadHash }); await emitOutbox(ctx, tx, "metric_policy.changed", id, { versionId: id }); return { id, status: "approved", duplicate: false, optimizationEnabled: input.optimizationEnabled, dataGateRequired: true };
  });
}
