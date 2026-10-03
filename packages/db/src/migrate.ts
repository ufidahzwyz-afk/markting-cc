import { createHash } from "node:crypto";
import { readdir, readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import type { Database } from "./index";

const migrationDir = resolve(dirname(fileURLToPath(import.meta.url)), "../migrations");
const digest = (value: string) => createHash("sha256").update(value).digest("hex");
export async function migrateDatabase(db: Database): Promise<number[]> {
  await db.query("CREATE TABLE IF NOT EXISTS schema_migrations (version integer PRIMARY KEY, name text NOT NULL, sha256 char(64) NOT NULL, down_sha256 char(64) NOT NULL, applied_at timestamptz NOT NULL DEFAULT now())");
  const names = (await readdir(migrationDir)).filter((name) => /^\d+_.+\.up\.sql$/.test(name)).sort();
  return db.transaction(async (tx) => {
    await tx.query("LOCK TABLE schema_migrations IN EXCLUSIVE MODE");
    const applied: number[] = [];
    for (const name of names) {
      const version = Number(name.split("_")[0]);
      const sql = await readFile(resolve(migrationDir, name), "utf8");
      const down = await readFile(resolve(migrationDir, name.replace(".up.sql", ".down.sql")), "utf8");
      const existing = (await tx.query("SELECT * FROM schema_migrations WHERE version=$1", [version])).rows[0];
      if (existing) { if (existing.sha256 !== digest(sql) || existing.down_sha256 !== digest(down)) throw new Error(`Migration ${name} has changed after application`); continue; }
      // Drivers accept one SQL statement per query; SQL files use explicit delimiters.
      for (const statement of sql.split("\n-- statement-breakpoint\n").filter((part) => part.trim())) await tx.query(statement);
      await tx.query("INSERT INTO schema_migrations(version,name,sha256,down_sha256) VALUES ($1,$2,$3,$4)", [version, name, digest(sql), digest(down)]);
      applied.push(version);
    }
    return applied;
  });
}
export async function rollbackDatabase(db: Database): Promise<number | null> {
  return db.transaction(async (tx) => {
    await tx.query("LOCK TABLE schema_migrations IN EXCLUSIVE MODE");
    const latest = (await tx.query("SELECT * FROM schema_migrations ORDER BY version DESC LIMIT 1")).rows[0];
    if (!latest) return null;
    const name = String(latest.name).replace(".up.sql", ".down.sql");
    const sql = await readFile(resolve(migrationDir, name), "utf8");
    if (digest(sql) !== latest.down_sha256) throw new Error("Rollback checksum mismatch");
    for (const statement of sql.split("\n-- statement-breakpoint\n").filter((part) => part.trim())) await tx.query(statement);
    await tx.query("DELETE FROM schema_migrations WHERE version=$1", [latest.version]); return Number(latest.version);
  });
}

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  const { openDatabase } = await import("./index");
  const db = await openDatabase();
  try { process.stdout.write(JSON.stringify(process.argv.includes("--down") ? await rollbackDatabase(db) : await migrateDatabase(db)) + "\n"); }
  finally { await db.close(); }
}
