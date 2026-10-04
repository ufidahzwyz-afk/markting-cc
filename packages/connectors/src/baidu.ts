import { ConnectorBlockedError, type ConnectorMode } from "./contracts";

export interface BaiduAdapter {
  readonly mode: ConnectorMode;
  readonly capabilitiesVerified: boolean;
  read(target: Record<string, unknown>): Promise<Record<string, unknown>>;
  write(input: { actionId: string; idempotencyKey: string; target: Record<string, unknown>; payload: Record<string, unknown> }): Promise<{ externalId?: string; status: "submitted" | "unknown" }>;
  readback(input: { target: Record<string, unknown>; receipt: { externalId?: string; status: "submitted" | "unknown" }; payload: Record<string, unknown> }): Promise<{ verified: boolean; state: Record<string, unknown>; evidenceRef: string; effectiveFieldsVerified?: boolean; reviewStatus?: "approved" | "pending" | "rejected" | "unknown" }>;
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
export function createBaiduJsonClient(options: { credentials: () => Promise<{ username: string; password: string; token: string }>; fetch?: typeof fetch; beforeMutation?: () => Promise<void> }) {
  const methods = new Set(["AccountService/getAccountInfo", "CampaignService/getCampaign", "CampaignService/addCampaign", "CampaignService/updateCampaign", "AdgroupService/getAdgroup", "AdgroupService/addAdgroup", "AdgroupService/updateAdgroup", "KeywordService/getKeyword", "KeywordService/addKeyword", "KeywordService/updateKeyword", "CreativeService/getCreative", "CreativeService/addCreative", "CreativeService/updateCreative", "ReportService/getProfessionalReportId", "ReportService/getReportState", "ReportService/getReportFileUrl"]);
  return async function call(method: string, body: Record<string, unknown>) {
    if (!methods.has(method)) throw new ConnectorBlockedError("unsupported_api_method");
    const secret = await options.credentials();
    if (!secret.username || !secret.password || !secret.token) throw new ConnectorBlockedError("baidu_credentials_not_configured");
    if (/\/(?:add|update)/.test(method)) { if (!options.beforeMutation) throw new ConnectorBlockedError("authorization_required"); await options.beforeMutation(); }
    const response = await (options.fetch ?? fetch)(`https://api.baidu.com/json/sms/service/${method}`, { method: "POST", redirect: "error", signal: AbortSignal.timeout(20_000), headers: { "Content-Type": "application/json" }, body: JSON.stringify({ header: { username: secret.username, password: secret.password, token: secret.token }, body }) });
    if (!response.ok) throw new ConnectorBlockedError("baidu_http_error");
    const data = await response.json() as { header?: { status?: number }; body?: Record<string, unknown> };
    if (data.header?.status !== 0 || !data.body) throw new ConnectorBlockedError("baidu_api_error");
    return data.body;
  };
}

export type BaiduEntityType = "campaign" | "adgroup" | "keyword" | "negative" | "creative";
export const BAIDU_ENTITY_CONTRACTS = Object.freeze({
  campaign: { service: "CampaignService", array: "campaignTypes", id: "campaignId", ids: "campaignIds", fields: ["campaignId", "campaignName", "budget", "pause", "regionTarget", "schedule", "negativeWords", "exactNegativeWords"] },
  adgroup: { service: "AdgroupService", array: "adgroupTypes", id: "adgroupId", ids: "adgroupIds", fields: ["adgroupId", "campaignId", "adgroupName", "maxPrice", "pause", "negativeWords", "exactNegativeWords"] },
  keyword: { service: "KeywordService", array: "keywordTypes", id: "keywordId", ids: "keywordIds", fields: ["keywordId", "adgroupId", "keyword", "price", "matchType", "pcDestinationUrl", "mobileDestinationUrl", "pause"] },
  creative: { service: "CreativeService", array: "creativeTypes", id: "creativeId", ids: "creativeIds", fields: ["creativeId", "adgroupId", "title", "description1", "description2", "pcDestinationUrl", "mobileDestinationUrl", "displayUrl", "pause"] },
});
type NativeEntity = keyof typeof BAIDU_ENTITY_CONTRACTS;
export interface BaiduNativeTransportOptions {
  call: ReturnType<typeof createBaiduJsonClient>;
  /** This is the immutable reviewed integration contract, not inferred from a filled-in password. */
  contractVersion: string;
  externalAccountId: string;
  beforeMutation?: () => Promise<void>;
  reviewContracts?: BaiduReviewContracts;
}
export interface BaiduReviewContract { field: "status"; approved: (string | number)[]; pending: (string | number)[]; rejected: (string | number)[] }
export type BaiduReviewContracts = Partial<Record<"keyword" | "creative", BaiduReviewContract>>;
/** Provider enum meanings are supplied by a reviewed private contract; no guessed value means approved. */
export function parseBaiduReviewContracts(value: unknown): BaiduReviewContracts {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new ConnectorBlockedError("baidu_review_contract_invalid");
  const rows = value as Record<string, unknown>, result: BaiduReviewContracts = {};
  if (Object.keys(rows).some(key => !["keyword", "creative"].includes(key))) throw new ConnectorBlockedError("baidu_review_contract_invalid");
  for (const type of ["keyword", "creative"] as const) {
    if (rows[type] === undefined) continue;
    const row = rows[type] as BaiduReviewContract;
    if (!row || typeof row !== "object" || Array.isArray(row) || Object.keys(row).some(key => !["field", "approved", "pending", "rejected"].includes(key)) || row.field !== "status") throw new ConnectorBlockedError("baidu_review_contract_invalid");
    const values: (string | number)[] = [];
    for (const kind of ["approved", "pending", "rejected"] as const) {
      const list = row[kind];
      if (!Array.isArray(list) || !list.length || list.length > 32 || list.some(item => typeof item !== "string" && typeof item !== "number" || typeof item === "string" && item.length > 100 || typeof item === "number" && !Number.isFinite(item))) throw new ConnectorBlockedError("baidu_review_contract_invalid");
      values.push(...list);
    }
    if (new Set(values.map(item => JSON.stringify(item))).size !== values.length) throw new ConnectorBlockedError("baidu_review_contract_invalid");
    result[type] = { field: "status", approved: [...row.approved], pending: [...row.pending], rejected: [...row.rejected] };
  }
  return result;
}
function nativeTarget(target: Record<string, unknown>): { type: NativeEntity; id?: number } {
  if (target.entityType === "search_term" || target.entity_type === "search_term") throw new ConnectorBlockedError("search_terms_are_read_only");
  const type = String(target.entityType ?? target.entity_type);
  const actualType = type === "negative" ? String(target.parentType ?? target.parent_type ?? "campaign") : type;
  if (!(actualType in BAIDU_ENTITY_CONTRACTS) || type === "negative" && !["campaign", "adgroup"].includes(actualType)) throw new ConnectorBlockedError("unsupported_baidu_entity");
  const id = target.entityId ?? target.entity_id;
  if (id !== undefined && (!Number.isSafeInteger(Number(id)) || Number(id) <= 0)) throw new ConnectorBlockedError("invalid_baidu_entity_id");
  return { type: actualType as NativeEntity, ...(id !== undefined ? { id: Number(id) } : {}) };
}
function nativePayload(type: NativeEntity, input: Record<string, unknown>, id?: number): Record<string, unknown> {
  const contract = BAIDU_ENTITY_CONTRACTS[type];
  if (!Object.keys(input).length || Object.keys(input).some(key => !(contract.fields as readonly string[]).includes(key))) throw new ConnectorBlockedError("unsupported_baidu_effective_field");
  const payload: Record<string, unknown> = { ...input, ...(id ? { [contract.id]: id } : {}) };
  for (const key of ["budget", "price", "maxPrice"]) if (key in payload && (typeof payload[key] !== "number" || !Number.isFinite(payload[key]) || Number(payload[key]) < 0)) throw new ConnectorBlockedError("invalid_baidu_amount");
  if ("pause" in payload && typeof payload.pause !== "boolean") throw new ConnectorBlockedError("invalid_baidu_pause");
  for (const key of ["pcDestinationUrl", "mobileDestinationUrl", "displayUrl"]) if (key in payload) {
    try { const url = new URL(String(payload[key])); if (url.protocol !== "https:" || url.username || url.password) throw new Error(); } catch { throw new ConnectorBlockedError("invalid_baidu_destination"); }
  }
  return payload;
}
/** Native fixed-host calls with exact resource/field matching. API responses are never replaced by configured desired fields. */
export function createBaiduNativeTransport(options: BaiduNativeTransportOptions): BaiduTransport & { verifyAccount(): Promise<{ externalAccountId: string; evidenceRef: string; capturedAt: string }> } {
  if (!/^[A-Za-z0-9_.-]{1,80}$/.test(options.contractVersion)) throw new ConnectorBlockedError("baidu_contract_not_configured");
  const reviewContracts = options.reviewContracts ? parseBaiduReviewContracts(options.reviewContracts) : {};
  const account = async () => {
    const body = await options.call("AccountService/getAccountInfo", { accountFields: ["userId", "userName"] });
    const info = body.accountInfo as Record<string, unknown> | undefined;
    const externalAccountId = String(info?.userId ?? "");
    if (externalAccountId !== options.externalAccountId) throw new ConnectorBlockedError("account_mismatch");
    return { externalAccountId, evidenceRef: `baidu-api:${options.contractVersion}/AccountService/getAccountInfo/${externalAccountId}`, capturedAt: new Date().toISOString() };
  };
  const readEntity = async (target: Record<string, unknown>): Promise<Record<string, unknown>> => {
    const { type, id } = nativeTarget(target), contract = BAIDU_ENTITY_CONTRACTS[type];
    if (!id) throw new ConnectorBlockedError("baidu_entity_id_required");
    const review = type === "keyword" || type === "creative" ? reviewContracts[type] : undefined;
    const response = await options.call(`${contract.service}/get${type[0]!.toUpperCase()}${type.slice(1)}`, { [contract.ids]: [id], [type === "adgroup" ? "adgroupFields" : `${type}Fields`]: [...contract.fields, ...(review ? [review.field] : [])] });
    const entities = response[contract.array];
    if (!Array.isArray(entities)) throw new ConnectorBlockedError("baidu_response_contract_mismatch");
    const entity = entities.find(value => !!value && typeof value === "object" && Number((value as Record<string, unknown>)[contract.id]) === id);
    if (!entity) throw new ConnectorBlockedError("baidu_entity_not_found");
    return { ...(entity as Record<string, unknown>), accountId: options.externalAccountId, entityType: type };
  };
  return {
    verifyAccount: account,
    async read(target) {
      await account();
      if (target.accountId !== options.externalAccountId) throw new ConnectorBlockedError("account_mismatch");
      // Reports are native read-only requests. Their exact approved request is supplied by the reviewed account contract.
      if (target.reportRequestType && typeof target.reportRequestType === "object" && !Array.isArray(target.reportRequestType)) {
        const request = await options.call("ReportService/getProfessionalReportId", { reportRequestType: target.reportRequestType });
        if (typeof request.reportId !== "string") throw new ConnectorBlockedError("baidu_report_contract_mismatch");
        const status = await options.call("ReportService/getReportState", { reportId: request.reportId });
        if (status.isGenerated !== true) return { accountId: options.externalAccountId, reportId: request.reportId, status: "pending" };
        const file = await options.call("ReportService/getReportFileUrl", { reportId: request.reportId });
        if (typeof file.reportFilePath !== "string" || !file.reportFilePath.startsWith("https://")) throw new ConnectorBlockedError("baidu_report_contract_mismatch");
        return { accountId: options.externalAccountId, reportId: request.reportId, reportFileUrl: file.reportFilePath, status: "available" };
      }
      return readEntity(target);
    },
    async write(input) {
      if (!input.actionId || !input.idempotencyKey || !options.beforeMutation || input.target.accountId !== options.externalAccountId) throw new ConnectorBlockedError("authorization_required");
      await account();
      const { type, id } = nativeTarget(input.target), contract = BAIDU_ENTITY_CONTRACTS[type];
      if ((type === "keyword" || type === "creative") && !reviewContracts[type]) throw new ConnectorBlockedError("baidu_review_contract_not_configured");
      const payload = nativePayload(type, input.payload, id);
      if ((input.target.entityType ?? input.target.entity_type) === "negative" && Object.keys(input.payload).some(key => !["negativeWords", "exactNegativeWords"].includes(key))) throw new ConnectorBlockedError("unsupported_negative_field");
      await options.beforeMutation?.();
      const operation = id ? "update" : "add", noun = `${type[0]!.toUpperCase()}${type.slice(1)}`;
      const body = await options.call(`${contract.service}/${operation}${noun}`, { [contract.array]: [payload] });
      const entities = body[contract.array];
      const returnedId = Array.isArray(entities) && entities.length === 1 && typeof entities[0] === "object" ? Number((entities[0] as Record<string, unknown>)[contract.id]) : id;
      if (!Number.isSafeInteger(returnedId) || Number(returnedId) <= 0) return { status: "unknown" };
      return { status: "submitted", externalId: String(returnedId) };
    },
    async readback(input) {
      await account();
      if (!input.receipt.externalId) return { verified: false, state: {}, evidenceRef: "" };
      const type = nativeTarget(input.target).type;
      const state = await readEntity({ ...input.target, entityId: Number(input.receipt.externalId) });
      const payload = nativePayload(type, input.payload, Number(input.receipt.externalId));
      const same = (left: unknown, right: unknown): boolean => JSON.stringify(left) === JSON.stringify(right);
      const effective = Object.entries(payload).every(([key, value]) => same(state[key], value));
      let reviewStatus: "approved" | "pending" | "rejected" | "unknown" | undefined;
      if (type === "keyword" || type === "creative") {
        const review = reviewContracts[type]; reviewStatus = "unknown";
        if (review) for (const status of ["approved", "pending", "rejected"] as const) if (review[status].some(value => same(value, state[review.field]))) reviewStatus = status;
      }
      return { verified: effective && (reviewStatus === undefined || reviewStatus === "approved"), state, effectiveFieldsVerified: effective, ...(reviewStatus ? { reviewStatus } : {}), evidenceRef: `baidu-api:${options.contractVersion}/${type}/${input.receipt.externalId}/effective-readback` };
    },
  };
}
