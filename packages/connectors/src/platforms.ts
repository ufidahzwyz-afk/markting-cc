import { ConnectorBlockedError, type CapabilityVerification, type ConnectorMode, type PlatformAdapter, type PlatformCommand, type PlatformExecutionContext, type PlatformHooks, type PlatformResult } from "./contracts";

export interface PlatformDescriptor {
  channelId: string;
  displayName: string;
  transport: "official_api_first" | "controlled_browser";
  formats: readonly string[];
  /** Exact HTTPS navigation origins, including known authentication endpoints. */
  allowedOrigins: readonly string[];
  requiredCapabilities: readonly string[];
}
const publishing = ["verify_account", "maintain_session", "validate_actual_materials", "submit_publish", "readback_actual_result", "reconcile_unknown_result", "verify_ai_label_requirements", "readback_required_labels"] as const;
function descriptor(channelId: string, displayName: string, origins: string[], formats: string[], transport: PlatformDescriptor["transport"] = "controlled_browser"): PlatformDescriptor {
  const requiredCapabilities = channelId === "baidu_marketing" ? ["verify_account", "maintain_session", "write_entity", "readback_effective_fields", "restore_before_snapshot", "reconcile_unknown_result"] : publishing;
  return Object.freeze({ channelId, displayName, allowedOrigins: Object.freeze(origins), formats: Object.freeze(formats), transport, requiredCapabilities });
}
// Public platform identifiers only. Account names, secrets and business source material stay outside this repository.
export const PLATFORM_DESCRIPTORS: readonly PlatformDescriptor[] = Object.freeze([
  descriptor("wechat_mp", "微信公众号", ["https://mp.weixin.qq.com", "https://open.weixin.qq.com"], ["article"], "official_api_first"),
  descriptor("wechat_channels", "微信视频号", ["https://channels.weixin.qq.com", "https://open.weixin.qq.com"], ["video"]),
  descriptor("toutiao", "今日头条", ["https://mp.toutiao.com", "https://sso.toutiao.com", "https://www.toutiao.com"], ["article", "video"]),
  descriptor("zhihu", "知乎", ["https://www.zhihu.com", "https://zhuanlan.zhihu.com"], ["article", "answer"]),
  descriptor("baijiahao", "百家号", ["https://baijiahao.baidu.com", "https://passport.baidu.com"], ["article", "video"]),
  descriptor("haokan", "好看视频", ["https://haokan.baidu.com", "https://passport.baidu.com"], ["video"]),
  descriptor("baidu_wenku", "百度文库", ["https://wenku.baidu.com", "https://passport.baidu.com"], ["document"]),
  descriptor("baidu_zhidao", "百度知道", ["https://zhidao.baidu.com", "https://passport.baidu.com"], ["answer"]),
  descriptor("baidu_jingyan", "百度经验", ["https://jingyan.baidu.com", "https://passport.baidu.com"], ["tutorial"]),
  descriptor("baidu_tieba", "百度贴吧", ["https://tieba.baidu.com", "https://passport.baidu.com"], ["post"]),
  descriptor("baidu_marketing", "百度营销", ["https://fengchao.baidu.com", "https://yingxiao.baidu.com", "https://api.baidu.com", "https://passport.baidu.com"], ["search_ad"], "official_api_first"),
  descriptor("xiaohongshu", "小红书", ["https://creator.xiaohongshu.com", "https://www.xiaohongshu.com"], ["image_note", "video"]),
  descriptor("douyin", "抖音", ["https://creator.douyin.com", "https://www.douyin.com"], ["video"]),
  descriptor("sohu", "搜狐", ["https://mp.sohu.com", "https://passport.sohu.com", "https://www.sohu.com"], ["article"]),
  descriptor("cnblogs", "博客园", ["https://i.cnblogs.com", "https://account.cnblogs.com", "https://www.cnblogs.com"], ["article"]),
  descriptor("csdn", "CSDN", ["https://mp.csdn.net", "https://passport.csdn.net", "https://blog.csdn.net"], ["article"]),
]);
export function getPlatformDescriptor(channelId: string): PlatformDescriptor {
  const entry = PLATFORM_DESCRIPTORS.find((item) => item.channelId === channelId);
  if (!entry) throw new ConnectorBlockedError("unsupported_platform");
  return entry;
}
function validEvidence(context: PlatformExecutionContext, proof: CapabilityVerification): boolean {
  const timestamp = Date.parse(proof.capturedAt);
  return proof.verified && proof.externalAccountId === context.externalAccountId && proof.adapterVersion === context.adapterVersion && proof.evidenceRef.length > 0 && Number.isFinite(timestamp) && timestamp <= Date.now() + 60_000 && timestamp >= Date.now() - 7 * 86400_000;
}
/** A hook must be a reviewed, platform-specific implementation. Empty hooks never imply a working integration. */
export function createPlatformAdapter(channelId: string, options: { mode: ConnectorMode; hooks?: PlatformHooks; profileRequired?: boolean; descriptor?: PlatformDescriptor }): PlatformAdapter {
  const descriptor = options.descriptor ?? getPlatformDescriptor(channelId);
  if (descriptor.channelId !== channelId || !descriptor.allowedOrigins.length || descriptor.allowedOrigins.some((origin) => { try { const parsed = new URL(origin); return parsed.protocol !== "https:" || parsed.origin !== origin || !!parsed.username || !!parsed.password; } catch { return true; } })) throw new ConnectorBlockedError("invalid_platform_scope");
  const verifiedAccounts = new Map<string, CapabilityVerification>();
  const key = (ctx: PlatformExecutionContext) => `${ctx.orgId}:${ctx.accountId}:${ctx.sessionVersion}:${ctx.adapterVersion}`;
  async function verify(context: PlatformExecutionContext) {
    if (options.mode !== "live" || context.mode !== "live" || !options.hooks) throw new ConnectorBlockedError("integration_required");
    const proof = await options.hooks.probe(context);
    if (!validEvidence(context, proof)) throw new ConnectorBlockedError("capability_verification_failed");
    if (!descriptor.requiredCapabilities.every((capability) => proof.capabilities.includes(capability))) throw new ConnectorBlockedError("capability_gap");
    verifiedAccounts.set(key(context), proof);
    return proof;
  }
  async function execute(context: PlatformExecutionContext, command: PlatformCommand): Promise<PlatformResult> {
    if (options.mode !== "live" || !options.hooks) return { status: "blocked", reason: "integration_required" };
    if (command.commandType === "login" || command.commandType === "session_verify") {
      await context.assertLease();
      const hook = command.commandType === "login" ? options.hooks.login : options.hooks.sessionVerify;
      return hook ? hook(context) : { status: "blocked", reason: `${command.commandType}_not_implemented` };
    }
    // Recheck the current private capability receipt before each mutation; cached proof cannot outlive configuration or acceptance expiry.
    let proof = command.commandType === "publish" || command.commandType === "ad_write" ? await verify(context) : verifiedAccounts.get(key(context));
    if (!proof || !validEvidence(context, proof)) {
      // Read-only commands must work before publishing has passed its independent capability test.
      if (command.commandType === "ad_read" || command.commandType === "source_fetch" || command.commandType === "reconcile") {
        proof = await options.hooks.probe(context);
        if (!validEvidence(context, proof) || !proof.capabilities.includes("verify_account")) throw new ConnectorBlockedError("capability_verification_failed");
      } else proof = await verify(context);
    }
    await context.assertLease();
    const hooks = options.hooks;
    if (command.commandType === "source_fetch") return hooks.sourceFetch ? hooks.sourceFetch(context, command) : { status: "blocked", reason: "source_not_implemented" };
    if (command.commandType === "ad_read") return hooks.readMetrics ? hooks.readMetrics(context, command) : { status: "blocked", reason: "metrics_not_implemented" };
    if (command.commandType === "reconcile") return hooks.reconcile ? hooks.reconcile(context, command) : { status: "blocked", reason: "reconciliation_required" };
    if (!command.actionId) throw new ConnectorBlockedError("authorization_required");
    const submit = command.commandType === "publish" ? hooks.publish : hooks.adWrite;
    if (!submit || !hooks.readback) return { status: "blocked", reason: "write_or_readback_not_implemented" };
    if (hooks.sessionVerify) {
      const current = await hooks.sessionVerify(context);
      if (current.status !== "verified") return current;
      if (!current.evidence.verified || current.evidence.externalAccountId !== context.externalAccountId) return { status: "blocked", reason: "account_verification_failed" };
    }
    await context.assertLease();
    if (!hooks.mutationBoundaryManaged) context.markMutationStart?.();
    const result = await submit(context, command);
    // Submission is never treated as completion; uncertain effects must be reconciled.
    if (result.status !== "submitted") return result.status === "verified" ? { status: "unknown", reason: "submission_without_readback" } : result;
    await context.recordSubmission?.(result);
    await context.assertLease();
    let readback: PlatformResult;
    try { readback = await hooks.readback(context, command, result); }
    catch { return { status: "unknown", reason: "readback_failed", externalId: result.externalId, data: { external_id: result.externalId } }; }
    if (readback.status === "in_review" || readback.status === "rejected") return readback;
    if (readback.status !== "verified" || !readback.evidence.verified || readback.evidence.externalAccountId !== context.externalAccountId || readback.evidence.labelsVerified !== true) return { status: "unknown", reason: "readback_not_verified", externalId: result.externalId, data: { external_id: result.externalId } };
    return readback;
  }
  return {
    channelId, mode: options.mode, profileRequired: options.profileRequired ?? true, allowedOrigins: descriptor.allowedOrigins,
    readiness: () => ({ configured: options.mode === "live" && !!options.hooks, connected: verifiedAccounts.size > 0, reason: verifiedAccounts.size > 0 ? null : "integration_required", capabilities: verifiedAccounts.values().next().value?.capabilities ?? [] }),
    verify, execute,
    async reconcile(context, command) { if (!options.hooks?.reconcile || options.mode !== "live") return { status: "blocked", reason: "reconciliation_required" }; await context.assertLease(); return options.hooks.reconcile(context, command); },
  };
}
export function createPlatformRegistry(options: { mode: ConnectorMode; hooks?: Partial<Record<string, PlatformHooks>> }): ReadonlyMap<string, PlatformAdapter> {
  return new Map(PLATFORM_DESCRIPTORS.map((descriptor) => [descriptor.channelId, createPlatformAdapter(descriptor.channelId, { mode: options.mode, ...(options.hooks?.[descriptor.channelId] ? { hooks: options.hooks[descriptor.channelId] } : {}) })]));
}
