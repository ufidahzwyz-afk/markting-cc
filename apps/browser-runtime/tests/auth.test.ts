import test from "node:test";
import assert from "node:assert/strict";
import type { AddressInfo } from "node:net";
import { randomBytes } from "node:crypto";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { createLocalJWKSet, exportJWK, generateKeyPair, SignJWT } from "jose";
import { createLocalServiceIdentityVerifier, createServiceIdentityVerifier, issueLocalServiceToken } from "../src/auth";
import { createBrowserServer } from "../src/server";
import type { BrowserService } from "../src/service";

test("private command HTTP authenticates signature/audience/service identity and explicit org, default fails closed", async () => {
  const pair = await generateKeyPair("RS256");
  const publicJwk = await exportJWK(pair.publicKey);
  const org = "00000000-0000-4000-8000-000000000001";
  const email = "worker@test-project.iam.gserviceaccount.com";
  const audience = "http://browser.internal:3003";
  const verifier = createServiceIdentityVerifier({ audience, serviceOrganizations: { [email]: [org] }, trustedJwks: createLocalJWKSet({ keys: [{ ...publicJwk, kid: "test-key", alg: "RS256" }] }) });
  let writes = 0;
  const getService = async () => ({ enqueue: async () => { writes++; return { id: "queued-in-test" }; } }) as unknown as BrowserService;
  const token = (aud = audience, account = email, expires = Math.floor(Date.now() / 1000) + 120) => new SignJWT({ email: account, email_verified: true }).setProtectedHeader({ alg: "RS256", kid: "test-key" }).setIssuer("https://accounts.google.com").setAudience(aud).setSubject("test-service-subject").setIssuedAt().setExpirationTime(expires).sign(pair.privateKey);
  const server = createBrowserServer({ identityVerifier: verifier, getService });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  const send = async (authorization: string, organization = org, body: unknown = { command_type: "session_verify", platform_account_id: org, adapter_version: "test-v1", idempotency_key: "test", input_ref: {} }) => fetch(`${base}/internal/browser/commands`, { method: "POST", headers: { Authorization: `Bearer ${authorization}`, "X-Org-ID": organization, "Content-Type": "application/json" }, body: JSON.stringify(body) });
  try {
    assert.equal((await send("not-signed")).status, 401);
    assert.equal((await send(await token("wrong-audience"))).status, 401);
    assert.equal((await send(await token(audience, "unauthorized@test.iam.gserviceaccount.com"))).status, 401);
    assert.equal((await send(await token(audience, email, Math.floor(Date.now() / 1000) - 60))).status, 401);
    assert.equal((await send(await token(), "00000000-0000-4000-8000-000000000099")).status, 403);
    assert.equal((await send(await token(), org, { command_type: "evaluate_javascript", javascript: "fetch('secret')" })).status, 422);
    assert.equal(writes, 0);
    assert.equal((await send(await token())).status, 202);
    assert.equal(writes, 1);
    assert.equal((await fetch(`${base}/internal/browser/cdp`)).status, 404);
  } finally { await new Promise<void>((resolve) => server.close(() => resolve())); }
  const blocked = createBrowserServer({ getService });
  await new Promise<void>((resolve) => blocked.listen(0, "127.0.0.1", resolve));
  try {
    const response = await fetch(`http://127.0.0.1:${(blocked.address() as AddressInfo).port}/internal/browser/commands`, { method: "POST" });
    assert.equal(response.status, 503);
    assert.equal((await response.json() as { error: { code: string } }).error.code, "IDENTITY_NOT_CONFIGURED");
  } finally { await new Promise<void>((resolve) => blocked.close(() => resolve())); }
});

test("local service identity verifies audience, role, expiry and durable one-use nonce without impersonating an operator", async () => {
  const directory = await mkdtemp(join(tmpdir(), "boran-service-auth-test-")), keyFile = join(directory, "service.key");
  const org = "00000000-0000-4000-8000-000000000001", audience = "http://browser-runtime:3003";
  await writeFile(keyFile, randomBytes(32), { mode: 0o600 });
  const options = { audience, keyFile, services: { "boran-worker": { orgIds: [org], roles: ["worker"] } }, allowedRoles: ["worker"], replayDirectory: join(directory, "nonces") };
  const verifier = createLocalServiceIdentityVerifier(options);
  const token = (overrides: Partial<Parameters<typeof issueLocalServiceToken>[0]> = {}) => issueLocalServiceToken({ audience, keyFile, subject: "boran-worker", role: "worker", ...overrides });
  try {
    await assert.rejects(verifier(await token({ audience: "wrong-audience" })), { code: "INVALID_SERVICE_IDENTITY" });
    await assert.rejects(verifier(await token({ role: "owner" })), { code: "INVALID_SERVICE_IDENTITY" });
    await assert.rejects(verifier(await token({ subject: "unlisted-service" })), { code: "INVALID_SERVICE_IDENTITY" });
    await assert.rejects(verifier(await token({ now: () => new Date(Date.now() - 180_000) })), { code: "INVALID_SERVICE_IDENTITY" });
    const valid = await token();
    assert.deepEqual(await verifier(valid), { subject: "boran-worker", email: "boran-worker@boran.local", orgIds: [org] });
    await assert.rejects(verifier(valid), { code: "INVALID_SERVICE_IDENTITY" });
    await assert.rejects(createLocalServiceIdentityVerifier(options)(valid), { code: "INVALID_SERVICE_IDENTITY" });
    const concurrent = await token();
    const attempts = await Promise.allSettled([verifier(concurrent), createLocalServiceIdentityVerifier(options)(concurrent)]);
    assert.equal(attempts.filter(attempt => attempt.status === "fulfilled").length, 1);
    assert.equal(attempts.filter(attempt => attempt.status === "rejected").length, 1);
    await assert.rejects(issueLocalServiceToken({ audience, keyFile, subject: "boran-worker", role: "worker", ttlSeconds: 121 }), { code: "IDENTITY_NOT_CONFIGURED" });
    await rm(keyFile);
    await assert.rejects(token({ keyFile: join(directory, "unavailable.key") }), { code: "IDENTITY_NOT_CONFIGURED" });
    await assert.rejects(verifier("no-key-available"), { code: "IDENTITY_NOT_CONFIGURED" });
  } finally { await rm(directory, { recursive: true, force: true }); }
});
