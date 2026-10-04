import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { lstat, readdir, readlink } from "node:fs/promises";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";

export async function privateFileManifest(root) {
  const entries = [];
  async function visit(relative) {
    const path = join(root, relative), info = await lstat(path);
    const metadata = { path: relative || ".", mode: info.mode & 0o777, uid: info.uid, gid: info.gid };
    if (info.isDirectory()) {
      entries.push({ ...metadata, type: "directory" });
      for (const name of (await readdir(path)).sort()) await visit(relative ? `${relative}/${name}` : name);
    } else if (info.isFile()) {
      const hash = createHash("sha256");
      for await (const chunk of createReadStream(path)) hash.update(chunk);
      entries.push({ ...metadata, type: "file", bytes: info.size, sha256: hash.digest("hex") });
    } else if (info.isSymbolicLink()) entries.push({ ...metadata, type: "symlink", target: await readlink(path) });
    else throw new Error("Unsupported special file in private backup volume");
  }
  await visit(""); return entries;
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  if (!process.argv[2]) throw new Error("Manifest root is required");
  privateFileManifest(resolve(process.argv[2])).then(entries => process.stdout.write(JSON.stringify(entries))).catch(() => { process.stderr.write("Private file manifest failed.\n"); process.exitCode = 1; });
}
