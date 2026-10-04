import {aiInputHash, createRuntimeAiGateway, getAiReadiness, readDeepSeekConfig, UnconfiguredAiGateway, type AiGateway, type AiReadiness, type RuntimeAiOptions} from '@boran/ai';
import {createRuntimeSourceReaders, type RuntimeSourceConfig, type SourceCredential} from '@boran/connectors/source-runtime';
import {createSecretStoreFromEnvironment, type SecretPayload} from '@boran/connectors/secrets';
import {createSourceReaders, MockSourceReader, type SourceTransport} from '@boran/connectors/sources';
import {DomainError, stableHash, type ServiceContext} from '@boran/domain/core';
import {DatabaseAiLimitLedger} from './ai-usage';
import {createBrowserSourceTransport} from './browser-source-client';

type Row = Record<string, unknown>;
export interface ModelConfiguration {
  connection_id: string | null; base_url: string; protocol: 'chat_completions' | 'messages';
  insight_model: string; content_model: string; response_format: 'json_object' | 'json_schema' | 'none';
  max_calls_per_day: number; max_calls_per_minute: number; max_input_tokens: number; max_output_tokens: number;
}
export interface ModelVerification {models_verified: boolean; verified_at: string | null; missing_models: string[]}
export interface RuntimeModelDto {schema_version: number; configuration: ModelConfiguration; readiness: AiReadiness; verification: ModelVerification}
export interface AutomationRuntimeOptions {
  env?: NodeJS.ProcessEnv; fetch?: typeof fetch;
  resolveSecret?: (reference: string, scope: {orgId: string; connectionId: string}) => Promise<SecretPayload | string>;
  chatgptTransport?: SourceTransport; workflowRunId?: string;
}
export const defaultModelConfiguration: ModelConfiguration = {connection_id: null, base_url: 'https://api.deepseek.com', protocol: 'chat_completions', insight_model: 'deepseek-v4-pro', content_model: 'deepseek-flash', response_format: 'json_object', max_calls_per_day: 100, max_calls_per_minute: 10, max_input_tokens: 65536, max_output_tokens: 8192};
const configuredFields = Object.keys(defaultModelConfiguration);
function row(value: unknown): Row {return value && typeof value === 'object' && !Array.isArray(value) ? value as Row : {};}
function iso(value: unknown): string | null {if (value instanceof Date) return value.toISOString(); return typeof value === 'string' && Number.isFinite(Date.parse(value)) ? new Date(value).toISOString() : null;}
/** The product's DeepSeek configuration only accepts the official HTTPS origin; model input cannot set hosts. */
export function validateModelConfiguration(value: unknown): ModelConfiguration {
  const input = row(value);
  if (Object.keys(input).length !== configuredFields.length || Object.keys(input).some(key => !configuredFields.includes(key))) throw new DomainError('INVALID_MODEL_CONFIGURATION', 422, '模型配置字段不完整或包含未允许字段');
  if (typeof input.connection_id !== 'string' || !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(input.connection_id)) throw new DomainError('INVALID_MODEL_CONNECTION', 422, '请选择组织内DeepSeek模型连接');
  let url: URL;
  try {url = new URL(String(input.base_url));} catch {throw new DomainError('INVALID_MODEL_ENDPOINT', 422, '模型服务地址无效');}
  if (url.protocol !== 'https:' || url.hostname !== 'api.deepseek.com' || url.port || url.username || url.password || url.search || url.hash || !['', '/', '/v1', '/v1/', '/anthropic', '/anthropic/'].includes(url.pathname)) throw new DomainError('INVALID_MODEL_ENDPOINT', 422, 'DeepSeek须使用官方HTTPS API地址，不能配置任意主机或代理');
  const config = {...input, base_url: url.toString().replace(/\/$/, '')} as unknown as ModelConfiguration;
  for (const [key, max] of [['max_calls_per_day', 100000], ['max_calls_per_minute', 1000], ['max_input_tokens', 1000000], ['max_output_tokens', 256000]] as const) if (!Number.isSafeInteger(config[key]) || config[key] < 1 || config[key] > max) throw new DomainError('INVALID_MODEL_LIMIT', 422, '模型调用和token限额必须为允许范围内的正整数');
  if (config.protocol === 'chat_completions' && url.pathname.startsWith('/anthropic') || config.protocol === 'messages' && !url.pathname.startsWith('/anthropic')) throw new DomainError('INVALID_MODEL_PROTOCOL', 422, 'Chat Completions使用根API或/v1；Messages使用/anthropic地址');
  try {readDeepSeekConfig(modelConfigurationEnv(config, 'validation-only', {} as NodeJS.ProcessEnv));} catch {throw new DomainError('INVALID_MODEL_CONFIGURATION', 422, '模型协议、模型ID或JSON配置无效；Messages须使用本地Schema校验');}
  return config;
}
export function modelConfigurationEnv(config: ModelConfiguration, secretRef: string | null, sourceEnv: NodeJS.ProcessEnv = process.env): NodeJS.ProcessEnv {
  // Only server-owned pricing/network/timeouts survive; every org-controlled route is overwritten by its current DB configuration.
  return {...sourceEnv, AI_MODE: 'real', DEEPSEEK_BASE_URL: config.base_url, DEEPSEEK_PROTOCOL: config.protocol, DEEPSEEK_INSIGHT_MODEL: config.insight_model, DEEPSEEK_CONTENT_MODEL: config.content_model, DEEPSEEK_RESPONSE_FORMAT: config.response_format, AI_MAX_CALLS_PER_DAY: String(config.max_calls_per_day), AI_MAX_CALLS_PER_MINUTE: String(config.max_calls_per_minute), AI_MAX_INPUT_TOKENS: String(config.max_input_tokens), AI_MAX_OUTPUT_TOKENS: String(config.max_output_tokens), DEEPSEEK_API_KEY_SECRET_REF: secretRef ?? '', DEEPSEEK_MODELS_URL: 'https://api.deepseek.com/models'};
}
function secretResolver(env: NodeJS.ProcessEnv, custom?: AutomationRuntimeOptions['resolveSecret']): NonNullable<AutomationRuntimeOptions['resolveSecret']> {
  if (custom) return custom;
  return async (reference, scope) => {
    if (reference.startsWith('env:')) {
      const name = reference.slice(4);
      const allowed = new Set((env.BORAN_ALLOWED_SECRET_ENV_KEYS ?? '').split(',').map(key => key.trim()).filter(Boolean));
      if (!/^[A-Z][A-Z0-9_]{2,99}$/.test(name) || !allowed.has(name) || !env[name]) throw new DomainError('SECRET_ENV_REFERENCE_BLOCKED', 503, '本地凭据环境变量引用未允许或未配置');
      return env[name]!;
    }
    return createSecretStoreFromEnvironment(env).resolveSecret(reference, scope);
  };
}
export function modelConfigurationFingerprint(config: ModelConfiguration, connection: Row, credentialRevision: string | null = null): string {
  return stableHash({configuration: config, connection_id: connection.id ?? null, provider: connection.provider ?? null, read_mode: connection.read_mode ?? null, secret_ref: connection.secret_ref ?? null, credential_revision: credentialRevision});
}
export interface RuntimeModelState {dto: RuntimeModelDto; env: NodeJS.ProcessEnv; connection: Row | null; fingerprint: string | null; resolveSecret: NonNullable<AutomationRuntimeOptions['resolveSecret']>}
/** Local/DB inspection only. A configured connection is not evidence of a provider generation. */
export async function loadRuntimeModelState(ctx: ServiceContext, options: AutomationRuntimeOptions = {}): Promise<RuntimeModelState> {
  const sourceEnv = options.env ?? process.env;
  const setting = (await ctx.db.query("SELECT schema_version,value FROM settings WHERE org_id=$1 AND key='ai_configuration'", [ctx.orgId])).rows[0];
  const stored = row(setting?.value); let config = {...defaultModelConfiguration}; let invalid = false;
  if (setting) {
    try {config = validateModelConfiguration(stored.configuration);} catch {invalid = true;}
  }
  const connection = config.connection_id ? (await ctx.db.query('SELECT id,provider,read_mode,secret_ref,access_status,capabilities FROM connections WHERE org_id=$1 AND id=$2', [ctx.orgId, config.connection_id])).rows[0] ?? null : null;
  const secretRef = typeof connection?.secret_ref === 'string' ? connection.secret_ref : null;
  const env = modelConfigurationEnv(config, secretRef, sourceEnv);
  const resolveSecret = secretResolver(sourceEnv, options.resolveSecret);
  let readiness = getAiReadiness({env});
  const missing = [...readiness.missing];
  if (!setting) missing.push('尚未保存组织模型配置');
  if (invalid) missing.push('组织模型配置无效，请重新保存');
  if (ctx.mode !== 'live') missing.push('模拟身份不能连接真实模型服务');
  if (!connection || connection.provider !== 'deepseek' || connection.read_mode !== 'native_api' || connection.access_status === 'disabled') missing.push('组织内真实DeepSeek连接无效或已停用');
  let credentialRevision: string | null = null;
  if (ctx.mode === 'live' && secretRef && connection && connection.provider === 'deepseek' && connection.read_mode === 'native_api') {
    try {
      const credential = await resolveSecret(secretRef, {orgId: ctx.orgId, connectionId: String(connection.id)});
      if (typeof credential !== 'string' && credential.kind !== 'api_key' || typeof credential === 'string' && !credential.trim()) missing.push('DeepSeek连接需要API密钥类型的可用凭据');
      else credentialRevision = aiInputHash({api_key_revision: typeof credential === 'string' ? credential : credential.kind === 'api_key' ? credential.apiKey : ''});
    } catch {missing.push('组织模型凭据不可读取，检查加密存储或本地引用允许列表');}
  }
  const configured = readiness.configured && missing.length === 0;
  readiness = {...readiness, mode: ctx.mode === 'mock' ? 'mock' : 'real', configured, state: configured ? 'configured' : invalid ? 'invalid' : 'not_configured', missing: [...new Set(missing)]};
  const fingerprint = connection ? modelConfigurationFingerprint(config, connection, credentialRevision) : null;
  const verification = row(stored.verification);
  const valid = configured && fingerprint !== null && verification.configuration_fingerprint === fingerprint && verification.models_verified === true && iso(verification.verified_at) !== null;
  const models: ModelVerification = {models_verified: valid, verified_at: valid ? iso(verification.verified_at) : null, missing_models: valid ? [] : Array.isArray(verification.missing_models) && verification.configuration_fingerprint === fingerprint ? verification.missing_models.filter((id): id is string => typeof id === 'string' && /^[a-zA-Z0-9._:/-]{1,120}$/.test(id)) : []};
  return {dto: {schema_version: Number(setting?.schema_version ?? 0), configuration: config, readiness, verification: models}, env, connection, fingerprint, resolveSecret};
}
export async function getRuntimeModelConfiguration(ctx: ServiceContext, options: AutomationRuntimeOptions = {}): Promise<RuntimeModelDto> {return (await loadRuntimeModelState(ctx, options)).dto;}
export async function createConfiguredAiGateway(ctx: ServiceContext, options: AutomationRuntimeOptions = {}): Promise<AiGateway> {
  if (ctx.mode === 'mock') return createRuntimeAiGateway({env: {...process.env, AI_MODE: 'mock'}});
  const state = await loadRuntimeModelState(ctx, options);
  if (!state.dto.readiness.configured || !state.connection || !state.fingerprint) return new UnconfiguredAiGateway(state.dto.readiness.missing.join('；'));
  const connectionId = String(state.connection.id); const expected = state.fingerprint;
  const runtime: RuntimeAiOptions = {env: state.env, limitLedger: new DatabaseAiLimitLedger(ctx.db, ctx.orgId), ...(options.fetch ? {fetch: options.fetch} : {}), resolveSecret: async (reference, scope) => {
    if (scope.orgId !== ctx.orgId) throw new DomainError('MODEL_SCOPE_MISMATCH', 403, '模型调用组织与配置不匹配');
    const current = await loadRuntimeModelState(ctx, options);
    if (!current.dto.readiness.configured || !current.connection || current.connection.secret_ref !== reference || current.fingerprint !== expected) throw new DomainError('MODEL_CONFIGURATION_CHANGED', 409, '模型配置或密钥已变化，旧任务不可继续调用');
    const credential = await state.resolveSecret(reference, {orgId: ctx.orgId, connectionId});
    if (typeof credential === 'string') return credential;
    if (credential.kind !== 'api_key') throw new DomainError('MODEL_CREDENTIAL_KIND_INVALID', 503, '模型连接不是API密钥凭据');
    return credential.apiKey;
  }};
  return createRuntimeAiGateway(runtime);
}
export async function createConfiguredSourceReaders(ctx: ServiceContext, options: AutomationRuntimeOptions = {}): Promise<ReturnType<typeof createSourceReaders>> {
  if (ctx.mode === 'mock') {
    const reader = (kind: MockSourceReader['kind']) => new MockSourceReader(kind, {status: 'failed', mode: 'mock', snapshots: [], errorCode: 'NOT_CONFIGURED', gaps: ['模拟来源尚无工程测试输入，不生成来源正文']});
    return {market_public: reader('market_public'), competitor_public: reader('competitor_public'), mac_drive: reader('mac_drive'), chatgpt: reader('chatgpt')};
  }
  const env = options.env ?? process.env; const root = env.BORAN_SOURCE_ROOT ?? env.SOURCE_OBJECT_ROOT;
  if (!root || !root.startsWith('/')) return createSourceReaders();
  const resolve = secretResolver(env, options.resolveSecret);
  const chatgptTransport = options.chatgptTransport ?? (options.workflowRunId ? createBrowserSourceTransport({workflowRunId: options.workflowRunId, sourceRoot: root, env, ...(options.fetch ? {fetch: options.fetch} : {})}) : undefined);
  const config: RuntimeSourceConfig = {sourceRoot: root, ...(options.fetch ? {fetch: options.fetch} : {}), ...(chatgptTransport ? {chatgptTransport} : {}), resolveSecret: async (reference, scope): Promise<SourceCredential | null> => {
    if (scope.orgId !== ctx.orgId) throw new DomainError('SOURCE_SCOPE_MISMATCH', 403, '来源组织范围不匹配');
    const connection = (await ctx.db.query('SELECT secret_ref,read_mode,access_status FROM connections WHERE org_id=$1 AND id=$2', [ctx.orgId, scope.connectionId])).rows[0];
    if (!connection || connection.read_mode === 'mock' || connection.access_status === 'disabled' || connection.secret_ref !== reference) throw new DomainError('SOURCE_CONFIGURATION_CHANGED', 409, '来源凭据或授权范围已变化');
    const credential = await resolve(reference, scope);
    return typeof credential === 'string' ? credential : credential.kind === 'drive_oauth' ? credential : null;
  }};
  return createRuntimeSourceReaders(config);
}
