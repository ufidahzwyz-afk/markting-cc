// API projections only. Historical examples are imported by an explicit server command.
export type Quality = "complete" | "partial" | "stale" | "missing";
export type Metric = "spend" | "impressions" | "clicks" | "platformConversions";
export type Counts = Record<Metric, number | null> & { currency: string | null };
export type DailyMetric = { date: string; quality: Quality; spendMinor: number | null; impressions: number | null; clicks: number | null; platformConversions: number | null };
export type AccountMetrics = {
  connectionId: string; accountName: string; currency: string; authoritativeReportType: string;
  quality: Quality; daily: DailyMetric[]; spendMinor: number | null; impressions: number | null;
  clicks: number | null; platformConversions: number | null; batchIds: string[];
  sourceWatermark: string | null; sourceKinds: string[];
};
export type MetricsResponse = { mode: "mock" | "live"; start: string; end: string; quality: Quality; currency: string | null; dataCutoff: string; accounts: AccountMetrics[]; batchIds: string[] };
export type Connection = { id: string; provider: string; display_name: string; read_mode: string; currency: string; timezone: string; enabled_for_reporting: boolean; access_status: string; last_success_at: string | null };
export type ImportFixture = { object_key: string; file_hash: string; account_id: string; mode: "mock"; window_start: string; window_end: string };
export type ImportPreflight = { id: string; state: string; quality: Quality; rowCount: number; errors: { row: number; code: string; message: string }[]; duplicate: boolean; fileHash: string; mode: "mock" | "live" };
export type ReportNotification = { id: string; report_id: string; channel: "in_app"; status: string; created_at: string; sent_at: string | null; kind: "daily" | "weekly"; period_start: string; period_end: string; revision: number; quality: Quality; read: boolean; mode: "mock" | "live"; external_delivery_paused?: boolean };
export type ReportSnapshot = { id: string; kind: "daily" | "weekly"; period_start: string; period_end: string; revision: number; quality: Quality; source_batch_ids: string[]; data_cutoff: string; metrics_json: MetricsResponse; body_json: { mode?: string; facts?: unknown; actions?: unknown; dataGaps?: { accountName?: string; quality?: Quality }[] } };
export type DailyRow = Counts & { date: string; quality: Quality };
export const missingCounts = (): Counts => ({ spend: null, impressions: null, clicks: null, platformConversions: null, currency: null });
export const qualityLabels: Record<Quality, string> = { complete: "完整", partial: "不完整", stale: "已过期", missing: "未采集" };
export const sourceLabel = (kinds: string[]) => kinds.includes("historical_import") ? "历史导入" : kinds.includes("connector") ? "连接采集" : "未采集";
export function accountCounts(account: AccountMetrics, date?: string): Counts {
  if (date) {
    const row = account.daily.find(day => day.date === date);
    if (!row || row.quality !== "complete") return { ...missingCounts(), currency: account.currency };
    return { spend: row.spendMinor === null ? null : row.spendMinor / 100, impressions: row.impressions, clicks: row.clicks, platformConversions: row.platformConversions, currency: account.currency };
  }
  return { spend: account.spendMinor === null ? null : account.spendMinor / 100, impressions: account.impressions, clicks: account.clicks, platformConversions: account.platformConversions, currency: account.currency };
}
export function sumCounts(rows: Counts[]): Counts {
  if (!rows.length) return missingCounts();
  const currencies = new Set(rows.map(row => row.currency));
  const currency = currencies.size === 1 ? rows[0]!.currency : null;
  const sum = (key: Metric) => rows.some(row => row[key] === null) ? null : rows.reduce((value, row) => value + row[key]!, 0);
  return { spend: currency ? sum("spend") : null, impressions: sum("impressions"), clicks: sum("clicks"), platformConversions: sum("platformConversions"), currency };
}
export function dailyRows(accounts: AccountMetrics[]): DailyRow[] {
  const dates = [...new Set(accounts.flatMap(account => account.daily.map(day => day.date)))].sort();
  return dates.map(date => {
    const values = accounts.map(account => {
      const row = account.daily.find(day => day.date === date);
      return { row, counts: row ? { spend: row.spendMinor === null ? null : row.spendMinor / 100, impressions: row.impressions, clicks: row.clicks, platformConversions: row.platformConversions, currency: account.currency } : missingCounts() };
    });
    const quality: Quality = values.some(value => !value.row || value.row.quality === "missing") ? "missing" : values.some(value => value.row!.quality === "partial") ? "partial" : values.some(value => value.row!.quality === "stale") ? "stale" : "complete";
    return { date, quality, ...sumCounts(values.map(value => value.counts)) };
  });
}
export function csvCell(value: unknown): string {
  const text = String(value ?? "");
  return `"${(/^[=+\-@\t\r]/.test(text) ? `'${text}` : text).replaceAll('"', '""')}"`;
}
