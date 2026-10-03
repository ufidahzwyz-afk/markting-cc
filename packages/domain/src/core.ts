import { createHash, randomUUID } from "node:crypto";
import type { Database, SqlExecutor } from "@boran/db";

export interface ServiceContext {
  db: Database;
  orgId: string;
  actorId: string;
  actorType?: "user" | "service";
  roles: string[];
  mode: "mock" | "live";
  now?: () => Date;
}
export class DomainError extends Error {
  constructor(public code: string, public status: number, message: string, public details?: unknown) { super(message); this.name = "DomainError"; }
}
export function requireRole(ctx: ServiceContext, ...roles: string[]): void {
  if (!ctx.roles.some((role) => roles.includes(role))) throw new DomainError("FORBIDDEN", 403, "当前角色不能执行此操作");
}
export function uuid(): string { return randomUUID(); }
export function nowIso(ctx: Pick<ServiceContext, "now">): string { return (ctx.now?.() ?? new Date()).toISOString(); }
export function assertVersion(actual: number, expected: number): void {
  if (actual !== expected) throw new DomainError("VERSION_CONFLICT", 409, "记录已被修改，请重新读取", { actual, expected });
}
function canonical(value: unknown): string {
  if (value === null) return "null";
  if (typeof value === "string" || typeof value === "boolean") return JSON.stringify(value);
  if (typeof value === "number" && Number.isFinite(value)) return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (value && typeof value === "object" && Object.getPrototypeOf(value) === Object.prototype) return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonical((value as Record<string, unknown>)[key])}`).join(",")}}`;
  throw new DomainError("INVALID_JSON", 422, "载荷必须为有限 JSON 值");
}
export function stableHash(value: unknown): string { return createHash("sha256").update(canonical(value)).digest("hex"); }
export function assertSafeInteger(value: unknown, field = "amount"): asserts value is number {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 0) throw new DomainError("INVALID_INTEGER", 422, `${field} 必须为非负安全整数`);
}
export async function audit(ctx: ServiceContext, tx: SqlExecutor, action: string, targetType: string, targetId: string, details: unknown = {}): Promise<void> {
  await tx.query("INSERT INTO audit_logs (id,org_id,actor_type,actor_id,action,target_type,target_id,request_id,details) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)", [uuid(), ctx.orgId, ctx.actorType ?? "user", ctx.actorId, action, targetType, targetId, uuid(), JSON.stringify(details)]);
}
export async function emitOutbox(ctx: ServiceContext, tx: SqlExecutor, eventType: string, aggregateId: string, payload: unknown): Promise<void> {
  await tx.query("INSERT INTO outbox_events (id,org_id,event_id,event_type,aggregate_id,schema_version,payload,occurred_at,attempts,next_attempt_at) VALUES ($1,$2,$3,$4,$5,1,$6,$7,0,$7)", [uuid(), ctx.orgId, uuid(), eventType, aggregateId, JSON.stringify(payload), nowIso(ctx)]);
}
