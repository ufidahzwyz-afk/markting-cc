import { randomUUID } from "node:crypto";
import { DomainError, stableHash } from "@boran/domain/core";
import type { ServiceContext } from "@boran/domain/core";
import type { SqlExecutor } from "@boran/db";

export function jsonData(data: unknown, status = 200, meta: Record<string, unknown> = {}) {
  return Response.json({ data, meta: { request_id: randomUUID(), ...meta } }, { status, headers: { "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff" } });
}
export function errorResponse(error: unknown) {
  if (error instanceof DomainError) return Response.json({ error: { code: error.code, message: error.message, details: safeDetails(error.details), request_id: randomUUID() } }, { status: error.status, headers: { "Cache-Control": "no-store" } });
  if (error && typeof error === "object" && "code" in error && error.code === "CONTRACT_INVALID") return Response.json({ error: { code: "INVALID_REQUEST", message: "请求字段不符合接口约定", request_id: randomUUID() } }, { status: 400 });
  // PostgreSQL constraint detail can contain personal data; never echo its text.
  if (error && typeof error === "object" && "code" in error && ["23505", "23503", "23514"].includes(String(error.code))) return Response.json({ error: { code: "DATA_CONFLICT", message: "记录冲突或关联范围无效", request_id: randomUUID() } }, { status: 409 });
  return Response.json({ error: { code: "INTERNAL_ERROR", message: "操作未完成，请查看任务状态或稍后重试", request_id: randomUUID() } }, { status: 500 });
}
function safeDetails(value: unknown) {
  if (!value || typeof value !== "object") return undefined;
  const input = value as Record<string, unknown>;
  return Object.fromEntries(["actual", "expected", "missing", "action_id", "resource_id"].filter(key => input[key] !== undefined).map(key => [key, input[key]]));
}
export async function readBody(request: Request): Promise<Record<string, unknown>> {
  if (!request.headers.get("content-type")?.toLowerCase().startsWith("application/json")) throw new DomainError("INVALID_CONTENT_TYPE", 400, "请求须使用 JSON");
  if (Number(request.headers.get("content-length") ?? 0) > 1024 * 1024) throw new DomainError("PAYLOAD_TOO_LARGE", 413, "请求体过大");
  const text = await request.text();
  if (Buffer.byteLength(text) > 1024 * 1024) throw new DomainError("PAYLOAD_TOO_LARGE", 413, "请求体过大");
  try {
    const parsed: unknown = JSON.parse(text);
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) return parsed as Record<string, unknown>;
  } catch { /* reject malformed JSON */ }
  throw new DomainError("INVALID_REQUEST", 400, "请求必须是 JSON 对象");
}
export function expectedVersion(request: Request) {
  const value = request.headers.get("if-match")?.replace(/^W\//, "").replaceAll('"', "");
  const version = Number(value);
  if (!value || !Number.isSafeInteger(version) || version < 1) throw new DomainError("VERSION_REQUIRED", 428, "修改需要 If-Match 版本");
  return version;
}
export function idempotencyKey(request: Request) {
  const key = request.headers.get("idempotency-key");
  if (!key || !/^[\w:.-]{1,128}$/.test(key)) throw new DomainError("IDEMPOTENCY_REQUIRED", 400, "提交需要有效的 Idempotency-Key");
  return key;
}
export function transactionContext(ctx: ServiceContext, tx: SqlExecutor): ServiceContext {
  return { ...ctx, db: { query: tx.query.bind(tx), transaction: async fn => fn(tx), close: async () => undefined } };
}
/** Only wraps database-only commands. External writes keep their own persisted intent. */
export async function databaseCommand(ctx: ServiceContext, request: Request, body: unknown, status: number, command: (context: ServiceContext) => Promise<unknown>) {
  const key = idempotencyKey(request);
  const scope = `${request.method}:${stableHash({ path: new URL(request.url).pathname, actorId: ctx.actorId })}`;
  const hash = stableHash({ body, version: request.headers.get("if-match") });
  const result = await ctx.db.transaction(async tx => {
    await tx.query("INSERT INTO idempotency_records (org_id,scope,key,request_hash,expires_at) VALUES ($1,$2,$3,$4,now()+interval '7 days') ON CONFLICT (org_id,scope,key) DO NOTHING", [ctx.orgId, scope, key, hash]);
    const existing = (await tx.query<{ request_hash: string; response_json: unknown; status_code: number | null }>("SELECT request_hash,response_json,status_code FROM idempotency_records WHERE org_id=$1 AND scope=$2 AND key=$3 FOR UPDATE", [ctx.orgId, scope, key])).rows[0]!;
    if (existing.request_hash !== hash) throw new DomainError("IDEMPOTENCY_CONFLICT", 409, "同一幂等键不能用于不同请求");
    if (existing.status_code !== null) return { data: existing.response_json, status: existing.status_code, replay: true };
    const data = await command(transactionContext(ctx, tx));
    await tx.query("UPDATE idempotency_records SET response_json=$1,status_code=$2,updated_at=now() WHERE org_id=$3 AND scope=$4 AND key=$5", [JSON.stringify(data), status, ctx.orgId, scope, key]);
    return { data, status, replay: false };
  });
  return jsonData(result.data, result.status, { mode: ctx.mode, idempotency_replay: result.replay });
}
