import { createCipheriv, createDecipheriv, createHmac, randomBytes, randomUUID } from "node:crypto";
import { chmod, link, lstat, mkdir, open, readFile, readdir, rm } from "node:fs/promises";
import { dirname, isAbsolute, join, resolve } from "node:path";

export type SecretPayload =
  | { kind: "api_key"; apiKey: string }
  | { kind: "platform_password"; username: string; password: string; token?: string }
  | { kind: "drive_oauth"; clientId: string; clientSecret: string; refreshToken: string; accessToken?: string; expiresAt?: string };
export interface SecretScope { orgId: string; connectionId?: string; accountId?: string }
export interface SecretStoreOptions { rootDirectory: string; keyFile: string }
export class SecretStoreError extends Error {
  constructor(readonly code: "SECRET_STORE_NOT_CONFIGURED" | "SECRET_KEY_MISSING" | "SECRET_KEY_INVALID" | "SECRET_SCOPE_INVALID" | "SECRET_SCOPE_MISMATCH" | "SECRET_PAYLOAD_INVALID" | "SECRET_REFERENCE_INVALID" | "SECRET_NOT_FOUND" | "SECRET_INTEGRITY_FAILED" | "SECRET_STORAGE_FAILED", message: string) {
    super(message); this.name = "SecretStoreError";
  }
}
const referencePattern = /^boran-secret:([0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12})$/;
const validId = (id: unknown): id is string => typeof id === "string" && /^[A-Za-z0-9][A-Za-z0-9_.:@-]{0,199}$/.test(id);
function checkedScope(scope: SecretScope): SecretScope {
  if (!scope || !validId(scope.orgId) || (!!scope.connectionId === !!scope.accountId) || (scope.connectionId !== undefined && !validId(scope.connectionId)) || (scope.accountId !== undefined && !validId(scope.accountId))) throw new SecretStoreError("SECRET_SCOPE_INVALID", "Secret requires an organization and exactly one connection or account scope");
  return { orgId: scope.orgId, ...(scope.connectionId ? { connectionId: scope.connectionId } : { accountId: scope.accountId! }) };
}
function checkedPayload(value: unknown): SecretPayload {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new SecretStoreError("SECRET_PAYLOAD_INVALID", "Credential payload is invalid");
  const object = value as Record<string, unknown>;
  const text = (key: string, optional = false) => optional && object[key] === undefined || typeof object[key] === "string" && (object[key] as string).length > 0 && (object[key] as string).length <= 16_384;
  const allowed: Record<string, readonly string[]> = { api_key: ["kind", "apiKey"], platform_password: ["kind", "username", "password", "token"], drive_oauth: ["kind", "clientId", "clientSecret", "refreshToken", "accessToken", "expiresAt"] };
  const fields = allowed[String(object.kind)];
  const valid = fields && Object.keys(object).every(key => fields.includes(key)) && (
    object.kind === "api_key" && text("apiKey") ||
    object.kind === "platform_password" && text("username") && text("password") && text("token", true) ||
    object.kind === "drive_oauth" && text("clientId") && text("clientSecret") && text("refreshToken") && text("accessToken", true) && (object.expiresAt === undefined || typeof object.expiresAt === "string" && Number.isFinite(Date.parse(object.expiresAt)))
  );
  if (!valid || Buffer.byteLength(JSON.stringify(object)) > 48_000) throw new SecretStoreError("SECRET_PAYLOAD_INVALID", "Credential payload is invalid");
  return { ...object } as SecretPayload;
}
async function privateDirectory(path: string) {
  await mkdir(path, { recursive: true, mode: 0o700 });
  const info = await lstat(path);
  if (!info.isDirectory() || info.isSymbolicLink()) throw new SecretStoreError("SECRET_STORAGE_FAILED", "Private secret directory is invalid");
  await chmod(path, 0o700);
}
async function durablePrivateFile(path: string, value: string | Buffer) {
  const file = await open(path, "wx", 0o600);
  try { await file.writeFile(value); await file.sync(); } finally { await file.close(); }
}
async function syncDirectory(path: string) {
  const directory = await open(path, "r");
  try { await directory.sync(); } finally { await directory.close(); }
}
async function loadKey(keyFile: string): Promise<Buffer> {
  try {
    const info = await lstat(keyFile);
    if (!info.isFile() || info.isSymbolicLink() || (info.mode & 0o077) !== 0 || info.size !== 32) throw new SecretStoreError("SECRET_KEY_INVALID", "Master key must be a private 32-byte regular file");
    const key = await readFile(keyFile);
    if (key.length !== 32) throw new SecretStoreError("SECRET_KEY_INVALID", "Master key is invalid");
    return key;
  } catch (error) {
    if (error instanceof SecretStoreError) throw error;
    if ((error as NodeJS.ErrnoException).code === "ENOENT") throw new SecretStoreError("SECRET_KEY_MISSING", "Persistent encryption key is missing; restore its backup before using existing credentials");
    throw new SecretStoreError("SECRET_KEY_INVALID", "Master key could not be read");
  }
}
/** Explicit first-install initialization. Never invoked by a read/write or ordinary service startup. */
export async function initializeSecretStore(options: SecretStoreOptions): Promise<{ created: boolean }> {
  const root = resolve(options.rootDirectory), keyFile = resolve(options.keyFile);
  await privateDirectory(root);
  await privateDirectory(dirname(keyFile));
  try { const key = await loadKey(keyFile); key.fill(0); return { created: false }; }
  catch (error) { if (!(error instanceof SecretStoreError) || error.code !== "SECRET_KEY_MISSING") throw error; }
  if ((await readdir(root)).length) throw new SecretStoreError("SECRET_KEY_MISSING", "Existing credential storage requires its original encryption key");
  const key = randomBytes(32);
  try { await durablePrivateFile(keyFile, key); await syncDirectory(dirname(keyFile)); return { created: true }; }
  catch (error) {
    if ((error as NodeJS.ErrnoException).code === "EEXIST") { const existing = await loadKey(keyFile); existing.fill(0); return { created: false }; }
    throw new SecretStoreError("SECRET_STORAGE_FAILED", "Persistent master key could not be initialized");
  } finally { key.fill(0); }
}
interface Envelope { version: 1; reference: string; scope: SecretScope; createdAt: string; iv: string; tag: string; ciphertext: string }
function associatedData(envelope: Pick<Envelope, "version" | "reference" | "scope" | "createdAt">) {
  return Buffer.from(JSON.stringify({ version: envelope.version, reference: envelope.reference, scope: envelope.scope, createdAt: envelope.createdAt }));
}
/** Immutable credential references. Database rows and DTOs contain only a reference, never this payload. */
export class EncryptedSecretStore {
  readonly rootDirectory: string;
  readonly keyFile: string;
  constructor(options: SecretStoreOptions) {
    if (!options.rootDirectory || !options.keyFile || !isAbsolute(options.rootDirectory) || !isAbsolute(options.keyFile)) throw new SecretStoreError("SECRET_STORE_NOT_CONFIGURED", "Absolute secret-store and master-key paths are required");
    this.rootDirectory = resolve(options.rootDirectory); this.keyFile = resolve(options.keyFile);
  }
  private path(reference: string) {
    const match = referencePattern.exec(reference);
    if (!match) throw new SecretStoreError("SECRET_REFERENCE_INVALID", "Credential reference is invalid");
    return join(this.rootDirectory, `${match[1]}.json`);
  }
  async write(payload: SecretPayload, scope: SecretScope): Promise<string> {
    const checked = checkedPayload(payload), binding = checkedScope(scope), reference = `boran-secret:${randomUUID()}`;
    const key = await loadKey(this.keyFile), plaintext = Buffer.from(JSON.stringify(checked));
    let temporary: string | undefined;
    try {
      await privateDirectory(this.rootDirectory);
      const header = { version: 1 as const, reference, scope: binding, createdAt: new Date().toISOString() };
      const iv = randomBytes(12), cipher = createCipheriv("aes-256-gcm", key, iv);
      cipher.setAAD(associatedData(header));
      const envelope: Envelope = { ...header, iv: iv.toString("base64"), tag: "", ciphertext: Buffer.concat([cipher.update(plaintext), cipher.final()]).toString("base64") };
      envelope.tag = cipher.getAuthTag().toString("base64");
      const target = this.path(reference);
      temporary = `${target}.${randomUUID()}.tmp`;
      await durablePrivateFile(temporary, JSON.stringify(envelope));
      // Link the fully written file without replacing an existing immutable reference.
      await link(temporary, target); await rm(temporary); temporary = undefined; await syncDirectory(this.rootDirectory);
      return reference;
    } catch (error) {
      if (error instanceof SecretStoreError) throw error;
      throw new SecretStoreError("SECRET_STORAGE_FAILED", "Credential could not be persisted");
    } finally { key.fill(0); plaintext.fill(0); if (temporary) await rm(temporary, { force: true }).catch(() => undefined); }
  }
  async resolveSecret(reference: string, scope: SecretScope): Promise<SecretPayload> {
    const path = this.path(reference), binding = checkedScope(scope), key = await loadKey(this.keyFile);
    let plaintext: Buffer | undefined;
    try {
      const info = await lstat(path);
      if (!info.isFile() || info.isSymbolicLink() || (info.mode & 0o077) !== 0 || info.size > 70_000) throw new SecretStoreError("SECRET_INTEGRITY_FAILED", "Credential storage integrity check failed");
      const envelope = JSON.parse(await readFile(path, "utf8")) as Envelope;
      if (envelope.version !== 1 || envelope.reference !== reference || typeof envelope.createdAt !== "string" || !envelope.scope) throw new SecretStoreError("SECRET_INTEGRITY_FAILED", "Credential storage integrity check failed");
      const stored = checkedScope(envelope.scope);
      if (stored.orgId !== binding.orgId || stored.connectionId !== binding.connectionId || stored.accountId !== binding.accountId) throw new SecretStoreError("SECRET_SCOPE_MISMATCH", "Credential belongs to a different organization or account");
      const iv = Buffer.from(envelope.iv, "base64"), tag = Buffer.from(envelope.tag, "base64"), ciphertext = Buffer.from(envelope.ciphertext, "base64");
      if (iv.length !== 12 || tag.length !== 16 || ciphertext.length > 48_000) throw new Error("Invalid encrypted envelope");
      const decipher = createDecipheriv("aes-256-gcm", key, iv);
      decipher.setAAD(associatedData({ ...envelope, scope: stored })); decipher.setAuthTag(tag);
      plaintext = Buffer.concat([decipher.update(ciphertext), decipher.final()]);
      return checkedPayload(JSON.parse(plaintext.toString("utf8")));
    } catch (error) {
      if (error instanceof SecretStoreError) throw error;
      if ((error as NodeJS.ErrnoException).code === "ENOENT") throw new SecretStoreError("SECRET_NOT_FOUND", "Credential reference was not found");
      throw new SecretStoreError("SECRET_INTEGRITY_FAILED", "Credential could not be authenticated and decrypted");
    } finally { key.fill(0); plaintext?.fill(0); }
  }
  async delete(reference: string, scope: SecretScope): Promise<void> {
    await this.resolveSecret(reference, scope);
    try { await rm(this.path(reference)); await syncDirectory(this.rootDirectory); }
    catch { throw new SecretStoreError("SECRET_STORAGE_FAILED", "Credential could not be deleted"); }
  }
  async assertScope(reference: string, scope: SecretScope): Promise<void> { await this.resolveSecret(reference, scope); }
  /** Keyed idempotency fingerprint; a public hash of a password is never returned or persisted. */
  async fingerprint(payload: SecretPayload, scope: SecretScope): Promise<string> {
    const checked = checkedPayload(payload), binding = checkedScope(scope), key = await loadKey(this.keyFile);
    const fingerprintKey = createHmac("sha256", key).update("boran-credential-idempotency-v1").digest();
    try {
      const canonical = Object.fromEntries(Object.entries(checked).sort(([left], [right]) => left < right ? -1 : left > right ? 1 : 0));
      return createHmac("sha256", fingerprintKey).update(JSON.stringify({ scope: binding, payload: canonical })).digest("hex");
    } finally { key.fill(0); fingerprintKey.fill(0); }
  }
}
export function createSecretStoreFromEnvironment(env: NodeJS.ProcessEnv = process.env): EncryptedSecretStore {
  if (!env.BORAN_SECRET_STORE_ROOT || !env.BORAN_SECRET_KEY_FILE) throw new SecretStoreError("SECRET_STORE_NOT_CONFIGURED", "Credential encryption storage is not configured");
  return new EncryptedSecretStore({ rootDirectory: env.BORAN_SECRET_STORE_ROOT, keyFile: env.BORAN_SECRET_KEY_FILE });
}
