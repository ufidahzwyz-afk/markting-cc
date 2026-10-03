import { ConnectorBlockedError, type ConnectorMode } from "./contracts";

export interface BaiduAdapter {
  readonly mode: ConnectorMode;
  readonly capabilitiesVerified: boolean;
  read(target: Record<string, unknown>): Promise<Record<string, unknown>>;
  write(input: { actionId: string; idempotencyKey: string; target: Record<string, unknown>; payload: Record<string, unknown> }): Promise<{ externalId?: string; status: "submitted" | "unknown" }>;
  readback(input: { target: Record<string, unknown>; receipt: { externalId?: string; status: "submitted" | "unknown" }; payload: Record<string, unknown> }): Promise<{ verified: boolean; state: Record<string, unknown>; evidenceRef: string }>;
}
export interface BaiduTransport {
  read: BaiduAdapter["read"];
  write: BaiduAdapter["write"];
  readback: BaiduAdapter["readback"];
}
export interface BaiduVerification {
  accountId: string;
  verifiedAt: string;
  evidenceRef: string;
  capabilities: string[];
}
export const BAIDU_REQUIRED_CAPABILITIES = ["read_campaign_reports", "read_keyword_reports", "read_search_term_reports", "write_entity", "readback_effective_fields", "restore_before_snapshot"] as const;
function isVerified(proof: BaiduVerification | undefined): boolean {
  return !!proof && !!proof.accountId && !!proof.evidenceRef && Date.parse(proof.verifiedAt) >= Date.now() - 86400_000 && Date.parse(proof.verifiedAt) <= Date.now() + 60_000 && BAIDU_REQUIRED_CAPABILITIES.every((name) => proof.capabilities.includes(name));
}
export class BaiduAdsConnector implements BaiduAdapter {
  constructor(readonly mode: ConnectorMode, private readonly transport?: BaiduTransport, private readonly verification?: BaiduVerification) {}
  get capabilitiesVerified() { return this.mode === "live" && !!this.transport && isVerified(this.verification); }
  private assertReady(target: Record<string, unknown>) {
    if (!this.capabilitiesVerified || !this.transport) throw new ConnectorBlockedError("integration_required", "百度账号、API权限与字段回读能力尚未实测");
    if (target.accountId !== this.verification!.accountId) throw new ConnectorBlockedError("account_mismatch");
    return this.transport;
  }
  read(target: Record<string, unknown>) { return this.assertReady(target).read(target); }
  async write(input: Parameters<BaiduAdapter["write"]>[0]) {
    if (!input.actionId || !input.idempotencyKey) throw new ConnectorBlockedError("authorization_required");
    return this.assertReady(input.target).write(input);
  }
  async readback(input: Parameters<BaiduAdapter["readback"]>[0]) {
    const result = await this.assertReady(input.target).readback(input);
    if (!result.evidenceRef) return { ...result, verified: false };
    return result;
  }
}
export function createBaiduAdapter(options: { mode: ConnectorMode; transport?: BaiduTransport; verification?: BaiduVerification }): BaiduAdapter {
  return new BaiduAdsConnector(options.mode, options.transport, options.verification);
}

/** Fixed native API boundary: no supplied endpoint, script, shell or browser URL is accepted. */
export function createBaiduJsonClient(options: { credentials: () => Promise<{ username: string; password: string; token: string }>; fetch?: typeof fetch }) {
  const methods = new Set(["AccountService/getAccountInfo", "CampaignService/getCampaign", "CampaignService/addCampaign", "CampaignService/updateCampaign", "AdgroupService/getAdgroup", "AdgroupService/addAdgroup", "AdgroupService/updateAdgroup", "KeywordService/getKeyword", "KeywordService/addKeyword", "KeywordService/updateKeyword", "CreativeService/getCreative", "CreativeService/addCreative", "CreativeService/updateCreative", "ReportService/getProfessionalReportId", "ReportService/getReportState", "ReportService/getReportFileUrl"]);
  return async function call(method: string, body: Record<string, unknown>) {
    if (!methods.has(method)) throw new ConnectorBlockedError("unsupported_api_method");
    const secret = await options.credentials();
    const response = await (options.fetch ?? fetch)(`https://api.baidu.com/json/sms/service/${method}`, { method: "POST", redirect: "error", signal: AbortSignal.timeout(20_000), headers: { "Content-Type": "application/json" }, body: JSON.stringify({ header: { username: secret.username, password: secret.password, token: secret.token }, body }) });
    if (!response.ok) throw new ConnectorBlockedError("baidu_http_error");
    const data = await response.json() as { header?: { status?: number }; body?: Record<string, unknown> };
    if (data.header?.status !== 0 || !data.body) throw new ConnectorBlockedError("baidu_api_error");
    return data.body;
  };
}
