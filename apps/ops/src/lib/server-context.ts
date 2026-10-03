import { createRemoteJWKSet, jwtVerify } from "jose";
import { timingSafeEqual } from "node:crypto";
import { DEMO_MARKETER_ID, DEMO_ORG_ID, DEMO_OWNER_ID, openDatabase } from "@boran/db";
import type { ServiceContext } from "@boran/domain/core";
import { DomainError } from "@boran/domain/core";

type HeaderSource = Pick<Headers, "get">;
const jwks = new Map<string, ReturnType<typeof createRemoteJWKSet>>();
let database: ReturnType<typeof openDatabase> | undefined;
export function getDatabase() {
  database ??= openDatabase({ mode: isLocalIdentity() ? "mock" : "live", initialize: false }).catch(error => { database = undefined; throw error; });
  return database;
}
export function cookieValue(headers: HeaderSource, name: string): string | undefined {
  const raw = headers.get("cookie")?.split(";").map(part => part.trim()).find(part => part.startsWith(`${name}=`))?.slice(name.length + 1);
  if (!raw) return undefined;
  try { return decodeURIComponent(raw); } catch { return undefined; }
}
export function isLocalIdentity() {
  return process.env.AUTH_MODE === "mock" && ["development", "test"].includes(process.env.APP_ENV ?? "production") && process.env.BORAN_MODE !== "live";
}
export async function authenticate(headers: HeaderSource): Promise<ServiceContext> {
  const local = isLocalIdentity();
  if (!local && (process.env.AUTH_MODE !== "oidc" || !process.env.OIDC_ISSUER || !process.env.OIDC_AUDIENCE || !process.env.OIDC_JWKS_URL || !process.env.BORAN_ORG_ID || process.env.BORAN_MODE !== "live")) throw new DomainError("IDENTITY_NOT_CONFIGURED", 503, "真实身份与组织配置尚未接入");
  const db = await getDatabase();
  let actorId: string;
  let orgId: string;
  if (isLocalIdentity()) {
    const selected = cookieValue(headers, "boran_dev_actor");
    if (selected && selected !== DEMO_OWNER_ID && selected !== DEMO_MARKETER_ID) throw new DomainError("UNAUTHENTICATED", 401, "模拟运营账号无效");
    actorId = selected ?? DEMO_OWNER_ID;
    orgId = DEMO_ORG_ID;
  } else {
    if (process.env.AUTH_MODE !== "oidc" || !process.env.OIDC_ISSUER || !process.env.OIDC_AUDIENCE || !process.env.OIDC_JWKS_URL || !process.env.BORAN_ORG_ID || process.env.BORAN_MODE !== "live") {
      throw new DomainError("IDENTITY_NOT_CONFIGURED", 503, "真实身份与组织配置尚未接入");
    }
    const token = headers.get("authorization")?.match(/^Bearer ([^\s]+)$/)?.[1] ?? cookieValue(headers, "boran_session");
    if (!token) throw new DomainError("UNAUTHENTICATED", 401, "请通过组织身份登录");
    let subject: string;
    try {
      const url = new URL(process.env.OIDC_JWKS_URL);
      if (url.protocol !== "https:" || url.username || url.password) throw new Error("Invalid identity endpoint");
      let keys = jwks.get(url.href);
      if (!keys) { keys = createRemoteJWKSet(url); jwks.set(url.href, keys); }
      const { payload } = await jwtVerify(token, keys, { issuer: process.env.OIDC_ISSUER, audience: process.env.OIDC_AUDIENCE, algorithms: ["RS256", "ES256"], requiredClaims: ["exp", "sub", "iat"] });
      if (!payload.sub || typeof payload.sub !== "string") throw new Error("Missing subject");
      subject = `${process.env.OIDC_ISSUER}|${payload.sub}`;
    } catch { throw new DomainError("UNAUTHENTICATED", 401, "组织身份验证失败"); }
    const identity = await db.query<{ id: string }>("SELECT id FROM users WHERE identity_subject=$1 AND active=true", [subject]);
    if (!identity.rows[0]) throw new DomainError("FORBIDDEN", 403, "该组织身份尚未授权");
    actorId = identity.rows[0].id;
    orgId = process.env.BORAN_ORG_ID;
  }
  const membership = await db.query<{ roles: string[] }>("SELECT m.roles FROM memberships m JOIN users u ON u.id=m.user_id WHERE m.org_id=$1 AND m.user_id=$2 AND m.active=true AND u.active=true", [orgId, actorId]);
  if (!membership.rows[0]) throw new DomainError("FORBIDDEN", 403, "组织成员权限已停用");
  return { db, orgId, actorId, roles: membership.rows[0].roles, mode: isLocalIdentity() ? "mock" : "live" };
}
export function assertWriteOrigin(request: Request) {
  const expected = process.env.OPS_BASE_URL ? new URL(process.env.OPS_BASE_URL).origin : new URL(request.url).origin;
  if (request.headers.get("origin") !== expected || request.headers.get("sec-fetch-site") === "cross-site") throw new DomainError("CSRF_REJECTED", 403, "请求来源验证失败");
  const cookie = cookieValue(request.headers, "boran_csrf");
  const submitted = request.headers.get("x-csrf-token");
  if (!cookie || !submitted || cookie.length !== 64 || submitted.length !== 64 || !/^[0-9a-f]+$/.test(cookie) || !/^[0-9a-f]+$/.test(submitted) || !timingSafeEqual(Buffer.from(cookie), Buffer.from(submitted))) throw new DomainError("CSRF_REJECTED", 403, "请刷新页面后重试");
}
