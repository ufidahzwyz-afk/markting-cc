import test from "node:test";
import assert from "node:assert/strict";
import type { AddressInfo } from "node:net";
import { createLocalJWKSet, exportJWK, generateKeyPair, SignJWT } from "jose";
import { createServiceIdentityVerifier } from "../src/auth";
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
