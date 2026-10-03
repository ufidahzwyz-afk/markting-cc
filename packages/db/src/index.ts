import { mkdir, readdir, open, readFile, unlink } from "node:fs/promises";
import { resolve } from "node:path";
import { PGlite } from "@electric-sql/pglite";
import { migrateDatabase } from "./migrate";
import { seedDemo } from "./seed";

export interface SqlExecutor {
  query<T extends Record<string, unknown> = Record<string, unknown>>(sql: string, params?: unknown[]): Promise<{ rows: T[]; rowCount: number }>;
}
export interface Database extends SqlExecutor {
  transaction<T>(fn: (tx: SqlExecutor) => Promise<T>): Promise<T>;
  close(): Promise<void>;
}
export const DEMO_ORG_ID = "00000000-0000-4000-8000-000000000001";
export const DEMO_OWNER_ID = "00000000-0000-4000-8000-000000000002";
export const DEMO_MARKETER_ID = "00000000-0000-4000-8000-000000000003";

function serializedPglite(engine: PGlite): Database {
  let tail: Promise<unknown> = Promise.resolve();
  let closed = false;
  function serialize<T>(fn: () => Promise<T>): Promise<T> {
    const next = tail.then(() => { if (closed) throw new Error("Database is closed"); return fn(); });
    tail = next.catch(() => undefined);
    return next;
  }
  const executor: SqlExecutor = { async query<T extends Record<string, unknown>>(sql: string, params?: unknown[]) {
    const result = await engine.query<T>(sql, params);
    return { rows: result.rows, rowCount: Math.max(result.affectedRows ?? 0, result.rows.length) };
  } };
  return {
    query: <T extends Record<string, unknown>>(sql: string, params?: unknown[]) => serialize(() => executor.query<T>(sql, params)),
    transaction: <T>(fn: (tx: SqlExecutor) => Promise<T>) => serialize(() => engine.transaction(async (tx) => fn({ async query<R extends Record<string, unknown>>(sql: string, params?: unknown[]) {
      const result = await tx.query<R>(sql, params);
      return { rows: result.rows, rowCount: Math.max(result.affectedRows ?? 0, result.rows.length) };
    } }))),
    close: () => serialize(async () => { closed = true; await engine.close(); }),
  };
}

const cacheKey = Symbol.for("boran.local-database-cache");
const globalCache = globalThis as typeof globalThis & { [cacheKey]?: Map<string, Promise<Database>> };
const cache = globalCache[cacheKey] ??= new Map<string, Promise<Database>>();

export async function openDatabase(options: { url?: string; dataDir?: string; mode?: "mock" | "live"; initialize?: boolean } = {}): Promise<Database> {
  const mode = options.mode ?? (process.env.BORAN_MODE === "live" ? "live" : "mock");
  const url = options.url ?? process.env.DATABASE_URL;
  if (url) {
    const { Pool, types } = await import("pg");
    const configuredMax = Number(process.env.DATABASE_POOL_MAX ?? 5);
    if (!Number.isInteger(configuredMax) || configuredMax < 1 || configuredMax > 20) throw new Error("DATABASE_POOL_MAX must be 1..20");
    // DATE is a calendar value. The default pg parser creates a local midnight
    // Date, which shifts business dates when callers serialize it as UTC.
    // Keep the override pool-local so unrelated pg consumers retain their parsers.
    const pool = new Pool({ connectionString: url, max: configuredMax, types: {
      getTypeParser(oid, format) {
        if (oid === 1082 && format !== "binary") return (value: string) => value;
        return types.getTypeParser(oid, format);
      },
    } });
    try { await pool.query("SELECT 1"); } catch (error) { await pool.end(); throw error; }
    return {
      async query<T extends Record<string, unknown>>(sql: string, params?: unknown[]) { const result = await pool.query<T>(sql, params); return { rows: result.rows, rowCount: result.rowCount ?? result.rows.length }; },
      async transaction<T>(fn: (tx: SqlExecutor) => Promise<T>) {
        const client = await pool.connect();
        try {
          await client.query("BEGIN");
          const result = await fn({ async query<R extends Record<string, unknown>>(sql: string, params?: unknown[]) { const value = await client.query<R>(sql, params); return { rows: value.rows, rowCount: value.rowCount ?? value.rows.length }; } });
          await client.query("COMMIT"); return result;
        } catch (error) { await client.query("ROLLBACK"); throw error; } finally { client.release(); }
      },
      close: () => pool.end(),
    };
  }
  if (mode === "live") throw new Error("DATABASE_URL is required in live mode; no mock fallback is permitted");
  // Local database files belong to runtime storage, never to a deployment bundle.
  const path = resolve(/* turbopackIgnore: true */ options.dataDir ?? process.env.BORAN_DATA_DIR ?? ".local/postgres");
  if (!cache.has(path)) cache.set(path, (async () => {
    if (options.initialize === false) {
      try { if (!(await readdir(/* turbopackIgnore: true */ path)).length) throw new Error("empty"); } catch { throw new Error("Existing database is required; initialize it before public requests"); }
    } else await mkdir(path, { recursive: true });
    const lockPath = `${path}.writer.lock`;
    let lock;
    try { lock = await open(lockPath, "wx", 0o600); }
    catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
      const pid = Number(await readFile(lockPath, "utf8"));
      if (!Number.isSafeInteger(pid) || pid < 1) throw new Error("Local database writer lock is invalid; inspect it before recovery");
      try { process.kill(pid, 0); throw new Error("Local database already has an active writer; use PostgreSQL for multiple processes"); }
      catch (probe) { if ((probe as NodeJS.ErrnoException).code !== "ESRCH") throw probe; }
      await unlink(lockPath); lock = await open(lockPath, "wx", 0o600);
    }
    await lock.writeFile(String(process.pid));
    await lock.close();
    const db = serializedPglite(new PGlite(path));
    const closeEngine = db.close;
    db.close = async () => { cache.delete(path); try { await closeEngine(); } finally { await unlink(lockPath).catch(() => undefined); } };
    try { if (options.initialize !== false) { await migrateDatabase(db); await seedDemo(db); } return db; }
    catch (error) { await db.close(); throw error; }
  })().catch((error: unknown) => { cache.delete(path); throw error; }));
  // Persistent local connections live for the process; close only on process shutdown.
  return cache.get(path)!;
}

export async function createTestDatabase(): Promise<Database> {
  const db = serializedPglite(new PGlite());
  try { await migrateDatabase(db); await seedDemo(db); return db; } catch (error) { await db.close(); throw error; }
}
export { migrateDatabase, rollbackDatabase } from "./migrate";
export { seedDemo } from "./seed";
