import { randomBytes } from "node:crypto";
import { chmod, lstat, mkdir, open, readFile, readdir } from "node:fs/promises";
import { dirname, isAbsolute, join } from "node:path";
import { pathToFileURL } from "node:url";

async function directory(path) {
  if (!isAbsolute(path)) throw new Error("Private runtime paths must be absolute");
  await mkdir(path, { recursive: true, mode: 0o700 });
  const info = await lstat(path);
  if (!info.isDirectory() || info.isSymbolicLink()) throw new Error("Private runtime directory is invalid");
  await chmod(path, 0o700);
}
async function initializeKey(path, protectedDirectories) {
  await directory(dirname(path));
  try {
    const info = await lstat(path);
    if (!info.isFile() || info.isSymbolicLink() || info.size !== 32 || (info.mode & 0o077)) throw new Error("Existing runtime key must remain a private 32-byte file");
    return false;
  } catch (error) { if (error.code !== "ENOENT") throw error; }
  for (const existing of protectedDirectories) {
    try { if ((await readdir(existing)).length) throw new Error("Existing encrypted state requires its original key; restore the private backup"); }
    catch (error) { if (error.code !== "ENOENT") throw error; }
  }
  const key = randomBytes(32);
  try {
    const file = await open(path, "wx", 0o600);
    try { await file.writeFile(key); await file.sync(); } finally { await file.close(); }
    const parent = await open(dirname(path), "r");
    try { await parent.sync(); } finally { await parent.close(); }
    return true;
  } catch (error) {
    if (error.code !== "EEXIST") throw error;
    const value = await readFile(path); const valid = value.length === 32; value.fill(0);
    if (!valid) throw new Error("Concurrent runtime key initialization is incomplete; retry without replacing it");
    return false;
  } finally { key.fill(0); }
}
export async function initializePrivateRuntime(env = process.env) {
  const secretRoot = env.BORAN_SECRET_STORE_ROOT;
  const keyFile = env.BORAN_SECRET_KEY_FILE;
  const serviceKey = env.BORAN_SERVICE_KEY_FILE;
  const sourceRoot = env.BORAN_SOURCE_STORE_ROOT;
  const replayRoot = env.BROWSER_LOCAL_REPLAY_ROOT;
  if (!secretRoot || !keyFile || !serviceKey || !sourceRoot || !replayRoot) throw new Error("Private runtime storage paths are not configured");
  for (const path of [secretRoot, sourceRoot, replayRoot]) await directory(path);
  const credentialsKeyCreated = await initializeKey(keyFile, [secretRoot]);
  const serviceKeyCreated = await initializeKey(serviceKey, [replayRoot]);
  return { credentialsKeyCreated, serviceKeyCreated };
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  initializePrivateRuntime().then(result => process.stdout.write(JSON.stringify({ initialized: true, ...result }) + "\n")).catch(() => { process.stderr.write("Private runtime initialization failed; inspect configured paths, permissions and original-key backups. Keys were not printed.\n"); process.exitCode = 1; });
}
