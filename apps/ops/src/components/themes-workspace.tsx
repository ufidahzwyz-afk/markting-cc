"use client";

import { useMemo, useState } from "react";
import { Badge, Button, EmptyState } from "@boran/ui";
import { Icon } from "./icon";
import { themeFixtures } from "@/lib/fixtures";
import type { ThemeFixture, ThemeStatus } from "@/lib/fixtures";

const statuses = ["全部主题", "待完善", "待审核", "草稿"] as const;

function ThemeCard({ theme, expanded, onToggle }: { theme: ThemeFixture; expanded: boolean; onToggle: () => void }) {
  const [draft, setDraft] = useState({ audience: theme.audience, intent: theme.intent, focus: theme.focus });
  return <article className={`theme-card ${expanded ? "expanded" : ""}`}>
    <div className="theme-card-top"><span className="theme-number">{theme.id.slice(-2)}</span><Badge tone={theme.status === "待审核" ? "blue" : theme.status === "待完善" ? "amber" : "neutral"}>{theme.status}</Badge></div>
    <h2>{theme.name}</h2><p className="theme-focus">{draft.focus}</p>
    <dl className="theme-meta"><div><dt>目标受众</dt><dd>{draft.audience}</dd></div><div><dt>用户意图</dt><dd>{draft.intent}</dd></div></dl>
    <div className="channel-tags">{theme.channels.map((channel) => <span key={channel}>{channel}</span>)}</div>
    <div className="theme-card-footer"><span><Icon name="file" size={16} />{theme.tasks} 项演练任务</span><Button variant="quiet" onClick={onToggle} aria-expanded={expanded} aria-controls={`editor-${theme.id}`}>{expanded ? "收起预览" : "查看与调整"}<Icon name="chevron" size={16} className={expanded ? "rotated" : ""} /></Button></div>
    {expanded && <div className="theme-editor" id={`editor-${theme.id}`}><div className="editor-heading"><strong>临时编辑预览</strong><Badge>仅本页</Badge></div><p className="field-hint">修改会显示在此卡片，刷新后恢复示例。当前不会保存业务数据。</p><label>目标受众<input value={draft.audience} onChange={(event) => setDraft({ ...draft, audience: event.target.value })} maxLength={120} /></label><label>用户意图<input value={draft.intent} onChange={(event) => setDraft({ ...draft, intent: event.target.value })} maxLength={120} /></label><label>内容方向<textarea value={draft.focus} onChange={(event) => setDraft({ ...draft, focus: event.target.value })} rows={3} maxLength={300} /></label><div className="editor-actions"><Button onClick={() => setDraft({ audience: theme.audience, intent: theme.intent, focus: theme.focus })}><Icon name="reset" size={16} />恢复示例</Button><Button variant="primary" disabled title="持久化保存将在业务接入阶段实现">保存未开放</Button></div></div>}
  </article>;
}

export function ThemesWorkspace() {
  const [filter, setFilter] = useState<(typeof statuses)[number]>("全部主题");
  const [search, setSearch] = useState("");
  const [expanded, setExpanded] = useState<string | null>(null);
  const filtered = useMemo(() => themeFixtures.filter((theme) => (filter === "全部主题" || theme.status === filter as ThemeStatus) && `${theme.name}${theme.audience}${theme.intent}`.includes(search.trim())), [filter, search]);
  return <>
    <div className="page-heading"><div><p className="eyebrow">CAMPAIGN THEMES</p><h1>推广主题<span className="heading-dot">.</span></h1><p>把业务问题整理成可以持续推进的推广方向。</p></div><div className="heading-action"><Button variant="primary" disabled title="实际主题创建将在业务接入阶段开放"><span aria-hidden="true">＋</span>新建主题</Button><span>业务接入后开放创建</span></div></div>
    <div className="inline-notice"><Icon name="eye" size={19} /><p><strong>主题演练</strong>以下为通用测试主题。可筛选、展开和临时调整，不会保存、生成或发布真实内容。</p></div>
    <section className="themes-toolbar" aria-label="主题筛选"><div className="filter-tabs" role="group" aria-label="按主题状态筛选">{statuses.map((status) => <button type="button" key={status} className={filter === status ? "active" : ""} aria-pressed={filter === status} onClick={() => setFilter(status)}>{status}<span>{status === "全部主题" ? themeFixtures.length : themeFixtures.filter((theme) => theme.status === status).length}</span></button>)}</div><label className="search-field"><Icon name="search" size={18} /><span className="sr-only">搜索主题、受众或用户意图</span><input type="search" placeholder="搜索主题或受众" value={search} onChange={(event) => setSearch(event.target.value)} /></label></section>
    <div className="results-caption" aria-live="polite"><span>共 {filtered.length} 个演练主题</span><span>连接未配置 · 真实执行关闭</span></div>
    {filtered.length > 0 ? <div className="theme-grid">{filtered.map((theme) => <ThemeCard key={theme.id} theme={theme} expanded={expanded === theme.id} onToggle={() => setExpanded(expanded === theme.id ? null : theme.id)} />)}</div> : <section className="panel"><EmptyState title="没有匹配的演练主题" description="试试其他关键词，或切换到全部主题。" icon={<Icon name="search" size={26} />} /><div className="empty-action"><Button onClick={() => { setSearch(""); setFilter("全部主题"); }}>清除筛选</Button></div></section>}
    <section className="theme-process panel"><div><p className="eyebrow">FROM IDEA TO IMPACT</p><h2>每个主题都沿着同一条路径推进</h2><p>主题是内容、页面、渠道任务与结果复盘的共同起点。</p></div><div className="theme-process-steps"><span><Icon name="layers" size={18} />明确主题</span><Icon name="arrow" size={16} /><span><Icon name="file" size={18} />准备内容</span><Icon name="arrow" size={16} /><span><Icon name="check" size={18} />审核执行</span><Icon name="arrow" size={16} /><span><Icon name="chart" size={18} />效果复盘</span></div></section>
  </>;
}
