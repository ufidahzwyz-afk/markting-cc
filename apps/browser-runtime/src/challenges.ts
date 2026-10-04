import { randomUUID } from "node:crypto";
import type { Page } from "playwright";
import type { Database } from "@boran/db";
import { audit, DomainError, stableHash, type ServiceContext } from "@boran/domain/core";
import { createBrowserService } from "./service";
import { assertRecipeUrl, type BrowserRecipe, BrowserRecipeRegistry } from "./recipes";
import type { BrowserProfilePool, ProfileLease } from "./profiles";

export interface LoginChallengeCommand { action: "open" | "submit" | "verify" | "close"; code?: string }
export function parseLoginChallenge(value: unknown): LoginChallengeCommand {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new DomainError("INVALID_LOGIN_CHALLENGE", 422, "Challenge command required");
  const row = value as Record<string, unknown>;
  if (Object.keys(row).some(key => !["action", "code"].includes(key)) || !["open", "submit", "verify", "close"].includes(String(row.action)) || row.action === "submit" && (typeof row.code !== "string" || !/^[A-Za-z0-9]{4,16}$/.test(row.code)) || row.action !== "submit" && row.code !== undefined) throw new DomainError("INVALID_LOGIN_CHALLENGE", 422, "Only the configured verification field is accepted");
  return row as unknown as LoginChallengeCommand;
}
interface ActiveChallenge { orgId: string; accountId: string; userId: string; token: number; version: number; configurationHash: string; recipe: BrowserRecipe; profile: ProfileLease; page: Page; timer: ReturnType<typeof setTimeout>; expiresAt: string; busy: boolean }
function object(value: unknown): Record<string, unknown> { return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {}; }
/** The private browser holds a single bound page; the client can only submit one reviewed verification field. */
export class LoginChallengeManager {
  private readonly active = new Map<string, ActiveChallenge>();
  private readonly pending = new Set<string>();
  constructor(private readonly options: { database(): Promise<Database>; profiles: BrowserProfilePool; recipes: BrowserRecipeRegistry; mode: "mock" | "live" }) {}
  private async state(orgId: string, id: string) {
    if (this.options.mode !== "live") throw new DomainError("REAL_LOGIN_REQUIRED", 503, "Actual login challenge requires live identity");
    const db = await this.options.database();
    const row = (await db.query("SELECT s.*,a.connection_id,a.account_external_id,a.session_version,a.browser_fencing_token,a.adapter_version,a.channel_id,a.provider,a.session_status,c.scope_json,c.secret_ref,c.read_mode,c.account_external_id AS connection_external_id,m.roles FROM login_sessions s JOIN platform_accounts a ON a.org_id=s.org_id AND a.id=s.platform_account_id JOIN connections c ON c.org_id=a.org_id AND c.id=a.connection_id JOIN memberships m ON m.org_id=s.org_id AND m.user_id=s.user_id JOIN users u ON u.id=m.user_id WHERE s.org_id=$1 AND s.id=$2 AND m.active AND u.active", [orgId, id])).rows[0];
    if (!row || !Array.isArray(row.roles) || !row.roles.some(role => ["owner", "admin", "marketer"].includes(String(role))) || row.state !== "active" || !row.consumed_at || Date.parse(String(row.expires_at)) <= Date.now() || Number(row.expected_session_version) !== Number(row.session_version) || row.session_status === "revoked" || row.read_mode === "mock") throw new DomainError("LOGIN_INTERACTION_DENIED", 403, "Redeemed owner-bound live login session required");
    const login = object(object(row.scope_json).platform_login), recipe = this.options.recipes.get(String(login.recipe_id ?? ""), String(login.recipe_version ?? ""), String(row.channel_id ?? row.provider));
    if (!recipe.challenge) throw new DomainError("LOGIN_CHALLENGE_UNSUPPORTED", 503, "This version has no reviewed QR or verification-field interaction");
    const configurationHash = stableHash({ connection_id: row.connection_id, account_external_id: row.connection_external_id, read_mode: row.read_mode, scope_json: row.scope_json, secret_ref: row.secret_ref });
    return { db, row, recipe, configurationHash };
  }
  private async assert(id: string, active: ActiveChallenge) {
    const { row, configurationHash } = await this.state(active.orgId, id);
    if (row.user_id !== active.userId || row.platform_account_id !== active.accountId || Number(row.browser_fencing_token) !== active.token || Number(row.session_version) !== active.version || configurationHash !== active.configurationHash) throw new DomainError("LOGIN_INTERACTION_DENIED", 403, "Login profile ownership or configuration changed");
  }
  private async close(id: string) {
    const current = this.active.get(id);
    if (!current) return;
    clearTimeout(current.timer);
    await current.profile.close();
    this.active.delete(id);
  }
  async perform(orgId: string, id: string, input: LoginChallengeCommand): Promise<Record<string, unknown>> {
    if(this.pending.has(id))throw new DomainError('LOGIN_INTERACTION_BUSY',409,'Login interaction is already in progress');
    this.pending.add(id);try{return await this.performUnlocked(orgId,id,input);}finally{this.pending.delete(id);}
  }
  private async performUnlocked(orgId: string, id: string, input: LoginChallengeCommand): Promise<Record<string, unknown>> {
    if (input.action === "close") {
      const db=await this.options.database();
      const owner=(await db.query('SELECT s.user_id,s.platform_account_id,m.roles FROM login_sessions s JOIN memberships m ON m.org_id=s.org_id AND m.user_id=s.user_id JOIN users u ON u.id=m.user_id WHERE s.org_id=$1 AND s.id=$2 AND m.active AND u.active',[orgId,id])).rows[0];
      if(!owner||!Array.isArray(owner.roles)||!owner.roles.some(role=>['owner','admin','marketer'].includes(String(role))))throw new DomainError('LOGIN_INTERACTION_DENIED',403,'Current bound operator is required to release this login profile');
      const current = this.active.get(id); if (current&&(current.orgId!==orgId||current.userId!==owner.user_id||current.accountId!==owner.platform_account_id))throw new DomainError('LOGIN_INTERACTION_DENIED',403,'Login profile belongs to another bound account');
      await this.close(id);
      await db.query("UPDATE login_sessions SET state='cancelled',version=version+1,updated_at=now() WHERE org_id=$1 AND id=$2 AND state IN ('created','active')", [orgId, id]);
      return { interaction_ready: false, state: "cancelled" };
    }
    const state = await this.state(orgId, id);
    let current = this.active.get(id);
    if (!current) {
      if (input.action !== "open") throw new DomainError("LOGIN_INTERACTION_NOT_OPEN", 409, "Open this bound login challenge before submitting or verifying");
      const token = await state.db.transaction(async tx => {
        const account = (await tx.query("SELECT session_version,browser_fencing_token FROM platform_accounts WHERE org_id=$1 AND id=$2 FOR UPDATE", [orgId, state.row.platform_account_id])).rows[0];
        if (!account || Number(account.session_version) !== Number(state.row.expected_session_version) || (await tx.query("SELECT id FROM browser_commands WHERE org_id=$1 AND platform_account_id=$2 AND state='running' LIMIT 1", [orgId, state.row.platform_account_id])).rowCount) throw new DomainError("ACCOUNT_BUSY", 409, "Account already has a running browser command");
        const token = Number(account.browser_fencing_token) + 1;
        await tx.query("UPDATE platform_accounts SET browser_fencing_token=$3 WHERE org_id=$1 AND id=$2", [orgId, state.row.platform_account_id, token]);
        return token;
      });
      const profile = await this.options.profiles.acquire({ orgId, accountId: String(state.row.platform_account_id), fencingToken: token, channelId: state.recipe.channelId, allowedOrigins: state.recipe.allowedOrigins });
      try {
        const page = await profile.context.newPage();
        const expiresAt = String(state.row.expires_at), timer = setTimeout(() => { void this.close(id).catch(() => undefined); }, Math.max(1, Date.parse(expiresAt) - Date.now())); timer.unref();
        current = { orgId, accountId: String(state.row.platform_account_id), userId: String(state.row.user_id), token, version: Number(state.row.session_version), configurationHash: state.configurationHash, recipe: state.recipe, profile, page, timer, expiresAt, busy: false };
        this.active.set(id, current);
        await this.assert(id, current);
        const url = current.recipe.challenge!.startUrl ?? current.recipe.login.url;
        assertRecipeUrl(url, current.recipe.allowedOrigins);
        await page.goto(url, { waitUntil: "domcontentloaded", timeout: 20_000 });
        assertRecipeUrl(page.url(), current.recipe.allowedOrigins);
      } catch (error) { await profile.close(); this.active.delete(id); throw error; }
    }
    if (current.orgId !== orgId || current.busy) throw new DomainError("LOGIN_INTERACTION_BUSY", 409, "Login interaction is already in progress");
    current.busy = true;
    try {
      await this.assert(id, current);
      const challenge = current.recipe.challenge!, page = current.page;
      if (input.action === "submit") {
        if (challenge.method !== "otp" || !input.code || !(challenge.codeFormat === "alphanumeric" ? /^[A-Za-z0-9]{4,16}$/ : /^[0-9]{4,10}$/).test(input.code)) throw new DomainError("INVALID_VERIFICATION_CODE", 422, "Code format does not match the reviewed verification field");
        await page.locator(challenge.codeSelector!).fill(input.code, { timeout: 10_000 });
        await this.assert(id, current);
        await page.locator(challenge.submitSelector!).click({ timeout: 10_000 });
        assertRecipeUrl(page.url(), current.recipe.allowedOrigins);
      }
      if (input.action === "verify" || input.action === "submit") {
        let locator = page.locator(current.recipe.login.account.selector).first();
        await locator.waitFor({ state: "visible", timeout: 2_000 }).catch(() => undefined);
        if(!await locator.isVisible().catch(()=>false)){
          assertRecipeUrl(current.recipe.login.accountUrl,current.recipe.allowedOrigins);
          await page.goto(current.recipe.login.accountUrl,{waitUntil:'domcontentloaded',timeout:20_000});
          assertRecipeUrl(page.url(),current.recipe.allowedOrigins);
          locator=page.locator(current.recipe.login.account.selector).first();
        }
        let observed = "";
        if (await locator.isVisible().catch(() => false)) observed = current.recipe.login.account.attribute ? await locator.getAttribute(current.recipe.login.account.attribute) ?? "" : await locator.innerText();
        if (observed.trim() !== String(state.row.account_external_id)) return { interaction_ready: true, method: challenge.method, state: observed ? "account_mismatch" : "challenge_required", verified: false, expires_at: current.expiresAt };
        await this.assert(id, current);
        const proof = { verified: true, externalAccountId: observed.trim(), capturedAt: new Date().toISOString(), kind: "browser_readback" as const, evidenceRef: `browser-login-session:${id}/${current.recipe.id}/${current.recipe.version}/actual-account` };
        const ctx: ServiceContext = { db: state.db, orgId, actorId: current.userId, actorType: "user", roles: state.row.roles as string[], mode: "live" };
        const commandId = randomUUID();
        const completed = await createBrowserService(ctx, { adapters: new Map() }).completeLogin(id, current.accountId, async () => proof,async(tx,verified)=>{
          const data = { configuration_hash: current!.configurationHash, adapter_version: current!.recipe.version, session_version_after: verified.sessionVersion };
          const account = (await tx.query("SELECT browser_fencing_token,session_version FROM platform_accounts WHERE org_id=$1 AND id=$2 FOR UPDATE", [orgId, current!.accountId])).rows[0];
          if (!account || Number(account.browser_fencing_token) !== current!.token || Number(account.session_version) !== verified.sessionVersion) throw new DomainError("LOGIN_INTERACTION_DENIED", 403, "Completed login lost its account fence");
          await tx.query("UPDATE platform_accounts SET adapter_version=$3 WHERE org_id=$1 AND id=$2", [orgId, current!.accountId, current!.recipe.version]);
          await tx.query("INSERT INTO browser_commands(id,org_id,platform_account_id,connection_id,login_session_id,command_type,idempotency_key,state,fencing_token,session_version,input_ref,result_ref,attempts,started_at,finished_at) VALUES($1,$2,$3,$4,$5,'login',$6,'succeeded',$7,$8,$9,$10,1,now(),now())", [commandId, orgId, current!.accountId, state.row.connection_id, id, `manual-login:${id}`, current!.token, current!.version, JSON.stringify({ refs: {}, adapter_version: current!.recipe.version, payload_hash: stableHash({ mode: "live", login_session_id: id }), mode: "live" }), JSON.stringify({ status: "verified", evidence: proof, data })]);
          await tx.query("UPDATE login_sessions SET browser_command_id=$3,result_ref=$4 WHERE org_id=$1 AND id=$2", [orgId, id, commandId, JSON.stringify({ status: "verified", evidence: proof, data })]);
          await audit(ctx, tx, "browser.challenge.verified", "login_session", id, { account_id: current!.accountId, command_id: commandId });
        });
        await this.close(id);
        return { interaction_ready: false, state: "completed", verified: true, command_id: commandId, session_version: completed.sessionVersion };
      }
      let qrImage: string | undefined;
      if (challenge.method === "qr") {
        const locator = page.locator(challenge.qrSelector!).first();
        if (!await locator.isVisible().catch(() => false)) throw new DomainError("QR_CHALLENGE_NOT_READY", 409, "Platform QR challenge is not visible");
        const image = await locator.screenshot({ timeout: 10_000 });
        if (image.length > 256_000) throw new DomainError("QR_CHALLENGE_TOO_LARGE", 409, "QR challenge exceeds the scoped image limit");
        qrImage = `data:image/png;base64,${image.toString("base64")}`;
      }
      return { interaction_ready: true, method: challenge.method, state: "challenge_required", verified: false, expires_at: current.expiresAt, ...(qrImage ? { qr_image: qrImage } : {}) };
    } finally { current.busy = false; }
  }
  async shutdown() { await Promise.all([...this.active.keys()].map(id => this.close(id))); }
}
