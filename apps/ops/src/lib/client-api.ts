"use client";
export class ApiError extends Error {
  constructor(public code: string, public status: number, message: string) { super(message); this.name = "ApiError"; }
}
type Envelope<T> = { data: T; meta: Record<string, unknown>; error?: { code: string; message: string } };
let session: Promise<{ csrf_token: string }> | undefined;
async function csrfToken() {
  session ??= fetch("/api/v1/session", { cache: "no-store" }).then(async response => {
    const value = await response.json() as Envelope<{ csrf_token: string }>;
    if (!response.ok) throw new ApiError(value.error?.code ?? "REQUEST_FAILED", response.status, value.error?.message ?? "身份读取失败");
    return value.data;
  }).catch(error => { session = undefined; throw error; });
  return (await session).csrf_token;
}
export async function api<T>(path: string, options: { method?: string; body?: unknown; version?: number | string; key?: string } = {}): Promise<T> {
  const method = options.method ?? "GET";
  const headers: Record<string, string> = {};
  if (method !== "GET") {
    headers["Content-Type"] = "application/json";
    headers["X-CSRF-Token"] = await csrfToken();
    headers["Idempotency-Key"] = options.key ?? crypto.randomUUID();
    if (options.version !== undefined) headers["If-Match"] = String(options.version);
  }
  const response = await fetch(`/api/v1${path}`, { method, headers, cache: "no-store", ...(options.body !== undefined ? { body: JSON.stringify(options.body) } : {}) });
  const value = await response.json() as Envelope<T>;
  if (!response.ok) {
    if (value.error?.code === "CSRF_REJECTED") session = undefined;
    throw new ApiError(value.error?.code ?? "REQUEST_FAILED", response.status, value.error?.message ?? "请求未完成");
  }
  return value.data;
}
