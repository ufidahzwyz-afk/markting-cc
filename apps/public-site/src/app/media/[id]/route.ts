import { publicContext } from "@/lib/runtime";
import { verifyLocalAsset } from "@/lib/media-store";
import type { AssetFile } from "@boran/domain/content";
export const dynamic = "force-dynamic";
export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    if (!/^[0-9a-f-]{36}$/i.test(id)) return new Response(null, { status: 404 });
    const ctx = await publicContext();
    const asset = (await ctx.db.query("SELECT a.* FROM media_assets a WHERE a.org_id=$1 AND a.id=$2 AND a.state='ready' AND a.public_permission='allowed' AND a.license_evidence_ref IS NOT NULL AND EXISTS (SELECT 1 FROM pages p JOIN releases r ON r.org_id=p.org_id AND r.id=p.published_release_id JOIN content_versions v ON v.org_id=r.org_id AND v.id=r.content_version_id WHERE p.org_id=a.org_id AND p.owner_system='marketing' AND EXISTS (SELECT 1 FROM jsonb_array_elements(v.body_json->'modules') m WHERE m->'data'->'media'->>'asset_id'=a.id::text))", [ctx.orgId, id])).rows[0];
    if (!asset || !["image/png", "image/jpeg", "image/webp", "video/mp4", "audio/mpeg"].includes(String(asset.mime_type))) return new Response(null, { status: 404 });
    const file = await verifyLocalAsset(asset as unknown as AssetFile);
    return new Response(Buffer.from(file.bytes), { headers: { "Content-Type": file.mimeType, "Content-Length": String(file.bytes.length), "X-Content-Type-Options": "nosniff", "Cache-Control": "private, max-age=0, must-revalidate", "Content-Security-Policy": "default-src 'none'; sandbox" } });
  } catch { return new Response(null, { status: 404 }); }
}
