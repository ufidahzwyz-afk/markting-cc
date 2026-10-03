"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useRef } from "react";
import type { ReactNode } from "react";
import { Badge } from "@boran/ui";
import { Icon } from "./icon";
import { SettingsContent } from "./settings-content";

const navigation = [
  { href: "/overview", label: "今日工作", icon: "grid" as const, description: "概览与待办" },
  { href: "/themes", label: "推广主题", icon: "layers" as const, description: "主题与内容" },
  { href: "/reports", label: "效果复盘", icon: "chart" as const, description: "数据与洞察" },
];

export function Shell({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const settingsDialog = useRef<HTMLDialogElement>(null);
  const current = navigation.find((item) => pathname.startsWith(item.href));
  return <div className="app-shell">
    <a className="skip-link" href="#main-content">跳到主要内容</a>
    <aside className="sidebar" aria-label="工作台导航">
      <Link className="brand" href="/overview" aria-label="泊冉 · 返回今日工作"><span className="brand-mark" aria-hidden="true"><span /><span /><span /></span><span className="brand-word">泊冉<small>营销工作台</small></span></Link>
      <div className="workspace-label">MARKETING OPERATIONS</div>
      <nav className="primary-nav">{navigation.map((item) => <Link key={item.href} href={item.href} className={`nav-item ${pathname.startsWith(item.href) ? "active" : ""}`} aria-current={pathname.startsWith(item.href) ? "page" : undefined}><Icon name={item.icon} /><span>{item.label}</span>{item.href === "/overview" && <span className="nav-count">3</span>}</Link>)}</nav>
      <div className="sidebar-bottom"><div className="sidebar-status"><span className="status-dot" /><div><strong>系统尚未接通</strong><span>真实执行已关闭</span></div></div><button type="button" className="settings-button" onClick={() => settingsDialog.current?.showModal()}><Icon name="gear" /><span>系统设置</span><Icon name="chevron" size={16} /></button><div className="team-card"><span className="avatar">泊</span><div><strong>泊冉工作空间</strong><span>本地演练身份</span></div><Badge>DEV</Badge></div></div>
    </aside>
    <div className="workspace">
      <header className="topbar"><div className="breadcrumb"><span>工作台</span><Icon name="chevron" size={14} /><strong>{current?.label ?? "系统设置"}</strong></div><div className="topbar-actions"><Badge tone="amber" dot>开发环境 · 模拟数据</Badge><button type="button" className="icon-button mobile-settings" aria-label="打开系统设置" onClick={() => settingsDialog.current?.showModal()}><Icon name="gear" /></button><span className="header-avatar" aria-label="本地模拟身份">泊</span></div></header>
      <main id="main-content" className="main-content" tabIndex={-1}>{children}</main>
      <footer className="workspace-footer"><span>泊冉市场推广自动化系统</span><span>M0 界面预览 · 数据与执行均为隔离演练</span></footer>
    </div>
    <dialog className="settings-dialog" ref={settingsDialog} aria-labelledby="settings-title" onClick={(event) => { if (event.target === event.currentTarget) settingsDialog.current?.close(); }}>
      <div className="drawer-body"><header className="drawer-header"><div><p className="eyebrow">WORKSPACE SETTINGS</p><h2 id="settings-title">系统设置</h2></div><button type="button" className="icon-button" aria-label="关闭系统设置" onClick={() => settingsDialog.current?.close()}><Icon name="close" /></button></header><SettingsContent /><footer className="drawer-footer"><Badge tone="amber">模拟环境</Badge><span>所有设置为只读预览</span></footer></div>
    </dialog>
  </div>;
}
