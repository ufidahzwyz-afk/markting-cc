import { createHash, randomBytes, randomUUID, timingSafeEqual } from "node:crypto";
import type { SqlExecutor } from "@boran/db";
import { audit, DomainError, nowIso, requireRole, stableHash, type ServiceContext } from "@boran/domain/core";
import { ConnectorBlockedError, type BrowserCommandType, type CapabilityVerification, type PlatformAdapter, type PlatformExecutionContext, type PlatformResult, type VerificationEvidence } from "@boran/connectors";
import { platformConfigurationHash } from "./capabilities";

export interface EnqueueBrowserCommand {
  command_type: BrowserCommandType;
  idempotency_key: string;
  platform_account_id?: string;
  connection_id?: string;
  execution_action_id?: string;
  workflow_run_id?: string;
  login_session_id?: string;
  adapter_version: string;
  session_version?: number;
  input_ref: Record<string, string>;
}
export interface BrowserCommandRow extends Record<string, unknown> {
  id: string; org_id: string; platform_account_id: string | null; connection_id: string | null;
  execution_action_id: string | null; workflow_run_id: string | null; login_session_id: string | null;
  command_type: BrowserCommandType; state: string; fencing_token: string | number; session_version: string | number | null;
  input_ref: { refs: Record<string, string>; adapter_version: string; payload_hash: string; mode?: "mock" | "live" };
  lease_owner: string | null; lease_until: string | Date | null;
}
interface AccountRow extends Record<string, unknown> {
  id: string; connection_id: string; account_external_id: string; enabled: boolean; provider: string; channel_id: string | null;
  adapter_version: string | null; session_version: string | number; browser_fencing_token: string | number; session_status: string;
}
interface LoginRow extends Record<string, unknown> {
  id: string; platform_account_id: string; user_id: string; ticket_hash: string; state: string; consumed_at: string | Date | null;
  expected_session_version: string | number; expires_at: string | Date; ticket_expires_at: string | Date;
}
export interface BrowserServiceDependencies {
  adapters: ReadonlyMap<string, PlatformAdapter>;
  authorizeAction?: (ctx: ServiceContext, tx: SqlExecutor, actionId: string) => Promise<void>;
  withProfile?: <T>(input: { orgId: string; accountId: string; fencingToken: number; channelId: string; allowedOrigins?: readonly string[] }, run: (browser: unknown) => Promise<T>) => Promise<T>;
  /** Private source text is consumed by the source service, never put in durable command/API DTOs. */
  captureSource?: (data: Record<string, unknown>) => Promise<void>;
  /** Source adapters use their own reviewed allowlists; a command never carries a supplied URL. */
  sourceAdapter?: PlatformAdapter;
}
const commandTypes = new Set(["login", "session_verify", "source_fetch", "publish", "ad_read", "ad_write", "reconcile"]);
const writeTypes = new Set(["publish", "ad_write"]);
const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
function fail(code: string, status = 409): never { throw new DomainError(code, status, code); }
function number(value: string | number | null) { const result = Number(value); if (!Number.isSafeInteger(result) || result < 0) fail("invalid_version", 422); return result; }
function hashTicket(ticket: string) { return createHash("sha256").update(ticket).digest("hex"); }
function sameHash(a: string, b: string) { return a.length === b.length && timingSafeEqual(Buffer.from(a), Buffer.from(b)); }
export function safePlatformData(data: Record<string, unknown> | undefined): Record<string, unknown> {
  if (!data) return {};
  const output: Record<string, unknown> = {};
  for (const key of ["external_id", "review_status", "entity_type", "capability_status", "capability_artifact_id"]) if (typeof data[key] === "string" && /^[\p{L}\p{N}_.:-]{1,200}$/u.test(data[key] as string)) output[key] = data[key];
  if (typeof data.published_url === "string") {
    try { const url = new URL(data.published_url); if (url.protocol === "https:" && !url.username && !url.password && ![...url.searchParams.keys()].some(key => /token|password|secret|auth|cookie|session/i.test(key))) output.published_url = url.toString(); } catch { /* discard malformed or credential-bearing URLs */ }
  }
  if (Array.isArray(data.required_labels) && data.required_labels.every(label => typeof label === "string" && label.length <= 200)) output.required_labels = data.required_labels.slice(0, 20);
  if (data.effective_fields && typeof data.effective_fields === "object" && !Array.isArray(data.effective_fields)) {
    const allowed = new Set(["accountId", "entityType", "campaignId", "campaignName", "adgroupId", "adgroupName", "keywordId", "keyword", "creativeId", "title", "description1", "description2", "price", "maxPrice", "budget", "pause", "status", "device", "regionTarget", "schedule", "negativeWords", "exactNegativeWords", "matchType", "pcDestinationUrl", "mobileDestinationUrl", "displayUrl"]);
    const fields: Record<string, unknown> = {};
    const bounded = (value:unknown,depth=0):boolean => depth<=4&&(typeof value==='boolean'||typeof value==='number'&&Number.isFinite(value)||typeof value==='string'&&value.length<=1000||Array.isArray(value)&&value.length<=1000&&value.every(item=>bounded(item,depth+1))||!!value&&typeof value==='object'&&Object.keys(value).length<=30&&Object.entries(value).every(([key,item])=>!/token|password|secret|auth|cookie|session/i.test(key)&&bounded(item,depth+1)));
    for (const [key, value] of Object.entries(data.effective_fields)) if (allowed.has(key) && bounded(value)) {
      if (/DestinationUrl$|displayUrl/.test(key)) { try { const url=new URL(String(value)); if(url.protocol!=='https:'||url.username||url.password||[...url.searchParams.keys()].some(param=>/token|password|secret|auth|cookie|session/i.test(param)))continue; } catch { continue; } }
      fields[key] = value;
    }
    output.effective_fields = fields;
  }
  return output;
}
export function parseBrowserCommand(body: unknown): EnqueueBrowserCommand {
  if (!body || typeof body !== "object" || Array.isArray(body)) fail("invalid_command", 422);
  const value = body as Record<string, unknown>;
  const keys = new Set(["command_type", "idempotency_key", "platform_account_id", "connection_id", "execution_action_id", "workflow_run_id", "login_session_id", "adapter_version", "session_version", "input_ref"]);
  if (Object.keys(value).some((key) => !keys.has(key)) || !commandTypes.has(String(value.command_type))) fail("unsupported_command", 422);
  if (typeof value.idempotency_key !== "string" || !/^[A-Za-z0-9_.:-]{1,128}$/.test(value.idempotency_key)) fail("invalid_idempotency_key", 422);
  if (typeof value.adapter_version !== "string" || !/^[A-Za-z0-9_.-]{1,80}$/.test(value.adapter_version)) fail("invalid_adapter_version", 422);
  for (const field of ["platform_account_id", "connection_id", "execution_action_id", "workflow_run_id", "login_session_id"]) if (value[field] !== undefined && (typeof value[field] !== "string" || !uuidPattern.test(value[field]))) fail("invalid_reference", 422);
  if (value.session_version !== undefined && (typeof value.session_version !== "number" || !Number.isSafeInteger(value.session_version) || value.session_version < 0)) fail("invalid_session_version", 422);
  const refs = value.input_ref;
  const refKeys = new Set(["content_version_id", "material_id", "source_id", "object_key", "publication_id", "action_snapshot_id", "reconcile_command_id", "read_intent_id", "capability_artifact"]);
  if (!refs || typeof refs !== "object" || Array.isArray(refs) || Object.entries(refs).some(([key, val]) => !refKeys.has(key) || typeof val !== "string" || !/^[A-Za-z0-9_./-]{1,512}$/.test(val) || val.includes(".."))) fail("invalid_input_reference", 422);
  if ("capability_artifact" in refs && (refs.capability_artifact !== "server-selected" || value.command_type !== "session_verify" || !value.platform_account_id || !value.connection_id || value.execution_action_id)) fail("invalid_capability_reference", 422);
  if (!value.platform_account_id && !value.connection_id) fail("target_required", 422);
  if (value.command_type === "source_fetch" && (!value.connection_id || !value.workflow_run_id || value.execution_action_id)) fail("invalid_source_command", 422);
  if (writeTypes.has(String(value.command_type)) && (!value.platform_account_id || !value.execution_action_id)) fail("authorization_required", 422);
  return value as unknown as EnqueueBrowserCommand;
}

export function createBrowserService(ctx: ServiceContext, dependencies: BrowserServiceDependencies) {
  const clock = () => new Date(nowIso(ctx));
  async function account(tx: SqlExecutor, id: string): Promise<AccountRow> {
    const row = (await tx.query<AccountRow>("SELECT * FROM platform_accounts WHERE org_id=$1 AND id=$2 FOR UPDATE", [ctx.orgId, id])).rows[0];
    if (!row) fail("account_not_found", 404);
    if (row.session_status === "revoked") fail("account_revoked", 403);
    return row;
  }
  async function membership(tx: SqlExecutor) {
    if (ctx.actorType === "service") fail("login_user_identity_required", 403);
    const found = await tx.query<{ roles: string[] }>("SELECT m.roles FROM memberships m JOIN users u ON u.id=m.user_id WHERE m.org_id=$1 AND m.user_id=$2 AND m.active=true AND u.active=true", [ctx.orgId, ctx.actorId]);
    if (!found.rowCount) fail("user_revoked", 403);
    if (!found.rows[0]!.roles.some((role) => ["owner", "admin", "marketer"].includes(role))) fail("user_role_revoked", 403);
  }
  async function get(id: string, tx: SqlExecutor = ctx.db) {
    const result = (await tx.query<BrowserCommandRow>("SELECT * FROM browser_commands WHERE org_id=$1 AND id=$2", [ctx.orgId, id])).rows[0];
    if (!result) fail("command_not_found", 404);
    return result;
  }
  async function authorize(tx: SqlExecutor, command: Pick<BrowserCommandRow, "command_type" | "execution_action_id" | "platform_account_id">) {
    if (writeTypes.has(command.command_type)) {
      if (!command.execution_action_id || !dependencies.authorizeAction) fail("authorization_integration_required", 503);
      await dependencies.authorizeAction(ctx, tx, command.execution_action_id);
      const action = (await tx.query("SELECT target,action_type FROM execution_actions WHERE org_id=$1 AND id=$2", [ctx.orgId, command.execution_action_id])).rows[0];
      const target = action?.target as Record<string, unknown> | undefined;
      if (!action || (target?.platform_account_id ?? target?.account_id) !== command.platform_account_id || (command.command_type === "ad_write" ? !String(action.action_type).startsWith("ads.") : action.action_type !== "external.publish")) fail("action_target_mismatch", 403);
    }
  }
  async function enqueue(input: EnqueueBrowserCommand) {
    requireRole(ctx, "owner", "admin", "marketer", "service");
    const parsed = parseBrowserCommand(input);
    const payloadHash = stableHash({ mode: ctx.mode, command: parsed });
    return ctx.db.transaction(async (tx) => {
      // Account serialization also protects same-target idempotency and manual login creation.
      if (parsed.platform_account_id) {
        const target = await account(tx, parsed.platform_account_id);
        if (parsed.connection_id && parsed.connection_id !== target.connection_id) fail("account_connection_mismatch", 422);
        if (parsed.session_version !== undefined && parsed.session_version !== number(target.session_version)) fail("session_version_conflict");
      } else {
        const connection = (await tx.query("SELECT id FROM connections WHERE org_id=$1 AND id=$2 FOR UPDATE", [ctx.orgId, parsed.connection_id])).rows[0];
        if (!connection) fail("connection_not_found", 404);
      }
      if (parsed.workflow_run_id && !(await tx.query("SELECT id FROM workflow_runs WHERE org_id=$1 AND id=$2", [ctx.orgId, parsed.workflow_run_id])).rowCount) fail("run_not_found", 404);
      const prior = (await tx.query<BrowserCommandRow>("SELECT * FROM browser_commands WHERE org_id=$1 AND idempotency_key=$2", [ctx.orgId, parsed.idempotency_key])).rows[0];
      if (prior) { if (prior.input_ref.payload_hash !== payloadHash) fail("idempotency_conflict"); return prior; }
      if (parsed.login_session_id && !(await tx.query("SELECT id FROM login_sessions WHERE org_id=$1 AND id=$2 AND platform_account_id=$3", [ctx.orgId, parsed.login_session_id, parsed.platform_account_id])).rowCount) fail("login_binding_mismatch", 403);
      await authorize(tx, { command_type: parsed.command_type, execution_action_id: parsed.execution_action_id ?? null, platform_account_id: parsed.platform_account_id ?? null });
      const result = await tx.query<BrowserCommandRow>("INSERT INTO browser_commands (id,org_id,platform_account_id,connection_id,execution_action_id,workflow_run_id,login_session_id,command_type,idempotency_key,state,fencing_token,session_version,input_ref,attempts,created_at,updated_at) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,'queued',0,$10,$11,0,$12,$12) RETURNING *", [randomUUID(), ctx.orgId, parsed.platform_account_id ?? null, parsed.connection_id ?? null, parsed.execution_action_id ?? null, parsed.workflow_run_id ?? null, parsed.login_session_id ?? null, parsed.command_type, parsed.idempotency_key, parsed.session_version ?? null, JSON.stringify({ refs: parsed.input_ref, adapter_version: parsed.adapter_version, payload_hash: payloadHash, mode: ctx.mode }), clock().toISOString()]);
      await audit(ctx, tx, "browser.command.created", "browser_command", result.rows[0]!.id, { commandType: parsed.command_type, mode: ctx.mode });
      return result.rows[0]!;
    });
  }
  async function claim(id: string, owner: string, leaseSeconds = 90) {
    if (!owner || owner.length > 200 || leaseSeconds < 30 || leaseSeconds > 300) fail("invalid_lease", 422);
    return ctx.db.transaction(async (tx) => {
      // The deployment has one dedicated browser node. This DB lock serializes global capacity decisions.
      await tx.query("SELECT id FROM organizations ORDER BY id FOR NO KEY UPDATE");
      const command = await get(id, tx);
      if (command.state === "unknown") fail("reconciliation_required");
      if (command.state !== "queued") fail("command_not_queued");
      if (command.input_ref.mode !== ctx.mode) fail("command_mode_mismatch");
      const now = clock();
      if (number((await tx.query<{ total: string | number }>("SELECT count(*) AS total FROM browser_commands WHERE state='running' AND lease_until>$1", [now.toISOString()])).rows[0]!.total) >= 2) fail("browser_capacity_exhausted");
      const targetId = command.platform_account_id ?? command.connection_id!;
      const active = await tx.query("SELECT id FROM browser_commands WHERE org_id=$1 AND id<>$2 AND state='running' AND (platform_account_id=$3 OR connection_id=$3)", [ctx.orgId, id, targetId]);
      if (active.rowCount) fail("account_busy");
      let token: number;
      let version: number | null = null;
      if (command.platform_account_id) {
        const target = await account(tx, command.platform_account_id);
        if (!target.enabled && !["login", "session_verify", "reconcile"].includes(command.command_type)) fail("account_disabled", 403);
        if (target.session_status === "challenge_required" && command.command_type !== "login") fail("challenge_required");
        const manual = await tx.query("SELECT id FROM login_sessions WHERE org_id=$1 AND platform_account_id=$2 AND state IN ('created','active') AND expires_at>$3 AND id IS DISTINCT FROM $4", [ctx.orgId, target.id, now.toISOString(), command.login_session_id]);
        if (manual.rowCount) fail("manual_login_active");
        version = number(target.session_version);
        if (command.session_version !== null && number(command.session_version) !== version) fail("session_version_conflict");
        if (target.adapter_version && target.adapter_version !== command.input_ref.adapter_version) fail("adapter_version_conflict");
        token = number(target.browser_fencing_token) + 1;
        await tx.query("UPDATE platform_accounts SET browser_fencing_token=$3 WHERE org_id=$1 AND id=$2", [ctx.orgId, target.id, token]);
      } else {
        const target = (await tx.query<{ browser_fencing_token: string | number }>("SELECT browser_fencing_token FROM connections WHERE org_id=$1 AND id=$2 FOR UPDATE", [ctx.orgId, command.connection_id])).rows[0];
        if (!target) fail("connection_not_found", 404);
        token = number(target.browser_fencing_token) + 1;
        await tx.query("UPDATE connections SET browser_fencing_token=$3 WHERE org_id=$1 AND id=$2", [ctx.orgId, command.connection_id, token]);
      }
      await authorize(tx, command);
      const result = await tx.query<BrowserCommandRow>("UPDATE browser_commands SET state='running',fencing_token=$3,session_version=$4,lease_owner=$5,lease_until=$6,heartbeat_at=$7,started_at=COALESCE(started_at,$7),attempts=attempts+1,updated_at=$7 WHERE org_id=$1 AND id=$2 RETURNING *", [ctx.orgId, id, token, version, owner, new Date(now.getTime() + leaseSeconds * 1000).toISOString(), now.toISOString()]);
      return result.rows[0]!;
    });
  }
  async function assertLease(tx: SqlExecutor, id: string, owner: string, token: number) {
    const command = await get(id, tx);
    if (command.input_ref.mode !== ctx.mode) fail("command_mode_mismatch");
    if (command.state !== "running" || command.lease_owner !== owner || number(command.fencing_token) !== token || !command.lease_until || new Date(command.lease_until).getTime() <= clock().getTime()) fail("stale_browser_lease");
    if (command.platform_account_id) {
      const target = await account(tx, command.platform_account_id);
      if (number(target.browser_fencing_token) !== token || number(target.session_version) !== number(command.session_version)) fail("stale_browser_lease");
    } else {
      const target = (await tx.query<{ browser_fencing_token: string | number }>("SELECT browser_fencing_token FROM connections WHERE org_id=$1 AND id=$2", [ctx.orgId, command.connection_id])).rows[0];
      if (!target || number(target.browser_fencing_token) !== token) fail("stale_browser_lease");
    }
    await authorize(tx, command);
    return command;
  }
  async function heartbeat(id: string, owner: string, token: number) {
    return ctx.db.transaction(async (tx) => {
      await assertLease(tx, id, owner, token);
      await tx.query("UPDATE browser_commands SET heartbeat_at=$3,lease_until=$4 WHERE org_id=$1 AND id=$2", [ctx.orgId, id, clock().toISOString(), new Date(clock().getTime() + 90_000).toISOString()]);
    });
  }
  async function finish(id: string, owner: string, token: number, result: PlatformResult, capabilityProof?: CapabilityVerification) {
    return ctx.db.transaction(async (tx) => {
      const command = await assertLease(tx, id, owner, token);
      let state = "blocked";
      if (result.status === "verified") {
        const verifiedCommand = command.command_type === "reconcile" && command.input_ref.refs.reconcile_command_id ? await get(command.input_ref.refs.reconcile_command_id, tx) : command;
        const capturedAt = Date.parse(result.evidence.capturedAt);
        if (ctx.mode !== "live" || !result.evidence.verified || !result.evidence.evidenceRef || !Number.isFinite(capturedAt) || capturedAt < clock().getTime() - 60_000 || capturedAt > clock().getTime() + 60_000 || !["api_readback", "browser_readback"].includes(result.evidence.kind)) fail("unverified_result");
        if (command.platform_account_id) {
          const target = await account(tx, command.platform_account_id);
          if (target.account_external_id !== result.evidence.externalAccountId) fail("account_verification_mismatch");
        }
        if (writeTypes.has(verifiedCommand.command_type) && result.evidence.labelsVerified !== true) fail("label_verification_missing");
        if (verifiedCommand.command_type === "publish") {
          const action = (await tx.query<{ payload_hash: string; action_type: string }>("SELECT payload_hash,action_type FROM execution_actions WHERE org_id=$1 AND id=$2", [ctx.orgId, verifiedCommand.execution_action_id])).rows[0];
          if (!action || action.action_type !== "external.publish" || !result.evidence.contentHash || !/^[a-f0-9]{64}$/.test(result.evidence.contentHash) || result.evidence.contentHash !== action.payload_hash) fail("content_verification_mismatch");
          const data = safePlatformData(result.data);
          if (!data.external_id || !data.published_url || data.review_status !== "approved") fail("publication_receipt_missing");
        }
        if (["session_verify", "login"].includes(command.command_type) && command.platform_account_id) {
          await tx.query("UPDATE platform_accounts SET session_status='active',last_session_verified_at=$3,session_version=session_version+1,adapter_version=$4 WHERE org_id=$1 AND id=$2", [ctx.orgId, command.platform_account_id, result.evidence.capturedAt,command.input_ref.adapter_version]);
        }
        state = "succeeded";
      } else if (result.status === "unknown" || result.status === "submitted" || result.status === "in_review") state = "unknown";
      else if (result.status === "rejected") state = "failed";
      if (result.status === "challenge_required" && command.platform_account_id) await tx.query("UPDATE platform_accounts SET session_status='challenge_required',session_version=session_version+1 WHERE org_id=$1 AND id=$2", [ctx.orgId, command.platform_account_id]);
      // Only references and non-secret status metadata enter durable command results.
      const actualEvidence = "evidence" in result ? result.evidence : undefined;
      if (actualEvidence && result.status !== "verified") {
        const capturedAt = Date.parse(actualEvidence.capturedAt);
        if (ctx.mode !== "live" || !actualEvidence.verified || !actualEvidence.evidenceRef || !Number.isFinite(capturedAt) || Math.abs(capturedAt-clock().getTime())>60_000) fail("unverified_result");
        if (command.platform_account_id && (await account(tx, command.platform_account_id)).account_external_id !== actualEvidence.externalAccountId) fail("account_verification_mismatch");
      }
      const safeEvidence = actualEvidence ? { verified: true, kind: actualEvidence.kind, externalAccountId: actualEvidence.externalAccountId, capturedAt: actualEvidence.capturedAt, evidenceRef: actualEvidence.evidenceRef, ...(actualEvidence.labelsVerified !== undefined ? { labelsVerified: actualEvidence.labelsVerified } : {}), ...(actualEvidence.contentHash && /^[a-f0-9]{64}$/.test(actualEvidence.contentHash) ? { contentHash: actualEvidence.contentHash } : {}) } : null;
      const data = "data" in result ? safePlatformData(result.data) : {};
      if(result.status==='verified'&&['login','session_verify'].includes(command.command_type)&&command.platform_account_id){
        const current=await account(tx,command.platform_account_id),connection=(await tx.query('SELECT id,account_external_id,read_mode,scope_json,secret_ref FROM connections WHERE org_id=$1 AND id=$2',[ctx.orgId,current.connection_id])).rows[0];
        if(!connection)fail('connection_not_found',404);
        data.configuration_hash=stableHash({connection_id:connection.id,account_external_id:connection.account_external_id,read_mode:connection.read_mode,scope_json:connection.scope_json,secret_ref:connection.secret_ref});
        data.adapter_version=command.input_ref.adapter_version;data.session_version_after=number(current.session_version);
        if (connection.read_mode === 'mock' || connection.account_external_id !== current.account_external_id) fail('connection_account_mismatch');
        const capabilityRegistration=command.input_ref.refs.capability_artifact === 'server-selected';
        await tx.query("UPDATE connections SET access_status=CASE WHEN $4 THEN access_status WHEN capabilities ? 'platform_execution' OR capabilities_verified_at IS NULL THEN 'verifying' ELSE access_status END,health='healthy',capabilities=CASE WHEN NOT $4 AND capabilities ? 'platform_execution' THEN '{}'::jsonb ELSE capabilities END,capabilities_verified_at=CASE WHEN NOT $4 AND capabilities ? 'platform_execution' THEN NULL ELSE capabilities_verified_at END,last_success_at=$3,last_error_code=NULL,updated_at=$3 WHERE org_id=$1 AND id=$2", [ctx.orgId, connection.id, clock().toISOString(),capabilityRegistration]);
        if (command.input_ref.refs.capability_artifact === 'server-selected') {
          if (!capabilityProof?.verified || !capabilityProof.artifactId || capabilityProof.orgId !== ctx.orgId || capabilityProof.accountId !== current.id || capabilityProof.connectionId !== connection.id || capabilityProof.externalAccountId !== current.account_external_id || capabilityProof.configurationHash !== platformConfigurationHash(connection) || capabilityProof.adapterVersion !== command.input_ref.adapter_version || capabilityProof.sessionVersion !== number(command.session_version) || !capabilityProof.acceptedAt || !Number.isFinite(Date.parse(capabilityProof.acceptedAt)) || Date.parse(capabilityProof.acceptedAt) < clock().getTime()-86400_000 || Date.parse(capabilityProof.acceptedAt)>clock().getTime()+60_000 || !Array.isArray(capabilityProof.capabilityEvidence) || !capabilityProof.capabilities.length || capabilityProof.capabilities.some(cap => !capabilityProof.capabilityEvidence!.some(proof => proof.capability === cap && proof.externalAccountId === current.account_external_id && /^[a-f0-9]{64}$/.test(proof.sha256) && ['api_readback','browser_readback'].includes(proof.kind) && Number.isFinite(Date.parse(proof.capturedAt)) && Date.parse(proof.capturedAt)>=clock().getTime()-86400_000 && Date.parse(proof.capturedAt)<=clock().getTime()+60_000))) fail('capability_artifact_verification_failed');
          const accepted = { ...capabilityProof, registrationCommandId: command.id, sessionVersion: number(current.session_version) };
          await tx.query("UPDATE connections SET access_status='connected',capabilities=$3::jsonb,capabilities_verified_at=$4,updated_at=$4 WHERE org_id=$1 AND id=$2", [ctx.orgId, connection.id, JSON.stringify({ ...Object.fromEntries(capabilityProof.capabilities.map(cap => [cap, true])), verified_capabilities: capabilityProof.capabilities, platform_execution: accepted }), clock().toISOString()]);
          data.capability_status='verified';data.capability_artifact_id=capabilityProof.artifactId;
          await audit(ctx,tx,'browser.capabilities.verified','platform_account',String(current.id),{commandId:command.id,artifactId:capabilityProof.artifactId,configurationHash:capabilityProof.configurationHash,capabilities:capabilityProof.capabilities});
        }
      }
      const safe = result.status === "verified" ? { status: result.status, evidence: safeEvidence, data } : result.status === "submitted" || result.status === "in_review" ? { status: result.status, externalId: result.externalId, ...(result.evidenceRef ? { evidenceRef: result.evidenceRef } : {}), ...(safeEvidence?{evidence:safeEvidence}:{}), data } : { status: result.status, reason: /^[A-Za-z0-9_.:-]{1,100}$/.test(result.reason) ? result.reason : "adapter_reason_redacted", ...(result.status === "rejected" || result.status === "unknown" ? { externalId: result.externalId, evidenceRef: result.evidenceRef, ...(safeEvidence?{evidence:safeEvidence}:{}), data } : {}) };
      await tx.query("UPDATE browser_commands SET state=$3,result_ref=$4,finished_at=$5,lease_owner=NULL,lease_until=NULL,updated_at=$5 WHERE org_id=$1 AND id=$2", [ctx.orgId, id, state, JSON.stringify(safe), clock().toISOString()]);
      if (command.command_type === "reconcile" && ["succeeded", "unknown", "failed"].includes(state)) {
        const originalId = command.input_ref.refs.reconcile_command_id;
        if (!originalId) fail("reconciliation_reference_missing");
        const original = await get(originalId, tx);
        if (original.state !== "unknown" || original.platform_account_id !== command.platform_account_id || original.execution_action_id !== command.execution_action_id) fail("reconciliation_target_mismatch");
        await tx.query("UPDATE browser_commands SET state=$3,result_ref=$4,finished_at=$5,updated_at=$5 WHERE org_id=$1 AND id=$2 AND state='unknown'", [ctx.orgId, originalId, state, JSON.stringify({ ...safe, reconciliationCommandId: id }), clock().toISOString()]);
      }
      await audit(ctx, tx, `browser.command.${state}`, "browser_command", id, { status: result.status, fencingToken: token });
      return get(id, tx);
    });
  }
  async function execute(id: string, owner: string) {
    const command = await claim(id, owner);
    const token = number(command.fencing_token);
    if (ctx.mode !== "live") return finish(id, owner, token, { status: "blocked", reason: "mock_mode_external_execution_disabled" });
    const target = command.platform_account_id ? (await ctx.db.query<AccountRow>("SELECT * FROM platform_accounts WHERE org_id=$1 AND id=$2", [ctx.orgId, command.platform_account_id])).rows[0] : null;
    const sourceConnection = !target && command.connection_id ? (await ctx.db.query("SELECT account_external_id FROM connections WHERE org_id=$1 AND id=$2", [ctx.orgId, command.connection_id])).rows[0] : null;
    const adapter = target ? dependencies.adapters.get(target.channel_id ?? target.provider) : dependencies.sourceAdapter;
    if (!adapter || adapter.mode !== "live") return finish(id, owner, token, { status: "blocked", reason: "integration_required" });
    const check = () => ctx.db.transaction(async (tx) => { await assertLease(tx, id, owner, token); });
    const executionContext: PlatformExecutionContext = { orgId: ctx.orgId, accountId: command.platform_account_id ?? command.connection_id!, externalAccountId: target?.account_external_id ?? String(sourceConnection?.account_external_id ?? "source"), adapterVersion: command.input_ref.adapter_version, sessionVersion: number(command.session_version), fencingToken: token, commandId: id, mode: ctx.mode, assertLease: check, markMutationStart:()=>{effectMayHaveStarted=true;}, recordSubmission: receipt => ctx.db.transaction(async tx => { await assertLease(tx, id, owner, token); await tx.query("UPDATE browser_commands SET result_ref=$3,updated_at=$4 WHERE org_id=$1 AND id=$2", [ctx.orgId, id, JSON.stringify({ status: "submitted", externalId: receipt.externalId, evidenceRef: receipt.evidenceRef, data: safePlatformData({ ...receipt.data, external_id: receipt.externalId }) }), clock().toISOString()]); }) };
    const action = { commandType: command.command_type, inputRef: command.input_ref.refs, ...(command.execution_action_id ? { actionId: command.execution_action_id } : {}) };
    let effectMayHaveStarted = false;
    let capabilityProof: CapabilityVerification | undefined;
    try {
      const run = async (browser?: unknown): Promise<PlatformResult> => {
        await check(); const runtimeContext={ ...executionContext, ...(browser ? { browserSession: browser } : {}) };
        if(command.command_type==='session_verify'&&command.input_ref.refs.capability_artifact==='server-selected'){
          capabilityProof=await adapter.verify({...runtimeContext,capabilityArtifactRequested:true});
          return {status:'verified',evidence:capabilityProof};
        }
        return adapter.execute(runtimeContext, action);
      };
      let result: PlatformResult;
      if (adapter.profileRequired === false) result = await run();
      else {
        if (!dependencies.withProfile) throw new ConnectorBlockedError("encrypted_profile_not_configured");
        result = await dependencies.withProfile({ orgId: ctx.orgId, accountId: executionContext.accountId, fencingToken: token, channelId: adapter.channelId, ...(adapter.allowedOrigins ? { allowedOrigins: adapter.allowedOrigins } : {}) }, browser => run(browser));
      }
      if (command.command_type === "source_fetch" && result.status === "verified" && result.data && dependencies.captureSource) await dependencies.captureSource(result.data);
      return await finish(id, owner, token, result, capabilityProof);
    } catch (error) {
      const reason = error instanceof ConnectorBlockedError || error instanceof DomainError ? error.code : "adapter_execution_failed";
      return finish(id, owner, token, { status: effectMayHaveStarted ? "unknown" : "blocked", reason });
    }
  }
  async function recoverExpired() {
    return ctx.db.transaction(async (tx) => {
      const recovered = await tx.query<BrowserCommandRow>("UPDATE browser_commands SET state=CASE WHEN command_type IN ('publish','ad_write') THEN 'unknown' ELSE 'queued' END,lease_owner=NULL,lease_until=NULL,last_error='{\"code\":\"lease_expired\"}'::jsonb,updated_at=$2 WHERE org_id=$1 AND state='running' AND lease_until<=$2 RETURNING *", [ctx.orgId, clock().toISOString()]);
      await tx.query("UPDATE login_sessions SET state='expired',updated_at=$2 WHERE org_id=$1 AND state IN ('created','active') AND expires_at<=$2", [ctx.orgId, clock().toISOString()]);
      return recovered.rows;
    });
  }
  async function reconcile(id: string) {
    const original = await get(id);
    if (original.state !== "unknown") fail("command_not_unknown");
    if (!original.platform_account_id) fail("source_reconciliation_not_implemented", 503);
    return enqueue({ command_type: "reconcile", idempotency_key: `reconcile:${id}:${Math.floor(clock().getTime() / 60_000)}`, platform_account_id: original.platform_account_id, ...(original.execution_action_id ? { execution_action_id: original.execution_action_id } : {}), adapter_version: original.input_ref.adapter_version, input_ref: { reconcile_command_id: id } });
  }
  async function cancel(id: string) {
    requireRole(ctx, "owner", "admin", "marketer", "service");
    return ctx.db.transaction(async (tx) => { const command = await get(id, tx); if (!["queued", "blocked"].includes(command.state)) fail("cannot_cancel_submitted_command"); await tx.query("UPDATE browser_commands SET state='cancelled',updated_at=$3 WHERE org_id=$1 AND id=$2", [ctx.orgId, id, clock().toISOString()]); return get(id, tx); });
  }
  async function createLogin(accountId: string) {
    requireRole(ctx, "owner", "admin", "marketer");
    return ctx.db.transaction(async (tx) => {
      await membership(tx);
      const target = await account(tx, accountId);
      const now = clock();
      await tx.query("UPDATE login_sessions SET state='expired' WHERE org_id=$1 AND platform_account_id=$2 AND state IN ('created','active') AND expires_at<=$3", [ctx.orgId, accountId, now.toISOString()]);
      if ((await tx.query("SELECT id FROM login_sessions WHERE org_id=$1 AND platform_account_id=$2 AND state IN ('created','active')", [ctx.orgId, accountId])).rowCount) fail("manual_login_active");
      if ((await tx.query("SELECT id FROM browser_commands WHERE org_id=$1 AND platform_account_id=$2 AND state='running'", [ctx.orgId, accountId])).rowCount) fail("account_busy");
      const ticket = randomBytes(32).toString("base64url");
      const id = randomUUID();
      const expiresAt = new Date(now.getTime() + 900_000).toISOString();
      const ticketExpiresAt = new Date(now.getTime() + 60_000).toISOString();
      await tx.query("INSERT INTO login_sessions (id,org_id,platform_account_id,user_id,ticket_hash,expires_at,state,expected_session_version,ticket_expires_at,version,created_at,updated_at) VALUES ($1,$2,$3,$4,$5,$6,'created',$7,$8,1,$9,$9)", [id, ctx.orgId, accountId, ctx.actorId, hashTicket(ticket), expiresAt, number(target.session_version), ticketExpiresAt, now.toISOString()]);
      await audit(ctx, tx, "browser.login.created", "login_session", id, { accountId, expiresAt });
      return { id, ticket, ticketExpiresAt, expiresAt, interactionReady: false, status: "login_proxy_integration_required" };
    });
  }
  async function redeemLogin(input: { sessionId: string; accountId: string; ticket: string }) {
    requireRole(ctx, "owner", "admin", "marketer");
    return ctx.db.transaction(async (tx) => {
      await membership(tx);
      const target = await account(tx, input.accountId);
      const session = (await tx.query<LoginRow>("SELECT * FROM login_sessions WHERE org_id=$1 AND id=$2 FOR UPDATE", [ctx.orgId, input.sessionId])).rows[0];
      if (!session || session.user_id !== ctx.actorId || session.platform_account_id !== input.accountId) fail("login_binding_mismatch", 403);
      if (session.state !== "created" || session.consumed_at || new Date(session.ticket_expires_at).getTime() <= clock().getTime() || new Date(session.expires_at).getTime() <= clock().getTime() || !sameHash(session.ticket_hash, hashTicket(input.ticket))) fail("login_ticket_invalid", 403);
      if (number(target.session_version) !== number(session.expected_session_version)) fail("session_version_conflict");
      await tx.query("UPDATE login_sessions SET state='active',consumed_at=$3,started_at=$3,updated_at=$3,version=version+1 WHERE org_id=$1 AND id=$2", [ctx.orgId, session.id, clock().toISOString()]);
      return { id: session.id, accountId: input.accountId, expiresAt: session.expires_at };
    });
  }
  async function authorizeInteraction(sessionId: string, accountId: string) {
    return ctx.db.transaction(async (tx) => {
      await membership(tx);
      const target = await account(tx, accountId);
      const session = (await tx.query<LoginRow>("SELECT * FROM login_sessions WHERE org_id=$1 AND id=$2", [ctx.orgId, sessionId])).rows[0];
      if (!session || session.state !== "active" || session.user_id !== ctx.actorId || session.platform_account_id !== accountId || new Date(session.expires_at).getTime() <= clock().getTime() || number(session.expected_session_version) !== number(target.session_version)) fail("login_interaction_denied", 403);
      return session;
    });
  }
  async function completeLogin(sessionId: string, accountId: string, verifyActualSession: () => Promise<VerificationEvidence>, afterVerified?: (tx:SqlExecutor,details:{proof:VerificationEvidence;sessionVersion:number})=>Promise<void>) {
    await authorizeInteraction(sessionId, accountId);
    if (ctx.mode !== "live") fail("real_verification_required", 503);
    const proof = await verifyActualSession();
    return ctx.db.transaction(async (tx) => {
      await membership(tx);
      const target = await account(tx, accountId);
      const session = (await tx.query<LoginRow>("SELECT * FROM login_sessions WHERE org_id=$1 AND id=$2 FOR UPDATE", [ctx.orgId, sessionId])).rows[0];
      if (!session || session.user_id !== ctx.actorId || session.platform_account_id !== accountId || session.state !== "active" || new Date(session.expires_at).getTime() <= clock().getTime() || number(session.expected_session_version) !== number(target.session_version)) fail("login_interaction_denied", 403);
      if (!proof.verified || proof.externalAccountId !== target.account_external_id || !proof.evidenceRef || !Number.isFinite(Date.parse(proof.capturedAt)) || !["api_readback", "browser_readback"].includes(proof.kind) || Date.parse(proof.capturedAt) < clock().getTime() - 60_000 || Date.parse(proof.capturedAt) > clock().getTime() + 60_000) fail("real_verification_required", 503);
      await tx.query("UPDATE platform_accounts SET session_status='active',session_version=session_version+1,last_session_verified_at=$3 WHERE org_id=$1 AND id=$2", [ctx.orgId, accountId, clock().toISOString()]);
      await tx.query("UPDATE connections SET access_status=CASE WHEN capabilities ? 'platform_execution' OR capabilities_verified_at IS NULL THEN 'verifying' ELSE access_status END,health='healthy',capabilities=CASE WHEN capabilities ? 'platform_execution' THEN '{}'::jsonb ELSE capabilities END,capabilities_verified_at=CASE WHEN capabilities ? 'platform_execution' THEN NULL ELSE capabilities_verified_at END,last_success_at=$3,last_error_code=NULL,updated_at=$3 WHERE org_id=$1 AND id=$2 AND read_mode<>'mock' AND account_external_id=$4", [ctx.orgId,target.connection_id,clock().toISOString(),proof.externalAccountId]);
      await tx.query("UPDATE login_sessions SET state='completed',completed_at=$3,result_ref=$4,version=version+1 WHERE org_id=$1 AND id=$2", [ctx.orgId, sessionId, clock().toISOString(), JSON.stringify({ evidenceRef: proof.evidenceRef, externalAccountId: proof.externalAccountId })]);
      await afterVerified?.(tx,{proof,sessionVersion:number(target.session_version)+1});
      await audit(ctx, tx, "browser.login.completed", "login_session", sessionId, { accountId, evidenceRef: proof.evidenceRef });
      return { id: sessionId, verified: true, sessionVersion: number(target.session_version) + 1 };
    });
  }
  return { enqueue, get, claim, heartbeat, finish, execute, recoverExpired, reconcile, cancel, createLogin, redeemLogin, authorizeInteraction, completeLogin };
}
export type BrowserService = ReturnType<typeof createBrowserService>;
