import { test } from "node:test";
import assert from "node:assert/strict";
import { accountCounts, csvCell, dailyRows, sumCounts } from "../src/lib/report-fixtures";
import type { AccountMetrics } from "../src/lib/report-fixtures";

function account(overrides: Partial<AccountMetrics> = {}): AccountMetrics {
  return { connectionId: "isolated-source", accountName: "测试数据源", currency: "CNY", authoritativeReportType: "campaign_daily", quality: "complete", daily: [{ date: "2026-10-01", quality: "complete", spendMinor: 12000, impressions: 1200, clicks: 60, platformConversions: 5 }], spendMinor: 12000, impressions: 1200, clicks: 60, platformConversions: 5, batchIds: ["persisted-batch"], sourceWatermark: "2026-10-02T00:00:00Z", sourceKinds: ["historical_import"], ...overrides };
}
test("missing windows retain nulls and a partial account cannot become a complete KPI", () => {
  assert.equal(sumCounts([]).spend, null);
  const missing = account({ quality: "partial", spendMinor: null, clicks: null, impressions: null, platformConversions: null });
  assert.equal(sumCounts([accountCounts(account()), accountCounts(missing)]).spend, null);
  assert.equal(accountCounts(account(), "2026-09-30").clicks, null);
});
test("minor-unit amounts convert once and different currencies are never added", () => {
  const first = accountCounts(account());
  assert.equal(first.spend, 120);
  const mixed = sumCounts([first, accountCounts(account({ currency: "USD" }))]);
  assert.equal(mixed.spend, null);
  assert.equal(mixed.currency, null);
  assert.equal(mixed.clicks, 120);
});
test("stale observations remain labelled in the chart without creating fresh daily KPIs", () => {
  const stale = account({ quality: "stale", spendMinor: null, clicks: null, impressions: null, platformConversions: null, daily: [{ date: "2026-10-01", quality: "stale", spendMinor: 12000, impressions: 1200, clicks: 60, platformConversions: null }] });
  const rows = dailyRows([stale]);
  assert.equal(rows[0]?.spend, 120);
  assert.equal(rows[0]?.quality, "stale");
  assert.equal(rows[0]?.platformConversions, null);
  assert.equal(accountCounts(stale, "2026-10-01").spend, null);
});
test("CSV escapes spreadsheet formulas, quotes and missing values", () => {
  assert.equal(csvCell("=1+2"), '"\'=1+2"');
  assert.equal(csvCell('a"b'), '"a""b"');
  assert.equal(csvCell(null), '""');
});
