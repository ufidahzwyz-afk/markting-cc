import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { DomainError } from "@boran/domain/core";
import type { ServiceIdentity, ServiceIdentityVerifier } from "./auth";
import { parseBrowserCommand, type BrowserService } from "./service";

export interface BrowserServerOptions {
  identityVerifier?: ServiceIdentityVerifier;
  getService: (orgId: string, identity: ServiceIdentity) => Promise<BrowserService>;
  profilesReady?: boolean;
}
function respond(response: ServerResponse, status: number, value: unknown) {
  response.writeHead(status, { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff" });
  response.end(JSON.stringify(value));
}
async function body(request: IncomingMessage): Promise<unknown> {
  if (!String(request.headers["content-type"] ?? "").startsWith("application/json")) throw new DomainError("JSON_REQUIRED", 415, "JSON required");
  const chunks: Buffer[] = [];
  let length = 0;
  for await (const chunk of request) { const data = Buffer.from(chunk); length += data.length; if (length > 16_384) throw new DomainError("BODY_TOO_LARGE", 413, "Command body exceeds limit"); chunks.push(data); }
  try { return JSON.parse(Buffer.concat(chunks).toString("utf8")); } catch { throw new DomainError("INVALID_JSON", 422, "Invalid JSON"); }
}
/** Fixed private surface. There are no URL-navigation, JS-evaluation, shell, CDP or VNC proxy routes. */
export function createBrowserServer(options: BrowserServerOptions) {
  return createServer(async (request, response) => {
    try {
      const path = new URL(request.url ?? "/", "http://browser.internal").pathname;
      if (request.method === "GET" && path === "/healthz") return respond(response, 200, { service: "browser-runtime", healthy: true, externalWritesEnabled: false });
      if (request.method === "GET" && path === "/readyz") return respond(response, options.identityVerifier && options.profilesReady ? 200 : 503, { identityConfigured: !!options.identityVerifier, profilesConfigured: !!options.profilesReady, integrations: "require_per_platform_verification" });
      if (!path.startsWith("/internal/browser/commands")) return respond(response, 404, { error: { code: "NOT_FOUND" } });
      if (!options.identityVerifier) throw new DomainError("IDENTITY_NOT_CONFIGURED", 503, "Service OIDC is not configured");
      const authorization = request.headers.authorization;
      if (!authorization?.startsWith("Bearer ")) throw new DomainError("SERVICE_TOKEN_REQUIRED", 401, "Service identity required");
      const identity = await options.identityVerifier(authorization.slice(7));
      const orgId = request.headers["x-org-id"];
      if (typeof orgId !== "string" || !identity.orgIds.includes(orgId)) throw new DomainError("ORGANIZATION_FORBIDDEN", 403, "Explicit authorized organization required");
      const service = await options.getService(orgId, identity);
      if (request.method === "POST" && path === "/internal/browser/commands") return respond(response, 202, { data: await service.enqueue(parseBrowserCommand(await body(request))) });
      const match = /^\/internal\/browser\/commands\/([0-9a-f-]{36})(?:\/(cancel|execute|reconcile))?$/.exec(path);
      if (!match) return respond(response, 404, { error: { code: "NOT_FOUND" } });
      const id = match[1]!;
      if (request.method === "GET" && !match[2]) return respond(response, 200, { data: await service.get(id) });
      if (request.method === "POST" && match[2] === "cancel") return respond(response, 200, { data: await service.cancel(id) });
      if (request.method === "POST" && match[2] === "reconcile") return respond(response, 202, { data: await service.reconcile(id) });
      if (request.method === "POST" && match[2] === "execute") {
        const command = await service.execute(id, identity.email);
        const result = command.result_ref as { status?: string } | null;
        const status = command.state === "blocked" ? result?.status === "challenge_required" ? 409 : 503 : 200;
        return respond(response, status, { data: { ...command, verified: command.state === "succeeded" }, ...(status >= 400 ? { error: { code: status === 409 ? "CHALLENGE_REQUIRED" : "INTEGRATION_REQUIRED" } } : {}) });
      }
      return respond(response, 405, { error: { code: "METHOD_NOT_ALLOWED" } });
    } catch (error) {
      const known = error instanceof DomainError;
      respond(response, known ? error.status : 500, { error: { code: known ? error.code : "BROWSER_INTERNAL_ERROR" } });
    }
  });
}
