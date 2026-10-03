import { createTopic, updateTopic } from "./marketing";
import { activeRoles, requireActiveRole } from "./authz";
import { DomainError, audit, assertVersion, nowIso, uuid, type ServiceContext } from "./core";
import type { SqlExecutor } from "@boran/db";

const lines = { "用友": "yonyou", "致远": "seeyon", "集成服务": "shared" } as const;
const owners = { "运营 A": "00000000-0000-4000-8000-000000000002", "运营 B": "00000000-0000-4000-8000-000000000003" };
const channels = ["官网", "微信公众号", "知乎", "百度"];
export interface WorkspaceThemeInput { title: string; businessLine: keyof typeof lines; status: "草稿" | "进行中" | "待审核" | "已暂停"; audience: string; goal: string; channels: string[]; owner: string; ownerId?: string; tasks: { id: string; label: string; done: boolean }[] }
export interface WorkspaceThemeView extends WorkspaceThemeInput { id: string; updatedAt: string; version: number }
function withinTx(ctx: ServiceContext, tx: SqlExecutor): ServiceContext { return { ...ctx, db: { query: tx.query.bind(tx), transaction: fn => fn(tx), close: async () => undefined } }; }
function validate(input: WorkspaceThemeInput) {
  if (typeof input.title !== "string" || !input.title.trim() || input.title.length > 100 || !(input.businessLine in lines) || !["草稿", "进行中", "待审核", "已暂停"].includes(input.status) || typeof input.audience !== "string" || input.audience.length > 180 || typeof input.goal !== "string" || input.goal.length > 500 || !Array.isArray(input.channels) || input.channels.some(item => !channels.includes(item)) || !Array.isArray(input.tasks) || input.tasks.length > 30 || new Set(input.tasks.map(task => task?.id)).size !== input.tasks.length || input.tasks.some(task => !task || typeof task.id !== "string" || task.id.length > 100 || typeof task.label !== "string" || !task.label.trim() || task.label.length > 200 || typeof task.done !== "boolean")) throw new DomainError("INVALID_THEME", 422, "主题信息或推进任务无效");
}
async function owner(ctx: ServiceContext, input: WorkspaceThemeInput, tx: SqlExecutor) {
  const id = input.ownerId ?? (ctx.mode === "mock" ? owners[input.owner as keyof typeof owners] : undefined);
  const row = (await tx.query("SELECT u.id,u.display_name FROM users u JOIN memberships m ON m.user_id=u.id WHERE m.org_id=$1 AND u.id=$2 AND m.active AND u.active", [ctx.orgId, id ?? ctx.actorId])).rows[0];
  if (!row) throw new DomainError("INVALID_OWNER", 422, "负责人必须为现有组织成员");
  return String(row.id);
}
export async function getWorkspaceThemes(ctx: ServiceContext): Promise<WorkspaceThemeView[]> {
  await requireActiveRole(ctx, ctx.db, "owner", "marketer");
  const topics = (await ctx.db.query("SELECT t.*,s.value AS workspace_meta FROM topics t LEFT JOIN settings s ON s.org_id=t.org_id AND s.key='workspace.theme.'||t.id::text WHERE t.org_id=$1 AND t.state<>'discarded' ORDER BY t.updated_at DESC LIMIT 200", [ctx.orgId])).rows;
  const tasks = (await ctx.db.query("SELECT t.*,u.display_name FROM tasks t JOIN users u ON u.id=t.owner_user_id WHERE t.org_id=$1 AND t.brief->>'workspace'='theme' ORDER BY (t.brief->>'ordinal')::integer,t.created_at", [ctx.orgId])).rows;
  return topics.map(row => {
    const items = tasks.filter(task => (task.brief as Record<string, unknown>).topic_id === row.id);
    const meta = (row.workspace_meta ?? {}) as Record<string, unknown>;
    const first = items[0];
    return { id: String(row.id), title: String(row.title), businessLine: row.business_line === "yonyou" ? "用友" : row.business_line === "seeyon" ? "致远" : "集成服务", status: row.state === "active" || row.state === "scheduled" ? "进行中" : meta.status === "已暂停" ? "已暂停" : row.state === "ready" || meta.status === "待审核" ? "待审核" : "草稿", audience: String(row.audience), goal: String(meta.goal ?? row.problem), channels: Array.isArray(meta.channels) ? meta.channels.map(String) : [], owner: ctx.mode === "mock" && first ? (first.owner_user_id === owners["运营 A"] ? "运营 A" : first.owner_user_id === owners["运营 B"] ? "运营 B" : String(first.display_name)) : String(first?.display_name ?? "未分配"), ...(first ? { ownerId: String(first.owner_user_id) } : {}), updatedAt: new Date(String(row.updated_at)).toISOString(), version: Number(row.version), tasks: items.map(task => ({ id: String(task.id), label: String(task.title), done: task.status === "done" })) };
  });
}
export async function saveWorkspaceTheme(ctx: ServiceContext, input: WorkspaceThemeInput, existing?: { id: string; expectedVersion: number }): Promise<WorkspaceThemeView> {
  validate(input);
  return ctx.db.transaction(async tx => {
    await requireActiveRole(ctx, tx, "owner", "marketer");
    const actor = await owner(ctx, input, tx);
    const nested = withinTx(ctx, tx);
    const fields = { title: input.title.trim(), businessLine: lines[input.businessLine], audience: input.audience.trim() || "目标受众待确认", problem: input.goal.trim() || "客户业务问题待确认", offer: "服务范围待确认", angle: "内容方向待确认", claimIds: [] as string[] };
    const prior = existing ? (await tx.query("SELECT * FROM topics WHERE org_id=$1 AND id=$2 FOR UPDATE", [ctx.orgId, existing.id])).rows[0] : undefined;
    if (existing && !prior) throw new DomainError("NOT_FOUND", 404, "主题不存在");
    if (existing) assertVersion(Number(prior!.version), existing.expectedVersion);
    if (input.status === "进行中" && (!prior || !["active", "scheduled"].includes(String(prior.state)))) throw new DomainError("THEME_ACTIVATION_REQUIRED", 422, "主题需要有效规则和排期才能进入进行中，请先保存草稿");
    const topic = existing ? await updateTopic(nested, existing.id, { ...fields, claimIds: (prior!.claim_ids ?? []) as string[], expectedVersion: existing.expectedVersion }) : await createTopic(nested, fields);
    if (input.status === "已暂停") {
      await tx.query("UPDATE topics SET state='blocked' WHERE org_id=$1 AND id=$2", [ctx.orgId, topic.id]);
      await tx.query("UPDATE execution_actions SET state='cancelled',version=version+1 WHERE org_id=$1 AND target->>'topic_id'=$2 AND state IN ('queued','retry_wait')", [ctx.orgId, topic.id]);
      await tx.query("UPDATE publish_jobs SET delivery_state='cancelled' WHERE org_id=$1 AND execution_action_id IN (SELECT id FROM execution_actions WHERE org_id=$1 AND target->>'topic_id'=$2 AND state='cancelled') AND delivery_state IN ('scheduled','queued','retry_wait')", [ctx.orgId, topic.id]);
    }
    await tx.query("INSERT INTO settings(org_id,key,value,schema_version,updated_by) VALUES($1,$2,$3,1,$4) ON CONFLICT(org_id,key) DO UPDATE SET value=excluded.value,updated_by=excluded.updated_by,updated_at=now()", [ctx.orgId, `workspace.theme.${topic.id}`, JSON.stringify({ goal: input.goal, channels: [...new Set(input.channels)], status: input.status }), ctx.actorId]);
    const old = (await tx.query("SELECT id FROM tasks WHERE org_id=$1 AND brief->>'workspace'='theme' AND brief->>'topic_id'=$2", [ctx.orgId, topic.id])).rows;
    const oldIds = new Set(old.map(row => String(row.id)));
    const time = nowIso(ctx);
    for (const [ordinal, task] of input.tasks.entries()) {
      if (oldIds.has(task.id)) {
        await tx.query("UPDATE tasks SET title=$1,status=$2,owner_user_id=$3,version=version+1,updated_at=$4 WHERE org_id=$5 AND id=$6", [task.label, task.done ? "done" : "todo", actor, time, ctx.orgId, task.id]);
      } else {
        if (existing) throw new DomainError("TASK_SET_CHANGED", 409, "任务清单已变化，请刷新主题");
        await tx.query("INSERT INTO tasks(id,org_id,type,title,brief,business_line,owner_user_id,due_at,priority,status,version) VALUES($1,$2,'evidence',$3,$4,$5,$6,$7,'P2',$8,1)", [uuid(), ctx.orgId, task.label, JSON.stringify({ workspace: "theme", topic_id: topic.id, ordinal, execution: "planning_record" }), lines[input.businessLine], actor, time, task.done ? "done" : "todo"]);
      }
    }
    if (existing && oldIds.size !== input.tasks.length) throw new DomainError("TASK_SET_CHANGED", 409, "任务清单已变化，请刷新主题");
    await audit(ctx, tx, "workspace.theme.saved", "topic", topic.id, { version: topic.version, planningOnly: true });
    const views = await getWorkspaceThemes(nested);
    return views.find(theme => theme.id === topic.id)!;
  });
}
export async function getWorkspaceOverview(ctx: ServiceContext) {
  await requireActiveRole(ctx, ctx.db, "owner", "marketer");
  const tasks = (await ctx.db.query("SELECT t.*,u.display_name AS owner_name FROM tasks t JOIN users u ON u.id=t.owner_user_id WHERE t.org_id=$1 ORDER BY t.due_at,t.created_at LIMIT 200", [ctx.orgId])).rows;
  const connections = (await ctx.db.query("SELECT id,provider,display_name,source_kind,access_status,health,last_error_code,last_success_at FROM connections WHERE org_id=$1 ORDER BY display_name", [ctx.orgId])).rows;
  const runs = (await ctx.db.query("SELECT id,kind,status,started_at,finished_at,created_at,error FROM workflow_runs WHERE org_id=$1 ORDER BY created_at DESC LIMIT 20", [ctx.orgId])).rows;
  const actions = (await ctx.db.query("SELECT id,action_type,state,last_error,target,created_at FROM execution_actions WHERE org_id=$1 AND state IN ('blocked','unknown','failed') ORDER BY created_at DESC LIMIT 20", [ctx.orgId])).rows;
  return { tasks, connections, runs, exceptions: actions, mode: ctx.mode, externalWritesEnabled: false };
}
