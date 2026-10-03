import type { Metadata } from "next";
import type { ReactNode } from "react";
import { Shell } from "@/components/shell";
import { currentOpsAccess } from "@/lib/access";
import "./globals.css";

export const metadata: Metadata = {
  title: { default: "今日工作 · 泊冉营销工作台", template: "%s · 泊冉营销工作台" },
  description: "泊冉市场推广自动化系统 · M0 开发环境界面预览",
  robots: { index: false, follow: false },
};

export const dynamic = "force-dynamic";

export default function RootLayout({ children }: { children: ReactNode }) {
  const access = currentOpsAccess();
  return <html lang="zh-CN"><body>{access.allowed ? <Shell>{children}</Shell> : <main className="identity-gate"><p className="eyebrow">泊冉营销工作台</p><h1>身份接入待配置</h1><p>{access.message}</p></main>}</body></html>;
}
