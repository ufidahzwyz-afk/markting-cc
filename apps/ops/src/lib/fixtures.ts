/** Isolated demonstration fixtures; never a source of real operating results. */
export const overviewFixture = {
  source: "fixture",
  realWritesEnabled: false,
  budgetApproved: false,
  connectionsConfigured: false,
  demoTasks: 4,
  demoThemes: 3,
  demoExceptions: 3,
  executionStatus: "blocked",
} as const;

export type ThemeStatus = "待完善" | "待审核" | "草稿";
export type ThemeFixture = {
  id: string;
  name: string;
  audience: string;
  intent: string;
  status: ThemeStatus;
  channels: string[];
  focus: string;
  tasks: number;
};

export const themeFixtures: readonly ThemeFixture[] = [
  { id: "demo-theme-01", name: "企业流程协同", audience: "需要梳理内部流程的中小企业", intent: "了解流程协同的常见问题", status: "待完善", channels: ["官网内容", "内容平台"], focus: "从流程断点出发，解释需求识别与实施步骤。", tasks: 2 },
  { id: "demo-theme-02", name: "经营数据管理", audience: "需要统一经营数据口径的管理团队", intent: "了解业务数据管理的基础方法", status: "待审核", channels: ["官网内容"], focus: "用通用场景说明数据口径与管理价值。", tasks: 1 },
  { id: "demo-theme-03", name: "数字化服务入门", audience: "首次评估数字化服务的企业", intent: "了解服务范围与项目准备事项", status: "草稿", channels: ["内容平台"], focus: "解释服务选择、前期准备和交付边界。", tasks: 1 },
] as const;

export const campaignFixture = {
  source: "fixture",
  grain: "campaign",
  currency: "CNY",
  spend: 220,
  impressions: 2200,
  clicks: 110,
  platformConversions: 9,
} as const;

// Keyword rows are subordinate diagnostics. They must not be added to campaign totals.
export const keywordFixtures = [
  { keyword: "流程协同（测试词）", spend: 100, impressions: 1000, clicks: 50, platformConversions: 4 },
  { keyword: "数据管理（测试词）", spend: 80, impressions: 800, clicks: 40, platformConversions: 3 },
  { keyword: "服务咨询（测试词）", spend: 40, impressions: 400, clicks: 20, platformConversions: 2 },
] as const;

export function calculateCampaignMetrics() {
  return {
    ...campaignFixture,
    clickThroughRate: campaignFixture.clicks / campaignFixture.impressions,
    costPerClick: campaignFixture.spend / campaignFixture.clicks,
    platformConversionRate: campaignFixture.platformConversions / campaignFixture.clicks,
    costPerPlatformConversion: campaignFixture.spend / campaignFixture.platformConversions,
  };
}
