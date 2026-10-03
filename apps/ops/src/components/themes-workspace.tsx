"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import type { FormEvent } from "react";
import { Icon } from "./icon";
import { businessLines, freshWorkspaceThemes, isWorkspaceTheme, themeProgress, WORKSPACE_THEME_STORAGE_KEY, workspaceChannels, workspaceOwners, workspaceThemeStatuses } from "@/lib/workspace-fixtures";
import type { BusinessLine, WorkspaceTheme, WorkspaceThemeStatus } from "@/lib/workspace-fixtures";

type SortKey = "title" | "progress" | "updatedAt";
const statusTones: Record<WorkspaceThemeStatus, string> = { "草稿": "neutral", "进行中": "blue", "待审核": "amber", "已暂停": "neutral" };
function formatTime(value: string) {
  return new Intl.DateTimeFormat("zh-CN", { timeZone: "Asia/Shanghai", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hour12: false }).format(new Date(value));
}
function emptyDraft(): WorkspaceTheme {
  return {
    id: `mock-theme-${globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`}`,
    title: "", businessLine: "用友", status: "草稿", audience: "", goal: "", channels: ["官网"], owner: "运营 A", updatedAt: new Date().toISOString(),
    tasks: ["确认受众与业务问题", "整理公开参考资料", "准备官网内容", "准备渠道素材", "检查事实与内容边界", "确认发布计划"].map((label, index) => ({ id: `task-${index + 1}`, label, done: false })),
  };
}

export function ThemesWorkspace() {
  const [themes, setThemes] = useState<WorkspaceTheme[]>(freshWorkspaceThemes);
  const [loaded, setLoaded] = useState(false);
  const [businessLine, setBusinessLine] = useState<BusinessLine | "全部业务线">("全部业务线");
  const [status, setStatus] = useState<WorkspaceThemeStatus | "全部">("全部");
  const [search, setSearch] = useState("");
  const [sort, setSort] = useState<{ key: SortKey; direction: "asc" | "desc" }>({ key: "updatedAt", direction: "desc" });
  const [selected, setSelected] = useState<string[]>([]);
  const [draft, setDraft] = useState<WorkspaceTheme | null>(null);
  const [isNew, setIsNew] = useState(false);
  const [detailTab, setDetailTab] = useState<"details" | "tasks">("details");
  const [notice, setNotice] = useState("");
  const [validationError, setValidationError] = useState("");
  const dialog = useRef<HTMLDialogElement>(null);
  const selectAll = useRef<HTMLInputElement>(null);

  useEffect(() => {
    try {
      const raw = window.localStorage.getItem(WORKSPACE_THEME_STORAGE_KEY);
      if (raw) {
        const stored: unknown = JSON.parse(raw);
        if (Array.isArray(stored) && stored.length <= 200 && stored.every(isWorkspaceTheme) && new Set(stored.map((theme) => theme.id)).size === stored.length) setThemes(stored);
      }
    } catch { setNotice("本地存储不可用，当前修改仅在此页面保留。"); }
    setLoaded(true);
  }, []);

  const filtered = useMemo(() => {
    const query = search.trim().toLocaleLowerCase("zh-CN");
    return themes.filter((theme) => (businessLine === "全部业务线" || theme.businessLine === businessLine) && (status === "全部" || theme.status === status) && `${theme.title} ${theme.audience} ${theme.owner}`.toLocaleLowerCase("zh-CN").includes(query)).sort((a, b) => {
      const result = sort.key === "title" ? a.title.localeCompare(b.title, "zh-CN") : sort.key === "progress" ? themeProgress(a).percentage - themeProgress(b).percentage : Date.parse(a.updatedAt) - Date.parse(b.updatedAt);
      return sort.direction === "asc" ? result : -result;
    });
  }, [themes, businessLine, status, search, sort]);
  const selectedVisible = filtered.filter((theme) => selected.includes(theme.id)).length;
  const allVisibleSelected = filtered.length > 0 && selectedVisible === filtered.length;
  useEffect(() => { if (selectAll.current) selectAll.current.indeterminate = selectedVisible > 0 && !allVisibleSelected; }, [selectedVisible, allVisibleSelected]);

  function persist(next: WorkspaceTheme[], successMessage: string) {
    setThemes(next);
    try { window.localStorage.setItem(WORKSPACE_THEME_STORAGE_KEY, JSON.stringify(next)); setNotice(successMessage); }
    catch { setNotice("本地存储不可用，当前修改仅在此页面保留。"); }
  }
  function openTheme(theme?: WorkspaceTheme) {
    setIsNew(!theme);
    setDraft(theme ? { ...theme, channels: [...theme.channels], tasks: theme.tasks.map((task) => ({ ...task })) } : emptyDraft());
    setDetailTab("details");
    setValidationError("");
    dialog.current?.showModal();
  }
  function saveTheme(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!draft) return;
    if (!draft.title.trim()) {
      setDetailTab("details");
      setValidationError("请输入主题名称。");
      window.requestAnimationFrame(() => dialog.current?.querySelector<HTMLInputElement>("input[name=title]")?.focus());
      return;
    }
    const saved = { ...draft, title: draft.title.trim(), audience: draft.audience.trim(), goal: draft.goal.trim(), updatedAt: new Date().toISOString() };
    persist(isNew ? [saved, ...themes] : themes.map((theme) => theme.id === draft.id ? saved : theme), "主题已保存到当前浏览器的模拟空间。");
    dialog.current?.close();
  }
  function changeSort(key: SortKey) { setSort((current) => ({ key, direction: current.key === key && current.direction === "asc" ? "desc" : "asc" })); }
  function batchStatus(nextStatus: WorkspaceThemeStatus) {
    const now = new Date().toISOString();
    persist(themes.map((theme) => selected.includes(theme.id) ? { ...theme, status: nextStatus, updatedAt: now } : theme), `已在本地更新 ${selected.length} 个主题的状态。`);
    setSelected([]);
  }

  return <div className="ui-themes-workspace">
    <header className="ui-page-header"><div><h1>推广主题<span className="ui-count">{themes.length}</span></h1><p>管理推广方向、计划渠道与推进任务</p></div><button type="button" className="ui-button ui-button-primary" data-testid="new-theme" disabled={!loaded} onClick={() => openTheme()}><span aria-hidden="true">＋</span>新建主题</button></header>
    <section className="ui-toolbar" aria-label="主题筛选"><div className="ui-toolbar-main"><label className="ui-select-field"><Icon name="layers" size={16} /><span className="ui-sr-only">业务线</span><select aria-label="业务线" value={businessLine} onChange={(event) => { setBusinessLine(event.target.value as BusinessLine | "全部业务线"); setSelected([]); }}><option>全部业务线</option>{businessLines.map((line) => <option key={line}>{line}</option>)}</select></label><div className="ui-tabs" role="group" aria-label="主题状态">{(["全部", ...workspaceThemeStatuses] as const).map((item) => <button type="button" key={item} aria-pressed={status === item} data-active={status === item} onClick={() => { setStatus(item); setSelected([]); }}>{item}<span>{themes.filter((theme) => (businessLine === "全部业务线" || theme.businessLine === businessLine) && (item === "全部" || theme.status === item)).length}</span></button>)}</div></div><label className="ui-search-field"><Icon name="search" size={16} /><span className="ui-sr-only">搜索主题、受众或负责人</span><input type="search" aria-label="搜索主题" value={search} onChange={(event) => { setSearch(event.target.value); setSelected([]); }} placeholder="搜索主题、受众、负责人" /></label></section>
    {selected.length > 0 && <div className="ui-bulk-bar" aria-label="批量操作"><span>已选择 <strong>{selected.length}</strong> 项</span><button type="button" className="ui-button" onClick={() => batchStatus("进行中")}>设为进行中</button><button type="button" className="ui-button" onClick={() => batchStatus("已暂停")}>暂停主题</button><button type="button" className="ui-button ui-button-quiet" onClick={() => setSelected([])}>取消选择</button><span className="ui-muted">仅修改本地模拟状态</span></div>}
    <div className="ui-table-wrap"><table className="ui-table ui-themes-table"><thead><tr><th className="ui-checkbox-cell"><input ref={selectAll} type="checkbox" aria-label="选择当前列表全部主题" checked={allVisibleSelected} disabled={filtered.length === 0} onChange={(event) => setSelected(event.target.checked ? [...new Set([...selected, ...filtered.map((theme) => theme.id)])] : selected.filter((id) => !filtered.some((theme) => theme.id === id)))} /></th><th aria-sort={sort.key === "title" ? sort.direction === "asc" ? "ascending" : "descending" : "none"}><button type="button" className="ui-sort-button" onClick={() => changeSort("title")}>主题名称<span aria-hidden="true">{sort.key === "title" ? sort.direction === "asc" ? "↑" : "↓" : "↕"}</span></button></th><th>业务线</th><th>状态</th><th>计划渠道</th><th aria-sort={sort.key === "progress" ? sort.direction === "asc" ? "ascending" : "descending" : "none"}><button type="button" className="ui-sort-button" onClick={() => changeSort("progress")}>进度<span aria-hidden="true">{sort.key === "progress" ? sort.direction === "asc" ? "↑" : "↓" : "↕"}</span></button></th><th>待办</th><th>负责人</th><th aria-sort={sort.key === "updatedAt" ? sort.direction === "asc" ? "ascending" : "descending" : "none"}><button type="button" className="ui-sort-button" onClick={() => changeSort("updatedAt")}>更新时间<span aria-hidden="true">{sort.key === "updatedAt" ? sort.direction === "asc" ? "↑" : "↓" : "↕"}</span></button></th><th className="ui-row-action-cell"><span className="ui-sr-only">操作</span></th></tr></thead><tbody>{filtered.map((theme) => {
      const progress = themeProgress(theme);
      return <tr key={theme.id} data-testid={`theme-row-${theme.id}`} data-selected={selected.includes(theme.id)} onClick={() => openTheme(theme)}><td className="ui-checkbox-cell" onClick={(event) => event.stopPropagation()}><input type="checkbox" aria-label={`选择 ${theme.title}`} checked={selected.includes(theme.id)} onChange={(event) => setSelected(event.target.checked ? [...selected, theme.id] : selected.filter((id) => id !== theme.id))} /></td><td><button type="button" className="ui-theme-title" onClick={(event) => { event.stopPropagation(); openTheme(theme); }}>{theme.title}</button><span className="ui-row-subtitle">{theme.audience}</span></td><td><span className="ui-business-tag" data-line={theme.businessLine}>{theme.businessLine}</span></td><td><span className="ui-status" data-tone={statusTones[theme.status]}><i aria-hidden="true" />{theme.status}</span></td><td><div className="ui-channel-list">{theme.channels.length > 0 ? theme.channels.map((channel) => <span key={channel}>{channel}</span>) : <span className="ui-muted">未选择</span>}</div></td><td><div className="ui-progress-cell"><span className="ui-progress-track" role="progressbar" aria-label={`${theme.title}任务完成度`} aria-valuenow={progress.completed} aria-valuemin={0} aria-valuemax={progress.total}><span style={{ width: `${progress.percentage}%` }} /></span><span>{progress.completed}/{progress.total}</span></div></td><td><span className="ui-pending-count" data-pending={progress.pending > 0}>{progress.pending}</span></td><td><span className="ui-owner"><span aria-hidden="true">{theme.owner.slice(-1)}</span>{theme.owner}</span></td><td><time className="ui-table-time" dateTime={theme.updatedAt}>{formatTime(theme.updatedAt)}</time></td><td className="ui-row-action-cell"><button type="button" className="ui-icon-button" aria-label={`编辑 ${theme.title}`} onClick={(event) => { event.stopPropagation(); openTheme(theme); }}><Icon name="chevron" size={16} /></button></td></tr>;
    })}</tbody></table>{filtered.length === 0 && <div className="ui-table-empty"><Icon name="search" size={22} /><strong>没有匹配的主题</strong><p>调整业务线、状态或搜索关键词</p><button type="button" className="ui-button" onClick={() => { setBusinessLine("全部业务线"); setStatus("全部"); setSearch(""); }}>清除筛选</button></div>}</div>
    <div className="ui-table-footer"><span aria-live="polite">共 {filtered.length} 个主题{selected.length > 0 ? ` · 已选择 ${selected.length} 项` : ""}</span><span className="ui-save-notice" role="status">{notice}</span><span className="ui-muted">外部执行关闭</span></div>
    <dialog ref={dialog} className="ui-drawer ui-theme-drawer" aria-labelledby="theme-drawer-title" onClick={(event) => { if (event.target === event.currentTarget) dialog.current?.close(); }}>
      {draft && <form onSubmit={saveTheme} className="ui-drawer-form"><header className="ui-drawer-header"><div><span className="ui-muted">{isNew ? "新增主题" : `主题 ${draft.id.startsWith("mock-theme-00") ? draft.id.slice(-3) : "详情"}`}</span><h2 id="theme-drawer-title">{isNew ? "新建推广主题" : draft.title}</h2></div><button type="button" className="ui-icon-button" aria-label="关闭主题详情" onClick={() => dialog.current?.close()}><Icon name="close" size={20} /></button></header><div className="ui-drawer-tabs ui-tabs" role="group" aria-label="主题详情分类"><button type="button" data-active={detailTab === "details"} aria-pressed={detailTab === "details"} onClick={() => setDetailTab("details")}>基本信息</button><button type="button" data-active={detailTab === "tasks"} aria-pressed={detailTab === "tasks"} onClick={() => setDetailTab("tasks")}>推进任务<span>{themeProgress(draft).completed}/{themeProgress(draft).total}</span></button></div><div className="ui-drawer-body">
        <div hidden={detailTab !== "details"}>{validationError && <p className="ui-form-error" role="alert">{validationError}</p>}<label className="ui-field"><span>主题名称 <span className="ui-required">*</span></span><input name="title" aria-label="主题名称" required={detailTab === "details"} aria-invalid={Boolean(validationError)} maxLength={100} value={draft.title} onChange={(event) => { setDraft({ ...draft, title: event.target.value }); setValidationError(""); }} placeholder="输入主题名称" /></label><div className="ui-form-grid"><label className="ui-field">业务线<select aria-label="主题业务线" value={draft.businessLine} onChange={(event) => setDraft({ ...draft, businessLine: event.target.value as BusinessLine })}>{businessLines.map((line) => <option key={line}>{line}</option>)}</select></label><label className="ui-field">状态<select aria-label="主题状态" value={draft.status} onChange={(event) => setDraft({ ...draft, status: event.target.value as WorkspaceThemeStatus })}>{workspaceThemeStatuses.map((item) => <option key={item}>{item}</option>)}</select></label></div><label className="ui-field">负责人<select aria-label="主题负责人" value={draft.owner} onChange={(event) => setDraft({ ...draft, owner: event.target.value })}>{workspaceOwners.map((owner) => <option key={owner}>{owner}</option>)}</select></label><label className="ui-field">目标受众<input aria-label="目标受众" maxLength={180} value={draft.audience} onChange={(event) => setDraft({ ...draft, audience: event.target.value })} placeholder="希望触达哪些企业或岗位" /></label><label className="ui-field">推广目标<textarea aria-label="推广目标" rows={3} maxLength={500} value={draft.goal} onChange={(event) => setDraft({ ...draft, goal: event.target.value })} placeholder="本主题要回答什么问题" /></label><fieldset className="ui-field ui-channel-options"><legend>计划渠道</legend>{workspaceChannels.map((channel) => <label key={channel}><input type="checkbox" checked={draft.channels.includes(channel)} onChange={(event) => setDraft({ ...draft, channels: event.target.checked ? [...draft.channels, channel] : draft.channels.filter((item) => item !== channel) })} />{channel}</label>)}</fieldset><div className="ui-detail-meta"><span>最近更新</span><time dateTime={draft.updatedAt}>{formatTime(draft.updatedAt)}</time></div></div>
        <div hidden={detailTab !== "tasks"}><div className="ui-task-summary"><strong>{themeProgress(draft).completed}/{themeProgress(draft).total} 项已完成</strong><span className="ui-muted">勾选后保存到本地</span></div><div className="ui-task-checklist">{draft.tasks.map((task) => <label key={task.id} data-done={task.done}><input type="checkbox" checked={task.done} onChange={(event) => setDraft({ ...draft, tasks: draft.tasks.map((item) => item.id === task.id ? { ...item, done: event.target.checked } : item) })} /><span>{task.label}</span><span className="ui-status" data-tone={task.done ? "green" : "neutral"}>{task.done ? "已完成" : "待处理"}</span></label>)}</div><div className="ui-inline-note"><Icon name="lock" size={16} /><span>任务状态为本地管理记录，不触发生成、发布或投放。</span></div></div>
      </div><footer className="ui-drawer-footer"><p className="ui-local-note">仅保存模拟数据 · 不会发布到外部平台</p><div className="ui-drawer-actions"><button type="button" className="ui-button" onClick={() => dialog.current?.close()}>取消</button><button type="submit" className="ui-button ui-button-primary" data-testid="save-theme">保存主题</button></div></footer></form>}
    </dialog>
  </div>;
}
