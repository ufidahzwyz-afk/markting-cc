import { cache } from "react";
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { PageRenderer } from "@boran/ui/page-renderer";
import { requirePrivacyConfiguration } from "@boran/domain/privacy";
import { readPublishedPage } from "@boran/domain/content";
import { publicContext, sitePolicy } from "@/lib/runtime";
import { LeadForm } from "../lead-form";
import { PageView } from "../page-view";
const load = cache(async (parts: string[]) => {
  const ctx = await publicContext(); const policy = sitePolicy(); const path = `/${parts.join("/")}`;
  return { ctx, result: await readPublishedPage(ctx.db, ctx.orgId, new URL(policy.publicOrigin).host, path, ctx.mode) };
});
export const dynamic = "force-dynamic";
export async function generateMetadata({ params }: { params: Promise<{ path?: string[] }> }): Promise<Metadata> {
  const { path = [] } = await params;
  try {
    const { ctx, result } = await load(path); if (!result) return { robots: { index: false, follow: false } };
    return { title: result.release.seo_snapshot.title, description: result.release.seo_snapshot.description, alternates: { canonical: result.release.seo_snapshot.canonical }, robots: { index: ctx.mode === "live" && result.release.seo_snapshot.index_policy === "index", follow: ctx.mode === "live" } };
  } catch { return { title: "泊冉 · 站点尚未就绪", robots: { index: false, follow: false } }; }
}
export default async function PublishedPage({ params }: { params: Promise<{ path?: string[] }> }) {
  const { path = [] } = await params;
  let loaded: Awaited<ReturnType<typeof load>>;
  loaded = await load(path);
  const { ctx, result } = loaded; if (!result) notFound();
  let privacy: Awaited<ReturnType<typeof requirePrivacyConfiguration>> | undefined;
  const internalTest = ctx.mode === "mock" && ["development", "test"].includes(process.env.APP_ENV ?? "production") && process.env.AUTH_MODE === "mock" && process.env.PUBLIC_SITE_ALLOW_MOCK_FORMS === "true";
  try { privacy = await requirePrivacyConfiguration(ctx, { internalTest }); } catch { /* remain closed */ }
  const canSubmit = Boolean(privacy);
  const structured = { "@context": "https://schema.org", "@type": result.page.template_key === "article" ? "Article" : "WebPage", headline: result.release.seo_snapshot.title, description: result.release.seo_snapshot.description, url: result.release.seo_snapshot.canonical, datePublished: String(result.release.published_at), publisher: { "@type": "Organization", name: "泊冉" } };
  return <><script type="application/ld+json">{JSON.stringify(structured).replace(/</g, "\\u003c")}</script>{ctx.mode === "mock" && <aside className="public-preview-banner">开发环境 · 模拟数据 · 不代表真实网站发布已验收</aside>}<PageView pageId={result.page.id} releaseId={result.release.id} /><article data-release-id={result.release.id} data-content-hash={result.content.payload_hash} data-mode={ctx.mode}><PageRenderer modules={result.modules} availableMediaIds={result.media.map((asset) => asset.id)} renderLeadForm={(data) => <LeadForm pageId={result.page.id} releaseId={result.release.id} noticeVersion={data.privacy_notice_version} submitLabel={data.submit_label} enabled={canSubmit && privacy?.notice_version === data.privacy_notice_version} mock={ctx.mode === "mock"} allowedChannels={privacy?.allowed_contact_channels ?? []} />} /></article></>;
}
