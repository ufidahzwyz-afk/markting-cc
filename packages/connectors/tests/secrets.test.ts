import test from "node:test";
import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { chmod, mkdtemp, readFile, readdir, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createSecretStoreFromEnvironment, EncryptedSecretStore, initializeSecretStore, type SecretPayload, SecretStoreError } from "../src/secrets";

async function fixture(run: (store: EncryptedSecretStore, directory: string) => Promise<void>) {
  const directory = await mkdtemp(join(tmpdir(), "boran-secrets-test-"));
  const options = { rootDirectory: join(directory, "store"), keyFile: join(directory, "master.key") };
  try { await initializeSecretStore(options); await run(new EncryptedSecretStore(options), directory); }
  finally { await rm(directory, { recursive: true, force: true }); }
}
const scope = { orgId: "organization-a", connectionId: "connection-a" };
const credential = { kind: "platform_password", username: "synthetic-test-user", password: "synthetic-test-password" } as const;
const errorCode = (code: string) => (error: unknown) => error instanceof SecretStoreError && error.code === code;

test("credential persists encrypted with private permissions and survives service restart", () => fixture(async (store, directory) => {
  const reference = await store.write(credential, scope);
  assert.match(reference, /^boran-secret:[a-f0-9-]{36}$/);
  const names = await readdir(store.rootDirectory);
  assert.equal(names.length, 1);
  const path = join(store.rootDirectory, names[0]!);
  const saved = await readFile(path, "utf8");
  assert.equal(saved.includes(credential.password), false);
  assert.equal(saved.includes(credential.username), false);
  assert.equal((await stat(path)).mode & 0o777, 0o600);
  assert.equal((await stat(store.rootDirectory)).mode & 0o777, 0o700);
  assert.equal((await stat(store.keyFile)).mode & 0o777, 0o600);
  assert.deepEqual(await new EncryptedSecretStore({ rootDirectory: store.rootDirectory, keyFile: store.keyFile }).resolveSecret(reference, scope), credential);
  const originalKey = await readFile(join(directory, "master.key"));
  assert.deepEqual(await initializeSecretStore({ rootDirectory: store.rootDirectory, keyFile: store.keyFile }), { created: false });
  assert.deepEqual(await readFile(store.keyFile), originalKey);
}));

test("credentials cannot cross organization, connection or account boundaries", () => fixture(async store => {
  const reference = await store.write(credential, scope);
  await assert.rejects(store.resolveSecret(reference, { ...scope, orgId: "organization-b" }), errorCode("SECRET_SCOPE_MISMATCH"));
  await assert.rejects(store.resolveSecret(reference, { ...scope, connectionId: "connection-b" }), errorCode("SECRET_SCOPE_MISMATCH"));
  await assert.rejects(store.resolveSecret(reference, { orgId: scope.orgId, accountId: scope.connectionId }), errorCode("SECRET_SCOPE_MISMATCH"));
  await assert.rejects(store.delete(reference, { ...scope, orgId: "organization-b" }), errorCode("SECRET_SCOPE_MISMATCH"));
  await store.assertScope(reference, scope);
  await store.delete(reference, scope);
  await assert.rejects(store.resolveSecret(reference, scope), errorCode("SECRET_NOT_FOUND"));
}));

test("authenticated encryption rejects payload and scope tampering", () => fixture(async store => {
  const reference = await store.write(credential, scope), name = (await readdir(store.rootDirectory))[0]!;
  const path = join(store.rootDirectory, name), saved = await readFile(path, "utf8");
  const envelope = JSON.parse(saved) as { ciphertext: string; scope: typeof scope };
  const bytes = Buffer.from(envelope.ciphertext, "base64"); bytes[0] = bytes[0]! ^ 1; envelope.ciphertext = bytes.toString("base64");
  await writeFile(path, JSON.stringify(envelope));
  await assert.rejects(store.resolveSecret(reference, scope), errorCode("SECRET_INTEGRITY_FAILED"));
  const changedScope = JSON.parse(saved) as typeof envelope; changedScope.scope.connectionId = "connection-b";
  await writeFile(path, JSON.stringify(changedScope));
  await assert.rejects(store.resolveSecret(reference, { ...scope, connectionId: "connection-b" }), errorCode("SECRET_INTEGRITY_FAILED"));
}));

test("missing or incorrect master key blocks old data and never silently replaces the key", () => fixture(async store => {
  const reference = await store.write(credential, scope);
  await rm(store.keyFile);
  await assert.rejects(store.resolveSecret(reference, scope), errorCode("SECRET_KEY_MISSING"));
  await assert.rejects(initializeSecretStore({ rootDirectory: store.rootDirectory, keyFile: store.keyFile }), errorCode("SECRET_KEY_MISSING"));
  await writeFile(store.keyFile, randomBytes(32), { mode: 0o600 });
  await assert.rejects(store.resolveSecret(reference, scope), errorCode("SECRET_INTEGRITY_FAILED"));
  await chmod(store.keyFile, 0o644);
  await assert.rejects(store.resolveSecret(reference, scope), errorCode("SECRET_KEY_INVALID"));
}));

test("payload types, scope and reference are checked before secret operations", () => fixture(async store => {
  for (const payload of [ { kind: "api_key", apiKey: "" }, { kind: "platform_password", username: "u", password: "p", callback: "untrusted" }, { kind: "drive_oauth", accessToken: "token-without-refresh" } ]) await assert.rejects(store.write(payload as SecretPayload, scope), errorCode("SECRET_PAYLOAD_INVALID"));
  await assert.rejects(store.write(credential, { orgId: "organization-a" }), errorCode("SECRET_SCOPE_INVALID"));
  await assert.rejects(store.write(credential, { ...scope, accountId: "account-a" }), errorCode("SECRET_SCOPE_INVALID"));
  await assert.rejects(store.resolveSecret("../../master.key", scope), errorCode("SECRET_REFERENCE_INVALID"));
  assert.throws(() => createSecretStoreFromEnvironment({}), errorCode("SECRET_STORE_NOT_CONFIGURED"));
  const oauth = { kind: "drive_oauth", clientId: "synthetic-client", clientSecret: "synthetic-client-secret", refreshToken: "synthetic-refresh", expiresAt: "2026-10-04T00:00:00Z" } as const;
  const reference = await store.write(oauth, scope);
  assert.deepEqual(await store.resolveSecret(reference, scope), oauth);
}));

test("idempotency fingerprint is keyed, deterministic, order stable and bound to scope", () => fixture(async store => {
  const hash = await store.fingerprint(credential, scope);
  assert.match(hash, /^[a-f0-9]{64}$/);
  assert.equal(hash, await store.fingerprint({ password: credential.password, username: credential.username, kind: credential.kind }, scope));
  assert.notEqual(hash, await store.fingerprint({ ...credential, password: "different-synthetic-password" }, scope));
  assert.notEqual(hash, await store.fingerprint(credential, { ...scope, orgId: "organization-b" }));
  await fixture(async otherStore => assert.notEqual(hash, await otherStore.fingerprint(credential, scope)));
}));
