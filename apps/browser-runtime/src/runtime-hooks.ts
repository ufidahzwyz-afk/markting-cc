import type { Database } from "@boran/db";
import { readFileSync, statSync } from "node:fs";
import { stableHash } from "@boran/domain/core";
import { ConnectorBlockedError, createPlatformAdapter, createPlatformRegistry, type PlatformAdapter, type PlatformCommand, type PlatformExecutionContext, type PlatformHooks } from "@boran/connectors";
import { createBaiduJsonClient, createBaiduNativeTransport, parseBaiduReviewContracts, type BaiduReviewContracts } from "@boran/connectors/baidu";
import { createSecretStoreFromEnvironment } from "@boran/connectors/secrets";
import { BrowserRecipeRegistry } from "./recipes";
import { createRecipePlatformHooks, type PublicationMaterial } from "./recipe-hooks";
import { CapabilityArtifactRegistry, validStoredCapabilityProof } from "./capabilities";

export interface RuntimeHookOptions {
  mode: "mock" | "live";
  database(): Promise<Database>;
  recipes: BrowserRecipeRegistry;
  environment?: NodeJS.ProcessEnv;
}
function object(value: unknown): Record<string, unknown> { return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {}; }
export function createRuntimePlatformRegistry(options: RuntimeHookOptions): ReadonlyMap<string, PlatformAdapter> {
  const env = options.environment ?? process.env;
  const capabilityArtifacts = new CapabilityArtifactRegistry(env.BROWSER_CAPABILITY_ARTIFACTS_FILE);
  let baiduReviewContracts: BaiduReviewContracts | undefined;
  if (env.BROWSER_BAIDU_REVIEW_CONTRACT_FILE) {
    try {
      if (statSync(env.BROWSER_BAIDU_REVIEW_CONTRACT_FILE).size > 64_000) throw new Error();
      const review = object(JSON.parse(readFileSync(env.BROWSER_BAIDU_REVIEW_CONTRACT_FILE, "utf8")));
      if (review.version !== env.BROWSER_BAIDU_NATIVE_CONTRACT_VERSION) throw new Error();
      baiduReviewContracts = parseBaiduReviewContracts(review.entities);
    } catch { throw new ConnectorBlockedError("baidu_review_contract_invalid"); }
  }
  async function account(context: PlatformExecutionContext) {
    const db = await options.database();
    const row = (await db.query("SELECT a.*,c.secret_ref,c.scope_json,c.read_mode,c.capabilities,c.capabilities_verified_at,c.account_external_id AS connection_external_id FROM platform_accounts a JOIN connections c ON c.org_id=a.org_id AND c.id=a.connection_id WHERE a.org_id=$1 AND a.id=$2", [context.orgId, context.accountId])).rows[0];
    if (!row || row.read_mode === "mock") throw new ConnectorBlockedError("account_live_configuration_required");
    if (row.account_external_id !== context.externalAccountId || row.connection_external_id !== context.externalAccountId) throw new ConnectorBlockedError("account_mismatch");
    return row;
  }
  async function capabilities(context: PlatformExecutionContext, row: Record<string, unknown>) {
    if (context.capabilityArtifactRequested) return capabilityArtifacts.select(context, row);
    const proof = validStoredCapabilityProof(context, row);
    if (!proof?.registrationCommandId) return undefined;
    const saved = (await (await options.database()).query("SELECT result_ref FROM browser_commands WHERE org_id=$1 AND id=$2 AND platform_account_id=$3 AND connection_id=$4 AND command_type='session_verify' AND state='succeeded'", [context.orgId, proof.registrationCommandId, context.accountId, row.connection_id])).rows[0];
    const result = object(saved?.result_ref), data = object(result.data), observed = object(result.evidence);
    return data.capability_status === "verified" && data.configuration_hash === proof.configurationHash && data.capability_artifact_id === proof.artifactId && data.session_version_after === context.sessionVersion && observed.verified === true && observed.externalAccountId === context.externalAccountId && ["browser_readback", "api_readback"].includes(String(observed.kind)) ? proof : undefined;
  }
  async function material(context: PlatformExecutionContext, command: PlatformCommand): Promise<PublicationMaterial> {
    const db = await options.database();
    const row = (await db.query("SELECT e.payload_hash,e.payload,e.version_id,v.body_json,v.claim_ids,v.review_status,cv.asset_ids,cv.format,cv.validation_status,cv.validated_payload_hash,cv.validated_at,cv.ai_generated FROM execution_actions e JOIN content_versions v ON v.org_id=e.org_id AND v.id=e.version_id JOIN content_variants cv ON cv.org_id=v.org_id AND cv.content_version_id=v.id AND cv.platform_account_id=$3 WHERE e.org_id=$1 AND e.id=$2 AND cv.id=(e.target->>'content_variant_id')::uuid", [context.orgId, command.actionId, context.accountId])).rows[0];
    const body = object(row?.body_json);
    if (!row || row.review_status !== "approved" || row.validation_status !== "passed" || !row.validated_at || row.validated_payload_hash !== row.payload_hash || stableHash(body) !== row.payload_hash || row.format !== "article" || !Array.isArray(row.asset_ids) || row.asset_ids.length || typeof body.title !== "string" || typeof body.body !== "string") throw new ConnectorBlockedError("approved_actual_article_required");
    const claims = row.claim_ids as string[];
    if (claims.length) {
      const proof = (await db.query("SELECT id FROM evidence_claims WHERE org_id=$1 AND id=ANY($2::uuid[]) AND verification_status='verified' AND assertion_type='fact' AND visibility='public' AND public_permission='allowed' AND permission_evidence_ref IS NOT NULL AND (valid_until IS NULL OR valid_until>now())", [context.orgId, claims])).rows;
      if (proof.length !== new Set(claims).size) throw new ConnectorBlockedError("publication_claims_expired_or_revoked");
    }
    const configured = await account(context), login = object(object(configured.scope_json).platform_login);
    const recipe = options.recipes.get(String(login.recipe_id ?? ""), String(login.recipe_version ?? ""), String(configured.channel_id ?? configured.provider));
    if (row.ai_generated && !recipe.publication?.labels.length) throw new ConnectorBlockedError("ai_label_recipe_not_configured");
    return { title: body.title, body: body.body, payloadHash: String(row.payload_hash), validated: true, format: "article" };
  }
  const hooks = createRecipePlatformHooks({
    async configuration(context) {
      const row = await account(context), login = object(object(row.scope_json).platform_login);
      const configuredRecipe = options.recipes.get(String(login.recipe_id ?? ""), String(login.recipe_version ?? ""), String(row.channel_id ?? row.provider));
      if (login.method !== configuredRecipe.login.method) throw new ConnectorBlockedError("login_method_recipe_mismatch");
      const proof = await capabilities(context, row), { verification: _unboundProof, ...recipe } = configuredRecipe;
      return { recipe: { ...recipe, ...(proof ? { verification: proof } : {}) }, connectionId: String(row.connection_id), secretRef: typeof row.secret_ref === "string" ? row.secret_ref : null };
    },
    async resolveSecret(ref, scope) { return createSecretStoreFromEnvironment(env).resolveSecret(ref, scope); },
    material,
    async priorReceipt(context, command) {
      const db = await options.database();
      const original = (await db.query("SELECT * FROM browser_commands WHERE org_id=$1 AND id=$2 AND platform_account_id=$3 AND state='unknown' AND command_type='publish'", [context.orgId, command.inputRef.reconcile_command_id, context.accountId])).rows[0];
      const result = object(original?.result_ref), data = object(result.data), input = object(original?.input_ref);
      const externalId = data.external_id ?? result.externalId;
      if (!original || typeof externalId !== "string" || !original.execution_action_id) return null;
      return { externalId, originalCommand: { commandType: "publish", actionId: String(original.execution_action_id), inputRef: object(input.refs) as Record<string, string> } };
    },
  });
  const configured: Partial<Record<string, PlatformHooks>> = {};
  for (const channel of options.recipes.channels()) if (channel !== "website" && channel !== "chatgpt") configured[channel] = hooks;
  const registry = new Map(createPlatformRegistry({ mode: options.mode, hooks: configured }));
  if (options.recipes.channels().includes("website")) registry.set("website", createPlatformAdapter("website", { mode: options.mode, hooks, profileRequired: true, descriptor: { channelId: "website", displayName: "指定网站后台", transport: "controlled_browser", formats: ["article"], allowedOrigins: options.recipes.origins("website"), requiredCapabilities: ["verify_account", "maintain_session", "validate_actual_materials", "submit_publish", "readback_actual_result", "reconcile_unknown_result", "verify_ai_label_requirements", "readback_required_labels"] } }));
  if (env.BROWSER_BAIDU_NATIVE_CONTRACT_VERSION) {
    async function native(context: PlatformExecutionContext) {
      if(context.adapterVersion!==env.BROWSER_BAIDU_NATIVE_CONTRACT_VERSION)throw new ConnectorBlockedError('adapter_version_conflict');
      const row = await account(context);
      if (!row.secret_ref) throw new ConnectorBlockedError("baidu_credentials_not_configured");
      const call = createBaiduJsonClient({ beforeMutation:async()=>{await context.assertLease();context.markMutationStart?.();}, credentials: async () => {
        const secret = await createSecretStoreFromEnvironment(env).resolveSecret(String(row.secret_ref), { orgId: context.orgId, connectionId: String(row.connection_id) });
        if (secret.kind !== "platform_password" || !secret.token) throw new ConnectorBlockedError("baidu_token_required");
        return { username: secret.username, password: secret.password, token: secret.token };
      } });
      return { transport: createBaiduNativeTransport({ call, contractVersion: env.BROWSER_BAIDU_NATIVE_CONTRACT_VERSION!, externalAccountId: context.externalAccountId, beforeMutation: context.assertLease, ...(baiduReviewContracts ? { reviewContracts: baiduReviewContracts } : {}) }), row };
    }
    async function action(context: PlatformExecutionContext, command: PlatformCommand): Promise<{ target: Record<string, unknown>; payload: Record<string, unknown> }> {
      const db = await options.database(), id = command.actionId ?? command.inputRef.action_snapshot_id;
      if (command.commandType === "ad_read" && command.inputRef.read_intent_id) {
        const setting = (await db.query("SELECT value FROM settings WHERE org_id=$1 AND key=$2", [context.orgId, `platform_read_intent:${command.inputRef.read_intent_id}`])).rows[0];
        const intent = object(setting?.value), target = object(intent.target);
        if (intent.mode !== "live" || intent.account_id !== context.accountId || intent.target_hash !== stableHash(target)) throw new ConnectorBlockedError("baidu_read_intent_mismatch");
        return { target: { ...target, accountId: context.externalAccountId }, payload: {} };
      }
      const row = (await db.query("SELECT target,payload FROM execution_actions WHERE org_id=$1 AND id=$2", [context.orgId, id])).rows[0];
      if (!row) throw new ConnectorBlockedError("baidu_action_not_found");
      return { target: { ...object(row.target), accountId: context.externalAccountId }, payload: object(row.payload) };
    }
    const baiduHooks: PlatformHooks = {
      mutationBoundaryManaged: true,
      async probe(context) {
        const { transport, row } = await native(context), proof = await transport.verifyAccount();
        const acceptance = await capabilities(context, row);
        return { ...(acceptance ?? {}), verified: true, ...proof, kind: "api_readback", adapterVersion: context.adapterVersion, capabilities: ["verify_account", "maintain_session", ...(acceptance?.capabilities ?? [])] };
      },
      async login(context) { const { transport } = await native(context); return { status: "verified", evidence: { verified: true, ...(await transport.verifyAccount()), kind: "api_readback" } }; },
      async sessionVerify(context) { return baiduHooks.login!(context); },
      async readMetrics(context, command) { const { transport } = await native(context), input = await action(context, command); const state = await transport.read(input.target); return { status: "verified", evidence: { verified: true, ...(await transport.verifyAccount()), kind: "api_readback" }, data: { effective_fields: state, entity_type: input.target.entityType ?? input.target.entity_type } }; },
      async adWrite(context, command) {
        const { transport, row } = await native(context), input = await action(context, command), proof=await capabilities(context,row);
        const type=String(input.target.entityType??input.target.entity_type),existing=input.target.entityId??input.target.entity_id;
        const required=new Set<string>();
        if(type==='negative')required.add((input.target.parentType??input.target.parent_type??'campaign')==='adgroup'?'write_unit_negative_keyword':'write_campaign_negative_keyword');
        else required.add(`${existing?'update':'create'}_${type==='adgroup'?'unit':type}`);
        if('pause' in input.payload)required.add(input.payload.pause===true?'pause_entity':'enable_entity');
        if('price' in input.payload||'maxPrice' in input.payload)required.add('update_bid');
        if('regionTarget' in input.payload)required.add('update_geo');
        if('schedule' in input.payload)required.add('update_schedule');
        if('pcDestinationUrl' in input.payload||'mobileDestinationUrl' in input.payload||'displayUrl' in input.payload)required.add('update_landing_url');
        if(!proof||[...required].some(capability=>!proof.capabilities.includes(capability)))throw new ConnectorBlockedError('baidu_entity_capability_gap');
        // The native creative contract currently lacks actual AI/advertising-label readback fields.
        if(type==='creative')throw new ConnectorBlockedError('baidu_creative_label_adapter_pending');
        const receipt = await transport.write({ actionId: command.actionId!, idempotencyKey: `action:${command.actionId}`, ...input });
        return receipt.externalId ? { status: "submitted", externalId: receipt.externalId } : { status: "unknown", reason: "baidu_submission_receipt_missing" };
      },
      async readback(context, command, receipt) {
        if (receipt.status !== "submitted") return { status: "unknown", reason: "baidu_submission_receipt_missing" };
        const { transport } = await native(context), input = await action(context, command);
        const read = await transport.readback({ ...input, receipt });
        const evidence = { verified: true, externalAccountId: context.externalAccountId, capturedAt: new Date().toISOString(), evidenceRef: read.evidenceRef, kind: "api_readback" as const, labelsVerified: true };
        const data = { external_id: receipt.externalId, entity_type: input.target.entityType ?? input.target.entity_type, effective_fields: read.state, ...(read.reviewStatus ? { review_status: read.reviewStatus } : {}) };
        if (read.effectiveFieldsVerified && read.reviewStatus === "pending") return { status: "in_review", externalId: receipt.externalId, evidenceRef: read.evidenceRef, evidence, data };
        if (read.effectiveFieldsVerified && read.reviewStatus === "rejected") return { status: "rejected", reason: "baidu_review_rejected", externalId: receipt.externalId, evidenceRef: read.evidenceRef, evidence, data };
        return read.verified ? { status: "verified", evidence, data } : { status: "unknown", reason: read.effectiveFieldsVerified && read.reviewStatus === "unknown" ? "baidu_review_contract_unknown_status" : "baidu_effective_fields_mismatch", externalId: receipt.externalId, data };
      },
      async reconcile(context, command) {
        const db = await options.database(), original = (await db.query("SELECT execution_action_id,result_ref FROM browser_commands WHERE org_id=$1 AND id=$2 AND platform_account_id=$3 AND state='unknown' AND command_type='ad_write'", [context.orgId, command.inputRef.reconcile_command_id, context.accountId])).rows[0];
        const previous = object(original?.result_ref), externalId = object(previous.data).external_id ?? previous.externalId;
        if (!original || typeof externalId !== "string") return { status: "unknown", reason: "baidu_submission_receipt_missing" };
        return baiduHooks.readback!(context, { commandType: "ad_write", inputRef: {}, actionId: String(original.execution_action_id) }, { status: "submitted", externalId });
      },
    };
    registry.set("baidu_marketing", createPlatformAdapter("baidu_marketing", { mode: options.mode, hooks: baiduHooks, profileRequired: false }));
  }
  return registry;
}

export function createChatGptLoginHooks(options: RuntimeHookOptions): PlatformHooks | undefined {
  if (!options.recipes.channels().includes("chatgpt")) return undefined;
  return createRecipePlatformHooks({
    async configuration(context) {
      const db = await options.database(), row = (await db.query("SELECT id,secret_ref,scope_json,source_kind,read_mode FROM connections WHERE org_id=$1 AND id=$2", [context.orgId, context.accountId])).rows[0];
      if (!row || row.source_kind !== "chatgpt" || row.read_mode !== "authorized_browser") throw new ConnectorBlockedError("chatgpt_source_scope_not_configured");
      const login = object(object(row.scope_json).platform_login);
      const recipe = options.recipes.get(String(login.recipe_id ?? ""), String(login.recipe_version ?? ""), "chatgpt");
      if (login.method !== recipe.login.method) throw new ConnectorBlockedError("login_method_recipe_mismatch");
      return { recipe, connectionId: String(row.id), secretRef: typeof row.secret_ref === "string" ? row.secret_ref : null };
    },
    async resolveSecret(ref, scope) { return createSecretStoreFromEnvironment(options.environment ?? process.env).resolveSecret(ref, scope); },
    async material() { throw new ConnectorBlockedError("source_cannot_publish"); },
    async priorReceipt() { return null; },
  });
}
