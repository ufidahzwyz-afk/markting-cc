import {DeepSeekAiGateway, AiProviderError} from '@boran/ai';
import {requireActiveRole, requireOwner} from '@boran/domain/authz';
import {audit, DomainError, stableHash, type ServiceContext} from '@boran/domain/core';
import {getRuntimeModelConfiguration, loadRuntimeModelState, validateModelConfiguration, type AutomationRuntimeOptions} from '@boran/worker/automation-runtime';
import {databaseCommand, jsonData, transactionContext} from '../http';

type Row = Record<string, unknown>;
function object(value: unknown): Row {return value && typeof value === 'object' && !Array.isArray(value) ? value as Row : {};}
function configurationVersion(request: Request): number {
  const raw = request.headers.get('if-match')?.replace(/^W\//, '').replaceAll('"', ''); const version = Number(raw);
  if (raw === undefined || raw === '' || !Number.isSafeInteger(version) || version < 0) throw new DomainError('VERSION_REQUIRED', 428, '模型配置修改需要If-Match schema_version，首次为0');
  return version;
}
/** Dedicated org configuration: credentials stay on the connection and never enter settings or this DTO. */
export async function handleModel(ctx: ServiceContext, request: Request, segments: string[], body: Row = {}, options: AutomationRuntimeOptions = {}): Promise<Response | null> {
  if (segments[0] !== 'automation' || segments[1] !== 'model' || ![2, 3].includes(segments.length) || segments.length === 3 && segments[2] !== 'verify') return null;
  await requireActiveRole(ctx, ctx.db, 'owner', 'admin', 'marketer', 'reviewer');
  if (segments.length === 2 && request.method === 'GET') return jsonData(await getRuntimeModelConfiguration(ctx, options));
  if (segments.length === 2 && request.method === 'PUT') {
    if (ctx.mode !== 'live') throw new DomainError('LIVE_IDENTITY_REQUIRED', 403, '真实模型配置需要本地实名登录');
    await requireOwner(ctx);
    const config = validateModelConfiguration(body); const expected = configurationVersion(request);
    return databaseCommand(ctx, request, config, 200, async current => {
      await requireOwner(current);
      await current.db.query('SELECT id FROM organizations WHERE id=$1 FOR UPDATE', [current.orgId]);
      const previous = (await current.db.query("SELECT schema_version FROM settings WHERE org_id=$1 AND key='ai_configuration' FOR UPDATE", [current.orgId])).rows[0];
      const actual = Number(previous?.schema_version ?? 0);
      if (actual !== expected) throw new DomainError('VERSION_CONFLICT', 409, '模型配置已变化，请刷新后重试', {actual, expected});
      const connection = (await current.db.query('SELECT id,provider,read_mode,access_status FROM connections WHERE org_id=$1 AND id=$2 FOR UPDATE', [current.orgId, config.connection_id])).rows[0];
      if (!connection || connection.provider !== 'deepseek' || connection.read_mode !== 'native_api' || connection.access_status === 'disabled') throw new DomainError('INVALID_MODEL_CONNECTION', 422, '模型必须绑定本组织的真实DeepSeek API连接');
      const value = {configuration: config, verification: {models_verified: false, verified_at: null, missing_models: []}};
      await current.db.query("INSERT INTO settings(org_id,key,value,schema_version,updated_by) VALUES($1,'ai_configuration',$2,1,$3) ON CONFLICT(org_id,key) DO UPDATE SET value=EXCLUDED.value,schema_version=settings.schema_version+1,updated_by=EXCLUDED.updated_by,updated_at=clock_timestamp()", [current.orgId, JSON.stringify(value), current.actorId]);
      await current.db.query("UPDATE connections SET capabilities_verified_at=NULL,capabilities=capabilities-'model_catalog',access_status='not_configured',updated_at=clock_timestamp() WHERE org_id=$1 AND id=$2", [current.orgId, config.connection_id]);
      await audit(current, current.db, 'model.configuration.saved', 'connection', String(config.connection_id), {schema_version: actual + 1, protocol: config.protocol, insight_model: config.insight_model, content_model: config.content_model, configuration_hash: stableHash(config), model_catalog_verified: false});
      return getRuntimeModelConfiguration(current, options);
    });
  }
  if (segments.length === 3 && request.method === 'POST') {
    if (ctx.mode !== 'live') throw new DomainError('LIVE_IDENTITY_REQUIRED', 403, '真实模型核验需要本地实名登录');
    await requireOwner(ctx);
    if (Object.keys(body).length) throw new DomainError('INVALID_REQUEST', 422, '可用模型核验不接受凭据或模型覆盖字段');
    const initial = await loadRuntimeModelState(ctx, options);
    if (!initial.dto.readiness.configured || !initial.connection || !initial.fingerprint) throw new DomainError('AI_NOT_CONFIGURED', 503, '组织模型配置或凭据未完成', {missing: initial.dto.readiness.missing});
    const connectionId = String(initial.connection.id); let verified = false; let missing: string[] = []; let verifiedAt: string | null = null;
    let failure: string | null = null;
    try {
      const gateway = new DeepSeekAiGateway({env: initial.env, ...(options.fetch ? {fetch: options.fetch} : {}), resolveSecret: async (reference, scope) => {
        if (scope.orgId !== ctx.orgId || reference !== initial.connection!.secret_ref) throw new Error('MODEL_SCOPE_MISMATCH');
        const credential = await initial.resolveSecret(reference, {orgId: ctx.orgId, connectionId});
        if (typeof credential === 'string') return credential;
        if (credential.kind !== 'api_key') throw new Error('MODEL_CREDENTIAL_KIND_INVALID');
        return credential.apiKey;
      }});
      const catalog = await gateway.verifyModels(ctx.orgId); verified = true; verifiedAt = catalog.verified_at;
    } catch (error) {
      failure = error instanceof AiProviderError ? error.code : 'AI_MODEL_CATALOG_UNAVAILABLE';
      if (error instanceof AiProviderError && error.code === 'AI_MODEL_UNAVAILABLE') {
        const available = Array.isArray(error.details.available_models) ? error.details.available_models : [];
        missing = [initial.dto.configuration.insight_model, initial.dto.configuration.content_model].filter(model => !available.includes(model));
      }
    }
    const result = await ctx.db.transaction(async tx => {
      const currentCtx = transactionContext(ctx, tx); await requireOwner(currentCtx);
      await tx.query("SELECT schema_version FROM settings WHERE org_id=$1 AND key='ai_configuration' FOR UPDATE", [ctx.orgId]);
      const current = await loadRuntimeModelState(currentCtx, options);
      if (!current.dto.readiness.configured || current.fingerprint !== initial.fingerprint || current.dto.schema_version !== initial.dto.schema_version) throw new DomainError('MODEL_CONFIGURATION_CHANGED', 409, '配置或密钥在核验期间变化，请对当前版本重试');
      const stored = object((await tx.query("SELECT value FROM settings WHERE org_id=$1 AND key='ai_configuration'", [ctx.orgId])).rows[0]?.value);
      const verification = {models_verified: verified, verified_at: verifiedAt, missing_models: missing, configuration_fingerprint: initial.fingerprint};
      await tx.query("UPDATE settings SET value=$2,updated_at=clock_timestamp() WHERE org_id=$1 AND key='ai_configuration'", [ctx.orgId, JSON.stringify({...stored, verification})]);
      await tx.query("UPDATE connections SET capabilities=capabilities||$3::jsonb,capabilities_verified_at=CASE WHEN $4 THEN clock_timestamp() ELSE NULL END,access_status=CASE WHEN $4 THEN 'connected' ELSE 'not_configured' END,health=CASE WHEN $4 THEN 'healthy' ELSE 'unknown' END,last_attempt_at=clock_timestamp(),last_error_code=$5,updated_at=clock_timestamp() WHERE org_id=$1 AND id=$2", [ctx.orgId, connectionId, JSON.stringify({model_catalog: {models_verified: verified, actual_generation_verified: false}}), verified, failure]);
      await audit(currentCtx, tx, 'model.catalog.checked', 'connection', connectionId, {models_verified: verified, missing_models: missing, actual_generation_verified: false, error_code: failure});
      return {models_verified: verified, verified_at: verifiedAt, missing_models: missing, actual_generation_verified: false, ...(failure ? {error_code: failure} : {})};
    });
    return jsonData(result);
  }
  return null;
}
