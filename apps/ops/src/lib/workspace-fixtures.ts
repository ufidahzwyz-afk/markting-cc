/** Publicly understandable scenarios, isolated from all real business data. */
export const WORKSPACE_THEME_STORAGE_KEY = "boran:mock-workspace:themes:v2";
export const businessLines = ["用友", "致远", "集成服务"] as const;
export const workspaceThemeStatuses = ["草稿", "进行中", "待审核", "已暂停"] as const;
export const workspaceChannels = ["官网", "微信公众号", "知乎", "百度"] as const;
export const workspaceOwners = ["运营 A", "运营 B"] as const;
export type BusinessLine = (typeof businessLines)[number];
export type WorkspaceThemeStatus = (typeof workspaceThemeStatuses)[number];
export type WorkspaceTask = { id: string; label: string; done: boolean };
export type WorkspaceTheme = {
  version?: number; ownerId?: string; id: string; title: string; businessLine: BusinessLine; status: WorkspaceThemeStatus;
  audience: string; goal: string; channels: string[]; owner: string; updatedAt: string; tasks: WorkspaceTask[];
};
function tasks(completed: number): WorkspaceTask[] {
  return ["确认受众与业务问题", "整理公开参考资料", "准备官网内容", "准备渠道素材", "检查事实与内容边界", "确认发布计划"].map((label, index) => ({ id: `task-${index + 1}`, label, done: index < completed }));
}
export const workspaceThemeFixtures: readonly WorkspaceTheme[] = [
  { id: "mock-theme-001", title: "用友 ERP 财务与业务协同", businessLine: "用友", status: "进行中", audience: "需要统一财务与业务流程的企业", goal: "说明财务业务协同的常见场景与项目准备事项。", channels: ["官网", "微信公众号"], owner: "运营 A", updatedAt: "2026-10-03T03:30:00Z", tasks: tasks(4) },
  { id: "mock-theme-002", title: "致远 OA 审批流程梳理", businessLine: "致远", status: "待审核", audience: "需要优化审批与跨部门协作的企业", goal: "介绍审批流程识别、梳理与配置的一般方法。", channels: ["官网", "知乎"], owner: "运营 B", updatedAt: "2026-10-03T02:45:00Z", tasks: tasks(5) },
  { id: "mock-theme-003", title: "ERP 与 OA 主数据集成", businessLine: "集成服务", status: "进行中", audience: "同时使用经营管理与协同办公系统的企业", goal: "整理组织、人员与基础业务数据对接的常见需求。", channels: ["官网", "百度"], owner: "运营 B", updatedAt: "2026-10-03T02:10:00Z", tasks: tasks(3) },
  { id: "mock-theme-004", title: "用友 ERP 库存成本管理", businessLine: "用友", status: "草稿", audience: "希望改善库存与成本管理的制造或商贸企业", goal: "从库存记录与成本口径出发，解释数字化管理准备。", channels: ["官网"], owner: "运营 B", updatedAt: "2026-10-02T08:20:00Z", tasks: tasks(1) },
  { id: "mock-theme-005", title: "致远 OA 移动协同场景", businessLine: "致远", status: "进行中", audience: "需要支持异地审批与日常协同的管理团队", goal: "梳理移动审批、信息触达和任务跟进的典型场景。", channels: ["微信公众号", "知乎"], owner: "运营 A", updatedAt: "2026-10-02T07:40:00Z", tasks: tasks(2) },
  { id: "mock-theme-006", title: "经营数据报表统一口径", businessLine: "集成服务", status: "待审核", audience: "希望统一跨系统经营报表的企业", goal: "说明数据来源、指标口径与报表核验的基本步骤。", channels: ["官网", "微信公众号"], owner: "运营 B", updatedAt: "2026-10-02T06:00:00Z", tasks: tasks(5) },
  { id: "mock-theme-007", title: "用友系统升级前的准备", businessLine: "用友", status: "已暂停", audience: "正在评估经营管理系统升级的企业", goal: "介绍现状梳理、数据备份与升级评估的通用准备。", channels: ["官网", "百度"], owner: "运营 B", updatedAt: "2026-10-01T09:15:00Z", tasks: tasks(2) },
  { id: "mock-theme-008", title: "异构系统单点登录规划", businessLine: "集成服务", status: "草稿", audience: "管理多个企业应用与身份入口的 IT 团队", goal: "解释统一身份、访问范围和系统集成的准备问题。", channels: ["官网", "知乎"], owner: "运营 B", updatedAt: "2026-10-01T06:30:00Z", tasks: tasks(0) },
];
export function freshWorkspaceThemes(): WorkspaceTheme[] {
  return workspaceThemeFixtures.map((theme) => ({ ...theme, channels: [...theme.channels], tasks: theme.tasks.map((task) => ({ ...task })) }));
}
export function isWorkspaceTheme(value: unknown): value is WorkspaceTheme {
  if (typeof value !== "object" || value === null) return false;
  const item = value as Record<string, unknown>;
  return typeof item.id === "string" && item.id.startsWith("mock-") && typeof item.title === "string" && item.title.length > 0 && item.title.length <= 100
    && businessLines.includes(item.businessLine as BusinessLine) && workspaceThemeStatuses.includes(item.status as WorkspaceThemeStatus)
    && typeof item.audience === "string" && typeof item.goal === "string"
    && typeof item.owner === "string" && workspaceOwners.includes(item.owner as (typeof workspaceOwners)[number])
    && typeof item.updatedAt === "string" && Number.isFinite(Date.parse(item.updatedAt))
    && Array.isArray(item.channels) && item.channels.every((channel) => typeof channel === "string" && workspaceChannels.includes(channel as (typeof workspaceChannels)[number]))
    && Array.isArray(item.tasks) && item.tasks.every((task) => typeof task === "object" && task !== null && typeof task.id === "string" && typeof task.label === "string" && typeof task.done === "boolean");
}
export function themeProgress(theme: WorkspaceTheme) {
  const completed = theme.tasks.filter((task) => task.done).length;
  const total = theme.tasks.length;
  return { completed, total, pending: total - completed, percentage: total ? Math.round(completed / total * 100) : 0 };
}
