import { createHash } from "node:crypto";
import { readFile, realpath, stat } from "node:fs/promises";
import path from "node:path";
import { DomainError } from "@boran/domain/core";
import type { AssetFile, AssetVerifier } from "@boran/domain/content";
export const verifyLocalAsset: AssetVerifier = async (asset: AssetFile) => {
  const configured = process.env.BORAN_MEDIA_ROOT;
  if (!configured) throw new DomainError("MEDIA_STORAGE_REQUIRED", 503, "实际媒体存储尚未配置");
  if (!asset.object_key || path.isAbsolute(asset.object_key) || asset.object_key.includes("\\") || asset.object_key.split("/").some((part) => part === ".." || part === "." || !part)) throw new DomainError("UNSAFE_MEDIA_PATH", 422, "素材对象路径无效");
  const root = await realpath(configured); const file = await realpath(path.join(root, asset.object_key));
  if (!file.startsWith(`${root}${path.sep}`)) throw new DomainError("UNSAFE_MEDIA_PATH", 422, "素材对象越过存储边界");
  const info = await stat(file);
  if (!info.isFile() || info.size < 1 || info.size > 50 * 1024 * 1024) throw new DomainError("MEDIA_SIZE_INVALID", 422, "实际素材文件大小无效");
  const bytes = await readFile(file);
  if (createHash("sha256").update(bytes).digest("hex") !== asset.content_hash) throw new DomainError("MEDIA_HASH_MISMATCH", 422, "媒体文件已发生变化");
  return { bytes, mimeType: asset.mime_type };
};
