import type { MetadataRoute } from "next";
import { publicMode, sitePolicy } from "@/lib/runtime";
export default function robots(): MetadataRoute.Robots {
  try { const policy = sitePolicy(); return publicMode() === "live" ? { rules: { userAgent: "*", allow: policy.allowedPathPrefixes.map((path) => `${path}/`), disallow: ["/preview/", "/api/", "/media/"] }, sitemap: `${policy.publicOrigin}/sitemap.xml` } : { rules: { userAgent: "*", disallow: "/" } }; }
  catch { return { rules: { userAgent: "*", disallow: "/" } }; }
}
