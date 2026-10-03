import type { Metadata } from "next";
import { SettingsContent } from "@/components/settings-content";

export const metadata: Metadata = { title: "系统设置" };

export default function SettingsPage() {
  return <><div className="page-heading"><div><p className="eyebrow">WORKSPACE SETTINGS</p><h1>系统设置</h1><p>确认连接状态与执行边界。</p></div></div><section className="panel settings-page-panel"><SettingsContent /></section></>;
}
