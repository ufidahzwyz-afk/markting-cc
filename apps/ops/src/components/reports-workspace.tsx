"use client";

import { useMemo, useRef, useState } from "react";
import Link from "next/link";
import { Icon } from "./icon";
import { calculateCampaignMetrics, keywordFixtures } from "@/lib/fixtures";

type Counts = { spend: number; impressions: number; clicks: number; platformConversions: number };
type DailyRow = Counts & { date: string };
type Channel = "all" | "search" | "seo" | "geo" | "leads";
type Dimension = "channel" | "campaign" | "date";
type Metric = keyof Counts;
type ReportRow = { id: string; name: string; channel: Exclude<Channel, "all">; note: string; counts: Counts | null; date?: string };

// Fixed campaign-level mock rows; subordinate keyword diagnostics never contribute to totals.
const dailyFixtures: readonly DailyRow[] = [
  { date: "2026-09-30", spend: 100, impressions: 1000, clicks: 50, platformConversions: 4 },
  { date: "2026-10-01", spend: 120, impressions: 1200, clicks: 60, platformConversions: 5 },
];
const fullCampaign = calculateCampaignMetrics();
const metricLabels: Record<Metric, string> = { spend: "花费", impressions: "展现", clicks: "点击", platformConversions: "平台转化" };
const metricKeys = ["spend", "impressions", "clicks", "platformConversions"] as const;
const currency = (value: number) => `¥${value.toFixed(2)}`;
const count = (value: number) => value.toLocaleString("zh-CN");
const percentage = (numerator: number, denominator: number) => denominator > 0 ? `${(numerator / denominator * 100).toFixed(2)}%` : "—";
const displayMetric = (key: Metric, value: number | undefined) => value === undefined ? "—" : key === "spend" ? currency(value) : count(value);

function DailyChart({ rows, metric }: { rows: readonly DailyRow[]; metric: Metric }) {
  const [focusedDate, setFocusedDate] = useState<string | null>(null);
  const focused = rows.find((row) => row.date === focusedDate) ?? rows.at(-1);
  const ceiling = Math.ceil(Math.max(...rows.map((row) => row[metric]), 1) / 4) * 4;
  const left = 48;
  const baseline = 156;
  const plotHeight = 122;
  const barWidth = 72;
  return <div className="ui-chart">
    {rows.length ? <>
      <div className="ui-chart-readout" aria-live="polite"><span>{focused?.date}</span><strong>{metricLabels[metric]} {displayMetric(metric, focused?.[metric])}</strong><span>模拟数据</span></div>
      <svg viewBox="0 0 560 187" width="100%" height="187" role="img" aria-label={`按日期展示的模拟${metricLabels[metric]}柱状图`}>
        {[0, 1, 2, 3, 4].map((tick) => {
          const y = baseline - tick / 4 * plotHeight;
          return <g key={tick}><line x1={left} x2={536} y1={y} y2={y} stroke="#e8ecf1" /><text x={left - 9} y={y + 4} textAnchor="end" fontSize="11" fill="#6b7280">{metric === "spend" ? `¥${ceiling * tick / 4}` : count(ceiling * tick / 4)}</text></g>;
        })}
        {rows.map((row, index) => {
          const height = row[metric] / ceiling * plotHeight;
          const x = left + 488 / rows.length * (index + 0.5) - barWidth / 2;
          return <g key={row.date}>
            <rect x={x} y={baseline - height} width={barWidth} height={height} rx="3" fill={focused?.date === row.date ? "#2458c5" : "#82a9ef"} tabIndex={0} role="graphics-symbol" aria-label={`${row.date}，模拟${metricLabels[metric]} ${displayMetric(metric, row[metric])}`} onMouseEnter={() => setFocusedDate(row.date)} onFocus={() => setFocusedDate(row.date)}><title>{`${row.date} · ${metricLabels[metric]} ${displayMetric(metric, row[metric])}（模拟）`}</title></rect>
            <text x={x + barWidth / 2} y={baseline - height - 8} textAnchor="middle" fontSize="12" fill="#334155">{displayMetric(metric, row[metric])}</text>
            <text x={x + barWidth / 2} y={180} textAnchor="middle" fontSize="11" fill="#6b7280">{row.date.slice(5)}</text>
          </g>;
        })}
      </svg>
    </> : <div className="ui-report-unavailable">当前渠道没有采集记录</div>}
  </div>;
}

export function ReportsWorkspace() {
  const [view, setView] = useState<"fixture" | "real">("fixture");
  const [period, setPeriod] = useState("all");
  const [channel, setChannel] = useState<Channel>("all");
  const [dimension, setDimension] = useState<Dimension>("channel");
  const [metric, setMetric] = useState<Metric>("spend");
  const [sort, setSort] = useState<{ metric: Metric; ascending: boolean }>({ metric: "spend", ascending: false });
  const [selectedRow, setSelectedRow] = useState<ReportRow | null>(null);
  const [exportStatus, setExportStatus] = useState("");
  const definitionsDialog = useRef<HTMLDialogElement>(null);
  const detailsDialog = useRef<HTMLDialogElement>(null);
  const selectedDays = useMemo(() => dailyFixtures.filter((row) => period === "all" || row.date === period), [period]);
  const periodLabel = period === "all" ? "2026-09-30 — 2026-10-01" : period;
  const campaignTotals = useMemo<Counts>(() => period === "all" ? fullCampaign : selectedDays.reduce<Counts>((result, row) => ({ spend: result.spend + row.spend, impressions: result.impressions + row.impressions, clicks: result.clicks + row.clicks, platformConversions: result.platformConversions + row.platformConversions }), { spend: 0, impressions: 0, clicks: 0, platformConversions: 0 }), [period, selectedDays]);
  const totals = view === "fixture" && (channel === "all" || channel === "search") ? campaignTotals : null;
  const rows = useMemo(() => {
    const campaign: ReportRow = { id: "demo_c01", name: "测试搜索推广计划", channel: "search", note: "百度搜索 · demo_c01 · 模拟", counts: campaignTotals };
    const missing: ReportRow[] = [
      { id: "seo", name: "SEO 自然搜索", channel: "seo", note: "搜索数据待接入", counts: null },
      { id: "geo", name: "GEO 可见性", channel: "geo", note: "采样数据待接入", counts: null },
      { id: "leads", name: "线索回收", channel: "leads", note: "接待与线索数据待接入", counts: null },
    ];
    const candidates: ReportRow[] = dimension === "date" ? selectedDays.map((row) => ({ id: row.date, name: row.date, date: row.date, channel: "search", note: "百度搜索 · demo_c01 · 模拟", counts: row })) : dimension === "campaign" ? [campaign] : [{ ...campaign, id: "search", name: "百度搜索（模拟）" }, ...missing];
    return candidates.filter((row) => channel === "all" || row.channel === channel).sort((a, b) => {
      if (!a.counts) return b.counts ? 1 : 0;
      if (!b.counts) return -1;
      const difference = a.counts[sort.metric] - b.counts[sort.metric];
      return sort.ascending ? difference : -difference;
    });
  }, [campaignTotals, dimension, selectedDays, channel, sort]);

  function openDetails(row: ReportRow) {
    setSelectedRow(row);
    detailsDialog.current?.showModal();
  }
  function exportCsv() {
    const escape = (value: string | number) => `"${String(value).replaceAll('"', '""')}"`;
    const records = [
      ["数据来源", "日期窗口", "维度", "名称", "花费(元)", "展现", "点击", "平台转化", "有效线索", "状态"],
      ...rows.map((row) => ["隔离模拟数据", periodLabel, dimension === "channel" ? "渠道" : dimension === "campaign" ? "推广计划" : "日期", row.name, row.counts?.spend ?? "", row.counts?.impressions ?? "", row.counts?.clicks ?? "", row.counts?.platformConversions ?? "", "", row.counts ? "模拟" : "未采集"]),
    ];
    const blob = new Blob(["\uFEFF", records.map((record) => record.map(escape).join(",")).join("\r\n")], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `模拟效果报表_${period === "all" ? "2026-09-30_2026-10-01" : period}.csv`;
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
    setTimeout(() => URL.revokeObjectURL(url), 0);
    setExportStatus(`已导出 ${rows.length} 行模拟报表`);
  }
  function changeView(next: "fixture" | "real") {
    setView(next);
    setExportStatus("");
  }

  return <>
    <div className="ui-page-header"><div><h1>效果复盘</h1><span className="ui-status" data-tone={view === "fixture" ? "amber" : "neutral"}>{view === "fixture" ? "模拟数据" : "真实数据 · 待接入"}</span></div><div className="ui-page-actions"><button className="ui-button ui-button-secondary" type="button" onClick={() => definitionsDialog.current?.showModal()}><Icon name="file" size={15} />指标口径</button><button className="ui-button ui-button-primary" type="button" onClick={exportCsv} disabled={view === "real"}><Icon name="arrow" size={15} />{view === "fixture" ? "导出模拟 CSV" : "导出待接入"}</button></div></div>
    <div className="ui-toolbar">
      <div className="ui-tabs" role="group" aria-label="报告数据来源"><button type="button" aria-pressed={view === "fixture"} className={view === "fixture" ? "active" : ""} onClick={() => changeView("fixture")}>模拟报表</button><button type="button" aria-pressed={view === "real"} className={view === "real" ? "active" : ""} onClick={() => changeView("real")}>真实数据</button></div>
      <label className="ui-field">日期窗口<select aria-label="日期窗口" value={period} onChange={(event) => { setPeriod(event.target.value); setExportStatus(""); }}><option value="all">09-30 至 10-01（2 天）</option>{dailyFixtures.map((row) => <option key={row.date} value={row.date}>{row.date}</option>)}</select></label>
      <label className="ui-field">渠道<select aria-label="报表渠道" value={channel} onChange={(event) => { setChannel(event.target.value as Channel); setExportStatus(""); }}><option value="all">全部渠道</option><option value="search">百度搜索（模拟）</option><option value="seo">SEO 自然搜索</option><option value="geo">GEO 可见性</option><option value="leads">线索回收</option></select></label>
      <span className="ui-toolbar-note">{periodLabel} · 人民币</span>
    </div>
    <div className="ui-kpi-strip" aria-label="推广计划级汇总">{metricKeys.map((key) => <div className="ui-kpi" key={key}><span>{metricLabels[key]}</span><strong>{displayMetric(key, totals?.[key])}</strong><small>{key === "clicks" && totals ? `点击率 ${percentage(totals.clicks, totals.impressions)}` : key === "platformConversions" ? "平台口径 · 非有效线索" : totals ? "推广计划级模拟汇总" : "未采集"}</small></div>)}</div>

    {view === "fixture" ? <>
      <div className="ui-report-grid">
        <section className="ui-panel"><header className="ui-panel-header"><h2>每日表现</h2><label className="ui-field"><span className="sr-only">趋势指标</span><select aria-label="趋势指标" value={metric} onChange={(event) => setMetric(event.target.value as Metric)}>{metricKeys.map((key) => <option key={key} value={key}>{metricLabels[key]}</option>)}</select></label></header><div className="ui-panel-body"><DailyChart rows={totals ? selectedDays : []} metric={metric} /></div></section>
        <section className="ui-panel"><header className="ui-panel-header"><h2>效率与数据覆盖</h2><span className="ui-status" data-tone="amber">模拟</span></header><div className="ui-table-wrap"><table className="ui-table"><tbody><tr><th scope="row">平均点击成本</th><td>{totals && totals.clicks > 0 ? currency(totals.spend / totals.clicks) : "—"}</td></tr><tr><th scope="row">平台转化率</th><td>{totals ? percentage(totals.platformConversions, totals.clicks) : "—"}</td></tr><tr><th scope="row">每次平台转化成本</th><td>{totals && totals.platformConversions > 0 ? currency(totals.spend / totals.platformConversions) : "—"}</td></tr><tr><th scope="row">有效线索 / 成交</th><td>未采集</td></tr><tr><th scope="row">SEO / GEO 数据</th><td>未采集</td></tr><tr><th scope="row">日期覆盖</th><td>{totals ? `${selectedDays.length} 天模拟记录` : "未采集"}</td></tr></tbody></table></div></section>
      </div>
      <section className="ui-panel"><header className="ui-panel-header"><div className="ui-tabs" role="group" aria-label="报表汇总维度">{([{ value: "channel", label: "渠道汇总" }, { value: "campaign", label: "推广计划" }, { value: "date", label: "按日期" }] as const).map((item) => <button type="button" key={item.value} className={dimension === item.value ? "active" : ""} aria-pressed={dimension === item.value} onClick={() => { setDimension(item.value); setExportStatus(""); }}>{item.label}</button>)}</div><span className="ui-toolbar-note">{rows.length} 行 · 点击列名排序</span></header>
        <div className="ui-table-wrap"><table className="ui-table"><thead><tr><th scope="col">{dimension === "channel" ? "渠道" : dimension === "campaign" ? "推广计划" : "日期"}</th>{metricKeys.map((key) => <th scope="col" key={key} aria-sort={sort.metric === key ? sort.ascending ? "ascending" : "descending" : "none"}><button type="button" className="ui-table-sort" aria-label={`按${metricLabels[key]}排序`} onClick={() => setSort({ metric: key, ascending: sort.metric === key ? !sort.ascending : false })}>{metricLabels[key]}<span aria-hidden="true">{sort.metric === key ? sort.ascending ? " ↑" : " ↓" : " ↕"}</span></button></th>)}<th scope="col">点击率</th><th scope="col">有效线索</th><th scope="col">状态</th><th scope="col">操作</th></tr></thead><tbody>{rows.map((row) => <tr key={row.id}><td><strong>{row.name}</strong><small>{row.note}</small></td><td>{displayMetric("spend", row.counts?.spend)}</td><td>{displayMetric("impressions", row.counts?.impressions)}</td><td>{displayMetric("clicks", row.counts?.clicks)}</td><td>{displayMetric("platformConversions", row.counts?.platformConversions)}</td><td>{row.counts ? percentage(row.counts.clicks, row.counts.impressions) : "—"}</td><td>—</td><td><span className="ui-status" data-tone={row.counts ? "amber" : "neutral"}>{row.counts ? "模拟" : "未采集"}</span></td><td><button type="button" className="ui-button ui-button-secondary" aria-label={`查看${row.name}明细`} onClick={() => openDetails(row)}>明细</button></td></tr>)}{rows.length === 0 && <tr><td colSpan={9}>当前筛选没有采集记录。可切换渠道或汇总维度。</td></tr>}</tbody></table></div>
        <footer className="ui-panel-footer"><span>仅推广计划级数据参与汇总；关键词明细不重复累计。</span><span role="status" aria-live="polite">{exportStatus || "固定模拟数据 · 真实执行关闭"}</span></footer>
      </section>
    </> : <section className="ui-panel"><header className="ui-panel-header"><h2>数据接入状态</h2><Link className="ui-button ui-button-secondary" href="/settings">连接设置<Icon name="arrow" size={15} /></Link></header><div className="ui-table-wrap"><table className="ui-table"><thead><tr><th>数据源</th><th>最近采集</th><th>状态</th><th>缺失指标</th></tr></thead><tbody>{[["search", "百度搜索", "花费、展现、点击、平台转化"], ["seo", "SEO 自然搜索", "自然搜索流量、排名"], ["geo", "GEO 可见性", "采样批次、命中与引用"], ["leads", "线索回收", "有效线索、客户、成交"]].filter(([key]) => channel === "all" || key === channel).map(([key, name, missing]) => <tr key={key}><td><strong>{name}</strong></td><td>—</td><td><span className="ui-status" data-tone="neutral">待接入</span></td><td>{missing}</td></tr>)}</tbody></table></div><footer className="ui-panel-footer">尚无真实采集记录。缺失指标保持为空，平台转化不会代替业务线索。</footer></section>}

    <dialog className="ui-modal" ref={definitionsDialog} aria-labelledby="report-definitions-title" onClick={(event) => { if (event.target === event.currentTarget) definitionsDialog.current?.close(); }}><header><h2 id="report-definitions-title">来源与指标口径</h2><button type="button" className="ui-icon-button" aria-label="关闭指标口径" onClick={() => definitionsDialog.current?.close()}><Icon name="close" size={18} /></button></header><div className="ui-modal-body"><dl><dt>数据来源</dt><dd>两日固定模拟记录，同一百度测试计划 demo_c01；不代表实际投放或平台已接通。</dd><dt>汇总粒度</dt><dd>推广计划 × 日期。完整窗口合计：花费 ¥220、展现 2,200、点击 110、平台转化 9。关键词只作下钻，不再次加入总量。</dd><dt>计算公式</dt><dd>点击率 = 点击 ÷ 展现；平均点击成本 = 花费 ÷ 点击；平台转化率 = 平台转化 ÷ 点击；每次平台转化成本 = 花费 ÷ 平台转化。分母为 0 时保持为空。</dd><dt>线索与缺失数据</dt><dd>平台转化不代表有效线索或成交。SEO、GEO、有效线索及成交均未采集，不补成 0。</dd><dt>日期与金额</dt><dd>日期按北京时间展示，金额为人民币。CSV 仅导出当前模拟筛选结果。</dd></dl></div><footer><button type="button" className="ui-button ui-button-primary" onClick={() => definitionsDialog.current?.close()}>知道了</button></footer></dialog>
    <dialog className="ui-drawer" ref={detailsDialog} aria-labelledby="report-details-title" onClick={(event) => { if (event.target === event.currentTarget) detailsDialog.current?.close(); }}><header><div><h2 id="report-details-title">{selectedRow?.name ?? "报表明细"}</h2><span className="ui-status" data-tone={selectedRow?.counts ? "amber" : "neutral"}>{selectedRow?.counts ? "模拟明细" : "未采集"}</span></div><button type="button" className="ui-icon-button" aria-label="关闭报表明细" onClick={() => detailsDialog.current?.close()}><Icon name="close" size={18} /></button></header><div className="ui-drawer-body">{selectedRow?.counts ? <>
      <p>{selectedRow.date ?? periodLabel} · 百度搜索 · demo_c01</p><div className="ui-table-wrap"><table className="ui-table"><tbody>{metricKeys.map((key) => <tr key={key}><th scope="row">{metricLabels[key]}</th><td>{displayMetric(key, selectedRow.counts?.[key])}</td></tr>)}</tbody></table></div>
      <h3>日期记录</h3><div className="ui-table-wrap"><table className="ui-table"><thead><tr><th>日期</th><th>花费</th><th>展现</th><th>点击</th><th>平台转化</th></tr></thead><tbody>{selectedDays.filter((row) => !selectedRow.date || row.date === selectedRow.date).map((row) => <tr key={row.date}><td>{row.date}</td><td>{currency(row.spend)}</td><td>{count(row.impressions)}</td><td>{row.clicks}</td><td>{row.platformConversions}</td></tr>)}</tbody></table></div>
      {period === "all" && !selectedRow.date ? <><h3>关键词明细 · 完整两日窗口</h3><div className="ui-table-wrap"><table className="ui-table"><thead><tr><th>关键词</th><th>花费</th><th>点击</th><th>平台转化</th></tr></thead><tbody>{keywordFixtures.map((row) => <tr key={row.keyword}><td>{row.keyword}</td><td>{currency(row.spend)}</td><td>{row.clicks}</td><td>{row.platformConversions}</td></tr>)}</tbody></table></div><p className="ui-toolbar-note">关键词为计划下的诊断明细，不重复累计。</p></> : <p className="ui-toolbar-note">没有当前单日的关键词记录；完整两日窗口可查看已有模拟明细。</p>}
    </> : <><p>{selectedRow?.note}</p><p>该渠道没有采集记录，指标保持为空。</p><Link className="ui-button ui-button-secondary" href="/settings" onClick={() => detailsDialog.current?.close()}>查看连接状态</Link></>}</div><footer><span>隔离模拟数据 · 不产生业务写入</span><button type="button" className="ui-button ui-button-secondary" onClick={() => detailsDialog.current?.close()}>关闭</button></footer></dialog>
  </>;
}
