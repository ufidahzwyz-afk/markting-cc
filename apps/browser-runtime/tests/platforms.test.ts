import test from "node:test";
import assert from "node:assert/strict";
import { createPlatformAdapter, createPlatformRegistry, getPlatformDescriptor, PLATFORM_DESCRIPTORS, type PlatformExecutionContext, type PlatformHooks } from "@boran/connectors";

const context: PlatformExecutionContext = { orgId: "test-org", accountId: "test-account", externalAccountId: "external-account", adapterVersion: "test-v1", sessionVersion: 1, fencingToken: 1, commandId: "test-command", mode: "live", assertLease: async () => undefined };
test("16 distinct platforms are all blocked without independently verified hooks", async () => {
  assert.equal(PLATFORM_DESCRIPTORS.length, 16);
  assert.equal(new Set(PLATFORM_DESCRIPTORS.map((row) => row.channelId)).size, 16);
  const adapters = createPlatformRegistry({ mode: "live" });
  for (const descriptor of PLATFORM_DESCRIPTORS) {
    const adapter = adapters.get(descriptor.channelId)!;
    assert.equal(adapter.readiness().connected, false);
    assert.equal((await adapter.execute(context, { commandType: "publish", actionId: "approved-action", inputRef: {} })).status, "blocked");
    assert.ok(descriptor.allowedOrigins.every((origin) => new URL(origin).protocol === "https:"));
  }
});
test("capability proof, independent account readback and labels gate write completion", async () => {
  const descriptor = getPlatformDescriptor("wechat_mp");
  let writes = 0;
  const hooks: PlatformHooks = {
    probe: async () => ({ verified: true, externalAccountId: context.externalAccountId, adapterVersion: "test-v1", evidenceRef: "test/capability-proof", capturedAt: new Date().toISOString(), kind: "api_readback", capabilities: [...descriptor.requiredCapabilities] }),
    publish: async () => { writes++; return { status: "submitted", externalId: "test-post" }; },
    readback: async () => ({ status: "verified", evidence: { verified: true, externalAccountId: "wrong-account", evidenceRef: "test/readback", capturedAt: new Date().toISOString(), kind: "api_readback", labelsVerified: true } }),
  };
  const adapter = createPlatformAdapter("wechat_mp", { mode: "live", hooks });
  assert.equal((await adapter.execute(context, { commandType: "publish", actionId: "approved-action", inputRef: {} })).status, "unknown");
  assert.equal(writes, 1);
  const incomplete = createPlatformAdapter("wechat_mp", { mode: "live", hooks: { ...hooks, probe: async () => ({ ...(await hooks.probe(context)), capabilities: ["verify_account"] }) } });
  await assert.rejects(() => incomplete.execute(context, { commandType: "publish", actionId: "approved-action", inputRef: {} }), { code: "capability_gap" });
  assert.equal(writes, 1);
  const missingReadback = createPlatformAdapter("wechat_mp", { mode: "live", hooks: { probe: hooks.probe, publish: hooks.publish! } });
  assert.equal((await missingReadback.execute(context, { commandType: "publish", actionId: "approved-action", inputRef: {} })).status, "blocked");
  assert.equal(writes, 1);
});
