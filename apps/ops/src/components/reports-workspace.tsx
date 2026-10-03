"use client";

import { useState } from "react";
import Link from "next/link";
import { Badge, EmptyState, SectionTitle } from "@boran/ui";
import { Icon } from "./icon";
import { calculateCampaignMetrics, keywordFixtures } from "@/lib/fixtures";

const metrics = calculateCampaignMetrics();
const percent = (value: number) => `${(value * 100).toFixed(2)}%`;

export function ReportsWorkspace() {
  const [view, setView] = useState<"real" | "fixture">("real");
  const [showDefinitions, setShowDefinitions] = useState(false);
  return <>
    <div className="page-heading"><div><p className="eyebrow">PERFORMANCE REVIEW</p><h1>效果复盘<span className="heading-dot">.</span></h1><p>以可追溯的数据，判断下一步推广动作。</p></div><div className="segmented report-view" role="group" aria-label="报告数据来源"><button type="button" className={view === "real" ? "selected" : ""} aria-pressed={view === "real"} onClick={() => setView("real")}>真实数据</button><button type="button" className={view === "fixture" ? "selected" : ""} aria-pressed={view === "fixture"} onClick={() => setView("fixture")}>测试样例</button></div></div>
    {view === "real" ? <>
      <div className="inline-notice"><Icon name="link" size={19} /><p><strong>尚未连接数据源</strong>广告平台与线索系统未接入，当前没有可用于复盘的真实业务数据。</p></div>
      <div className="report-stats">{["推广花费", "展现次数", "点击次数", "平台转化"].map((label) => <div className="stat-card" key={label}><div className="stat-label">{label}</div><div className="stat-value empty-value">—</div><p>暂无可用真实数据</p></div>)}</div>
      <section className="panel real-report-empty"><EmptyState title="接通后，结果会在这里汇总" description="完成平台连接、执行范围批准与数据核验后，查看推广花费、点击表现和线索回收。" icon={<Icon name="chart" size={29} />} /><div className="empty-action"><Link href="/settings" className="button button-secondary">查看连接状态<Icon name="arrow" size={17} /></Link><button type="button" className="button button-quiet" onClick={() => setView("fixture")}>先看测试报告</button></div></section>
      <section className="panel report-boundary"><SectionTitle title="复盘需要回答的问题" description="数据接入后，从业务结果回到具体的推广动作" /><div className="review-questions"><div><span>01</span><h3>投入是否有效？</h3><p>比较花费、展现与点击，识别流量获取的变化。</p></div><div><span>02</span><h3>线索是否可信？</h3><p>区分平台转化、回收线索与业务确认结果。</p></div><div><span>03</span><h3>下一步调整什么？</h3><p>结合主题与渠道表现，提出有依据的优化建议。</p></div></div></section>
    </> : <>
      <div className="inline-notice fixture-notice"><Icon name="eye" size={19} /><p><strong>隔离测试样例</strong>本报告来自固定 fixture，用于验证展示与计算。没有导入、投放或发布真实业务数据。</p><Badge tone="amber">模拟数据</Badge></div>
      <section className="report-source"><div><Badge tone="blue">测试推广计划</Badge><span>汇总粒度：推广计划</span><span>币种：人民币</span></div><button type="button" className="text-button" aria-expanded={showDefinitions} aria-controls="metric-definitions" onClick={() => setShowDefinitions(!showDefinitions)}>数据口径<Icon name="chevron" size={16} className={showDefinitions ? "rotated" : ""} /></button></section>
      {showDefinitions && <div className="definitions" id="metric-definitions"><strong>计算与来源</strong><p>花费、展现、点击与平台转化均取推广计划级测试汇总。关键词为该计划下的明细，不再次加到总量中。点击率 = 点击 ÷ 展现；平均点击成本 = 花费 ÷ 点击；平台转化率 = 平台转化 ÷ 点击。</p><p>平台转化 9 次仅为平台测试口径，不代表有效线索、客户或成交。</p></div>}
      <div className="report-stats"><div className="stat-card"><div className="stat-label">推广花费<Icon name="chart" size={18} /></div><div className="stat-value"><span className="currency-sign">¥</span>{metrics.spend.toFixed(2)}</div><p>推广计划级测试汇总</p></div><div className="stat-card"><div className="stat-label">展现次数<Icon name="eye" size={18} /></div><div className="stat-value">{metrics.impressions.toLocaleString("zh-CN")}</div><p>测试展现</p></div><div className="stat-card"><div className="stat-label">点击次数<Icon name="arrow" size={18} /></div><div className="stat-value">{metrics.clicks}</div><p>点击率 {percent(metrics.clickThroughRate)}</p></div><div className="stat-card"><div className="stat-label">平台转化<Icon name="check" size={18} /></div><div className="stat-value">{metrics.platformConversions}<span>次</span></div><p>测试平台口径 · 非有效线索</p></div></div>
      <div className="report-columns"><section className="panel funnel-panel"><SectionTitle title="测试流量路径" description="固定样例的各阶段计数" action={<Badge>Fixture</Badge>} /><div className="funnel-rows"><div><span>展现</span><div className="funnel-track"><div style={{ width: "100%" }} /></div><strong>2,200</strong></div><div><span>点击</span><div className="funnel-track"><div style={{ width: "5%" }} /></div><strong>110</strong></div><div><span>平台转化</span><div className="funnel-track"><div style={{ width: `${metrics.platformConversions / metrics.impressions * 100}%` }} /></div><strong>9</strong></div></div><p className="chart-note">柱长按实际比例展示。点击与平台转化尚未对应业务线索。</p></section><section className="panel efficiency-panel"><SectionTitle title="测试效率指标" description="仅展示计算结果，不形成优化建议" /><dl className="efficiency-list"><div><dt>平均点击成本</dt><dd>¥{metrics.costPerClick.toFixed(2)}</dd></div><div><dt>平台转化率</dt><dd>{percent(metrics.platformConversionRate)}</dd></div><div><dt>每次平台转化成本</dt><dd>¥{metrics.costPerPlatformConversion.toFixed(2)}</dd></div><div><dt>有效线索 / 成交</dt><dd className="muted">暂无数据</dd></div></dl></section></div>
      <section className="panel keyword-panel"><SectionTitle title="关键词明细" description="同一测试推广计划下的明细；不与推广计划重复汇总" action={<Badge>3 条测试明细</Badge>} /><div className="task-table-wrapper"><table className="task-table keyword-table"><thead><tr><th>测试关键词</th><th>花费</th><th>展现</th><th>点击</th><th>平台转化</th></tr></thead><tbody>{keywordFixtures.map((row) => <tr key={row.keyword}><td><strong>{row.keyword}</strong></td><td>¥{row.spend.toFixed(2)}</td><td>{row.impressions.toLocaleString("zh-CN")}</td><td>{row.clicks}</td><td>{row.platformConversions}</td></tr>)}</tbody></table></div><div className="panel-note"><Icon name="file" size={16} /><span>没有真实导入记录。测试数据用于界面验收与计算校验。</span></div></section>
    </>}
  </>;
}
