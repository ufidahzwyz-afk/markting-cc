import type { Metadata } from "next";
import { requirePrivacyConfiguration } from "@boran/domain/privacy";
import { publicContext } from "@/lib/runtime";
export const metadata: Metadata = { title: "咨询处理告知", robots: { index: false, follow: false } };
export default async function Privacy() {
  let configuration: Awaited<ReturnType<typeof requirePrivacyConfiguration>> | undefined;
  try {
    const ctx = await publicContext();
    const internalTest = ctx.mode === "mock" && ["development", "test"].includes(process.env.APP_ENV ?? "production") && process.env.AUTH_MODE === "mock" && process.env.PUBLIC_SITE_ALLOW_MOCK_FORMS === "true";
    configuration = await requirePrivacyConfiguration(ctx, { internalTest });
  } catch { /* privacy gate remains closed */ }
  return <div className="public-placeholder"><h1>咨询处理告知</h1>{configuration ? <><p style={{ whiteSpace: "pre-wrap" }}>{configuration.notice_text}</p><p>告知版本：{configuration.notice_version}</p></> : <p>咨询处理告知、保留期与权利处理配置尚未完成，当前不接收真实联系方式。</p>}</div>;
}
