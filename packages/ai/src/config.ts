import {AiNotConfiguredError} from './types';
import type {AiPricing} from './limits';
export interface DeepSeekRuntimeConfig {
  protocol: 'chat_completions' | 'messages'; base_url: string; models_url: string; secret_ref: string;
  models: {insight: string; content: string}; response_format: 'json_object' | 'json_schema' | 'none';
  timeout_ms: number; retry_429: number; verify_models: boolean;
  limits: {max_input_tokens: number; max_output_tokens: number; max_calls_per_day: number; max_calls_per_minute: number; max_cost_micro_per_day: number | null};
  pricing: {insight?: AiPricing; content?: AiPricing};
}
export interface AiReadiness {
  mode: 'mock' | 'real'; state: 'configured' | 'not_configured' | 'invalid'; configured: boolean;
  provider: 'deepseek'; protocol: 'chat_completions' | 'messages'; requested_models: {insight: string; content: string};
  missing: string[]; credential_configured: boolean; pricing_configured: boolean;
  checks: {models_verified: false; real_call_verified: false};
  limits: DeepSeekRuntimeConfig['limits'];
}
function positive(env: NodeJS.ProcessEnv, key: string, fallback: number): number {
  const raw = env[key]; const value = raw === undefined || raw.trim() === '' ? fallback : Number(raw);
  if (!Number.isSafeInteger(value) || value <= 0) throw new AiNotConfiguredError(`模型配置 ${key} 必须为正整数`);
  return value;
}
function safeUrl(raw: string, env: NodeJS.ProcessEnv): URL {
  let url: URL;
  try {url = new URL(raw);} catch {throw new AiNotConfiguredError('模型服务地址无效');}
  const allowed = new Set(['api.deepseek.com', ...(env.DEEPSEEK_ALLOWED_HOSTS ?? '').split(',').map(host => host.trim().toLowerCase()).filter(Boolean)]);
  const localTest = env.APP_ENV === 'test' && ['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname);
  if (url.username || url.password || url.search || url.hash || (!localTest && (url.protocol !== 'https:' || !allowed.has(url.hostname.toLowerCase()))) || localTest && !['http:', 'https:'].includes(url.protocol)) throw new AiNotConfiguredError('模型服务地址必须为已允许的HTTPS服务且不得包含凭据');
  return url;
}
function pricing(value: unknown, expectedModel: string): AiPricing {
  if (!value || typeof value !== 'object') throw new AiNotConfiguredError('模型计价配置不完整');
  const row = value as Record<string, unknown>;
  if (row['model'] !== expectedModel) throw new AiNotConfiguredError('模型计价版本未绑定当前请求模型ID；更换模型须重新配置对应费率');
  if (Object.keys(row).some(key => !['model', 'aliases', 'input_micro_per_million_tokens', 'output_micro_per_million_tokens', 'currency', 'version'].includes(key)) || row['aliases'] !== undefined && (!Array.isArray(row['aliases']) || row['aliases'].length > 20 || row['aliases'].some(alias => typeof alias !== 'string' || !/^[a-zA-Z0-9._:/-]{1,120}$/.test(alias)) || new Set(row['aliases']).size !== row['aliases'].length)) throw new AiNotConfiguredError('模型计价字段或等价模型ID配置无效');
  if (!Number.isSafeInteger(row['input_micro_per_million_tokens']) || Number(row['input_micro_per_million_tokens']) < 0 || !Number.isSafeInteger(row['output_micro_per_million_tokens']) || Number(row['output_micro_per_million_tokens']) < 0 || !/^[A-Z]{3}$/.test(String(row['currency'])) || typeof row['version'] !== 'string' || !row['version'].trim() || row['version'].length > 200 || /[\u0000-\u001f\u007f]/.test(row['version'])) throw new AiNotConfiguredError('模型计价须有明确币种、有效版本和非负整数费率');
  return {input_micro_per_million_tokens: Number(row['input_micro_per_million_tokens']), output_micro_per_million_tokens: Number(row['output_micro_per_million_tokens']), currency: String(row['currency']), version: String(row['version']), model: expectedModel, ...(row['aliases'] === undefined ? {} : {aliases: row['aliases'] as string[]})};
}
export function readDeepSeekConfig(env: NodeJS.ProcessEnv = process.env): DeepSeekRuntimeConfig {
  const secret_ref = env.DEEPSEEK_API_KEY_SECRET_REF?.trim();
  if (!secret_ref) throw new AiNotConfiguredError('DEEPSEEK_API_KEY_SECRET_REF 尚未配置；API密钥须留在服务端秘密存储');
  const protocol = env.DEEPSEEK_PROTOCOL ?? 'chat_completions';
  if (protocol !== 'chat_completions' && protocol !== 'messages') throw new AiNotConfiguredError('DEEPSEEK_PROTOCOL 配置无效');
  const response_format = env.DEEPSEEK_RESPONSE_FORMAT ?? 'json_object';
  if (!['json_object', 'json_schema', 'none'].includes(response_format)) throw new AiNotConfiguredError('DEEPSEEK_RESPONSE_FORMAT 配置无效');
  if (protocol === 'messages' && response_format !== 'none') throw new AiNotConfiguredError('Messages协议须显式配置DEEPSEEK_RESPONSE_FORMAT=none；JSON能力仍由本地Schema验证');
  const base = safeUrl(env.DEEPSEEK_BASE_URL ?? 'https://api.deepseek.com', env);
  const base_url = base.toString().replace(/\/$/, '');
  const models_url = safeUrl(env.DEEPSEEK_MODELS_URL ?? `${base_url}/models`, env).toString();
  const models = {insight: env.DEEPSEEK_INSIGHT_MODEL?.trim() || 'deepseek-v4-pro', content: env.DEEPSEEK_CONTENT_MODEL?.trim() || 'deepseek-flash'};
  if (Object.values(models).some(model => !/^[a-zA-Z0-9._:/-]{1,120}$/.test(model))) throw new AiNotConfiguredError('模型ID配置无效');
  const max_cost_micro_per_day = env.AI_MAX_COST_MICRO_PER_DAY?.trim() ? positive(env, 'AI_MAX_COST_MICRO_PER_DAY', 1) : null;
  const rates: DeepSeekRuntimeConfig['pricing'] = {};
  if (env.DEEPSEEK_PRICING_JSON?.trim()) {
    let parsed: Record<string, unknown>;
    try {parsed = JSON.parse(env.DEEPSEEK_PRICING_JSON) as Record<string, unknown>;} catch {throw new AiNotConfiguredError('DEEPSEEK_PRICING_JSON 不是有效JSON');}
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed) || Object.keys(parsed).some(key => !['insight', 'content'].includes(key))) throw new AiNotConfiguredError('DEEPSEEK_PRICING_JSON 只能包含insight/content计价对象');
    if (parsed['insight']) rates.insight = pricing(parsed['insight'], models.insight);
    if (parsed['content']) rates.content = pricing(parsed['content'], models.content);
  }
  if (max_cost_micro_per_day !== null && (!rates.insight || !rates.content)) throw new AiNotConfiguredError('费用硬上限要求两个路由的当前计价依据；未知价格不能承诺费用上限');
  if (rates.insight && rates.content && rates.insight.currency !== rates.content.currency) throw new AiNotConfiguredError('两个模型的配额计价币种必须一致');
  const retry_429 = Number(env.DEEPSEEK_RETRY_429 ?? '1');
  if (!Number.isInteger(retry_429) || retry_429 < 0 || retry_429 > 2) throw new AiNotConfiguredError('DEEPSEEK_RETRY_429 必须为0到2');
  return {protocol, base_url, models_url, secret_ref, models, response_format: response_format as DeepSeekRuntimeConfig['response_format'],
    timeout_ms: positive(env, 'DEEPSEEK_TIMEOUT_MS', 60_000), retry_429, verify_models: env.DEEPSEEK_VERIFY_MODELS !== 'false',
    limits: {max_input_tokens: positive(env, 'AI_MAX_INPUT_TOKENS', 65_536), max_output_tokens: positive(env, 'AI_MAX_OUTPUT_TOKENS', 8192), max_calls_per_day: positive(env, 'AI_MAX_CALLS_PER_DAY', 100), max_calls_per_minute: positive(env, 'AI_MAX_CALLS_PER_MINUTE', 10), max_cost_micro_per_day}, pricing: rates};
}
export function getAiReadiness(options: {env?: NodeJS.ProcessEnv} = {}): AiReadiness {
  const env = options.env ?? process.env;
  const mode = env.AI_MODE === 'mock' ? 'mock' : 'real';
  const base: AiReadiness = {mode, state: 'not_configured', configured: false, provider: 'deepseek', protocol: env.DEEPSEEK_PROTOCOL === 'messages' ? 'messages' : 'chat_completions', requested_models: {insight: env.DEEPSEEK_INSIGHT_MODEL?.trim() || 'deepseek-v4-pro', content: env.DEEPSEEK_CONTENT_MODEL?.trim() || 'deepseek-flash'}, missing: [], credential_configured: Boolean(env.DEEPSEEK_API_KEY_SECRET_REF?.trim()), pricing_configured: false, checks: {models_verified: false, real_call_verified: false}, limits: {max_input_tokens: 65_536, max_output_tokens: 8192, max_calls_per_day: 100, max_calls_per_minute: 10, max_cost_micro_per_day: null}};
  try {
    const config = readDeepSeekConfig(env);
    return {...base, state: 'configured', configured: true, protocol: config.protocol, requested_models: config.models, limits: config.limits, pricing_configured: Boolean(config.pricing.insight && config.pricing.content)};
  } catch (error) {
    return {...base, state: base.credential_configured ? 'invalid' : 'not_configured', missing: [error instanceof AiNotConfiguredError ? error.message : '模型配置无效']};
  }
}
