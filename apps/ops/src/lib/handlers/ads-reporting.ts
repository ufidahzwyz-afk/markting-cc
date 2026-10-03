import { createHash } from "node:crypto";
import { validateApiRequest } from "@boran/contracts";
import { DomainError, nowIso } from "@boran/domain/core";
import type { ServiceContext } from "@boran/domain/core";
import { requireActiveRole } from "@boran/domain/authz";
import { commitImport, getAdMetrics, preflightImport } from "@boran/domain/ads";
import { approveMetricPolicy, createMetricPolicyVersion, createReportSnapshot, getCurrentMetricPolicy, getReports, recordGeoObservation } from "@boran/domain/reporting";
import { databaseCommand, jsonData } from "../http";

const csvHeader = "business_date,account_id,entity_level,entity_id,parent_id,currency,impressions,clicks,spend_minor,platform_conversions,device,conversion_definition";
const fixtureCsv: Record<string, string> = {
  "mock:campaign_daily": `\uFEFF${csvHeader}\n2026-09-30,demo_baidu,campaign,demo_c01,,CNY,1000,50,10000,4,all,form_submit\n2026-10-01,demo_baidu,campaign,demo_c01,,CNY,1200,60,12000,5,all,form_submit\n`,
  "mock:campaign_revision": `\uFEFF${csvHeader}\n2026-09-30,demo_baidu,campaign,demo_c01,,CNY,1000,50,10000,4,all,form_submit\n2026-10-01,demo_baidu,campaign,demo_c01,,CNY,1200,60,12000,6,all,form_submit\n`,
  "mock:keyword_daily": `\uFEFF${csvHeader}\n2026-09-30,demo_baidu,keyword,demo_k01,demo_c01,CNY,600,30,6000,3,all,form_submit\n2026-09-30,demo_baidu,keyword,demo_k02,demo_c01,CNY,400,20,4000,1,all,form_submit\n2026-10-01,demo_baidu,keyword,demo_k01,demo_c01,CNY,700,35,7000,3,all,form_submit\n2026-10-01,demo_baidu,keyword,demo_k02,demo_c01,CNY,500,25,5000,2,all,form_submit\n`,
};
function requireBody(body: Record<string, unknown> | undefined) { if (!body) throw new DomainError("INVALID_REQUEST", 400, "请求体不能为空"); return body; }
function dateOnly(value: unknown) { return (value instanceof Date ? value.toISOString() : String(value)).slice(0, 10); }
function reportProjection(row: Record<string, unknown>) { return { ...row, period_start: dateOnly(row.period_start), period_end: dateOnly(row.period_end) }; }
function inputWindow(ctx: ServiceContext, url: URL) {
  const yesterday = new Date(Date.parse(nowIso(ctx)) - 86400000);
  const fallback = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Shanghai", year: "numeric", month: "2-digit", day: "2-digit" }).format(yesterday);
  const start = url.searchParams.get("start") ?? url.searchParams.get("window_start") ?? fallback;
  const end = url.searchParams.get("end") ?? url.searchParams.get("window_end") ?? start;
  const connectionIds = url.searchParams.getAll("connection_id"); return { start, end, ...(connectionIds.length ? { connectionIds } : {}) };
}
async function importCsv(ctx: ServiceContext, objectKey: string) {
  if (ctx.mode === "mock" && fixtureCsv[objectKey]) return fixtureCsv[objectKey]!;
  // This key is populated by an authenticated upload/object-storage adapter, never a file/URL supplied here.
  const upload = (await ctx.db.query("SELECT value FROM settings WHERE org_id=$1 AND key=$2", [ctx.orgId, `import.upload:${objectKey}`])).rows[0]?.value as { csv?: unknown; mode?: unknown } | undefined;
  if (typeof upload?.csv === "string" && upload.mode === ctx.mode && Buffer.byteLength(upload.csv) <= 1024 * 1024) return upload.csv;
  throw new DomainError("UPLOAD_REQUIRED", 503, "上传对象尚未通过可信存储接入；不能将任意路径或URL作为来源");
}
function csvResponse(rows: unknown[][], mode: "mock" | "live") { const escape = (value: unknown) => { const text = String(value ?? ""); return `"${(/^[=+\-@\t\r]/.test(text) ? `'${text}` : text).replaceAll('"', '""')}"`; }; return new Response(`\uFEFF${rows.map((row) => row.map(escape).join(",")).join("\r\n")}`, { headers: { "Content-Type": "text/csv;charset=utf-8", "Content-Disposition": `attachment; filename="boran-${mode}-metrics.csv"`, "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff" } }); }

/** Auth, CSRF, body size and mutation idempotency are supplied by the root router. */
export async function handleAdsReporting(ctx: ServiceContext, request: Request, segments: string[], body?: Record<string, unknown>): Promise<Response | null> {
  const method = request.method; const path = segments.join("/"); const url = new URL(request.url);
  if (!["imports", "metrics", "metrics.csv", "reports", "geo", "metric-policies"].includes(segments[0] ?? "")) return null;
  await requireActiveRole(ctx, ctx.db, "owner", "marketer", ...(method === "GET" ? ["viewer"] : []));
  if (method === "GET" && path === "imports/fixtures") {
    if (ctx.mode !== "mock") throw new DomainError("MOCK_BOUNDARY", 409, "真实模式不可使用开发样例");
    return jsonData(Object.entries(fixtureCsv).map(([object_key, csv]) => ({ object_key, file_hash: createHash("sha256").update(csv).digest("hex"), mode: "mock", account_id: "demo_baidu", window_start: "2026-09-30", window_end: "2026-10-01" })), 200, { mode: ctx.mode });
  }
  if (method === "POST" && ["imports", "imports/preflight"].includes(path)) {
    const input = validateApiRequest("ImportCreate", requireBody(body));
    const csv = await importCsv(ctx, input.object_key);
    return databaseCommand(ctx, request, input, 201, (current) => preflightImport(current, { connectionId: input.connection_id, reportType: input.report_type, objectKey: input.object_key, fileHash: input.file_hash, windowStart: input.window_start, windowEnd: input.window_end, currency: input.currency, timezone: input.timezone, mapping: input.mapping, csv, sourceKind: "historical_import" }));
  }
  if (method === "GET" && segments[0] === "imports" && segments.length === 2) {
    const batch = (await ctx.db.query("SELECT * FROM ingestion_batches WHERE org_id=$1 AND id=$2 AND mapping->>'_mode'=$3", [ctx.orgId, segments[1], ctx.mode])).rows[0]; if (!batch) throw new DomainError("NOT_FOUND", 404, "导入批次不存在"); const mapping = batch.mapping as Record<string, unknown>; return jsonData({ ...batch, window_start: dateOnly(batch.window_start), window_end: dateOnly(batch.window_end), mapping: { fields: mapping.fields ?? {}, mode: mapping._mode, sourceKind: mapping._sourceKind, errors: mapping._errors ?? [] } }, 200, { mode: ctx.mode });
  }
  if (method === "POST" && segments[0] === "imports" && segments[2] === "commit" && segments.length === 3) {
    const input = validateApiRequest("ImportCommit", requireBody(body)); return databaseCommand(ctx, request, input, 200, (current) => commitImport(current, segments[1]!, { expectedFileHash: input.expected_file_hash, confirmCompleteWindow: input.confirm_complete_window, revisionPolicy: input.revision_policy }));
  }
  if (method === "GET" && ["metrics", "metrics.csv", "reports/csv"].includes(path)) {
    const metrics = await getAdMetrics(ctx, inputWindow(ctx, url));
    if (path !== "metrics" || url.searchParams.get("format") === "csv") return csvResponse([["模式", "账号", "币种", "日期", "花费minor", "展现", "点击", "平台转化", "质量"], ...metrics.accounts.flatMap((account) => account.daily.map((day) => [ctx.mode, account.accountName, account.currency, day.date, day.spendMinor, day.impressions, day.clicks, day.platformConversions, day.quality]))], ctx.mode);
    return jsonData(metrics, 200, { mode: ctx.mode, data_cutoff: metrics.dataCutoff });
  }
  if (method === "GET" && path === "reports") { const result = await getReports(ctx, { ...(url.searchParams.has("start") ? { start: url.searchParams.get("start")! } : {}), ...(url.searchParams.has("end") ? { end: url.searchParams.get("end")! } : {}) }); return jsonData({ ...result, reports: result.reports.map(reportProjection) }, 200, { mode: ctx.mode }); }
  if (method === "GET" && segments[0] === "reports" && segments.length === 2) {
    const report = (await ctx.db.query("SELECT * FROM report_snapshots WHERE org_id=$1 AND id=$2 AND body_json->>'mode'=$3", [ctx.orgId, segments[1], ctx.mode])).rows[0]; if (!report) throw new DomainError("NOT_FOUND", 404, "报告不存在"); return jsonData(reportProjection(report), 200, { mode: ctx.mode });
  }
  if (method === "POST" && ["reports", "reports/generate"].includes(path)) {
    const input = validateApiRequest("ReportGenerate", requireBody(body));
    return databaseCommand(ctx, request, input, 201, (current) => createReportSnapshot(current, { kind: input.kind, start: input.period_start, end: input.period_end, ...(input.connection_ids ? { connectionIds: input.connection_ids } : {}) }));
  }
  if (method === "POST" && path === "geo/observations") {
    const input = validateApiRequest("GeoObservation", requireBody(body)); return databaseCommand(ctx, request, input, 201, async (current) => { const result = await recordGeoObservation(current, { questionId: input.question_id, batchKey: input.batch_key, repetitionNo: input.repetition_no, platform: input.platform, productMode: input.product_mode, region: input.region, observedAt: input.observed_at, status: input.status, ...(input.model_version ? { modelVersion: input.model_version } : {}), ...(input.answer_text !== undefined ? { answerText: input.answer_text } : {}), ...(input.evidence_object_key ? { evidenceObjectKey: input.evidence_object_key } : {}), citations: input.citations ?? [] }); return { observation_id: result.id, duplicate: result.duplicate, mode: result.mode }; });
  }
  if (method === "GET" && path === "metric-policies/current") return jsonData(await getCurrentMetricPolicy(ctx), 200, { mode: ctx.mode });
  if (method === "POST" && path === "metric-policies/versions") {
    const input = validateApiRequest("MetricPolicyVersionCreate", requireBody(body)); return databaseCommand(ctx, request, input, 201, (current) => createMetricPolicyVersion(current, { dedupeWindowDays: input.dedupe_window_days, attributionWindowDays: input.attribution_window_days, cohortMaturationWindowDays: input.cohort_maturation_window_days, scoringMode: input.scoring_mode, scoringConfig: input.scoring_config, calibrationEvidenceRefs: input.calibration_evidence_refs, optimizationEnabled: input.optimization_enabled }));
  }
  if (method === "POST" && segments[0] === "metric-policies" && segments[2] === "approve" && segments.length === 3) {
    const input = validateApiRequest("MetricPolicyApprove", requireBody(body)); return databaseCommand(ctx, request, input, 200, (current) => approveMetricPolicy(current, segments[1]!, input.payload_hash));
  }
  return null;
}
