"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useRef, useState } from "react";
import type { ReactNode } from "react";
import { Icon } from "./icon";
import { SettingsContent } from "./settings-content";
import { api } from "@/lib/client-api";

const navigation = [
  { href: "/overview", label: "今日工作", icon: "grid" as const },
  { href: "/themes", label: "推广主题", icon: "layers" as const },
  { href: "/content", label: "内容与官网", icon: "layers" as const },
  { href: "/leads", label: "共享线索", icon: "grid" as const },
  { href: "/reports", label: "效果复盘", icon: "chart" as const },
];

export function Shell({ children, mode, actorName }: { children: ReactNode; mode: "mock" | "live"; actorName: string }) {
  const [switchError, setSwitchError] = useState("");
  async function switchActor(actor_id: string) { try { await api("/session/actor", { method: "POST", body: { actor_id } }); window.location.reload(); } catch(error) { setSwitchError(error instanceof Error ? error.message : "账号切换失败"); } }
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
      <div className="sidebar-bottom"><button className="settings-button" type="button" onClick={() => settings.current?.showModal()}><Icon name="gear" size={18} />连接与执行规则</button><div className="workspace-user"><span className="ui-avatar">运</span><div><strong>{actorName}</strong><span>{mode === "mock" ? "本地测试空间" : "组织工作空间"}</span></div></div></div>
    </aside>
    <div className="workspace">
      <header className="topbar"><div className="breadcrumb"><span>市场运营</span><Icon name="chevron" size={13} /><strong>{current?.label ?? "系统设置"}</strong></div><div className="topbar-actions"><span className="preview-label"><span />{mode === "mock" ? "本地测试 · 数据库已接入" : "组织工作空间"}</span><button type="button" className="ui-icon-button" aria-label="打开系统设置" onClick={() => settings.current?.showModal()}><Icon name="gear" size={18} /></button><span className="ui-avatar" aria-label={actorName}>运</span></div></header>
      <main id="main-content" className="main-content" tabIndex={-1}>{children}</main>
      <footer className="workspace-footer"><span>{mode === "mock" ? "本地测试工作空间" : "组织工作空间"}</span><span>外部发布与广告写入已关闭</span></footer>
    </div>
    <dialog className="ui-drawer settings-dialog" ref={settings} aria-labelledby="settings-title" onClick={event => { if (event.target === event.currentTarget) settings.current?.close(); }}>
      <header className="ui-drawer-header"><div><span className="ui-small-label">工作空间设置</span><h2 id="settings-title">连接与执行规则</h2></div><button type="button" className="ui-icon-button" aria-label="关闭系统设置" onClick={() => settings.current?.close()}><Icon name="close" size={19} /></button></header>
      <div className="ui-drawer-body">{mode === "mock" && <div className="ui-inline-note"><span>切换测试运营</span><button className="ui-button" type="button" onClick={() => switchActor("00000000-0000-4000-8000-000000000002")}>运营 A</button><button className="ui-button" type="button" onClick={() => switchActor("00000000-0000-4000-8000-000000000003")}>运营 B</button>{switchError && <p role="alert">{switchError}</p>}</div>}<SettingsContent /></div><footer className="ui-drawer-footer"><span>规则及连接状态从数据库读取</span><button type="button" className="ui-button" onClick={() => settings.current?.close()}>关闭</button></footer>
    </dialog>
  </div>;
}
