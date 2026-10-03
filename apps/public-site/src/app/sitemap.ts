import type { MetadataRoute } from "next";
import { publicContext } from "@/lib/runtime";
export const dynamic = "force-dynamic";
export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const ctx = await publicContext(); if (ctx.mode === "mock") return [];
  const pages = await ctx.db.query("SELECT r.seo_snapshot,r.published_at FROM pages p JOIN releases r ON r.org_id=p.org_id AND r.id=p.published_release_id WHERE p.org_id=$1 AND p.owner_system='marketing' AND r.seo_snapshot->>'index_policy'='index' ORDER BY p.path", [ctx.orgId]);
  return pages.rows.map((row) => ({ url: String((row.seo_snapshot as Record<string, unknown>).canonical), lastModified: new Date(String(row.published_at)) }));
}
