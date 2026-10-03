import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { BrowserProfilePool } from "../src/profiles";

test("unencrypted live profiles fail closed before launch", async () => {
  const pool = new BrowserProfilePool({ root: "/unused", mode: "live", encryptedVolumeConfirmed: false });
  await assert.rejects(() => pool.acquire({ orgId: randomUUID(), accountId: randomUUID(), fencingToken: 1, channelId: "wechat_mp" }), { code: "encrypted_profile_not_configured" });
});
test("real local Chromium profiles are isolated, locked, capacity limited and released only after close", { skip: !process.env.CHROMIUM_EXECUTABLE_PATH }, async () => {
  const root = await mkdtemp(join(tmpdir(), "boran-profile-test-"));
  const pool = new BrowserProfilePool({ root, mode: "mock", encryptedVolumeConfirmed: false, executablePath: process.env.CHROMIUM_EXECUTABLE_PATH! });
  const orgId = randomUUID(), first = { orgId, accountId: randomUUID(), fencingToken: 1, channelId: "wechat_mp" }, second = { ...first, accountId: randomUUID() };
  try {
    const a = await pool.acquire(first);
    const b = await pool.acquire(second);
    assert.notEqual(a.profileRef, b.profileRef);
    await assert.rejects(() => pool.acquire(first), { code: "profile_busy_or_recovery_required" });
    await assert.rejects(() => pool.acquire({ ...first, accountId: randomUUID() }), { code: "browser_capacity_exhausted" });
    await assert.rejects(() => a.context.newPage().then((page) => page.goto("http://localhost:9/private")), /ERR_BLOCKED_BY_CLIENT/);
    await a.close();
    const reopened = await pool.acquire({ ...first, fencingToken: 2 });
    await reopened.close(); await b.close();
  } finally { await pool.shutdown(); await rm(root, { recursive: true, force: true }); }
});
