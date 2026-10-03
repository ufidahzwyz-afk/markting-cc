import { DEMO_ORG_ID, DEMO_OWNER_ID, openDatabase } from "@boran/db";
import { DomainError } from "@boran/domain/core";
import type { ServiceContext } from "@boran/domain/core";
import type { SitePolicy } from "@boran/domain/content";
const databases = new Map<"mock" | "live", ReturnType<typeof openDatabase>>();
function publicDatabase(mode: "mock" | "live") {
  let database = databases.get(mode);
  if (!database) {
    database = openDatabase({ mode, initialize: false }).catch(error => { databases.delete(mode); throw error; });
    databases.set(mode, database);
  }
  return database;
}

export function publicMode(): "mock" | "live" {
  const environment = process.env.APP_ENV ?? "production";
  if (process.env.BORAN_MODE === "live") return "live";
  if (["development", "test"].includes(environment) && process.env.BORAN_MODE === "mock") return "mock";
  throw new DomainError("SITE_NOT_CONFIGURED", 503, "公网站点尚未配置");
}
export function sitePolicy(): SitePolicy {
  const mode = publicMode();
  const publicOrigin = process.env.PUBLIC_BASE_URL ?? process.env.PUBLIC_SITE_ORIGIN ?? (mode === "mock" ? "http://localhost:3001" : "");
  const allowedPathPrefixes = (process.env.PUBLIC_ALLOWED_PATH_PREFIXES ?? process.env.PUBLIC_SITE_ALLOWED_PATH_PREFIXES ?? "").split(",").map((part) => part.trim()).filter(Boolean);
  return { publicOrigin, allowedPathPrefixes };
}
export async function publicContext(): Promise<ServiceContext> {
  const mode = publicMode();
  const orgId = mode === "mock" ? DEMO_ORG_ID : process.env.PUBLIC_SITE_ORG_ID;
  if (!orgId) throw new DomainError("SITE_NOT_CONFIGURED", 503, "公网站点组织尚未配置");
  const db = await publicDatabase(mode);
  return { db, orgId, actorId: mode === "mock" ? DEMO_OWNER_ID : "public-site", roles: [], mode };
}
export function mockPreviewAllowed() {
  return ["development", "test"].includes(process.env.APP_ENV ?? "production") && process.env.AUTH_MODE === "mock" && process.env.BORAN_MODE === "mock";
}
