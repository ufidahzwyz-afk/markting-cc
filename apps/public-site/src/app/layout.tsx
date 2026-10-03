import type { ReactNode } from "react";
import type { Metadata } from "next";
import "./styles.css";
export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "泊冉 · 企业数字化服务" };
export default function Layout({ children }: { children: ReactNode }) {
  return <html lang="zh-CN"><body><header className="public-header"><a href="/" className="public-brand">泊冉<span>企业数字化服务</span></a><a href="#lead-form">咨询服务</a></header><main>{children}</main><footer className="public-footer"><span>泊冉企业服务</span><a href="/privacy">咨询处理告知</a></footer></body></html>;
}
