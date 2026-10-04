import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import type { BrowserContext, Page } from "playwright";
import { ConnectorBlockedError, createPlatformAdapter, type PlatformAdapter, type PlatformExecutionContext, type PlatformHooks } from "@boran/connectors";
import type { SourceCoverage } from "@boran/connectors/sources";
import { assertRecipeUrl, type AccountLocator } from "./recipes";

export const CHATGPT_SOURCE_ORIGINS = ["https://chatgpt.com", "https://auth.openai.com", "https://cdn.oaistatic.com"] as const;
export interface ChatGptReadRecipe {
  version: string;
  accountUrl: string;
  account: AccountLocator;
  messageSelector: string;
  messageIdAttribute: string;
  roleAttribute: string;
  textSelector: string;
  timestamp: AccountLocator;
  branch: AccountLocator;
  completeHistorySelector: string;
  loadEarlierSelector?: string;
  project?: { urlTemplate: string; id: AccountLocator; conversationLinkSelector: string };
}
export interface ChatGptSourceSnapshot {
  providerFileId: string;
  conversationId: string;
  projectId?: string;
  title: string;
  revision: string;
  mimeType: "application/json";
  rawContent: string;
  text: string;
  sourceModifiedAt: string | null;
  coverage: SourceCoverage;
}
export interface ChatGptSourceCapture {
  status: "changed" | "no_change" | "partial" | "auth_required" | "failed";
  snapshots: ChatGptSourceSnapshot[];
  nextCursor: unknown;
  gaps: string[];
}
export interface ChatGptSourceConfiguration {
  externalAccountId: string;
  conversationIds: readonly string[];
  projectIds: readonly string[];
  cursor: unknown;
}
const sha = (value: string) => createHash("sha256").update(value).digest("hex");
const selector = (value: unknown): value is string => typeof value === "string" && value.length > 0 && value.length <= 300 && !/[\r\n\0]/.test(value);
const locator = (value: unknown): value is AccountLocator => !!value && typeof value === "object" && selector((value as AccountLocator).selector) && ((value as AccountLocator).attribute === undefined || /^[A-Za-z][A-Za-z0-9_-]{0,60}$/.test((value as AccountLocator).attribute!));
export async function loadChatGptReadRecipe(path: string | undefined): Promise<ChatGptReadRecipe | undefined> {
  if (!path) return undefined;
  const text = await readFile(path, "utf8");
  if (Buffer.byteLength(text) > 32_000) throw new ConnectorBlockedError("invalid_chatgpt_read_recipe");
  const recipe = JSON.parse(text) as ChatGptReadRecipe;
  if (!recipe || !/^[A-Za-z0-9_.-]{1,80}$/.test(recipe.version) || !locator(recipe.account) || !locator(recipe.timestamp) || !locator(recipe.branch) || ![recipe.messageSelector, recipe.messageIdAttribute, recipe.roleAttribute, recipe.textSelector, recipe.completeHistorySelector].every(selector) || recipe.loadEarlierSelector && !selector(recipe.loadEarlierSelector)) throw new ConnectorBlockedError("invalid_chatgpt_read_recipe");
  assertRecipeUrl(recipe.accountUrl, CHATGPT_SOURCE_ORIGINS);
  if (recipe.project) {
    if (!locator(recipe.project.id) || !selector(recipe.project.conversationLinkSelector) || recipe.project.urlTemplate.split("{projectId}").length !== 2) throw new ConnectorBlockedError("invalid_chatgpt_read_recipe");
    assertRecipeUrl(recipe.project.urlTemplate.replace("{projectId}", "scope-check"), ["https://chatgpt.com"]);
  }
  return recipe;
}
async function field(page: Page, value: AccountLocator) { const found = page.locator(value.selector).first(); return value.attribute ? await found.getAttribute(value.attribute) ?? "" : await found.innerText(); }
async function visible(page: Page, value: string) { return page.locator(value).first().isVisible().catch(() => false); }
async function navigate(page: Page, url: string) { assertRecipeUrl(url, CHATGPT_SOURCE_ORIGINS); await page.goto(url, { waitUntil: "domcontentloaded", timeout: 20_000 }); assertRecipeUrl(page.url(), CHATGPT_SOURCE_ORIGINS); }
/** Read only the selected authorized conversations, with role/time/branch/coverage recorded honestly. */
export async function captureChatGptSource(context: PlatformExecutionContext, config: ChatGptSourceConfiguration, recipe: ChatGptReadRecipe): Promise<ChatGptSourceCapture> {
  const browser = context.browserSession as BrowserContext | undefined;
  if (!browser || typeof browser.newPage !== "function") throw new ConnectorBlockedError("encrypted_profile_not_configured");
  if (!config.externalAccountId || [...config.conversationIds, ...config.projectIds].some(value => !/^[A-Za-z0-9_-]{1,200}$/.test(value))) return { status: "failed", snapshots: [], nextCursor: config.cursor, gaps: ["CHATGPT_SCOPE_INVALID"] };
  const page = await browser.newPage(), snapshots: ChatGptSourceSnapshot[] = [], gaps: string[] = [];
  const previous = config.cursor && typeof config.cursor === "object" ? config.cursor as { version?: string; revisions?: Record<string, string> } : {};
  const revisions: Record<string, string> = {};
  try {
    await navigate(page, recipe.accountUrl);
    if (!await visible(page, recipe.account.selector) || (await field(page, recipe.account)).trim() !== config.externalAccountId) return { status: "auth_required", snapshots: [], nextCursor: config.cursor, gaps: ["CHATGPT_ACCOUNT_SESSION_REQUIRED"] };
    const conversations = new Map(config.conversationIds.map(id => [id, undefined as string | undefined]));
    for (const projectId of config.projectIds) {
      if (!recipe.project) { gaps.push("CHATGPT_PROJECT_ENUMERATION_NOT_CONFIGURED"); continue; }
      await navigate(page, recipe.project.urlTemplate.replace("{projectId}", encodeURIComponent(projectId)));
      if (!await visible(page, recipe.project.id.selector) || (await field(page, recipe.project.id)).trim() !== projectId) { gaps.push("CHATGPT_PROJECT_MEMBERSHIP_NOT_VERIFIED"); continue; }
      const links = page.locator(recipe.project.conversationLinkSelector), count = await links.count();
      if (count > 100) { gaps.push("CHATGPT_PROJECT_CONVERSATION_LIMIT"); continue; }
      for (let index = 0; index < count; index++) {
        const href = await links.nth(index).getAttribute("href");
        if (!href) continue;
        const url = new URL(href, "https://chatgpt.com");
        const match = /^\/c\/([A-Za-z0-9_-]{1,200})$/.exec(url.pathname);
        if (url.origin !== "https://chatgpt.com" || !match) { gaps.push("CHATGPT_PROJECT_LINK_OUTSIDE_SCOPE"); continue; }
        conversations.set(match[1]!, projectId);
      }
      // Project DOM listings can be paged/virtualized; explicit completion evidence is required.
      if (!await visible(page, recipe.completeHistorySelector)) gaps.push("CHATGPT_PROJECT_LIST_PARTIAL");
    }
    if (conversations.size > 100) return { status: "partial", snapshots: [], nextCursor: config.cursor, gaps: ["CHATGPT_CONVERSATION_LIMIT"] };
    for (const [id, projectId] of conversations) {
      await context.assertLease();
      await navigate(page, `https://chatgpt.com/c/${encodeURIComponent(id)}`);
      if (page.url().split("?")[0] !== `https://chatgpt.com/c/${encodeURIComponent(id)}`) { gaps.push("CHATGPT_CONVERSATION_UNAVAILABLE"); continue; }
      if (recipe.loadEarlierSelector) for (let load = 0; load < 20 && await visible(page, recipe.loadEarlierSelector); load++) { await context.assertLease(); await page.locator(recipe.loadEarlierSelector).first().click({ timeout: 10_000 }); }
      const elements = page.locator(recipe.messageSelector), count = await elements.count(), localGaps: string[] = [];
      if (!count) { gaps.push("CHATGPT_MESSAGES_UNAVAILABLE"); continue; }
      if (count > 1000) { gaps.push("CHATGPT_MESSAGE_LIMIT"); continue; }
      const messages: { id: string; role: "user" | "assistant"; text: string; createdAt: string | null }[] = [];
      for (let index = 0; index < count; index++) {
        const item = elements.nth(index), messageId = await item.getAttribute(recipe.messageIdAttribute), role = await item.getAttribute(recipe.roleAttribute);
        if (!messageId || !/^[A-Za-z0-9_.:-]{1,200}$/.test(messageId) || !["user", "assistant"].includes(role ?? "")) { localGaps.push("CHATGPT_MESSAGE_ID_OR_ROLE_MISSING"); continue; }
        const messageText = (await item.locator(recipe.textSelector).innerText()).trim();
        const time = item.locator(recipe.timestamp.selector).first();
        let createdAt: string | null = null;
        if (await time.count()) { const value = recipe.timestamp.attribute ? await time.getAttribute(recipe.timestamp.attribute) : await time.innerText(); if (value && Number.isFinite(Date.parse(value))) createdAt = new Date(value).toISOString(); }
        if (!createdAt) localGaps.push("CHATGPT_MESSAGE_TIME_UNAVAILABLE");
        messages.push({ id: messageId, role: role as "user" | "assistant", text: messageText, createdAt });
      }
      if (!messages.length) { gaps.push("CHATGPT_MESSAGES_UNAVAILABLE"); continue; }
      if (new Set(messages.map(message => message.id)).size !== messages.length) localGaps.push("CHATGPT_DUPLICATE_MESSAGE_IDS");
      const actualBranch = await visible(page, recipe.branch.selector) ? (await field(page, recipe.branch)).trim() : "";
      const branch = actualBranch || "unverified";
      if (!actualBranch) localGaps.push("CHATGPT_BRANCH_UNVERIFIED");
      if (!await visible(page, recipe.completeHistorySelector) || recipe.loadEarlierSelector && await visible(page, recipe.loadEarlierSelector)) localGaps.push("CHATGPT_HISTORY_PARTIAL");
      const rawContent = JSON.stringify({ conversationId: id, ...(projectId ? { projectId } : {}), branch, messages });
      if (Buffer.byteLength(rawContent) > 4_000_000) { gaps.push("CHATGPT_CONTENT_LIMIT"); continue; }
      const revision = sha(rawContent); revisions[id] = revision;
      if (previous.version === recipe.version && previous.revisions?.[id] === revision && !localGaps.length) continue;
      const coverage: SourceCoverage = { status: localGaps.length ? "partial" : "complete", scope: JSON.stringify({ conversation_ids: config.conversationIds, project_ids: config.projectIds }), conversation_id: id, ...(projectId ? { project_id: projectId } : {}), message_ids: messages.map(message => message.id), branch, start_locator: `message:${messages[0]!.id}`, end_locator: `message:${messages.at(-1)!.id}`, ...(localGaps.length ? { gaps: [...new Set(localGaps)] } : {}) };
      snapshots.push({ providerFileId: id, conversationId: id, ...(projectId ? { projectId } : {}), title: (await page.title()).slice(0, 200), revision, mimeType: "application/json", rawContent, text: messages.map(message => `[${message.role}] [${message.id}] [${message.createdAt ?? "time unavailable"}]\n${message.text}`).join("\n\n"), sourceModifiedAt: messages.at(-1)?.createdAt ?? null, coverage });
      gaps.push(...localGaps);
    }
    const allGaps = [...new Set(gaps)];
    await context.assertLease();
    return { status: allGaps.length ? "partial" : snapshots.length ? "changed" : "no_change", snapshots, nextCursor: allGaps.length ? config.cursor : { version: recipe.version, revisions }, gaps: allGaps };
  } finally { await page.close(); }
}
export function createChatGptSourceAdapter(options: { mode: "mock" | "live"; recipe?: ChatGptReadRecipe; loginHooks?: PlatformHooks; configuration(context: PlatformExecutionContext): Promise<ChatGptSourceConfiguration> }): PlatformAdapter | undefined {
  if (!options.recipe) return undefined;
  const recipe = options.recipe;
  return createPlatformAdapter("chatgpt", { mode: options.mode, profileRequired: true, descriptor: { channelId: "chatgpt", displayName: "指定 ChatGPT 沟通", transport: "controlled_browser", formats: ["conversation"], allowedOrigins: CHATGPT_SOURCE_ORIGINS, requiredCapabilities: ["verify_account"] }, hooks: {
    ...(options.loginHooks?.login ? {login:options.loginHooks.login} : {}),
    ...(options.loginHooks?.sessionVerify ? {sessionVerify:options.loginHooks.sessionVerify} : {}),
    async probe(context) {
      if (context.adapterVersion !== recipe.version) throw new ConnectorBlockedError("adapter_version_conflict");
      const config = await options.configuration(context), browser = context.browserSession as BrowserContext | undefined;
      if (!browser || typeof browser.newPage !== "function") throw new ConnectorBlockedError("encrypted_profile_not_configured");
      const page = await browser.newPage();
      try { await navigate(page, recipe.accountUrl); if (!await visible(page, recipe.account.selector) || (await field(page, recipe.account)).trim() !== config.externalAccountId || config.externalAccountId !== context.externalAccountId) throw new ConnectorBlockedError("challenge_required"); await context.assertLease(); }
      finally { await page.close(); }
      return { verified: true, externalAccountId: context.externalAccountId, adapterVersion: context.adapterVersion, evidenceRef: `chatgpt-command:${context.commandId}/actual-account-readback`, capturedAt: new Date().toISOString(), kind: "browser_readback", capabilities: ["verify_account"] };
    },
    async sourceFetch(context) {
      const config = await options.configuration(context), data = await captureChatGptSource(context, config, recipe);
      if (data.status === "auth_required") return { status: "challenge_required", reason: "chatgpt_account_session_required" };
      if (data.status === "failed") return { status: "blocked", reason: "chatgpt_source_read_failed" };
      return { status: "verified", evidence: { verified: true, externalAccountId: context.externalAccountId, capturedAt: new Date().toISOString(), evidenceRef: `chatgpt-command:${context.commandId}/source-read`, kind: "browser_readback" }, data: { source_capture: data } };
    },
  } });
}
