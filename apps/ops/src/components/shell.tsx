"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useRef } from "react";
import type { ReactNode } from "react";
import { Icon } from "./icon";
import { SettingsContent } from "./settings-content";

const navigation = [
  { href: "/overview", label: "今日工作", icon: "grid" as const },
  { href: "/themes", label: "推广主题", icon: "layers" as const },
  { href: "/reports", label: "效果复盘", icon: "chart" as const },
];

export function Shell({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const settings = useRef<HTMLDialogElement>(null);
  const current = navigation.find(item => pathname.startsWith(item.href));
  return <div className="app-shell">
    <a className="skip-link" href="#main-content">跳到主要内容</a>
    <aside className="sidebar" aria-label="工作台导航">
      <Link className="brand" href="/overview" aria-label="泊冉 · 返回今日工作"><span className="brand-monogram">泊</span><span>泊冉<span className="brand-product">市场运营</span></span></Link>
      <div className="workspace-switch"><span className="workspace-square">B</span><div><strong>泊冉工作空间</strong><span>市场团队</span></div><Icon name="chevron" size={14} /></div>
      <div className="nav-group-label">工作台</div>
      <nav className="primary-nav">{navigation.map(item => <Link key={item.href} href={item.href} className={`nav-item ${pathname.startsWith(item.href) ? "active" : ""}`} aria-current={pathname.startsWith(item.href) ? "page" : undefined}><Icon name={item.icon} size={18} /><span>{item.label}</span></Link>)}</nav>
      <div className="sidebar-bottom"><button className="settings-button" type="button" onClick={() => settings.current?.showModal()}><Icon name="gear" size={18} />连接与执行规则</button><div className="workspace-user"><span className="ui-avatar">运</span><div><strong>运营预览账号</strong><span>模拟工作空间</span></div></div></div>
    </aside>
    <div className="workspace">
      <header className="topbar"><div className="breadcrumb"><span>市场运营</span><Icon name="chevron" size={13} /><strong>{current?.label ?? "系统设置"}</strong></div><div className="topbar-actions"><span className="preview-label"><span />界面预览 · 模拟数据</span><button type="button" className="ui-icon-button" aria-label="打开系统设置" onClick={() => settings.current?.showModal()}><Icon name="gear" size={18} /></button><span className="ui-avatar" aria-label="预览账号">运</span></div></header>
      <main id="main-content" className="main-content" tabIndex={-1}>{children}</main>
      <footer className="workspace-footer"><span>本地模拟工作空间</span><span>外部发布与广告写入已关闭</span></footer>
    </div>
    <dialog className="ui-drawer settings-dialog" ref={settings} aria-labelledby="settings-title" onClick={event => { if (event.target === event.currentTarget) settings.current?.close(); }}>
      <header className="ui-drawer-header"><div><span className="ui-small-label">工作空间设置</span><h2 id="settings-title">连接与执行规则</h2></div><button type="button" className="ui-icon-button" aria-label="关闭系统设置" onClick={() => settings.current?.close()}><Icon name="close" size={19} /></button></header>
      <div className="ui-drawer-body"><SettingsContent /></div><footer className="ui-drawer-footer"><span>连接配置将在身份接入后开放</span><button type="button" className="ui-button" onClick={() => settings.current?.close()}>关闭</button></footer>
    </dialog>
  </div>;
}
