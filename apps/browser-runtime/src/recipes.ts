import { readFile } from "node:fs/promises";
import { ConnectorBlockedError, getPlatformDescriptor, type CapabilityVerification } from "@boran/connectors";

export interface AccountLocator { selector: string; attribute?: string }
export interface BrowserRecipe {
  id: string;
  version: string;
  channelId: string;
  allowedOrigins: readonly string[];
  login: {
    method: "password" | "qr" | "oauth";
    url: string;
    accountUrl: string;
    account: AccountLocator;
    usernameSelector?: string;
    passwordSelector?: string;
    submitSelector?: string;
    challengeSelectors: readonly string[];
  };
  publication?: {
    format: "article";
    url: string;
    titleSelector: string;
    bodySelector: string;
    submitSelector: string;
    externalId: AccountLocator;
    readbackUrlTemplate: string;
    readbackAccount: AccountLocator;
    titleReadbackSelector: string;
    bodyReadbackSelector: string;
    publishedSelector: string;
    inReviewSelector: string;
    rejectedSelector: string;
    publicUrl?: AccountLocator;
    labels: readonly { selector: string; text: string }[];
  };
  challenge?: {
    method: "otp" | "qr";
    startUrl?: string;
    codeSelector?: string;
    submitSelector?: string;
    qrSelector?: string;
    codeFormat?: "digits" | "alphanumeric";
  };
  /** A real per-account test receipt; configured selectors alone never create this proof. */
  verification?: CapabilityVerification;
}
function fail(): never { throw new ConnectorBlockedError("invalid_browser_recipe"); }
function selector(value: unknown): value is string {
  return typeof value === "string" && value.length > 0 && value.length <= 300 && !/[\r\n\0]/.test(value) && !value.includes(":has-text(");
}
function locator(value: unknown): value is AccountLocator {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const row = value as Record<string, unknown>;
  return Object.keys(row).every(key => ["selector", "attribute"].includes(key)) && selector(row.selector) && (row.attribute === undefined || typeof row.attribute === "string" && /^[a-zA-Z][a-zA-Z0-9_-]{0,60}$/.test(row.attribute));
}
export function assertRecipeUrl(value: string, origins: readonly string[]): URL {
  let url: URL;
  try { url = new URL(value); } catch { throw new ConnectorBlockedError("recipe_url_outside_scope"); }
  if (url.protocol !== "https:" || url.username || url.password || !origins.includes(url.origin)) throw new ConnectorBlockedError("recipe_url_outside_scope");
  return url;
}
/** Recipes contain selectors and scoped URLs, never executable scripts or credentials. */
export function validateBrowserRecipe(value: unknown, websiteOrigins: readonly string[] = []): BrowserRecipe {
  if (!value || typeof value !== "object" || Array.isArray(value)) fail();
  const row = value as BrowserRecipe;
  if (!/^[a-zA-Z0-9_.-]{1,80}$/.test(row.id) || !/^[a-zA-Z0-9_.-]{1,80}$/.test(row.version)) fail();
  const approvedOrigins = row.channelId === "website" ? websiteOrigins : row.channelId === "chatgpt" ? ["https://chatgpt.com", "https://auth.openai.com"] : getPlatformDescriptor(row.channelId).allowedOrigins;
  if (!Array.isArray(row.allowedOrigins) || !row.allowedOrigins.length || row.allowedOrigins.some(origin => typeof origin !== "string" || !approvedOrigins.includes(origin) || assertRecipeUrl(origin, approvedOrigins).origin !== origin)) fail();
  const login = row.login;
  if (!login || Object.keys(login).some(key => !["method", "url", "accountUrl", "account", "usernameSelector", "passwordSelector", "submitSelector", "challengeSelectors"].includes(key)) || !["password", "qr", "oauth"].includes(login.method) || !locator(login.account) || !Array.isArray(login.challengeSelectors) || login.challengeSelectors.some(value => !selector(value))) fail();
  assertRecipeUrl(login.url, row.allowedOrigins); assertRecipeUrl(login.accountUrl, row.allowedOrigins);
  if (login.method === "password" && ![login.usernameSelector, login.passwordSelector, login.submitSelector].every(selector)) fail();
  if (row.publication) {
    const publish = row.publication;
    if (Object.keys(publish).some(key => !["format", "url", "titleSelector", "bodySelector", "submitSelector", "externalId", "readbackUrlTemplate", "readbackAccount", "titleReadbackSelector", "bodyReadbackSelector", "publishedSelector", "inReviewSelector", "rejectedSelector", "publicUrl", "labels"].includes(key)) || publish.format !== "article" || ![publish.titleSelector, publish.bodySelector, publish.submitSelector, publish.titleReadbackSelector, publish.bodyReadbackSelector, publish.publishedSelector, publish.inReviewSelector, publish.rejectedSelector].every(selector) || !locator(publish.externalId) || !locator(publish.readbackAccount) || publish.publicUrl && !locator(publish.publicUrl) || !Array.isArray(publish.labels) || publish.labels.some(label => Object.keys(label).some(key => !["selector", "text"].includes(key)) || !selector(label.selector) || typeof label.text !== "string" || !label.text.length)) fail();
    assertRecipeUrl(publish.url, row.allowedOrigins);
    if (typeof publish.readbackUrlTemplate !== "string" || publish.readbackUrlTemplate.split("{externalId}").length !== 2) fail();
    assertRecipeUrl(publish.readbackUrlTemplate.replace("{externalId}", "scope-check"), row.allowedOrigins);
  }
  if (row.challenge) {
    if (Object.keys(row.challenge).some(key => !["method", "startUrl", "codeSelector", "submitSelector", "qrSelector", "codeFormat"].includes(key)) || !["otp", "qr"].includes(row.challenge.method) || row.challenge.method === "otp" && (!selector(row.challenge.codeSelector) || !selector(row.challenge.submitSelector)) || row.challenge.method === "qr" && !selector(row.challenge.qrSelector) || row.challenge.codeFormat !== undefined && !["digits", "alphanumeric"].includes(row.challenge.codeFormat)) fail();
    if (row.challenge.startUrl) assertRecipeUrl(row.challenge.startUrl,row.allowedOrigins);
  }
  const allowedKeys = new Set(["id", "version", "channelId", "allowedOrigins", "login", "publication", "challenge", "verification"]);
  if (Object.keys(value).some(key => !allowedKeys.has(key))) fail();
  return Object.freeze(row);
}
export class BrowserRecipeRegistry {
  private readonly recipes = new Map<string, BrowserRecipe>();
  constructor(values: readonly unknown[], websiteOrigins: readonly string[] = []) {
    for (const value of values) {
      const recipe = validateBrowserRecipe(value, websiteOrigins);
      const key = `${recipe.id}:${recipe.version}`;
      if (this.recipes.has(key)) throw new ConnectorBlockedError("duplicate_browser_recipe");
      this.recipes.set(key, recipe);
    }
  }
  get(id: string, version: string, channelId: string) {
    const recipe = this.recipes.get(`${id}:${version}`);
    if (!recipe || recipe.channelId !== channelId) throw new ConnectorBlockedError("browser_recipe_not_configured");
    return recipe;
  }
  channels() { return [...new Set([...this.recipes.values()].map(recipe => recipe.channelId))]; }
  origins(channelId: string) { return [...new Set([...this.recipes.values()].filter(recipe => recipe.channelId === channelId).flatMap(recipe => [...recipe.allowedOrigins]))]; }
  static async fromFile(path: string | undefined, websiteOrigins: readonly string[] = []) {
    if (!path) return new BrowserRecipeRegistry([]);
    const input = await readFile(path, "utf8");
    if (Buffer.byteLength(input) > 256_000) throw new ConnectorBlockedError("browser_recipe_file_too_large");
    const data: unknown = JSON.parse(input);
    if (!Array.isArray(data)) fail();
    return new BrowserRecipeRegistry(data, websiteOrigins);
  }
}
