import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { DomainError } from "@boran/domain/core";
import type { ServiceIdentity, ServiceIdentityVerifier } from "./auth";
import { parseBrowserCommand, type BrowserService } from "./service";
import { parseLoginChallenge,type LoginChallengeCommand } from './challenges';

export interface BrowserServerOptions {
  identityVerifier?: ServiceIdentityVerifier;
  getService: (orgId: string, identity: ServiceIdentity) => Promise<BrowserService>;
  profilesReady?: boolean;
  externalWritesEnabled?: boolean;
  readSource?: (orgId: string, identity: ServiceIdentity, input: SourceReadCommand) => Promise<unknown>;
  interactLogin?: (orgId:string,identity:ServiceIdentity,sessionId:string,input:LoginChallengeCommand)=>Promise<unknown>;
  interactionServices?:readonly string[];
}
export interface SourceReadCommand { connection_id: string; workflow_run_id: string; idempotency_key: string; adapter_version?: string; source_id?: string }
export function parseSourceReadCommand(value: unknown): SourceReadCommand {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new DomainError("INVALID_SOURCE_READ", 422, "Source references required");
  const row = value as Record<string, unknown>, keys = new Set(["connection_id", "workflow_run_id", "idempotency_key", "adapter_version", "source_id"]);
  const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
  if (Object.keys(row).some(key => !keys.has(key)) || !uuid.test(String(row.connection_id)) || !uuid.test(String(row.workflow_run_id)) || row.source_id !== undefined && !uuid.test(String(row.source_id)) || !/^[A-Za-z0-9_.:-]{1,128}$/.test(String(row.idempotency_key)) || row.adapter_version !== undefined && !/^[A-Za-z0-9_.-]{1,80}$/.test(String(row.adapter_version))) throw new DomainError("INVALID_SOURCE_READ", 422, "Scoped immutable references required");
  return row as unknown as SourceReadCommand;
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
      if (request.method === "GET" && path === "/healthz") return respond(response, 200, { service: "browser-runtime", healthy: true, externalWritesEnabled: options.externalWritesEnabled === true });
      if (request.method === "GET" && path === "/readyz") return respond(response, options.identityVerifier && options.profilesReady ? 200 : 503, { identityConfigured: !!options.identityVerifier, profilesConfigured: !!options.profilesReady, integrations: "require_per_platform_verification" });
      const loginChallenge=/^\/internal\/browser\/login-sessions\/([0-9a-f-]{36})\/challenge$/.exec(path);
      if (!path.startsWith("/internal/browser/commands") && path !== "/internal/browser/source-read"&&!loginChallenge) return respond(response, 404, { error: { code: "NOT_FOUND" } });
      if (!options.identityVerifier) throw new DomainError("IDENTITY_NOT_CONFIGURED", 503, "Service OIDC is not configured");
      const authorization = request.headers.authorization;
      if (!authorization?.startsWith("Bearer ")) throw new DomainError("SERVICE_TOKEN_REQUIRED", 401, "Service identity required");
      const identity = await options.identityVerifier(authorization.slice(7));
      const orgId = request.headers["x-org-id"];
      if (typeof orgId !== "string" || !identity.orgIds.includes(orgId)) throw new DomainError("ORGANIZATION_FORBIDDEN", 403, "Explicit authorized organization required");
      if(loginChallenge){
        if(request.method!=='POST')return respond(response,405,{error:{code:'METHOD_NOT_ALLOWED'}});
        if(!options.interactionServices?.includes(identity.email))throw new DomainError('INTERACTION_SERVICE_FORBIDDEN',403,'Only the delegated operator service can access a human login challenge');
        if(!options.interactLogin)throw new DomainError('LOGIN_CHALLENGE_UNSUPPORTED',503,'Controlled challenge is not configured');
        return respond(response,200,{data:await options.interactLogin(orgId,identity,loginChallenge[1]!,parseLoginChallenge(await body(request)))});
      }
      if (path === "/internal/browser/source-read") {
        if (request.method !== "POST") return respond(response, 405, { error: { code: "METHOD_NOT_ALLOWED" } });
        if (!options.readSource) throw new DomainError("SOURCE_BROWSER_NOT_CONFIGURED", 503, "Independent source browser recipe is not configured");
        return respond(response, 200, { data: await options.readSource(orgId, identity, parseSourceReadCommand(await body(request))) });
      }
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
