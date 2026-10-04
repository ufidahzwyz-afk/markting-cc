import { DomainError } from "@boran/domain/core";
import { issueLocalServiceToken } from "./auth";

export function createBrowserInternalClient(options: { baseUrl: string; token(): Promise<string>; fetch?: typeof fetch }) {
  const base = new URL(options.baseUrl);
  if (base.username || base.password || base.pathname !== "/" || base.search || base.hash || base.protocol !== "https:" && !(base.protocol === "http:" && ["browser-runtime", "localhost", "127.0.0.1"].includes(base.hostname))) throw new DomainError("BROWSER_ENDPOINT_INVALID", 503, "Trusted browser service endpoint is unavailable");
  async function request(orgId: string, path: string, body?: unknown) {
    const token = await options.token();
    let response: Response;
    try { response = await (options.fetch ?? fetch)(new URL(path, base), { method: body === undefined ? "GET" : "POST", redirect: "error", signal: AbortSignal.timeout(180_000), headers: { Authorization: `Bearer ${token}`, "X-Org-Id": orgId, "Content-Type": "application/json" }, ...(body !== undefined ? { body: JSON.stringify(body) } : {}) }); }
    catch { throw new DomainError("BROWSER_SERVICE_UNAVAILABLE", 503, "Browser service request did not complete"); }
    let result: unknown;
    try { result = await response.json(); } catch { throw new DomainError("BROWSER_RESPONSE_INVALID", 503, "Browser service response was invalid"); }
    if (!response.ok) {
      const code = (result as { error?: { code?: unknown } })?.error?.code;
      throw new DomainError(typeof code === "string" && /^[A-Z0-9_.:-]{1,100}$/i.test(code) ? code : "BROWSER_SERVICE_FAILED", response.status, "Browser service returned an incomplete operation");
    }
    return (result as { data?: unknown }).data;
  }
  const id = (value: string) => { if (!/^[0-9a-f-]{36}$/i.test(value)) throw new DomainError("INVALID_REFERENCE", 422, "Command reference invalid"); return value; };
  return { execute: (orgId: string, commandId: string) => request(orgId, `/internal/browser/commands/${id(commandId)}/execute`, {}), get: (orgId: string, commandId: string) => request(orgId, `/internal/browser/commands/${id(commandId)}`), sourceRead: (orgId: string, input: unknown) => request(orgId, "/internal/browser/source-read", input),challenge:(orgId:string,sessionId:string,input:import('./challenges').LoginChallengeCommand)=>request(orgId,`/internal/browser/login-sessions/${id(sessionId)}/challenge`,input) };
}
export function browserClientFromEnvironment(env: NodeJS.ProcessEnv = process.env, service: "ops" | "worker" = "worker") {
  if (!env.BROWSER_RUNTIME_URL) throw new DomainError("BROWSER_IDENTITY_NOT_CONFIGURED", 503, "Trusted browser client identity is not configured");
  if (env.BROWSER_IDENTITY_MODE !== "local_service") {
    if (!env.BROWSER_OIDC_AUDIENCE) throw new DomainError("BROWSER_IDENTITY_NOT_CONFIGURED", 503, "Cloud browser OIDC audience is not configured");
    return createBrowserInternalClient({ baseUrl: env.BROWSER_RUNTIME_URL, token: async () => {
      const url = new URL("http://metadata.google.internal/computeMetadata/v1/instance/service-accounts/default/identity");
      url.searchParams.set("audience", env.BROWSER_OIDC_AUDIENCE!); url.searchParams.set("format", "full");
      try {
        const response = await fetch(url, { headers: { "Metadata-Flavor": "Google" }, redirect: "error", signal: AbortSignal.timeout(10_000) });
        if (!response.ok || response.headers.get("Metadata-Flavor") !== "Google") throw new Error();
        const token = await response.text();
        if (token.length > 16_000 || !/^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/.test(token)) throw new Error();
        return token;
      } catch { throw new DomainError("BROWSER_IDENTITY_UNAVAILABLE", 503, "Cloud service identity token is unavailable"); }
    } });
  }
  if (!env.BROWSER_LOCAL_SERVICE_AUDIENCE || !env.BORAN_SERVICE_KEY_FILE) throw new DomainError("BROWSER_IDENTITY_NOT_CONFIGURED", 503, "Local browser service identity is not configured");
  if (["production", "staging"].includes(String(env.APP_ENV))) throw new DomainError("LOCAL_IDENTITY_FORBIDDEN", 500, "Production browser service requires OIDC");
  return createBrowserInternalClient({ baseUrl: env.BROWSER_RUNTIME_URL, token: () => issueLocalServiceToken({ audience: env.BROWSER_LOCAL_SERVICE_AUDIENCE!, keyFile: env.BORAN_SERVICE_KEY_FILE!, subject: `boran-${service}`, role: service }) });
}
