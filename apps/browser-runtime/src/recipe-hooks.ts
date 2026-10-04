import type { BrowserContext, Locator, Page } from "playwright";
import { ConnectorBlockedError, type PlatformCommand, type PlatformExecutionContext, type PlatformHooks, type PlatformResult, type VerificationEvidence } from "@boran/connectors";
import { assertRecipeUrl, type AccountLocator, type BrowserRecipe } from "./recipes";

export interface PublicationMaterial {
  title: string;
  body: string;
  payloadHash: string;
  /** Domain/media checks must pass before this immutable material can be loaded. */
  validated: true;
  format: "article";
}
export interface RecipeAccountConfiguration { recipe: BrowserRecipe; connectionId: string; secretRef: string | null }
export interface RecipeHookDependencies {
  configuration(context: PlatformExecutionContext): Promise<RecipeAccountConfiguration>;
  resolveSecret(ref: string, scope: { orgId: string; connectionId: string }): Promise<{ kind: string; username?: string; password?: string }>;
  material(context: PlatformExecutionContext, command: PlatformCommand): Promise<PublicationMaterial>;
  priorReceipt(context: PlatformExecutionContext, command: PlatformCommand): Promise<{ externalId: string; originalCommand: PlatformCommand } | null>;
}
const normalize = (value: string) => value.normalize("NFC").replace(/\r\n/g, "\n").replace(/[ \t]+/g, " ").trim();
async function visible(page: Page, selector: string) { return page.locator(selector).first().isVisible().catch(() => false); }
async function read(locator: Locator, attribute?: string) {
  return normalize(attribute ? await locator.getAttribute(attribute) ?? "" : await locator.innerText());
}
async function readField(page: Page, locator: AccountLocator) { return read(page.locator(locator.selector).first(), locator.attribute); }
function contextBrowser(context: PlatformExecutionContext) {
  const browser = context.browserSession as BrowserContext | undefined;
  if (!browser || typeof browser.newPage !== "function") throw new ConnectorBlockedError("encrypted_profile_not_configured");
  return browser;
}
function evidence(context: PlatformExecutionContext, recipe: BrowserRecipe, suffix: string): VerificationEvidence {
  return { verified: true, externalAccountId: context.externalAccountId, kind: "browser_readback", capturedAt: new Date().toISOString(), evidenceRef: `browser-command:${context.commandId}/${recipe.id}/${recipe.version}/${suffix}` };
}
async function navigate(page: Page, url: string, recipe: BrowserRecipe) {
  assertRecipeUrl(url, recipe.allowedOrigins);
  await page.goto(url, { waitUntil: "domcontentloaded", timeout: 20_000 });
  // Check the actual target after redirects, even when a profile route already restricts origins.
  assertRecipeUrl(page.url(), recipe.allowedOrigins);
}
async function accountState(page: Page, context: PlatformExecutionContext, recipe: BrowserRecipe): Promise<"active" | "expired" | "challenge" | "mismatch"> {
  for (const selector of recipe.login.challengeSelectors) if (await visible(page, selector)) return "challenge";
  if (!(await visible(page, recipe.login.account.selector))) return "expired";
  return await readField(page, recipe.login.account) === context.externalAccountId ? "active" : "mismatch";
}
/** Platform-specific recipes are reviewed deployment input; no page evaluation or user scripts are accepted. */
export function createRecipePlatformHooks(dependencies: RecipeHookDependencies): PlatformHooks {
  async function session(context: PlatformExecutionContext, renew: boolean): Promise<PlatformResult> {
    const config = await dependencies.configuration(context), recipe = config.recipe;
    if (recipe.version !== context.adapterVersion) return { status: "blocked", reason: "adapter_version_conflict" };
    const page = await contextBrowser(context).newPage();
    try {
      await navigate(page, recipe.login.accountUrl, recipe);
      const state = await accountState(page, context, recipe);
      if (state === "active") return { status: "verified", evidence: evidence(context, recipe, "account") };
      if (state === "mismatch") return { status: "challenge_required", reason: "account_mismatch" };
      if (state === "challenge") return { status: "challenge_required", reason: "platform_verification_required" };
      if (!renew) return { status: "blocked", reason: "session_expired" };
      if (recipe.login.method !== "password") return { status: "challenge_required", reason: recipe.login.method === "qr" ? "qr_login_required" : "oauth_login_required" };
      if (!config.secretRef) return { status: "blocked", reason: "credentials_not_configured" };
      const secret = await dependencies.resolveSecret(config.secretRef, { orgId: context.orgId, connectionId: config.connectionId });
      if (secret.kind !== "platform_password" || !secret.username || !secret.password) return { status: "blocked", reason: "password_credentials_required" };
      await navigate(page, recipe.login.url, recipe);
      for (const selector of recipe.login.challengeSelectors) if (await visible(page, selector)) return { status: "challenge_required", reason: "platform_verification_required" };
      await context.assertLease();
      await page.locator(recipe.login.usernameSelector!).fill(secret.username, { timeout: 10_000 });
      await page.locator(recipe.login.passwordSelector!).fill(secret.password, { timeout: 10_000 });
      await context.assertLease();
      await page.locator(recipe.login.submitSelector!).click({ timeout: 10_000 });
      await page.locator(`${recipe.login.account.selector}${recipe.login.challengeSelectors.length ? `,${recipe.login.challengeSelectors.join(",")}` : ""}`).first().waitFor({ state: "visible", timeout: 15_000 }).catch(() => undefined);
      assertRecipeUrl(page.url(), recipe.allowedOrigins);
      const afterLogin = await accountState(page, context, recipe);
      if (afterLogin === "challenge") return { status: "challenge_required", reason: "platform_verification_required" };
      // Some login pages redirect to a dashboard with a different account locator; verify the real account endpoint.
      await navigate(page, recipe.login.accountUrl, recipe);
      const verified = await accountState(page, context, recipe);
      await context.assertLease();
      return verified === "active" ? { status: "verified", evidence: evidence(context, recipe, "login-account") } : { status: "challenge_required", reason: verified === "mismatch" ? "account_mismatch" : verified === "challenge" ? "platform_verification_required" : "credentials_or_session_rejected" };
    } finally { await page.close(); }
  }
  async function probe(context: PlatformExecutionContext) {
    const result = await session(context, true);
    if (result.status !== "verified") throw new ConnectorBlockedError(result.status === "challenge_required" ? "challenge_required" : result.status === "blocked" ? result.reason : "account_verification_failed");
    const { recipe } = await dependencies.configuration(context);
    const proof = recipe.verification;
    const valid = proof?.verified && proof.externalAccountId === context.externalAccountId && proof.adapterVersion === context.adapterVersion && proof.evidenceRef && Date.parse(proof.capturedAt) >= Date.now() - 7 * 86400_000 && Date.parse(proof.capturedAt) <= Date.now() + 60_000;
    return { ...(valid ? proof : {}), ...result.evidence, adapterVersion: context.adapterVersion, capabilities: [...new Set(["verify_account", "maintain_session", ...(valid ? proof.capabilities : [])])] };
  }
  async function readback(context: PlatformExecutionContext, command: PlatformCommand, receipt: PlatformResult): Promise<PlatformResult> {
    if (receipt.status !== "submitted" || !receipt.externalId) return { status: "unknown", reason: "publication_receipt_missing" };
    const { recipe } = await dependencies.configuration(context), publication = recipe.publication;
    if (!publication) return { status: "blocked", reason: "publication_recipe_not_configured" };
    const material = await dependencies.material(context, command), page = await contextBrowser(context).newPage();
    try {
      await navigate(page, publication.readbackUrlTemplate.replace("{externalId}", encodeURIComponent(receipt.externalId)), recipe);
      if (!await visible(page, publication.readbackAccount.selector) || await readField(page, publication.readbackAccount) !== context.externalAccountId) return { status: "unknown", reason: "publication_account_not_verified" };
      const receiptData = { external_id: receipt.externalId };
      if (await visible(page, publication.rejectedSelector)) return { status: "rejected", reason: "platform_review_rejected", externalId: receipt.externalId, evidenceRef: evidence(context, recipe, "rejected").evidenceRef, evidence: evidence(context, recipe, "rejected"), data: { ...receiptData, review_status: "rejected" } };
      if (await visible(page, publication.inReviewSelector)) return { status: "in_review", externalId: receipt.externalId, evidenceRef: evidence(context, recipe, "review").evidenceRef, evidence: evidence(context, recipe, "review"), data: { ...receiptData, review_status: "in_review" } };
      if (!await visible(page, publication.publishedSelector)) return { status: "unknown", reason: "publication_state_not_verified" };
      const title = await read(page.locator(publication.titleReadbackSelector).first()), body = await read(page.locator(publication.bodyReadbackSelector).first());
      if (title !== normalize(material.title) || body !== normalize(material.body)) return { status: "unknown", reason: "actual_content_mismatch" };
      const labelsVerified = await Promise.all(publication.labels.map(async label => await visible(page, label.selector) && (await read(page.locator(label.selector).first())).includes(label.text)));
      if (labelsVerified.some(value => !value)) return { status: "unknown", reason: "required_labels_not_verified" };
      const publicUrl = publication.publicUrl ? await readField(page, publication.publicUrl) : page.url();
      assertRecipeUrl(publicUrl, recipe.allowedOrigins);
      await context.assertLease();
      return { status: "verified", evidence: { ...evidence(context, recipe, "publication"), labelsVerified: true, contentHash: material.payloadHash }, data: { ...receiptData, published_url: publicUrl, review_status: "approved", required_labels: publication.labels.map(label => label.text) } };
    } finally { await page.close(); }
  }
  return {
    mutationBoundaryManaged: true,
    probe,
    login: context => session(context, true),
    sessionVerify: context => session(context, true),
    async publish(context, command) {
      const { recipe } = await dependencies.configuration(context), publication = recipe.publication;
      if (!publication) return { status: "blocked", reason: "publication_recipe_not_configured" };
      const material = await dependencies.material(context, command);
      if (!material.validated || material.format !== publication.format || !material.title || !material.body || !/^[a-f0-9]{64}$/.test(material.payloadHash)) return { status: "blocked", reason: "actual_materials_not_validated" };
      const page = await contextBrowser(context).newPage();
      try {
        await navigate(page, publication.url, recipe);
        for (const selector of recipe.login.challengeSelectors) if (await visible(page, selector)) return { status: "challenge_required", reason: "platform_verification_required" };
        await page.locator(publication.titleSelector).fill(material.title, { timeout: 10_000 });
        await page.locator(publication.bodySelector).fill(material.body, { timeout: 10_000 });
        await context.assertLease();
        await page.locator(publication.submitSelector).waitFor({state:'visible',timeout:10_000});
        context.markMutationStart?.();
        await page.locator(publication.submitSelector).click({ timeout: 10_000 });
        await page.locator(publication.externalId.selector).first().waitFor({ state: "visible", timeout: 15_000 });
        assertRecipeUrl(page.url(), recipe.allowedOrigins);
        const externalId = await readField(page, publication.externalId);
        if (!/^[\p{L}\p{N}_.:-]{1,200}$/u.test(externalId)) return { status: "unknown", reason: "publication_receipt_invalid" };
        return { status: "submitted", externalId, evidenceRef: evidence(context, recipe, "submitted").evidenceRef, data: { external_id: externalId, review_status: "submitted" } };
      } finally { await page.close(); }
    },
    readback,
    async reconcile(context, command) {
      const original = await dependencies.priorReceipt(context, command);
      if (!original) return { status: "unknown", reason: "publication_receipt_missing" };
      const account = await session(context, true);
      if (account.status !== "verified") return account;
      // This path only reads; an unknown write is never resubmitted.
      const result = await readback(context, original.originalCommand, { status: "submitted", externalId: original.externalId });
      return result.status === "unknown" ? { ...result, externalId: original.externalId, data: { external_id: original.externalId } } : result;
    },
  };
}
