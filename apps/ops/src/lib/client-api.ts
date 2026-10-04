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

export type PrivateDraft = {
  id: string; topicId: string; contentVersionId: string; version: number; title: string;
  bodyBlocks: { type: 'paragraph'|'bullet'|'heading'; text: string }[]; claimRefs: { blockIndex: number; claimId: string }[];
  cta?: {label:string;href:string;action:'navigate'|'scroll_to_form'|'contact'} | null; gaps: unknown[]; warnings: unknown[]; aiRunId: string | null;
  sourceVersionIds: string[]; mode: string; origin: 'ai'|'manual'; parentVersionId: string|null; payloadHash: string; state: 'private_candidate';
};
export type AutomationStatus = {
  mode: 'live'|'mock';
  source_changes: Record<string, unknown>[]; insights: Record<string, unknown>[];
  recommendations: Record<string, unknown>[]; ai_runs: Record<string, unknown>[];
  drafts: PrivateDraft[]; model: Record<string, unknown>;
};
export const automationStatus = (mode?: 'live' | 'mock') => api<AutomationStatus>(`/automation/status${mode?`?mode=${mode}`:''}`);
export const privateDraft = (id: string, mode?: 'live'|'mock') => api<PrivateDraft>(`/automation/drafts/${id}${mode?`?mode=${mode}`:''}`);
export const editPrivateDraft = (draft: PrivateDraft, input: { title: string; body_blocks: PrivateDraft['bodyBlocks']; claim_refs: { block_index: number; claim_id: string }[]; cta?: PrivateDraft['cta'] }) => api<PrivateDraft>(`/automation/drafts/${draft.id}?mode=${draft.mode}`, { method: 'PATCH', version: draft.version, body: input });
export const syncSource = (id: string) => api<{ run_id: string; status: string; source_kind: string; simulation: boolean }>(`/connections/${id}/sync`, { method: 'POST', body: { mode: 'incremental' } });
