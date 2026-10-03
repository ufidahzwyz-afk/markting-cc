import type { Metadata } from "next";
import { SettingsContent } from "@/components/settings-content";
export const metadata: Metadata = { title: "系统设置" };
export default function SettingsPage() {
  return <><div className="ui-page-header"><h1>系统设置</h1><span className="ui-muted">连接、账号与执行范围</span></div><section className="ui-panel ui-settings-page"><SettingsContent /></section></>;
}
