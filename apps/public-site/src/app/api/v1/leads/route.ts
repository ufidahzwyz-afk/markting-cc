import { createHmac } from "node:crypto";
import { ContractValidationError, validateApiRequest } from "@boran/contracts";
import { DomainError } from "@boran/domain/core";
import { submitPublicLead } from "@boran/domain/leads";
import type { LeadSubmit } from "@boran/domain/leads";
import { publicContext, sitePolicy } from "@/lib/runtime";
export const dynamic = "force-dynamic";
async function limitedBody(request: Request) {
  if (Number(request.headers.get("content-length") ?? 0) > 16384) throw new DomainError("REQUEST_TOO_LARGE", 413, "表单内容过长");
  const reader = request.body?.getReader(); if (!reader) throw new DomainError("INVALID_FORM", 400, "表单内容为空");
  let length = 0; const chunks: Uint8Array[] = [];
  while (true) { const next = await reader.read(); if (next.done) break; length += next.value.byteLength; if (length > 16384) { await reader.cancel(); throw new DomainError("REQUEST_TOO_LARGE", 413, "表单内容过长"); } chunks.push(next.value); }
  const bytes = new Uint8Array(length); let offset = 0; for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length; }
  let input: unknown;
  try { input = JSON.parse(new TextDecoder().decode(bytes)); } catch { throw new DomainError("INVALID_JSON", 400, "表单 JSON 无效"); }
  return validateApiRequest("LeadSubmit", input) as LeadSubmit;
}
export async function POST(request: Request) {
  try {
    const origin = new URL(sitePolicy().publicOrigin).origin;
    if (request.headers.get("origin") !== origin) throw new DomainError("ORIGIN_FORBIDDEN", 403, "请求来源不允许");
    if (!request.headers.get("content-type")?.toLowerCase().startsWith("application/json")) throw new DomainError("UNSUPPORTED_CONTENT_TYPE", 415, "表单必须为 JSON");
    const ctx = await publicContext(); const input = await limitedBody(request);
    const internalTest = ctx.mode === "mock" && ["development", "test"].includes(process.env.APP_ENV ?? "production") && process.env.AUTH_MODE === "mock" && process.env.PUBLIC_SITE_ALLOW_MOCK_FORMS === "true";
    const secret = process.env.PUBLIC_RATE_LIMIT_SECRET;
    if (ctx.mode === "live" && (!secret || secret.length < 32)) throw new DomainError("FORM_NOT_CONFIGURED", 503, "表单安全接收尚未配置");
    const supplied = process.env.PUBLIC_SITE_TRUST_PROXY === "true" ? request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? "unknown-client" : "unknown-client";
    const client = supplied.length <= 100 && /^[a-f0-9:.]+$/i.test(supplied) ? supplied : "unknown-client";
    const rateLimitKey = createHmac("sha256", secret ?? "local-mock-rate-limit-only").update(client).digest("hex");
    const receipt = await submitPublicLead(ctx, input, { rateLimitKey, internalTest });
    return Response.json(receipt, { status: 201, headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    if (error instanceof ContractValidationError) return Response.json({ error: { code: "INVALID_REQUEST", message: "表单字段或格式无效" } }, { status: 400, headers: { "Cache-Control": "no-store" } });
    const known = error instanceof DomainError;
    return Response.json({ error: { code: known ? error.code : "FORM_UNAVAILABLE", message: known ? error.message : "咨询接收暂不可用" } }, { status: known ? error.status : 503, headers: { "Cache-Control": "no-store" } });
  }
}
