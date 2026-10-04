import { createHash, randomUUID } from "node:crypto";
import { spawn, spawnSync } from "node:child_process";
import { closeSync, createReadStream, openSync } from "node:fs";
import { chmod, mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, isAbsolute, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const repository = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const dockerArgs = process.env.BORAN_DOCKER_HOST ? ["--host", process.env.BORAN_DOCKER_HOST] : [];
const dockerBin = process.env.BORAN_DOCKER_BIN ?? "docker";
function docker(args, options = {}) {
  const result = spawnSync(dockerBin, [...dockerArgs, ...args], { cwd: repository, encoding: "utf8", maxBuffer: 64 * 1024 * 1024, ...options });
  if (result.status !== 0) throw new Error("A backup Docker operation failed; running business data was not restored or replaced");
  return result.stdout.trim();
}
async function digest(path) {
  const hash = createHash("sha256");
  for await (const chunk of createReadStream(path)) hash.update(chunk);
  return hash.digest("hex");
}
function tableChecks(psql) {
  const names = psql("SELECT tablename FROM pg_tables WHERE schemaname='public' ORDER BY tablename;").split("\n").filter(Boolean);
  return names.map(name => {
    if (!/^[a-z_][a-z0-9_]*$/.test(name)) throw new Error("Unexpected table name in backup schema");
    const [count, hash] = psql(`SELECT count(*),md5(coalesce(string_agg(md5(to_jsonb(t)::text),'' ORDER BY md5(to_jsonb(t)::text)),'')) FROM public."${name}" t;`).split("|");
    return { table: name, rows: Number(count), digest: hash };
  });
}
function volumeManifest(volume, image) {
  return JSON.parse(docker(["run", "--rm", "--network", "none", "--read-only", "--mount", `type=volume,src=${volume},dst=/source,readonly`, "--mount", `type=bind,src=${join(repository, "scripts/private-file-manifest.mjs")},dst=/manifest.mjs,readonly`, image, "node", "/manifest.mjs", "/source"]));
}
async function dumpToFile(compose, user, database, path) {
  const output = openSync(path, "wx", 0o600);
  try {
    await new Promise((resolvePromise, reject) => {
      const child = spawn(dockerBin, [...dockerArgs, ...compose, "exec", "-T", "postgres", "pg_dump", "--username", user, "--dbname", database, "--format=custom", "--no-owner"], { cwd: repository, stdio: ["ignore", output, "ignore"] });
      child.once("error", () => reject(new Error("Database backup could not start")));
      child.once("exit", code => code === 0 ? resolvePromise() : reject(new Error("Database backup failed")));
    });
  } finally { closeSync(output); }
}
async function waitForDatabase(container) {
  for (let attempt = 0; attempt < 60; attempt++) {
    // The entrypoint's temporary Unix-only server is not the final initialized database.
    const result = spawnSync(dockerBin, [...dockerArgs, "exec", container, "psql", "-h", "127.0.0.1", "-U", "restore_owner", "-d", "restore_check", "-At", "-c", "SELECT 1;"], { stdio: "ignore" });
    if (result.status === 0) return;
    await new Promise(resolvePromise => setTimeout(resolvePromise, 500));
  }
  throw new Error("Isolated restore database did not become ready");
}
/** Restores only into freshly named, network-isolated containers/volumes; never into the running project. */
export async function verifyPrivateBackup(directory) {
  const manifest = JSON.parse(await readFile(join(directory, "manifest.json"), "utf8"));
  if (manifest.format !== "boran-private-backup-v1" || !Array.isArray(manifest.archives) || !Array.isArray(manifest.tables)) throw new Error("Unsupported backup manifest");
  const validName = name => typeof name === "string" && /^[a-z0-9-]+\.(dump|tar)$/.test(name);
  for (const archive of [manifest.database, ...manifest.archives]) {
    if (!validName(archive.file) || await digest(join(directory, archive.file)) !== archive.sha256) throw new Error("Private backup file checksum mismatch");
  }
  const container = `boran-restore-check-${randomUUID()}`, volumes = [];
  try {
    docker(["run", "--detach", "--name", container, "--network", "none", "--mount", `type=bind,src=${directory},dst=/backup,readonly`, "--env", "POSTGRES_USER=restore_owner", "--env", "POSTGRES_DB=restore_check", "--env", "POSTGRES_HOST_AUTH_METHOD=trust", manifest.postgresImage]);
    await waitForDatabase(container);
    docker(["exec", container, "pg_restore", "--username", "restore_owner", "--dbname", "restore_check", "--no-owner", "--exit-on-error", `/backup/${manifest.database.file}`]);
    const checks = tableChecks(sql => docker(["exec", container, "psql", "-U", "restore_owner", "-d", "restore_check", "-At", "-c", sql]));
    if (JSON.stringify(checks) !== JSON.stringify(manifest.tables)) throw new Error("Isolated database restore differs in table counts or row digests");
    for (const archive of manifest.archives) {
      const volume = `boran-restore-volume-${randomUUID()}`; volumes.push(volume); docker(["volume", "create", volume]);
      docker(["run", "--rm", "--network", "none", "--mount", `type=volume,src=${volume},dst=/target`, "--mount", `type=bind,src=${directory},dst=/backup,readonly`, manifest.postgresImage, "tar", "--numeric-owner", "-C", "/target", "-xf", `/backup/${archive.file}`]);
      if (JSON.stringify(volumeManifest(volume, manifest.nodeImage)) !== JSON.stringify(archive.entries)) throw new Error("Isolated private-volume restore differs in content, permissions or ownership");
    }
    const result = { verifiedAt: new Date().toISOString(), tables: checks.length, archives: manifest.archives.length, databaseCountsAndDigestsMatch: true, privateVolumeContentsAndPermissionsMatch: true };
    await writeFile(join(directory, "restore-verification.json"), JSON.stringify(result, null, 2), { mode: 0o600 });
    return result;
  } finally {
    spawnSync(dockerBin, [...dockerArgs, "rm", "-f", container], { stdio: "ignore" });
    for (const volume of volumes) spawnSync(dockerBin, [...dockerArgs, "volume", "rm", volume], { stdio: "ignore" });
  }
}
export async function createPrivateBackup(directory, composeFiles = [join(repository, "infra/compose.yaml")], expectedProject = "boran-marketing-local") {
  if (!isAbsolute(directory) || directory.includes(",")) throw new Error("Private backup destination must be an absolute path without commas");
  await mkdir(directory, { recursive: false, mode: 0o700 }); await chmod(directory, 0o700);
  const compose = ["compose", ...composeFiles.flatMap(file => ["-f", resolve(file)])];
  const configuration = JSON.parse(docker([...compose, "config", "--format", "json"]));
  if (configuration.name !== expectedProject) throw new Error("Backup project differs from the explicitly expected existing project");
  const database = configuration.services.postgres.environment.POSTGRES_DB, user = configuration.services.postgres.environment.POSTGRES_USER;
  const postgresImage = configuration.services.postgres.image, nodeImage = "node:24.19.0-bookworm-slim";
  const running = docker([...compose, "ps", "--status", "running", "--services"]).split("\n").filter(name => ["ops", "public-site", "worker", "browser-runtime"].includes(name));
  let stopped = false;
  try {
    if (running.length) { stopped = true; docker([...compose, "stop", ...running]); }
    const tables = tableChecks(sql => docker([...compose, "exec", "-T", "postgres", "psql", "-U", user, "-d", database, "-At", "-c", sql]));
    const databaseFile = "database.dump"; await dumpToFile(compose, user, database, join(directory, databaseFile));
    const archives = [];
    for (const key of ["media-data", "browser-profiles", "sources-data", "secrets-data"]) {
      const volume = configuration.volumes[key]?.name;
      if (!volume) continue;
      const exists = spawnSync(dockerBin, [...dockerArgs, "volume", "inspect", volume], { stdio: "ignore" });
      if (exists.status !== 0) continue;
      const entries = volumeManifest(volume, nodeImage), file = `${key}.tar`;
      // Precreate as the host owner: a root tar process must not leave an unmanageable root-owned backup.
      await writeFile(join(directory, file), Buffer.alloc(0), { mode: 0o600, flag: "wx" });
      docker(["run", "--rm", "--network", "none", "--read-only", "--mount", `type=volume,src=${volume},dst=/source,readonly`, "--mount", `type=bind,src=${directory},dst=/backup`, postgresImage, "tar", "--numeric-owner", "-C", "/source", "-cf", `/backup/${file}`, "."]);
      await chmod(join(directory, file), 0o600);
      archives.push({ volume: key, file, sha256: await digest(join(directory, file)), entries });
    }
    const manifest = { format: "boran-private-backup-v1", createdAt: new Date().toISOString(), project: configuration.name, postgresImage, nodeImage, database: { file: databaseFile, sha256: await digest(join(directory, databaseFile)) }, tables, archives };
    await writeFile(join(directory, "manifest.json"), JSON.stringify(manifest, null, 2), { mode: 0o600 });
    // Resume the exact containers that were running. Verification then uses separate resources.
    if (stopped) { docker([...compose, "start", ...running]); stopped = false; }
    return await verifyPrivateBackup(directory);
  } finally { if (stopped) docker([...compose, "start", ...running]); }
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const [action, destination, ...files] = process.argv.slice(2);
  if (!destination || !["backup", "verify"].includes(action)) throw new Error("Usage: node scripts/private-backup.mjs backup|verify /absolute/private/backup [compose-file ...]");
  const operation = action === "backup" ? createPrivateBackup(resolve(destination), files.length ? files : undefined) : verifyPrivateBackup(resolve(destination));
  operation.then(result => process.stdout.write(JSON.stringify(result) + "\n")).catch(() => { process.stderr.write("Private backup or isolated restore verification failed; inspect the private destination. Existing project volumes were not overwritten.\n"); process.exitCode = 1; });
}
