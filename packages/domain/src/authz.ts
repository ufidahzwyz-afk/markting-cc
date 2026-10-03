import type { SqlExecutor } from "@boran/db";
import { DomainError, type ServiceContext } from "./core";

export async function activeRoles(ctx: ServiceContext, tx: SqlExecutor = ctx.db): Promise<string[]> {
  const row = (await tx.query("SELECT m.roles FROM memberships m JOIN users u ON u.id=m.user_id WHERE m.org_id=$1 AND m.user_id=$2 AND m.active AND u.active", [ctx.orgId, ctx.actorId])).rows[0];
  if (!row) throw new DomainError("FORBIDDEN", 403, "组织成员身份无效或已停用");
  return row.roles as string[];
}
export async function requireActiveRole(ctx: ServiceContext, tx: SqlExecutor, ...allowed: string[]): Promise<void> {
  const roles = await activeRoles(ctx, tx);
  if (!roles.some((role) => allowed.includes(role))) throw new DomainError("FORBIDDEN", 403, "当前组织角色不能执行此操作");
}
export async function requireOwner(ctx: ServiceContext, tx: SqlExecutor = ctx.db): Promise<void> { if (ctx.actorType === "service") throw new DomainError("FORBIDDEN", 403, "服务身份不能批准自己的执行规则"); await requireActiveRole(ctx, tx, "owner"); }
export async function assertLeadAccess(ctx: ServiceContext, ownerUserId: string | null, tx: SqlExecutor = ctx.db): Promise<void> {
  const roles = await activeRoles(ctx, tx);
  if (roles.some((role) => ["owner", "marketer"].includes(role))) return;
  if (roles.includes("sales") && ownerUserId === ctx.actorId) return;
  throw new DomainError("FORBIDDEN", 403, "当前成员无权访问此线索");
}
export async function assertOrgReference(ctx: ServiceContext, tx: SqlExecutor, table: string, id: string): Promise<void> {
  const allowed = ["connections", "platform_accounts", "topics", "pages", "content_versions", "content_variants", "evidence_claims", "source_versions", "reception_conversations", "lead_contacts", "leads", "media_assets", "brand_authorizations"];
  if (!allowed.includes(table)) throw new DomainError("INVALID_REFERENCE", 422, "引用类型不支持");
  if (!(await tx.query(`SELECT id FROM ${table} WHERE org_id=$1 AND id=$2`, [ctx.orgId, id])).rows.length) throw new DomainError("NOT_FOUND", 404, "组织内引用不存在");
}
