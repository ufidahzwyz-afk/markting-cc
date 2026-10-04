import { mkdir, open, readFile, writeFile, unlink, type FileHandle } from "node:fs/promises";
import { resolve } from "node:path";
import { randomUUID } from "node:crypto";
import { chromium, type BrowserContext } from "playwright";
import { ConnectorBlockedError, getPlatformDescriptor } from "@boran/connectors";

export interface ProfileLease { context: BrowserContext; profileRef: string; close(): Promise<void> }
/** Exclusive filesystem locks survive process failure. Stale files require an explicit stopped-process recovery. */
export class BrowserProfilePool {
  private readonly bootId = randomUUID();
  private readonly active = new Map<string, ProfileLease>();
  constructor(private readonly options: { root: string; encryptedVolumeConfirmed: boolean; executablePath?: string; mode: "mock" | "live"; proxyServer?: string; additionalOriginsByChannel?: Readonly<Record<string, readonly string[]>> }) {}
  private validateId(id: string) { if (!/^[0-9a-f-]{36}$/i.test(id)) throw new ConnectorBlockedError("invalid_profile_identity"); }
  async acquire(input: { orgId: string; accountId: string; fencingToken: number; channelId: string; allowedOrigins?: readonly string[] }): Promise<ProfileLease> {
    this.validateId(input.orgId); this.validateId(input.accountId);
    if (this.options.mode === "live" && !this.options.encryptedVolumeConfirmed) throw new ConnectorBlockedError("encrypted_profile_not_configured");
    if (!Number.isSafeInteger(input.fencingToken) || input.fencingToken < 1) throw new ConnectorBlockedError("invalid_profile_fencing");
    const configured = this.options.additionalOriginsByChannel?.[input.channelId];
    const approvedOrigins = configured ?? getPlatformDescriptor(input.channelId).allowedOrigins;
    const origins = input.allowedOrigins ?? approvedOrigins;
    if (!origins.length || origins.some(origin => !approvedOrigins.includes(origin) || new URL(origin).protocol !== "https:" || new URL(origin).origin !== origin)) throw new ConnectorBlockedError("invalid_profile_scope");
    const key = `${input.orgId}/${input.accountId}`;
    const root = resolve(this.options.root);
    await mkdir(resolve(root, "locks"), { recursive: true, mode: 0o700 });
    const accountLockPath = resolve(root, "locks", `${input.orgId}_${input.accountId}.lock`);
    let accountLock: FileHandle;
    try { accountLock = await open(accountLockPath, "wx", 0o600); } catch { throw new ConnectorBlockedError("profile_busy_or_recovery_required"); }
    let slot: FileHandle | undefined;
    let slotPath = "";
    let context: BrowserContext | undefined;
    try {
      for (let index = 0; index < 2; index++) {
        const path = resolve(root, "locks", `slot-${index}.lock`);
        try { slot = await open(path, "wx", 0o600); slotPath = path; break; } catch { /* occupied slot */ }
      }
      if (!slot) throw new ConnectorBlockedError("browser_capacity_exhausted");
      const metadata = JSON.stringify({ bootId: this.bootId, processId: process.pid, orgId: input.orgId, accountId: input.accountId, fencingToken: input.fencingToken });
      await accountLock.writeFile(metadata); await slot.writeFile(metadata);
      const profile = resolve(root, input.orgId, input.accountId);
      await mkdir(profile, { recursive: true, mode: 0o700 });
      const bindingFile = resolve(profile, "boran-binding.json");
      let binding: { orgId: string; accountId: string; channelId: string; fencingToken: number } | undefined;
      try { binding = JSON.parse(await readFile(bindingFile, "utf8")) as typeof binding; } catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw new ConnectorBlockedError("profile_binding_invalid"); }
      if (binding && (binding.orgId !== input.orgId || binding.accountId !== input.accountId || binding.channelId !== input.channelId || binding.fencingToken >= input.fencingToken)) throw new ConnectorBlockedError("profile_binding_or_fence_mismatch");
      await writeFile(bindingFile, JSON.stringify({ orgId: input.orgId, accountId: input.accountId, channelId: input.channelId, fencingToken: input.fencingToken }), { mode: 0o600 });
      context = await chromium.launchPersistentContext(profile, { headless: true, ...(this.options.executablePath ? { executablePath: this.options.executablePath } : {}), ...(this.options.proxyServer ? { proxy: { server: this.options.proxyServer } } : {}), args: ["--disable-dev-shm-usage", "--disable-save-password-bubble"], serviceWorkers: "block", acceptDownloads: false });
      await context.route("**/*", async (route) => {
        const url = new URL(route.request().url());
        // The first adapter POC must explicitly enumerate any additional resource/auth origins it needs.
        if ((url.protocol === "https:" && origins.includes(url.origin)) || url.protocol === "data:") await route.continue();
        else await route.abort("blockedbyclient");
      });
      let closed = false;
      const lease: ProfileLease = { context, profileRef: `private-profile:${key}`, close: async () => {
        if (closed) return;
        // A failed browser close preserves both locks, preventing another process from opening the live profile.
        await context!.close();
        closed = true;
        await accountLock.close(); await slot!.close();
        await unlink(accountLockPath); await unlink(slotPath);
        this.active.delete(key);
      } };
      this.active.set(key, lease);
      return lease;
    } catch (error) {
      if (context) {
        try { await context.close(); } catch { throw new ConnectorBlockedError("browser_shutdown_recovery_required"); }
      }
      await accountLock.close(); await unlink(accountLockPath).catch(() => undefined);
      if (slot) { await slot.close(); await unlink(slotPath).catch(() => undefined); }
      throw error;
    }
  }
  async withProfile<T>(input: Parameters<BrowserProfilePool["acquire"]>[0], run: (context: unknown) => Promise<T>): Promise<T> {
    const lease = await this.acquire(input);
    try { return await run(lease.context); } finally { await lease.close(); }
  }
  async shutdown() { await Promise.all([...this.active.values()].map((lease) => lease.close())); }
}
