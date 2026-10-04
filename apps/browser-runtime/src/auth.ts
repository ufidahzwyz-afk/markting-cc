import { createRemoteJWKSet, jwtVerify, SignJWT, type JWTVerifyGetKey } from "jose";
import { createHash, randomUUID } from "node:crypto";
import { chmod, lstat, mkdir, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { DomainError } from "@boran/domain/core";

export interface ServiceIdentity { subject: string; email: string; orgIds: readonly string[] }
export type ServiceIdentityVerifier = (token: string) => Promise<ServiceIdentity>;
/** Google service OIDC only. The org allowlist comes from deployment configuration, never token/body claims. */
export function createServiceIdentityVerifier(options: { audience: string; serviceOrganizations: Readonly<Record<string, readonly string[]>>; trustedJwks?: JWTVerifyGetKey }): ServiceIdentityVerifier {
  if (!options.audience || !Object.keys(options.serviceOrganizations).length) throw new DomainError("IDENTITY_NOT_CONFIGURED", 503, "OIDC audience and service allowlist are required");
  const keys = options.trustedJwks ?? createRemoteJWKSet(new URL("https://www.googleapis.com/oauth2/v3/certs"));
  return async (token) => {
    try {
      const { payload } = await jwtVerify(token, keys, { issuer: ["https://accounts.google.com", "accounts.google.com"], audience: options.audience, algorithms: ["RS256"], clockTolerance: 5 });
      const email = payload.email;
      if (typeof email !== "string" || !email.endsWith(".gserviceaccount.com") || payload.email_verified !== true || typeof payload.sub !== "string" || typeof payload.exp !== "number" || !options.serviceOrganizations[email]?.length) throw new Error("Service not allowed");
      return { subject: payload.sub, email, orgIds: options.serviceOrganizations[email]! };
    } catch { throw new DomainError("INVALID_SERVICE_IDENTITY", 401, "Service identity token could not be verified"); }
  };
}

const localIssuer = "urn:boran:local-service:v1";
export interface LocalServicePrincipal { orgIds: readonly string[]; roles: readonly string[] }
export interface LocalServiceVerifierOptions {
  audience: string;
  keyFile: string;
  services: Readonly<Record<string, LocalServicePrincipal>>;
  allowedRoles: readonly string[];
  replayDirectory: string;
  now?: () => Date;
}
async function localServiceKey(path: string): Promise<Buffer> {
  try {
    const info = await lstat(path);
    if (!info.isFile() || info.isSymbolicLink() || info.size !== 32 || (info.mode & 0o077)) throw new Error("Invalid service key");
    const key = await readFile(path);
    if (key.length !== 32) throw new Error("Invalid service key");
    return key;
  } catch { throw new DomainError("IDENTITY_NOT_CONFIGURED", 503, "Persistent private service authentication key is unavailable"); }
}
/** A fresh, short-lived, single-request token. Local service identity does not grant an operator login. */
export async function issueLocalServiceToken(options: { audience: string; keyFile: string; subject: string; role: string; ttlSeconds?: number; now?: () => Date }): Promise<string> {
  const ttl = options.ttlSeconds ?? 60;
  if (!options.audience || !/^[a-z][a-z0-9-]{1,63}$/.test(options.subject) || !/^[a-z][a-z0-9_-]{1,31}$/.test(options.role) || !Number.isSafeInteger(ttl) || ttl < 1 || ttl > 120) throw new DomainError("IDENTITY_NOT_CONFIGURED", 503, "Local service token configuration is invalid");
  const key = await localServiceKey(options.keyFile), issuedAt = Math.floor((options.now?.() ?? new Date()).getTime() / 1000);
  try {
    return await new SignJWT({ role: options.role }).setProtectedHeader({ alg: "HS256", typ: "JWT" }).setIssuer(localIssuer).setAudience(options.audience).setSubject(options.subject).setJti(randomUUID()).setIssuedAt(issuedAt).setExpirationTime(issuedAt + ttl).sign(key);
  } finally { key.fill(0); }
}
/** Org and role bindings come from a private deployment allowlist, never the request or JWT org claims. */
export function createLocalServiceIdentityVerifier(options: LocalServiceVerifierOptions): ServiceIdentityVerifier {
  if (!options.audience || !options.keyFile || !options.replayDirectory || !options.allowedRoles.length || !Object.keys(options.services).length || Object.values(options.services).some(service => !service.orgIds.length || !service.roles.length)) throw new DomainError("IDENTITY_NOT_CONFIGURED", 503, "Local service audience, role bindings and persistent replay storage are required");
  const seen = new Map<string, number>();
  let lastCleanup = 0;
  const now = options.now ?? (() => new Date());
  async function prepareReplayDirectory() {
    await mkdir(options.replayDirectory, { recursive: true, mode: 0o700 });
    const info = await lstat(options.replayDirectory);
    if (!info.isDirectory() || info.isSymbolicLink()) throw new Error("Invalid replay directory");
    await chmod(options.replayDirectory, 0o700);
  }
  async function cleanup(currentSeconds: number) {
    if (currentSeconds - lastCleanup < 60) return;
    lastCleanup = currentSeconds;
    for (const name of (await readdir(options.replayDirectory)).filter(name => /^[a-f0-9]{64}\.nonce$/.test(name)).slice(0, 1000)) {
      const path = join(options.replayDirectory, name);
      try { const expiry = Number(await readFile(path, "utf8")); if (Number.isFinite(expiry) && expiry < currentSeconds - 5) await rm(path, { force: true }); } catch { /* Concurrent cleanup is harmless. */ }
    }
  }
  return async token => {
    const key = await localServiceKey(options.keyFile);
    try {
      const currentDate = now(), currentSeconds = Math.floor(currentDate.getTime() / 1000);
      const { payload } = await jwtVerify(token, key, { issuer: localIssuer, audience: options.audience, algorithms: ["HS256"], currentDate, clockTolerance: 0 });
      const principal = typeof payload.sub === "string" ? options.services[payload.sub] : undefined;
      if (!principal || typeof payload.role !== "string" || !principal.roles.includes(payload.role) || !options.allowedRoles.includes(payload.role) || typeof payload.iat !== "number" || typeof payload.exp !== "number" || payload.exp - payload.iat > 120 || payload.exp <= payload.iat || payload.iat > currentSeconds + 5 || typeof payload.jti !== "string" || !/^[a-f0-9-]{36}$/.test(payload.jti)) throw new Error("Service is not authorized");
      for (const [nonce, expiry] of seen) if (expiry < currentSeconds) seen.delete(nonce);
      const nonce = createHash("sha256").update(`${payload.sub}:${payload.jti}`).digest("hex");
      if (seen.has(nonce) || seen.size >= 10_000) throw new Error("Service token was already consumed");
      await prepareReplayDirectory();
      await writeFile(join(options.replayDirectory, `${nonce}.nonce`), String(payload.exp), { flag: "wx", mode: 0o600 });
      seen.set(nonce, payload.exp);
      await cleanup(currentSeconds);
      return { subject: payload.sub!, email: `${payload.sub}@boran.local`, orgIds: principal.orgIds };
    } catch { throw new DomainError("INVALID_SERVICE_IDENTITY", 401, "Local service identity token could not be verified"); }
    finally { key.fill(0); }
  };
}
