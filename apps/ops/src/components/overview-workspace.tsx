"use client";

import Link from "next/link";
import { useMemo, useRef, useState } from "react";
import { Icon } from "./icon";

type TaskState = "pending" | "publish" | "running" | "done";
type Task = {
  id: string;
  name: string;
  kind: string;
  theme: string;
  channel: string;
  state: TaskState;
  owner: string;
  time: string;
  date: string;
  source: string;
  blocker: string | null;
  steps: string[];
};

const initialTasks: Task[] = [
  { id: "TK-1001", name: "确认致远公开产品资料采集范围", kind: "来源采集", theme: "致远协同办公", channel: "公开资料", state: "pending", owner: "运营 A", time: "09:00", date: "2026-10-03", source: "致远公开产品介绍页 · 范围样例，尚未实际读取", blocker: "需要确认允许采集的 URL 范围，当前连接尚未配置。", steps: ["检查资料采集范围", "确认公开资料可读性", "保存来源版本与覆盖记录"] },
  { id: "TK-1002", name: "采集用友业财一体公开产品资料", kind: "来源采集", theme: "用友业财一体", channel: "公开资料", state: "running", owner: "运营 B", time: "09:15", date: "2026-10-03", source: "用友公开产品介绍 · 固定模拟资料片段", blocker: null, steps: ["读取模拟来源片段", "比较模拟版本变化", "整理资料引用清单"] },
  { id: "TK-1003", name: "审核“多系统数据如何衔接”选题", kind: "选题审核", theme: "企业系统集成", channel: "官网内容", state: "pending", owner: "运营 A", time: "10:00", date: "2026-10-03", source: "系统集成通用场景 · 模拟选题草稿", blocker: "需核对内容边界，避免把通用方案写成已交付的客户案例。", steps: ["核对目标读者与问题", "检查产品事实与引用", "确认选题范围"] },
  { id: "TK-1004", name: "检查公众号“协同审批流程”发布草稿", kind: "发布准备", theme: "致远协同办公", channel: "微信公众号", state: "publish", owner: "运营 A", time: "10:30", date: "2026-10-03", source: "致远协同公开产品场景 · 模拟文章草稿", blocker: "公众号账号尚未接通，发布与回读核验不可执行。", steps: ["检查标题与正文预览", "检查配图与来源引用", "等待账号连接后执行发布核验"] },
  { id: "TK-1005", name: "校验百度落地页 URL 与转化参数", kind: "投放校验", theme: "用友业财一体", channel: "百度推广", state: "pending", owner: "运营 B", time: "11:00", date: "2026-10-03", source: "模拟落地页配置 · 不包含真实投放账号", blocker: "需要核对落地页参数；真实广告账号与操作范围尚未批准。", steps: ["检查页面与推广主题对应关系", "检查 URL 参数规则", "输出校验结果供人工确认"] },
  { id: "TK-1006", name: "核对共享咨询线索的主题与归属", kind: "共享线索", theme: "企业系统集成", channel: "网站咨询", state: "pending", owner: "运营 B", time: "11:30", date: "2026-10-03", source: "匿名咨询样例：多系统数据同步需求；无真实联系人", blocker: "样例缺少需求范围，需补充分类与负责人的处理备注。", steps: ["检查咨询与主题关联", "确认共享处理人", "记录下一步跟进事项"] },
  { id: "TK-1007", name: "复核知乎“业财数据一致性”回答", kind: "发布准备", theme: "用友业财一体", channel: "知乎", state: "publish", owner: "运营 A", time: "13:30", date: "2026-10-03", source: "业财协同通用问题 · 模拟回答草稿", blocker: "知乎账号尚未接通，当前仅可检查模拟稿件。", steps: ["复核问题与回答相关性", "检查产品表述与引用", "等待连接后提交与回读"] },
  { id: "TK-1008", name: "整理 API 集成内容的事实引用", kind: "素材核验", theme: "企业系统集成", channel: "官网内容", state: "running", owner: "运营 B", time: "14:00", date: "2026-10-03", source: "通用 API 集成场景 · 模拟引用列表", blocker: null, steps: ["整理接口集成场景", "检查事实引用完整度", "生成内容核验清单"] },
  { id: "TK-1009", name: "归档昨日运行日报样例", kind: "报告归档", theme: "日常运营", channel: "日报", state: "done", owner: "运营 B", time: "08:40", date: "2026-10-03", source: "固定模拟运行数据 · 不包含真实推广结果", blocker: null, steps: ["检查样例数据覆盖", "生成模拟日报", "记录本地归档结果"] },
  { id: "TK-1010", name: "检查协同办公页面 SEO 标题", kind: "SEO 检查", theme: "致远协同办公", channel: "官网页面", state: "done", owner: "运营 A", time: "08:50", date: "2026-10-03", source: "模拟页面标题与描述 · 尚未发布网页", blocker: null, steps: ["检查标题与页面主题", "检查描述与事实范围", "保存本地检查结果"] },
];

const stateLabels: Record<TaskState, string> = { pending: "待处理", publish: "待发布", running: "运行中", done: "已完成" };
const stateTones: Record<TaskState, string> = { pending: "amber", publish: "blue", running: "blue", done: "green" };
const tabs = ["全部", "待处理", "运行中", "已完成"] as const;
type Tab = (typeof tabs)[number];

function matchesTab(task: Task, tab: Tab) {
  return tab === "全部" || (tab === "待处理" && (task.state === "pending" || task.state === "publish")) || (tab === "运行中" && task.state === "running") || (tab === "已完成" && task.state === "done");
}

export function OverviewWorkspace() {
  const tasks = initialTasks;
  const [tab, setTab] = useState<Tab>("全部");
  const [search, setSearch] = useState("");
  const [owner, setOwner] = useState("全部负责人");
  const [date, setDate] = useState("2026-10-03");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [handled, setHandled] = useState<string[]>([]);
  const [notice, setNotice] = useState("");
  const [logs, setLogs] = useState([
    { time: "09:22", text: "公开资料采集 · 模拟步骤运行中", tone: "blue" },
    { time: "08:50", text: "SEO 标题检查 · 样例检查完成", tone: "green" },
    { time: "08:40", text: "昨日运行日报 · 样例归档完成", tone: "green" },
  ]);
  const drawer = useRef<HTMLDialogElement>(null);
  const scopedTasks = useMemo(() => tasks.filter((task) => (owner === "全部负责人" || task.owner === owner) && task.date === date), [tasks, owner, date]);
  const filteredTasks = useMemo(() => scopedTasks.filter((task) => matchesTab(task, tab) && `${task.id} ${task.name} ${task.theme} ${task.channel} ${task.kind}`.toLowerCase().includes(search.trim().toLowerCase())), [scopedTasks, tab, search]);
  const selectedTask = tasks.find((task) => task.id === selectedId);
  const pending = scopedTasks.filter((task) => task.state === "pending").length;
  const publishing = scopedTasks.filter((task) => task.state === "publish").length;
  const running = scopedTasks.filter((task) => task.state === "running").length;
  const completed = scopedTasks.filter((task) => task.state === "done").length;

  function openTask(id: string) {
    setSelectedId(id);
    drawer.current?.showModal();
  }

  function handleTask() {
    if (!selectedTask || selectedTask.state === "done" || handled.includes(selectedTask.id)) return;
    setHandled((current) => [...current, selectedTask.id]);
    setLogs((current) => [{ time: "本页", text: `${selectedTask.id} · 模拟处置已记录`, tone: "green" }, ...current].slice(0, 4));
    setNotice(`${selectedTask.id} 已记录模拟处置。任务执行状态未改变，刷新后恢复样例。`);
  }

  return <>
    <div className="ui-page-header"><div><h1>今日工作</h1><p>推进任务，处理例外，查看共享运行结果。</p></div><div className="ui-page-actions"><span className="ui-status" data-tone="neutral">模拟工作区</span><button type="button" className="ui-button ui-button-primary" onClick={() => { setTab("待处理"); setSearch(""); }}>处理待办</button></div></div>
    <div className="ui-notice"><Icon name="eye" size={16} /><span>任务与记录均为模拟数据，处置仅在本页生效。真实账号尚未接通。</span><Link href="/settings">连接设置<Icon name="chevron" size={14} /></Link></div>
    <section className="ui-toolbar" aria-label="工作区筛选"><div className="ui-toolbar-filters"><label className="ui-filter-field"><span>工作日期</span><input type="date" aria-label="工作日期" value={date} onChange={(event) => setDate(event.target.value)} /></label><label className="ui-filter-field"><span>负责人</span><select aria-label="负责人" value={owner} onChange={(event) => setOwner(event.target.value)}><option>全部负责人</option><option>运营 A</option><option>运营 B</option></select></label></div><span className="ui-muted">Asia/Shanghai · 本地身份样例</span></section>
    <section className="ui-kpi-strip" aria-label="模拟任务统计"><div className="ui-kpi"><span>待处理</span><strong>{pending}</strong><small>需要人工确认</small></div><div className="ui-kpi"><span>待发布</span><strong>{publishing}</strong><small>稿件待检查</small></div><div className="ui-kpi"><span>进行中</span><strong>{running}</strong><small>模拟步骤运行</small></div><div className="ui-kpi"><span>今日完成</span><strong>{completed}</strong><small>已完成的样例任务</small></div></section>
    {notice && <div className="ui-toast" role="status"><Icon name="check" size={16} /><span>{notice}</span><button type="button" className="ui-icon-button" aria-label="关闭处置提示" onClick={() => setNotice("")}><Icon name="close" size={16} /></button></div>}
    <div className="ui-work-grid">
      <section className="ui-panel ui-task-panel" aria-labelledby="task-list-title">
        <header className="ui-panel-header"><h2 id="task-list-title">工作任务 <span className="ui-count">{scopedTasks.length}</span></h2><label className="ui-search"><Icon name="search" size={16} /><span className="sr-only">搜索任务、主题或渠道</span><input type="search" placeholder="搜索任务、主题或渠道" value={search} onChange={(event) => setSearch(event.target.value)} /></label></header>
        <div className="ui-tabs" role="group" aria-label="任务状态">{tabs.map((item) => <button type="button" key={item} className={tab === item ? "active" : ""} aria-pressed={tab === item} onClick={() => setTab(item)}>{item}<span>{scopedTasks.filter((task) => matchesTab(task, item)).length}</span></button>)}</div>
        <div className="ui-table-wrap"><table className="ui-table"><thead><tr><th>任务</th><th>主题 / 渠道</th><th>状态</th><th>负责人</th><th>计划时间</th><th>操作</th></tr></thead><tbody>{filteredTasks.map((task) => <tr key={task.id}><td><button type="button" className="ui-task-name" onClick={() => openTask(task.id)}>{task.name}</button><span className="ui-task-meta">{task.id} · {task.kind}</span></td><td><span>{task.theme}</span><span className="ui-task-meta">{task.channel}</span></td><td><span className="ui-status" data-tone={stateTones[task.state]}>{stateLabels[task.state]}</span></td><td><span className="ui-owner"><span className="ui-owner-avatar" aria-hidden="true">{task.owner.slice(-1)}</span>{task.owner}</span></td><td><span className="ui-time">{task.time}</span></td><td><button type="button" className="ui-button ui-button-quiet" onClick={() => openTask(task.id)}>详情<Icon name="chevron" size={14} /></button></td></tr>)}</tbody></table>{filteredTasks.length === 0 && <div className="ui-empty"><Icon name="search" size={22} /><strong>没有符合条件的任务</strong><p>调整日期、负责人或关键词后重试。</p><button type="button" className="ui-button ui-button-secondary" onClick={() => { setDate("2026-10-03"); setOwner("全部负责人"); setSearch(""); setTab("全部"); }}>重置筛选</button></div>}</div>
        <footer className="ui-table-footer"><span aria-live="polite">显示 {filteredTasks.length} / {scopedTasks.length} 项任务</span><span>任务数据：本地模拟</span></footer>
      </section>
      <aside className="ui-work-aside" aria-label="例外与运行状态">
        <section className="ui-panel"><header className="ui-panel-header"><h2>待处理例外</h2><span className="ui-status" data-tone="amber">3</span></header><div className="ui-panel-body"><div className="ui-exception-list"><button type="button" className="ui-exception-item" onClick={() => openTask("TK-1001")}><span className="ui-status-dot" data-tone="amber" /><span><strong>公开资料范围待确认</strong><small>致远协同 · {handled.includes("TK-1001") ? "本页已模拟处置" : "运营 A"}</small></span><Icon name="chevron" size={14} /></button><button type="button" className="ui-exception-item" onClick={() => openTask("TK-1004")}><span className="ui-status-dot" data-tone="amber" /><span><strong>公众号发布连接缺失</strong><small>协同审批稿件 · 真实连接未配置</small></span><Icon name="chevron" size={14} /></button><button type="button" className="ui-exception-item" onClick={() => openTask("TK-1005")}><span className="ui-status-dot" data-tone="amber" /><span><strong>百度落地页参数待校验</strong><small>业财一体 · {handled.includes("TK-1005") ? "本页已模拟处置" : "运营 B"}</small></span><Icon name="chevron" size={14} /></button></div></div></section>
        <section className="ui-panel"><header className="ui-panel-header"><h2>账号连接</h2><Link className="ui-text-link" href="/settings">管理</Link></header><div className="ui-panel-body ui-connection-list">{["微信公众号", "百度推广", "爱番番"].map((name) => <div className="ui-connection-row" key={name}><span>{name}</span><span className="ui-status" data-tone="neutral">未配置</span></div>)}</div></section>
        <section className="ui-panel"><header className="ui-panel-header"><h2>运行记录</h2><span className="ui-muted">模拟</span></header><div className="ui-panel-body"><ol className="ui-log-list">{logs.map((log, index) => <li className="ui-log-item" key={`${log.time}-${index}`}><span className="ui-status-dot" data-tone={log.tone} /><div><span>{log.text}</span><small>{log.time}</small></div></li>)}</ol></div></section>
      </aside>
    </div>
    <dialog className="ui-drawer" ref={drawer} aria-labelledby="task-detail-title" onClose={() => setSelectedId(null)}>
      {selectedTask && <><header className="ui-drawer-header"><div><span className="ui-task-meta">{selectedTask.id} · {selectedTask.kind}</span><h2 id="task-detail-title">{selectedTask.name}</h2></div><button type="button" className="ui-icon-button" aria-label="关闭任务详情" onClick={() => drawer.current?.close()}><Icon name="close" size={20} /></button></header><div className="ui-drawer-body"><div className="ui-detail-grid"><div><span>任务状态</span><strong><span className="ui-status" data-tone={stateTones[selectedTask.state]}>{stateLabels[selectedTask.state]}</span></strong></div><div><span>负责人</span><strong>{selectedTask.owner}</strong></div><div><span>所属主题</span><strong>{selectedTask.theme}</strong></div><div><span>计划时间</span><strong>10 月 3 日 {selectedTask.time}</strong></div></div>
        {handled.includes(selectedTask.id) && <div className="ui-notice"><Icon name="check" size={16} /><span>已记录本页模拟处置；实际执行与连接状态未发生变化。</span></div>}
        <section className="ui-detail-section"><h3>任务步骤</h3><ol className="ui-step-list">{selectedTask.steps.map((step, index) => <li key={step}><span className="ui-step-number">{index + 1}</span><div><strong>{step}</strong><small>{selectedTask.state === "done" && !handled.includes(selectedTask.id) ? "样例步骤已完成" : index === 0 ? "当前检查项" : "等待前序确认"}</small></div></li>)}</ol></section>
        <section className="ui-detail-section"><h3>来源与范围</h3><p>{selectedTask.source}</p><span className="ui-status" data-tone="neutral">固定模拟样例</span></section>
        <section className="ui-detail-section"><h3>阻塞原因</h3>{selectedTask.blocker ? <div className="ui-blocker"><Icon name="alert" size={16} /><p>{selectedTask.blocker}</p></div> : <p>本项模拟任务没有待确认的阻塞。真实执行仍需接通对应业务连接。</p>}</section>
        <section className="ui-detail-section"><h3>运行记录</h3><ol className="ui-log-list"><li className="ui-log-item"><span className="ui-status-dot" data-tone="neutral" /><div><span>模拟调度创建任务</span><small>2026-10-03 {selectedTask.time} · 固定样例</small></div></li><li className="ui-log-item"><span className="ui-status-dot" data-tone={stateTones[selectedTask.state]} /><div><span>{handled.includes(selectedTask.id) ? "本页人工模拟处置已记录" : `${stateLabels[selectedTask.state]} · 演示状态`}</span><small>没有外部发布、投放或真实客户数据写入</small></div></li></ol></section>
      </div><footer className="ui-drawer-footer"><button type="button" className="ui-button ui-button-secondary" onClick={() => drawer.current?.close()}>关闭</button><button type="button" className="ui-button ui-button-primary" disabled={selectedTask.state === "done" || handled.includes(selectedTask.id)} onClick={handleTask}><Icon name="check" size={16} />{selectedTask.state === "done" ? "已完成" : handled.includes(selectedTask.id) ? "处置已记录" : "记录处置"}</button><span>仅模拟处置</span></footer></>}
    </dialog>
  </>;
}
