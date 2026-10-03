import { createHash } from "node:crypto";
import type { SqlExecutor } from "@boran/db";
import { DomainError, uuid, stableHash, nowIso, audit, emitOutbox } from "./core";
import type { ServiceContext } from "./core";
import { requireActiveRole } from "./authz";
import { claimExecutionAction, completeExecutionAction } from "./execution";

type RecordRow = Record<string, unknown>;
const reportLevels = { account_daily: "account", campaign_daily: "campaign", keyword_daily: "keyword", adgroup_daily: "adgroup", creative_daily: "creative", search_term_daily: "search_term" } as const;
export type AdReportType = keyof typeof reportLevels;
export type DataQuality = "complete" | "partial" | "stale" | "missing";
const currencies = new Set(["CNY", "USD", "EUR", "JPY", "GBP", "HKD", "SGD", "TWD", "AUD", "CAD"]);
const hashPattern = /^[a-f0-9]{64}$/;
function fail(code: string, message: string, details?: unknown): never { throw new DomainError(code, 422, message, details); }
export function validBusinessDate(value: string): boolean { return /^\d{4}-\d{2}-\d{2}$/.test(value) && !Number.isNaN(Date.parse(value)) && new Date(value).toISOString().slice(0, 10) === value; }
function sqlBusinessDate(value: unknown): string { return (value instanceof Date ? value.toISOString() : String(value)).slice(0, 10); }
export function datesInWindow(start: string, end: string): string[] {
  if (!validBusinessDate(start) || !validBusinessDate(end) || end < start) return fail("INVALID_WINDOW", "业务日期窗口无效");
  const days = (Date.parse(end) - Date.parse(start)) / 86400000 + 1;
  if (days > 366) return fail("INVALID_WINDOW", "单次窗口最多366天");
  return Array.from({ length: days }, (_, i) => new Date(Date.parse(start) + i * 86400000).toISOString().slice(0, 10));
}
function integer(value: unknown, field: string): number {
  if (typeof value === "string" && /^\d+$/.test(value)) value = Number(value);
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 0) return fail("INVALID_INTEGER", `${field}必须为非负安全整数`);
  return value;
}
function requiredString(value: unknown, field: string): string { if (typeof value !== "string" || !value.trim()) return fail("MISSING_FIELD", `${field}不能为空`); return value.trim(); }
function safeSum(values: number[], field: string): number { return integer(values.reduce((sum, value) => sum + value, 0), field); }
export function parseAdCsv(csv: string): RecordRow[] {
  const records: string[][] = []; let row: string[] = []; let cell = ""; let quoted = false;
  const text = csv.replace(/^\uFEFF/, "");
  for (let i = 0; i < text.length; i++) {
    const char = text[i]!;
    if (char === '"') { if (quoted && text[i + 1] === '"') { cell += '"'; i++; } else if (!quoted && cell.length) fail("INVALID_CSV", "引号必须位于字段开头"); else quoted = !quoted; }
    else if (char === "," && !quoted) { row.push(cell); cell = ""; }
    else if ((char === "\n" || char === "\r") && !quoted) { if (char === "\r" && text[i + 1] === "\n") i++; row.push(cell); if (row.some(Boolean)) records.push(row); row = []; cell = ""; }
    else cell += char;
  }
  if (quoted) fail("INVALID_CSV", "CSV引号未闭合");
  if (cell || row.length) { row.push(cell); records.push(row); }
  const headers = records.shift(); if (!headers || new Set(headers).size !== headers.length) return fail("INVALID_CSV", "CSV表头为空或重复");
  return records.map((values) => { if (values.length !== headers.length) return fail("INVALID_CSV", "CSV字段数与表头不同"); return Object.fromEntries(headers.map((key, index) => [key, values[index]])); });
}
type NormalizedAdRow = { date: string; entityLevel: string; entityId: string; parentId: string | null; currency: string; conversionDefinition: string; impressions: number; clicks: number; spendMinor: number; platformConversions: number | null; dimensions: RecordRow; dimensionHash: string };
function normalizeRow(row: RecordRow, input: ImportInput, account: string): NormalizedAdRow {
  const mapped = Object.fromEntries(Object.entries(row).map(([key, value]) => [input.mapping?.[key] ?? key, value]));
  const date = requiredString(mapped.business_date, "business_date");
  if (!validBusinessDate(date) || date < input.windowStart || date > input.windowEnd) fail("INVALID_DATE", "行日期不在有效窗口内");
  if (requiredString(mapped.account_id, "account_id") !== account) fail("ACCOUNT_MISMATCH", "行账号与来源连接不同");
  const entityLevel = requiredString(mapped.entity_level, "entity_level");
  if (entityLevel !== reportLevels[input.reportType]) fail("GRAIN_MISMATCH", "报表与实体粒度不符");
  const currency = requiredString(mapped.currency, "currency");
  if (!currencies.has(currency) || currency !== input.currency) fail("CURRENCY_MISMATCH", "未知币种或行币种不一致");
  const rawConversions = mapped.platform_conversions;
  const conversions = rawConversions === null || rawConversions === undefined || rawConversions === "" ? null : Number(rawConversions);
  if (conversions !== null && (!Number.isFinite(conversions) || conversions < 0 || conversions > Number.MAX_SAFE_INTEGER || !/^\d+(?:\.\d{1,4})?$/.test(String(rawConversions)))) fail("INVALID_CONVERSIONS", "平台转化必须为非负数或null");
  const dimensions: RecordRow = { device: requiredString(mapped.device, "device（缺维度请显式all）"), ...(typeof mapped.search_term === "string" ? { search_term: mapped.search_term } : {}) };
  return { date, entityLevel, entityId: requiredString(mapped.entity_id, "entity_id"), parentId: typeof mapped.parent_id === "string" && mapped.parent_id.trim() ? mapped.parent_id.trim() : null, currency, conversionDefinition: requiredString(mapped.conversion_definition, "conversion_definition"), impressions: integer(mapped.impressions, "impressions"), clicks: integer(mapped.clicks, "clicks"), spendMinor: integer(mapped.spend_minor, "spend_minor"), platformConversions: conversions, dimensions, dimensionHash: stableHash(dimensions) };
}
export interface ImportInput { connectionId: string; reportType: AdReportType; windowStart: string; windowEnd: string; currency: string; timezone: string; csv?: string; rows?: RecordRow[]; fileHash?: string; objectKey?: string; mapping?: Record<string, string>; sourceWatermark?: string; sourceKind?: "historical_import" | "connector"; }
export async function preflightImport(ctx: ServiceContext, input: ImportInput) {
  await requireActiveRole(ctx, ctx.db, "owner", "marketer"); datesInWindow(input.windowStart, input.windowEnd);
  if (!(input.reportType in reportLevels) || !currencies.has(input.currency)) fail("INVALID_IMPORT", "报表类型或币种不支持");
  try { new Intl.DateTimeFormat("en", { timeZone: input.timezone }); } catch { fail("INVALID_TIMEZONE", "来源时区无效"); }
  const rawRows = input.csv !== undefined ? parseAdCsv(input.csv) : input.rows;
  if (!rawRows || !rawRows.length || rawRows.length > 100000) fail("INVALID_IMPORT", "导入行数必须在1至100000之间");
  const fileHash = input.csv !== undefined ? createHash("sha256").update(input.csv).digest("hex") : stableHash(rawRows);
  if (input.fileHash !== undefined && input.fileHash !== fileHash) fail("HASH_MISMATCH", "原始内容hash与声明不符");
  const watermark = input.sourceWatermark ?? nowIso(ctx);
  if (!Number.isFinite(Date.parse(watermark))) fail("INVALID_WATERMARK", "来源水位无效");
  return ctx.db.transaction(async (tx) => {
    // Serialize one source's preflights, including the absent-row check, across real PG connections.
    const connection = (await tx.query("SELECT * FROM connections WHERE org_id=$1 AND id=$2 FOR UPDATE", [ctx.orgId, input.connectionId])).rows[0];
    if (!connection) throw new DomainError("NOT_FOUND", 404, "来源连接不存在");
    if (connection.currency !== input.currency || connection.timezone !== input.timezone) fail("CONNECTION_MISMATCH", "币种或时区与连接不一致");
    if (ctx.mode === "mock" && connection.read_mode !== "mock") fail("MODE_MISMATCH", "模拟数据只能导入隔离模拟连接");
    if (ctx.mode === "live" && connection.read_mode === "mock") fail("MODE_MISMATCH", "真实环境不可导入模拟连接");
    if (input.sourceKind === "connector" && ctx.mode === "live" && (connection.access_status !== "connected" || !connection.capabilities_verified_at)) throw new DomainError("INTEGRATION_REQUIRED", 503, "真实自动取数连接尚未验收");
    const existing = (await tx.query("SELECT * FROM ingestion_batches WHERE org_id=$1 AND connection_id=$2 AND report_type=$3 AND window_start=$4 AND window_end=$5 AND file_hash=$6", [ctx.orgId, input.connectionId, input.reportType, input.windowStart, input.windowEnd, fileHash])).rows[0];
    if (existing) {
      const existingMapping = existing.mapping as RecordRow;
      if (existingMapping._mode !== ctx.mode || existingMapping._sourceKind !== (input.sourceKind ?? "historical_import")) throw new DomainError("SOURCE_IDENTITY_CONFLICT", 409, "原批次模式与来源身份不可重标");
      const mappingChanged = stableHash(existingMapping.fields ?? {}) !== stableHash(input.mapping ?? {});
      if (mappingChanged && existing.state !== "rejected") throw new DomainError("MAPPING_CONFLICT", 409, "已预检通过或提交的批次不可重映射；须重新核对来源");
      // A rejected commit can be reconciled using an explicit newer source watermark before commit.
      // Committed contents and their original source evidence remain immutable.
      if (existing.state === "validated" && input.sourceWatermark !== undefined && Date.parse(watermark) > new Date(existing.source_watermark as string).getTime()) {
        await tx.query("UPDATE ingestion_batches SET source_watermark=$3,updated_at=now() WHERE org_id=$1 AND id=$2 AND state='validated'", [ctx.orgId, existing.id, watermark]);
        await audit(ctx, tx, "import.watermark_corrected", "ingestion_batch", String(existing.id), { previousWatermark: existing.source_watermark, sourceWatermark: watermark, fileHash, mode: ctx.mode });
      }
      if (!mappingChanged) return { id: String(existing.id), state: existing.state, quality: existing.quality, rowCount: Number(existing.row_count), errors: (existingMapping._errors ?? []) as { row: number; code: string; message: string }[], duplicate: true, fileHash, mode: ctx.mode };
    }
    const errors: { row: number; code: string; message: string }[] = []; const normalized: NormalizedAdRow[] = []; const keys = new Set<string>();
    rawRows.forEach((row, index) => { try { const parsed = normalizeRow(row, input, String(connection.account_external_id)); const key = stableHash([parsed.date, parsed.entityLevel, parsed.entityId, parsed.dimensionHash, parsed.currency, parsed.conversionDefinition]); if (keys.has(key)) fail("DUPLICATE_ROW", "同一自然键重复出现"); keys.add(key); normalized.push(parsed); } catch (error) { if (!(error instanceof DomainError)) throw error; errors.push({ row: index + 1, code: error.code, message: error.message }); } });
    const expectedDates = datesInWindow(input.windowStart, input.windowEnd); const covered = new Set(normalized.map((row) => row.date));
    if (new Set(normalized.map((row) => row.conversionDefinition)).size > 1) errors.push({ row: 0, code: "MIXED_CONVERSION_DEFINITION", message: "同一主报表不可混用多个转化口径" });
    const grainGroups = new Map<string, Set<unknown>>(); for (const row of normalized) { const key = `${row.date}:${row.entityId}`; const devices = grainGroups.get(key) ?? new Set(); devices.add(row.dimensions.device); grainGroups.set(key, devices); }
    if ([...grainGroups.values()].some((devices) => devices.has("all") && devices.size > 1)) errors.push({ row: 0, code: "OVERLAPPING_DIMENSIONS", message: "同一实体的all汇总不可与细分维度叠加" });
    const quality = errors.length || expectedDates.some((date) => !covered.has(date)) ? "partial" : "complete";
    const id = existing ? String(existing.id) : uuid(); const mapping = { fields: input.mapping ?? {}, _normalizedRows: normalized, _mode: ctx.mode, _sourceKind: input.sourceKind ?? "historical_import", _errors: errors };
    const sourceTotal = JSON.stringify({ spend_minor: safeSum(normalized.map((row) => row.spendMinor), "total_spend_minor") });
    if (existing) {
      await tx.query("UPDATE ingestion_batches SET mapping=$3,state=$4,quality=$5,row_count=$6,error_count=$7,source_total=$8,source_watermark=$9,updated_at=now() WHERE org_id=$1 AND id=$2 AND state='rejected'", [ctx.orgId, id, JSON.stringify(mapping), errors.length ? "rejected" : "validated", quality, rawRows.length, errors.length, sourceTotal, input.sourceWatermark !== undefined ? watermark : existing.source_watermark]);
      await audit(ctx, tx, "import.mapping_corrected", "ingestion_batch", id, { previousMappingHash: stableHash((existing.mapping as RecordRow).fields ?? {}), mappingHash: stableHash(input.mapping ?? {}), fileHash, mode: ctx.mode });
    } else await tx.query("INSERT INTO ingestion_batches(id,org_id,connection_id,report_type,window_start,window_end,file_hash,object_key,schema_version,mapping,state,quality,row_count,error_count,source_total,source_watermark) VALUES($1,$2,$3,$4,$5,$6,$7,$8,'1',$9,$10,$11,$12,$13,$14,$15)", [id, ctx.orgId, input.connectionId, input.reportType, input.windowStart, input.windowEnd, fileHash, input.objectKey ?? `isolated/${ctx.mode}/${fileHash}`, JSON.stringify(mapping), errors.length ? "rejected" : "validated", quality, rawRows.length, errors.length, sourceTotal, watermark]);
    await audit(ctx, tx, "import.preflight", "ingestion_batch", id, { mode: ctx.mode, quality, errors: errors.length });
    return { id, state: errors.length ? "rejected" : "validated", quality, rowCount: rawRows.length, errors, duplicate: false, fileHash, mode: ctx.mode };
  });
}
export async function commitImport(ctx: ServiceContext, id: string, input: { expectedFileHash: string; confirmCompleteWindow: boolean; revisionPolicy: "upsert_by_natural_key" }) {
  await requireActiveRole(ctx, ctx.db, "owner", "marketer");
  return ctx.db.transaction(async (tx) => {
    const candidate = (await tx.query("SELECT connection_id FROM ingestion_batches WHERE org_id=$1 AND id=$2", [ctx.orgId, id])).rows[0];
    if (!candidate) throw new DomainError("NOT_FOUND", 404, "导入批次不存在");
    // Keep source→batch lock ordering consistent with preflight and watermark correction.
    await tx.query("SELECT id FROM connections WHERE org_id=$1 AND id=$2 FOR UPDATE", [ctx.orgId, candidate.connection_id]);
    const batch = (await tx.query("SELECT * FROM ingestion_batches WHERE org_id=$1 AND id=$2 FOR UPDATE", [ctx.orgId, id])).rows[0]!;
    if (batch.file_hash !== input.expectedFileHash) throw new DomainError("HASH_MISMATCH", 409, "导入版本已变化");
    const mapping = batch.mapping as { _normalizedRows: NormalizedAdRow[]; _mode: string; _sourceKind: string };
    if (mapping._mode !== ctx.mode) fail("MODE_MISMATCH", "批次与执行模式不同");
    if (batch.state === "committed") return { id, state: "committed", duplicate: true, mode: ctx.mode };
    if (batch.state !== "validated" || input.revisionPolicy !== "upsert_by_natural_key") fail("INVALID_IMPORT_STATE", "只有预检通过的批次可按自然键提交");
    if (input.confirmCompleteWindow && batch.quality !== "complete") fail("INCOMPLETE_WINDOW", "缺少日期的批次不能确认为完整");
    const previous = (await tx.query("SELECT * FROM ad_daily_facts WHERE org_id=$1 AND connection_id=$2 AND report_type=$3 AND business_date BETWEEN $4 AND $5 FOR UPDATE", [ctx.orgId, batch.connection_id, batch.report_type, batch.window_start, batch.window_end])).rows;
    for (const row of mapping._normalizedRows) {
      const same = previous.find((fact) => sqlBusinessDate(fact.business_date) === row.date && fact.entity_external_id === row.entityId && fact.entity_level === row.entityLevel && fact.dimension_hash === row.dimensionHash && fact.currency === row.currency && fact.conversion_definition === row.conversionDefinition);
      if (same && new Date(same.source_updated_at as string).getTime() === new Date(batch.source_watermark as string).getTime() && (Number(same.spend_minor) !== row.spendMinor || Number(same.clicks) !== row.clicks || Number(same.impressions) !== row.impressions || (same.platform_conversions === null ? null : Number(same.platform_conversions)) !== row.platformConversions)) throw new DomainError("SOURCE_WATERMARK_CONFLICT", 409, "同来源水位有不同数据，须对账后提供新修订水位");
    }
    for (const row of mapping._normalizedRows) {
      await tx.query(`INSERT INTO ad_daily_facts(id,org_id,connection_id,business_date,report_type,entity_level,entity_external_id,parent_external_id,dimensions_json,dimension_hash,currency,conversion_definition,impressions,clicks,spend_minor,platform_conversions,ingestion_batch_id,source_updated_at,is_final)
      VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19)
      ON CONFLICT(org_id,connection_id,business_date,report_type,entity_level,entity_external_id,dimension_hash,currency,conversion_definition) DO UPDATE SET parent_external_id=EXCLUDED.parent_external_id,impressions=EXCLUDED.impressions,clicks=EXCLUDED.clicks,spend_minor=EXCLUDED.spend_minor,platform_conversions=EXCLUDED.platform_conversions,ingestion_batch_id=EXCLUDED.ingestion_batch_id,source_updated_at=EXCLUDED.source_updated_at,is_final=EXCLUDED.is_final,updated_at=now() WHERE ad_daily_facts.source_updated_at < EXCLUDED.source_updated_at`, [uuid(), ctx.orgId, batch.connection_id, row.date, batch.report_type, row.entityLevel, row.entityId, row.parentId, JSON.stringify(row.dimensions), row.dimensionHash, row.currency, row.conversionDefinition, row.impressions, row.clicks, row.spendMinor, row.platformConversions, id, batch.source_watermark, input.confirmCompleteWindow]);
    }
    await tx.query("UPDATE ingestion_batches SET state='committed',complete_confirmed_by=$3,updated_at=now() WHERE org_id=$1 AND id=$2", [ctx.orgId, id, input.confirmCompleteWindow ? ctx.actorId : null]);
    await audit(ctx, tx, "import.commit", "ingestion_batch", id, { mode: ctx.mode, rows: mapping._normalizedRows.length });
    await emitOutbox(ctx, tx, "metrics.changed", id, { batchId: id, mode: ctx.mode });
    return { id, state: "committed", duplicate: false, mode: ctx.mode };
  });
}
export interface AdMetricsInput { start: string; end: string; connectionIds?: string[]; staleAfterMs?: number; }
export async function getAdMetrics(ctx: ServiceContext, input: AdMetricsInput) {
  await requireActiveRole(ctx, ctx.db, "owner", "marketer", "viewer"); const dates = datesInWindow(input.start, input.end);
  const connections = (await ctx.db.query("SELECT * FROM connections WHERE org_id=$1 AND enabled_for_reporting=true ORDER BY id", [ctx.orgId])).rows.filter((connection) => (!input.connectionIds || input.connectionIds.includes(String(connection.id))) && (ctx.mode === "mock" ? connection.read_mode === "mock" : connection.read_mode !== "mock"));
  if (input.connectionIds?.some((id) => !connections.some((connection) => connection.id === id))) throw new DomainError("NOT_FOUND", 404, "连接不可见、未启用或模式不匹配");
  const facts = (await ctx.db.query("SELECT f.*,b.mapping,b.quality AS batch_quality FROM ad_daily_facts f JOIN ingestion_batches b ON b.org_id=f.org_id AND b.id=f.ingestion_batch_id WHERE f.org_id=$1 AND f.business_date BETWEEN $2 AND $3 AND b.state='committed'", [ctx.orgId, input.start, input.end])).rows;
  const byConnection = connections.map((connection) => {
    const authoritative = String(connection.authoritative_report_type ?? ""); const modeFacts = facts.filter((fact) => fact.connection_id === connection.id && fact.report_type === authoritative && (fact.mapping as RecordRow)._mode === ctx.mode);
    const daily = dates.map((date) => {
      const candidates = modeFacts.filter((row) => sqlBusinessDate(row.business_date) === date);
      const rows = candidates.filter((row) => (row.dimensions_json as RecordRow).device === "all" || !candidates.some((other) => other.entity_external_id === row.entity_external_id && (other.dimensions_json as RecordRow).device === "all"));
      if (!rows.length) return { date, quality: "missing" as DataQuality, spendMinor: null, impressions: null, clicks: null, platformConversions: null };
      if (new Set(rows.map((row) => row.conversion_definition)).size !== 1) return { date, quality: "partial" as DataQuality, spendMinor: null, impressions: null, clicks: null, platformConversions: null };
      const stale = rows.some((row) => Date.parse(nowIso(ctx)) - Date.parse(String(row.source_updated_at)) > (input.staleAfterMs ?? 48 * 3600000));
      const quality: DataQuality = stale ? "stale" : rows.some((row) => !row.is_final || row.batch_quality !== "complete") ? "partial" : "complete";
      return { date, quality, spendMinor: safeSum(rows.map((row) => Number(row.spend_minor)), "spend_minor"), impressions: safeSum(rows.map((row) => Number(row.impressions)), "impressions"), clicks: safeSum(rows.map((row) => Number(row.clicks)), "clicks"), platformConversions: rows.some((row) => row.platform_conversions === null) ? null : rows.reduce((sum, row) => sum + Number(row.platform_conversions), 0) };
    });
    const known = daily.filter((day) => day.spendMinor !== null); const complete = daily.every((day) => day.quality === "complete");
    const observedSpendMinor = known.length ? safeSum(known.map((day) => day.spendMinor!), "spend_minor") : null;
    const observedClicks = known.length ? safeSum(known.map((day) => day.clicks!), "clicks") : null;
    const observedImpressions = known.length ? safeSum(known.map((day) => day.impressions!), "impressions") : null;
    const quality: DataQuality = !known.length ? "missing" : daily.some((day) => day.quality === "missing" || day.quality === "partial") ? "partial" : daily.some((day) => day.quality === "stale") ? "stale" : "complete";
    return { connectionId: String(connection.id), accountName: String(connection.display_name), currency: String(connection.currency), authoritativeReportType: authoritative, quality, daily, observedSpendMinor, spendMinor: complete ? observedSpendMinor : null, clicks: complete ? observedClicks : null, impressions: complete ? observedImpressions : null, ctr: complete && observedImpressions ? observedClicks! / observedImpressions : null, cpcMinor: complete && observedClicks ? observedSpendMinor! / observedClicks : null, platformConversions: complete && daily.every((day) => day.platformConversions !== null) ? daily.reduce((sum, day) => sum + day.platformConversions!, 0) : null, batchIds: [...new Set(modeFacts.map((row) => String(row.ingestion_batch_id)))], sourceWatermark: modeFacts.length ? new Date(Math.max(...modeFacts.map((row) => Date.parse(String(row.source_updated_at))))).toISOString() : null, sourceKinds: [...new Set(modeFacts.map((row) => String((row.mapping as RecordRow)._sourceKind)))], realLeads: null, paidCplMinor: null, optimizationEligible: false };
  });
  const currencySet = new Set(byConnection.map((row) => row.currency)); const complete = byConnection.length > 0 && byConnection.every((row) => row.quality === "complete");
  return { mode: ctx.mode, start: input.start, end: input.end, quality: !byConnection.length || byConnection.every((row) => row.quality === "missing") ? "missing" : complete ? "complete" : "partial", currency: currencySet.size === 1 ? [...currencySet][0] : null, spendMinor: complete && currencySet.size === 1 ? safeSum(byConnection.map((row) => row.spendMinor!), "spend_minor") : null, dataCutoff: nowIso(ctx), accounts: byConnection, batchIds: [...new Set(byConnection.flatMap((row) => row.batchIds))], attribution: { status: "unavailable", paidCplMinor: null, reason: "必须另行配置批准归因窗口、成熟期及同cohort真实线索，平台转化不替代线索" } };
}
export const getMetrics = getAdMetrics;

export type AdsEntityLevel = "account" | "campaign" | "unit" | "keyword" | "negative_keyword" | "creative";
export type AdsPayload = { operation: "create" | "update" | "enable" | "pause"; entity_level: AdsEntityLevel; changes: { field: string; value: unknown }[]; expected_before_hash: string };
const allowedFields = new Set(["name", "daily_budget_minor", "bid_minor", "enabled", "keyword", "negative_keyword", "match_type", "title", "description", "landing_url", "region_ids", "time_windows", "content_version_id"]);
export function validateAdsPayload(value: unknown): asserts value is AdsPayload {
  if (!value || typeof value !== "object" || Array.isArray(value)) fail("INVALID_ADS_PAYLOAD", "广告载荷必须为对象"); const payload = value as AdsPayload;
  if (Object.keys(payload).some((key) => !["operation", "entity_level", "changes", "expected_before_hash"].includes(key)) || !["create", "update", "enable", "pause"].includes(payload.operation) || !["account", "campaign", "unit", "keyword", "negative_keyword", "creative"].includes(payload.entity_level) || !hashPattern.test(payload.expected_before_hash)) fail("INVALID_ADS_PAYLOAD", "广告动作类型、实体或hash无效");
  if (!Array.isArray(payload.changes) || !payload.changes.length || payload.changes.length > 100 || payload.changes.some((change) => !change || typeof change !== "object" || typeof change.field !== "string" || !("value" in change)) || new Set(payload.changes.map((change) => change.field)).size !== payload.changes.length) fail("INVALID_ADS_PAYLOAD", "广告变更不能为空、缺字段或重复");
  for (const change of payload.changes) {
    if (!allowedFields.has(change.field) || Object.keys(change).some((key) => !["field", "value"].includes(key))) fail("FIELD_NOT_ALLOWED", "未知广告字段");
    if (["daily_budget_minor", "bid_minor"].includes(change.field)) { if (typeof change.value !== "number") fail("INVALID_INTEGER", "广告金额须使用整数minor而非字符串"); integer(change.value, change.field); }
    else if (change.field === "enabled") { if (typeof change.value !== "boolean") fail("INVALID_FIELD", "enabled必须为boolean"); }
    else if (change.field === "landing_url") { let url: URL; try { url = new URL(requiredString(change.value, change.field)); } catch { return fail("INVALID_URL", "落地页地址无效"); } if (url.protocol !== "https:" || url.username || url.password) fail("INVALID_URL", "落地页须为无凭据HTTPS地址"); }
    else if (["region_ids", "time_windows"].includes(change.field)) { if (!Array.isArray(change.value) || !change.value.length) fail("INVALID_FIELD", "地域或时间窗口必须非空"); }
    else if (change.field === "match_type") { if (!["exact", "phrase", "broad"].includes(String(change.value))) fail("INVALID_FIELD", "匹配方式不支持"); }
    else requiredString(change.value, change.field);
  }
  if (payload.operation === "pause" && payload.changes.some((change) => change.field !== "enabled" || change.value !== false)) fail("INVALID_ADS_PAYLOAD", "pause仅允许enabled=false");
  if (payload.operation === "enable" && payload.changes.some((change) => change.field !== "enabled" || change.value !== true)) fail("INVALID_ADS_PAYLOAD", "enable仅允许enabled=true");
}
export function assertNegativeKeywordSafety(input: { phrase: string; observedSearchTerms: string[]; matchType: "phrase" | "exact"; scope: "unit" | "account"; accountScopeApproved?: boolean; quality: DataQuality; observationWindowApproved: boolean; protectedKeywords?: string[] }) {
  const phrase = input.phrase.normalize("NFKC").trim().replace(/\s+/g, " ");
  if (!phrase || input.quality !== "complete" || !input.observationWindowApproved || !["phrase", "exact"].includes(input.matchType) || !input.observedSearchTerms.some((term) => term.normalize("NFKC").trim().replace(/\s+/g, " ") === phrase)) fail("NEGATIVE_KEYWORD_EVIDENCE_REQUIRED", "否词需完整真实搜索短语、批准窗口及完整数据");
  if (input.scope === "account" && !input.accountScopeApproved) fail("ACCOUNT_NEGATIVE_NOT_AUTHORIZED", "账户级否词需显式授权");
  if (/^(安装|登录|接口|权限|备份|源码|发票|合同|预算|CRM)$/i.test(phrase) || /(价格|比价|供应商|选型|实施|升级|迁移|集成|运维|开发|单点登录|上海哪家|太贵)/i.test(phrase) || input.protectedKeywords?.some((keyword) => phrase === keyword.normalize("NFKC").trim())) fail("PROTECTED_BUSINESS_INTENT", "不得泛否业务词根或有效商业意图");
  return phrase;
}
export function assertAdsPolicyGate(payload: AdsPayload, policy: RecordRow, evidence: { currency: string; dailySpendMinor: number | null; totalSpendMinor: number | null; quality: DataQuality; nativeBudgetMinor: number | null; before: RecordRow }) {
  validateAdsPayload(payload);
  if (!(policy.allowed_ad_operations as string[] | undefined)?.includes(payload.operation) || !(policy.allowed_ad_entity_levels as string[] | undefined)?.includes(payload.entity_level)) fail("POLICY_SCOPE_MISMATCH", "广告子操作或实体不在规则白名单");
  if (policy.currency !== evidence.currency || evidence.quality !== "complete" || evidence.dailySpendMinor === null || evidence.totalSpendMinor === null || evidence.nativeBudgetMinor === null) fail("BUDGET_EVIDENCE_REQUIRED", "需真实同币种近期花费及原生预算控制");
  const dailyLimit = integer(policy.daily_budget_minor, "daily_budget_minor"); const totalLimit = integer(policy.total_budget_minor, "total_budget_minor");
  if (payload.operation !== "pause" && (evidence.dailySpendMinor >= dailyLimit || evidence.totalSpendMinor >= totalLimit)) fail("BUDGET_LIMIT_REACHED", "已达到批准预算，停止新动作");
  for (const change of payload.changes) {
    if (change.field === "daily_budget_minor" && Number(change.value) > Math.min(dailyLimit, evidence.nativeBudgetMinor)) fail("BUDGET_EXPANSION_NOT_AUTHORIZED", "目标预算超过批准或原生上限");
    if (change.field === "bid_minor") { const beforeBid = Number(evidence.before.bid_minor); const maxPct = Number(policy.max_bid_change_pct); if (!Number.isFinite(beforeBid) || beforeBid <= 0 || policy.max_bid_change_pct === null || !Number.isFinite(maxPct) || Math.abs(Number(change.value) - beforeBid) / beforeBid * 100 > maxPct) fail("BID_CHANGE_NOT_AUTHORIZED", "调价幅度超规则或缺原值"); }
    if (change.field === "region_ids") { const regions = (policy.business_scope as RecordRow)?.region_ids; if (!Array.isArray(regions) || (change.value as unknown[]).some((region) => !regions.includes(region))) fail("REGION_NOT_AUTHORIZED", "付费地域不得扩张"); }
    if (change.field === "time_windows") { const windows = (policy.business_scope as RecordRow)?.time_windows; if (!Array.isArray(windows) || (change.value as unknown[]).some((window) => !windows.some((allowed) => stableHash(allowed) === stableHash(window)))) fail("SCHEDULE_NOT_AUTHORIZED", "广告时段不得扩张批准规则"); }
  }
}
export interface BaiduExecutionAdapter { mode: "mock" | "live"; capabilitiesVerified: boolean; read(target: RecordRow): Promise<RecordRow>; verifyLanding?(url: string): Promise<{ healthy: boolean; mobileCaptureVerified: boolean; evidenceRef: string }>; write(input: { actionId: string; idempotencyKey: string; target: RecordRow; payload: AdsPayload }): Promise<{ externalId?: string; status: "submitted" | "unknown" }>; readback(input: { target: RecordRow; receipt: { externalId?: string; status: "submitted" | "unknown" }; payload: AdsPayload }): Promise<{ verified: boolean; state: RecordRow; evidenceRef: string }> }
/** Internal orchestration only: never expose a client-supplied readiness proof. */
export async function refreshBaiduReadiness(ctx: ServiceContext, accountId: string, adapter: BaiduExecutionAdapter) {
  await requireActiveRole(ctx, ctx.db, "owner", "marketer");
  if (adapter.mode !== ctx.mode || !adapter.capabilitiesVerified) throw new DomainError("INTEGRATION_REQUIRED", 503, "百度原生预算控制尚未验证");
  const account = (await ctx.db.query("SELECT a.*,c.currency,c.access_status,c.read_mode FROM platform_accounts a JOIN connections c ON c.org_id=a.org_id AND c.id=a.connection_id WHERE a.org_id=$1 AND a.id=$2", [ctx.orgId, accountId])).rows[0];
  if (!account || (ctx.mode === "live" && (!account.enabled || account.session_status !== "active" || account.access_status !== "connected" || account.read_mode === "mock"))) throw new DomainError("INTEGRATION_REQUIRED", 503, "账号未通过真实接通");
  const policy = (await ctx.db.query("SELECT v.* FROM policy_versions v JOIN execution_policies p ON p.org_id=v.org_id AND p.id=v.policy_id WHERE v.org_id=$1 AND p.status='active' AND p.active_version_id=v.id AND $2=ANY(v.account_ids) AND ('ads.update'=ANY(v.allowed_actions) OR 'ads.pause'=ANY(v.allowed_actions)) ORDER BY v.created_at DESC LIMIT 1", [ctx.orgId, accountId])).rows[0];
  const period = (policy?.business_scope as RecordRow | undefined)?.budget_period as { start?: string; end?: string } | undefined;
  if (!period?.start || !period.end) fail("BUDGET_PERIOD_REQUIRED", "未配置固定预算窗口");
  const metrics = await getAdMetrics(ctx, { start: period.start, end: period.end, connectionIds: [String(account.connection_id)] }); const data = metrics.accounts[0]!;
  if (data.quality !== "complete" || (ctx.mode === "live" && (data.sourceKinds.length !== 1 || data.sourceKinds[0] !== "connector"))) fail("BUDGET_EVIDENCE_REQUIRED", "需完整真实自动采集花费");
  const before = await adapter.read({ accountId, platform_account_id: accountId, connection_id: account.connection_id, external_resource_id: account.account_external_id });
  const nativeDaily = integer(before.native_daily_budget_minor ?? before.daily_budget_minor, "native_daily_budget_minor"); const nativeTotal = integer(before.native_total_budget_minor ?? before.total_budget_minor, "native_total_budget_minor");
  const date = new Intl.DateTimeFormat("en-CA", { timeZone: String(account.timezone), year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date(nowIso(ctx)));
  const day = data.daily.find((item) => item.date === date); if (day?.quality !== "complete") fail("BUDGET_EVIDENCE_REQUIRED", "今日花费缺失");
  if (typeof account.adapter_version !== "string" || !account.adapter_version || before.adapter_version !== account.adapter_version) fail("ADAPTER_VERSION_MISMATCH", "预算回读必须绑定实际已核验账号适配版本");
  const value = { source_batch_ids: data.batchIds, spend_cutoff: data.sourceWatermark, daily_spend_minor: day.spendMinor, total_spend_minor: data.spendMinor, native_daily_budget_minor: nativeDaily, native_total_budget_minor: nativeTotal, control_verified: true, verified_at: nowIso(ctx), adapter_version: account.adapter_version, connection_id: account.connection_id, currency: data.currency, mode: ctx.mode };
  await ctx.db.transaction(async (tx) => { await tx.query("INSERT INTO settings(id,org_id,key,value,schema_version,updated_by) VALUES($1,$2,$3,$4,1,$5) ON CONFLICT(org_id,key) DO UPDATE SET value=EXCLUDED.value,updated_by=EXCLUDED.updated_by,updated_at=now()", [uuid(), ctx.orgId, `ads.readiness:${accountId}`, JSON.stringify(value), ctx.actorId]); await audit(ctx, tx, "ads.readiness_refreshed", "platform_account", accountId, { mode: ctx.mode, batchIds: data.batchIds }); });
  return value;
}
export async function executeBaiduAction(ctx: ServiceContext, actionId: string, adapter: BaiduExecutionAdapter) {
  await requireActiveRole(ctx, ctx.db, "owner", "marketer");
  if (adapter.mode !== ctx.mode || (ctx.mode === "live" && !adapter.capabilitiesVerified)) throw new DomainError("INTEGRATION_REQUIRED", 503, "真实百度写入适配器尚未实测");
  const action = (await ctx.db.query("SELECT * FROM execution_actions WHERE org_id=$1 AND id=$2", [ctx.orgId, actionId])).rows[0];
  if (!action) throw new DomainError("NOT_FOUND", 404, "执行动作不存在");
  if (action.state === "succeeded") return { actionId, state: "succeeded", duplicate: true, mode: ctx.mode };
  if (["unknown", "executing", "submitted", "waiting_review", "verification_pending"].includes(String(action.state))) throw new DomainError("RECONCILIATION_REQUIRED", 409, "未知或已提交动作必须先对账");
  if (!["queued", "retry_wait"].includes(String(action.state)) || !["ads.update", "ads.pause"].includes(String(action.action_type)) || !action.policy_version_id || action.approval_id) fail("ACTION_NOT_EXECUTABLE", "需要已持久化的规则内百度动作；例外须经授权执行服务解析");
  const payload = action.payload; validateAdsPayload(payload);
  if (stableHash(payload) !== action.payload_hash) throw new DomainError("HASH_MISMATCH", 409, "动作载荷hash不一致");
  if (action.action_type === "ads.pause" && payload.operation !== "pause") fail("ACTION_NOT_EXECUTABLE", "ads.pause不可执行其他子动作");
  const target: RecordRow = { ...(action.target as RecordRow), accountId: (action.target as RecordRow).platform_account_id }; const connectionId = requiredString(target.connection_id, "connection_id");
  const account = (await ctx.db.query("SELECT * FROM platform_accounts WHERE org_id=$1 AND connection_id=$2 AND id=$3", [ctx.orgId, connectionId, target.platform_account_id])).rows[0];
  if (!account || (ctx.mode === "live" && (!account.enabled || account.session_status !== "active"))) throw new DomainError("INTEGRATION_REQUIRED", 503, "百度目标账号未接通");
  const before = await adapter.read(target);
  if (stableHash(before) !== payload.expected_before_hash) throw new DomainError("BEFORE_STATE_CHANGED", 409, "百度原状态已变化");
  const policy = (await ctx.db.query("SELECT v.* FROM policy_versions v JOIN execution_policies p ON p.org_id=v.org_id AND p.id=v.policy_id WHERE v.org_id=$1 AND v.id=$2 AND p.active_version_id=v.id AND p.status='active'", [ctx.orgId, action.policy_version_id])).rows[0];
  if (!policy || !policy.approved_by || Date.parse(String(policy.valid_from)) > Date.parse(nowIso(ctx)) || (policy.valid_until && Date.parse(String(policy.valid_until)) <= Date.parse(nowIso(ctx))) || !(policy.account_ids as string[]).includes(String(account.id)) || !(policy.allowed_actions as string[]).includes(String(action.action_type))) fail("POLICY_NOT_ACTIVE", "持续规则失效、收紧或账号超范围");
  const period = (policy.business_scope as RecordRow).budget_period as { start?: string; end?: string } | undefined;
  if (!period?.start || !period.end) fail("BUDGET_PERIOD_REQUIRED", "累计预算需明确固定消费窗口");
  const metrics = await getAdMetrics(ctx, { start: period.start!, end: period.end!, connectionIds: [connectionId] }); const accountMetrics = metrics.accounts[0]!;
  const businessDate = new Intl.DateTimeFormat("en-CA", { timeZone: String(account.timezone), year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date(nowIso(ctx)));
  const day = accountMetrics.daily.find((row) => row.date === businessDate);
  assertAdsPolicyGate(payload, policy, { currency: accountMetrics.currency, dailySpendMinor: day?.spendMinor ?? null, totalSpendMinor: accountMetrics.spendMinor, quality: accountMetrics.quality, nativeBudgetMinor: typeof before.daily_budget_minor === "number" ? before.daily_budget_minor : null, before });
  const negativeChange = payload.changes.find((change) => change.field === "negative_keyword");
  if (negativeChange) {
    const negativeScope = before.entity_level === "account" || target.external_resource_id === account.account_external_id ? "account" : "unit";
    const rule = (policy.business_scope as RecordRow).negative_keyword_rule as { window_start?: string; window_end?: string; match_type?: "phrase" | "exact"; account_scope_approved?: boolean; protected_keywords?: string[] } | undefined;
    if (!rule?.window_start || !rule.window_end || !rule.match_type) fail("NEGATIVE_KEYWORD_EVIDENCE_REQUIRED", "否词需批准的实际搜索词窗口");
    const terms = (await ctx.db.query("SELECT f.*,b.mapping,b.quality FROM ad_daily_facts f JOIN ingestion_batches b ON b.org_id=f.org_id AND b.id=f.ingestion_batch_id WHERE f.org_id=$1 AND f.connection_id=$2 AND f.report_type='search_term_daily' AND f.business_date BETWEEN $3 AND $4 AND b.state='committed'", [ctx.orgId, connectionId, rule.window_start, rule.window_end])).rows;
    const scopedTerms = negativeScope === "account" ? terms : terms.filter((row) => row.parent_external_id === target.external_resource_id);
    const complete = scopedTerms.length > 0 && scopedTerms.every((row) => row.is_final && row.quality === "complete" && (row.mapping as RecordRow)._mode === ctx.mode && (ctx.mode === "mock" || (row.mapping as RecordRow)._sourceKind === "connector"));
    const match = payload.changes.find((change) => change.field === "match_type")?.value ?? rule.match_type;
    if (match !== rule.match_type) fail("NEGATIVE_KEYWORD_EVIDENCE_REQUIRED", "否词匹配方式不在批准规则内");
    assertNegativeKeywordSafety({ phrase: String(negativeChange.value), observedSearchTerms: scopedTerms.map((row) => String((row.dimensions_json as RecordRow).search_term ?? "")), matchType: rule.match_type, scope: negativeScope, accountScopeApproved: rule.account_scope_approved ?? false, quality: complete ? "complete" : "partial", observationWindowApproved: true, protectedKeywords: rule.protected_keywords ?? [] });
  }
  if (payload.changes.some((change) => ["title", "description"].includes(change.field))) {
    const versionId = action.version_id ?? payload.changes.find((change) => change.field === "content_version_id")?.value;
    if (typeof versionId !== "string") fail("CREATIVE_EVIDENCE_REQUIRED", "广告创意必须绑定通过质检的不可变内容版本");
    const version = (await ctx.db.query("SELECT * FROM content_versions WHERE org_id=$1 AND id=$2 AND review_status='approved'", [ctx.orgId, versionId])).rows[0];
    if (!version || stableHash(version.body_json) !== version.payload_hash) fail("CREATIVE_EVIDENCE_REQUIRED", "创意内容版本未核验或已变化");
    const copy = version.body_json as RecordRow;
    for (const change of payload.changes.filter((item) => ["title", "description"].includes(item.field))) if (change.value !== (change.field === "title" ? copy.title : copy.description ?? copy.body)) fail("CREATIVE_COPY_MISMATCH", "创意必须与已质检版本精确一致");
    const claimIds = version.claim_ids as string[];
    const claims = claimIds.length ? (await ctx.db.query("SELECT * FROM evidence_claims WHERE org_id=$1 AND id=ANY($2::uuid[])", [ctx.orgId, claimIds])).rows : [];
    if (claims.length !== claimIds.length || claims.some((claim) => claim.verification_status !== "verified" || claim.assertion_type !== "fact" || claim.visibility !== "public" || claim.public_permission !== "allowed" || !claim.permission_evidence_ref || (claim.valid_until && Date.parse(String(claim.valid_until)) <= Date.parse(nowIso(ctx))))) fail("CREATIVE_FACTS_NOT_PUBLIC", "创意引用事实缺许可、被撤销或过期");
  }
  const landing = payload.changes.find((change) => change.field === "landing_url");
  if (landing) {
    const domain = new URL(String(landing.value)).hostname; const approved = (policy.business_scope as RecordRow).landing_domains;
    if (!Array.isArray(approved) || !approved.includes(domain)) fail("LANDING_DOMAIN_NOT_AUTHORIZED", "落地页主机不在当前规则内");
    const health = await adapter.verifyLanding?.(String(landing.value));
    if (!health?.healthy || !health.mobileCaptureVerified || !health.evidenceRef) fail("LANDING_NOT_VERIFIED", "落地页与移动留资必须实际验证");
  }
  if (ctx.mode === "live") await refreshBaiduReadiness(ctx, String(account.id), adapter);
  const claim = await claimExecutionAction(ctx, actionId, `baidu:${uuid()}`, 60);
  try {
    const receipt = await adapter.write({ actionId, idempotencyKey: String(action.idempotency_key), target, payload });
    const readback = await adapter.readback({ target, receipt, payload });
    const matched = readback.verified && !!readback.evidenceRef && payload.changes.every((change) => stableHash(readback.state[change.field] ?? null) === stableHash(change.value));
    const state = matched ? ctx.mode === "live" ? "succeeded" : "verification_pending" : "unknown";
    await completeExecutionAction(ctx, actionId, claim.token, { state, afterSnapshot: readback.state, ...(receipt.externalId ? { externalId: receipt.externalId } : {}), evidence: { ref: readback.evidenceRef, mode: ctx.mode, mockVerified: ctx.mode === "mock" && matched } });
    return { actionId, state, mode: ctx.mode, verified: matched, realAcceptance: ctx.mode === "live" && matched };
  } catch { try { await completeExecutionAction(ctx, actionId, claim.token, { state: "unknown", evidence: { code: "EXTERNAL_RESULT_UNKNOWN", mode: ctx.mode } }); } catch (error) { if (!(error instanceof DomainError) || error.code !== "STALE_LEASE") throw error; } return { actionId, state: "unknown", mode: ctx.mode, verified: false, realAcceptance: false }; }
}
