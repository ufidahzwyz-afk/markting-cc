import {aiOutputHash, validateAiOutput, validateAiOutputStructure, ContractValidationError} from '@boran/contracts';
import {buildAiMessages, workflowOutputSchema, AI_PROMPT_VERSION} from './prompts';
import {assertSafeAiValue, aiInputHash} from './privacy';
import {sourceMaterials, validateRuntimeEvidenceInput, validateRuntimeEvidenceOutput} from './evidence';
import {aiQuotaKeys, AI_QUOTA_TIMEZONE, calculateAiCost, ProcessAiLimitLedger, type AiLimitLedger, type AiLimitReceipt, type AiPricing} from './limits';
import {readDeepSeekConfig, type DeepSeekRuntimeConfig} from './config';
import {AiNotConfiguredError, AiProviderError, type AiRequest, type AiGateway, type AiGatewayResult, type AiAttemptMetadata, type AiUsage} from './types';
type Row = Record<string, unknown>;
const emptyUsage = (): AiUsage => ({input_tokens: null, output_tokens: null, total_tokens: null, cache_hit_tokens: null});
const sharedProcessLedger = new ProcessAiLimitLedger();
export interface RuntimeAiOptions {
  env?: NodeJS.ProcessEnv;
  resolveSecret?: (reference: string, context: {orgId: string}) => Promise<string> | string;
  fetch?: typeof globalThis.fetch;
  limitLedger?: AiLimitLedger;
  now?: () => number;
  sleep?: (milliseconds: number) => Promise<void>;
}
function object(value: unknown): Row {return value && typeof value === 'object' && !Array.isArray(value) ? value as Row : {};}
function token(value: unknown): number | null {return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 ? value : null;}
function readUsage(row: Row, protocol: DeepSeekRuntimeConfig['protocol']): AiUsage {
  const usage = object(row['usage']);
  const input = token(usage[protocol === 'messages' ? 'input_tokens' : 'prompt_tokens']);
  const output = token(usage[protocol === 'messages' ? 'output_tokens' : 'completion_tokens']);
  return {input_tokens: input, output_tokens: output, total_tokens: token(usage['total_tokens']) ?? (input !== null && output !== null ? input + output : null), cache_hit_tokens: token(usage['prompt_cache_hit_tokens'])};
}
async function boundedText(response: Response): Promise<string> {
  if (!response.body) return '';
  const reader = response.body.getReader(); const chunks: Uint8Array[] = []; let size = 0;
  try {
    while (true) {
      const chunk = await reader.read(); if (chunk.done) break;
      size += chunk.value.byteLength;
      if (size > 1_048_576) {await reader.cancel(); throw new AiProviderError('AI_RESPONSE_TOO_LARGE', '模型响应超过安全大小限制');}
      chunks.push(chunk.value);
    }
  } finally {reader.releaseLock();}
  return Buffer.concat(chunks).toString('utf8');
}
function safeId(value: unknown): string | null {return typeof value === 'string' && /^[a-zA-Z0-9._:/-]{1,200}$/.test(value) ? value : null;}
export class DeepSeekAiGateway implements AiGateway {
  readonly mode = 'real' as const;
  private readonly config: DeepSeekRuntimeConfig;
  private readonly send: typeof globalThis.fetch;
  private readonly ledger: AiLimitLedger;
  private readonly now: () => number;
  private readonly sleep: (milliseconds: number) => Promise<void>;
  private readonly catalogs = new Map<string, {at: number; models: string[]}>();
  constructor(private readonly options: RuntimeAiOptions = {}) {
    this.config = readDeepSeekConfig(options.env);
    if (!options.resolveSecret) throw new AiNotConfiguredError('服务端秘密解析器尚未配置；密钥不会从模型输入读取');
    if (this.config.protocol === 'messages' && this.config.response_format !== 'none') throw new AiNotConfiguredError('Messages协议须显式配置DEEPSEEK_RESPONSE_FORMAT=none；JSON能力仍由本地Schema验证');
    this.send = options.fetch ?? globalThis.fetch;
    this.ledger = options.limitLedger ?? sharedProcessLedger;
    this.now = options.now ?? Date.now;
    this.sleep = options.sleep ?? (milliseconds => new Promise(resolve => setTimeout(resolve, milliseconds)));
  }
  private async key(orgId: string): Promise<string> {
    let key: string;
    try {key = await this.options.resolveSecret!(this.config.secret_ref, {orgId});} catch {throw new AiNotConfiguredError('模型秘密引用无法读取；检查服务端凭据配置');}
    if (typeof key !== 'string' || !key.trim() || /[\r\n]/.test(key)) throw new AiNotConfiguredError('模型秘密引用没有有效API密钥');
    return key;
  }
  private headers(key: string): Record<string, string> {
    return this.config.protocol === 'messages' ? {'content-type': 'application/json', 'x-api-key': key, 'anthropic-version': '2023-06-01'} : {'content-type': 'application/json', authorization: `Bearer ${key}`};
  }
  /** A catalog check is not a successful generation, JSON-capability check or billing verification. */
  async verifyModels(orgId: string): Promise<{models: string[]; requested_models: {insight: string; content: string}; verified_at: string}> {
    const cached = this.catalogs.get(orgId);
    if (cached && this.now() - cached.at < 300_000) return {models: [...cached.models], requested_models: {...this.config.models}, verified_at: new Date(cached.at).toISOString()};
    const key = await this.key(orgId);
    let response: Response;
    try {response = await this.send(this.config.models_url, {method: 'GET', headers: this.headers(key), signal: AbortSignal.timeout(this.config.timeout_ms), redirect: 'error'});} catch {throw new AiProviderError('AI_MODEL_CATALOG_UNAVAILABLE', '模型目录读取失败；未进行生成调用');}
    if (!response.ok) throw new AiProviderError('AI_MODEL_CATALOG_REJECTED', '模型目录核验被服务拒绝；检查授权和接口协议', {http_status: response.status});
    let row: Row;
    try {row = object(JSON.parse(await boundedText(response)));} catch {throw new AiProviderError('AI_MODEL_CATALOG_INVALID', '模型目录返回格式无效');}
    const models = Array.isArray(row['data']) ? row['data'].map(entry => safeId(object(entry)['id'])).filter((id): id is string => Boolean(id)) : [];
    if (!models.length) throw new AiProviderError('AI_MODEL_CATALOG_INVALID', '模型目录未返回任何有效模型ID');
    if (Object.values(this.config.models).some(model => !models.includes(model))) throw new AiProviderError('AI_MODEL_UNAVAILABLE', '账号模型目录未包含所配置的Pro或Flash ID；请按账号实际可用ID配置', {requested_models: this.config.models, available_models: models});
    const at = this.now(); this.catalogs.set(orgId, {at, models});
    return {models, requested_models: {...this.config.models}, verified_at: new Date(at).toISOString()};
  }
  private async call(request: AiRequest, messages: ReturnType<typeof buildAiMessages>, attempts: AiAttemptMetadata[]): Promise<{text: string; attempt: AiAttemptMetadata; receipt: AiLimitReceipt}> {
    const route = ['content_draft', 'platform_assets', 'reception_reply'].includes(request.workflow) ? 'content' : 'insight';
    const model = this.config.models[route]; const pricing = this.config.pricing[route];
    // UTF-8 bytes are a conservative token upper bound; never silently truncate immutable evidence.
    const inputBound = Buffer.byteLength(JSON.stringify(messages), 'utf8');
    if (inputBound > this.config.limits.max_input_tokens) throw new AiProviderError('AI_INPUT_TOKEN_LIMIT', '输入证据及提示词超过配置token上限；请缩小采集分析范围');
    const body: Row = this.config.protocol === 'messages' ? {model, max_tokens: this.config.limits.max_output_tokens, system: messages[0]!.content, messages: messages.slice(1)} : {model, stream: false, max_tokens: this.config.limits.max_output_tokens, messages};
    if (this.config.protocol === 'chat_completions' && this.config.response_format === 'json_object') body['response_format'] = {type: 'json_object'};
    if (this.config.protocol === 'chat_completions' && this.config.response_format === 'json_schema') body['response_format'] = {type: 'json_schema', json_schema: {name: `boran_${request.workflow}_v2`, strict: true, schema: workflowOutputSchema(request.workflow)}};
    const key = await this.key(request.context.orgId);
    let rateRetries = 0;
    while (true) {
      const time = aiQuotaKeys(this.now());
      const receipt = await this.ledger.reserve({scope: `${request.context.orgId}:deepseek`, day: time.day, minute: time.minute, max_calls_per_day: this.config.limits.max_calls_per_day, max_calls_per_minute: this.config.limits.max_calls_per_minute, reserved_cost_micro: pricing ? calculateAiCost(inputBound, this.config.limits.max_output_tokens, pricing) : null, max_cost_micro_per_day: this.config.limits.max_cost_micro_per_day, currency: pricing?.currency ?? null, pricing_version: pricing?.version ?? null});
      const started = this.now();
      const attempt: AiAttemptMetadata = {requested_model: model, model: null, provider_request_id: null, response_id: null, status: 'unknown', usage: emptyUsage(), latency_ms: 0, cost_micro: null, price_model_verified: false};
      attempts.push(attempt);
      let response: Response;
      try {response = await this.send(`${this.config.base_url}/${this.config.protocol === 'messages' ? 'messages' : 'chat/completions'}`, {method: 'POST', headers: this.headers(key), body: JSON.stringify(body), signal: AbortSignal.timeout(this.config.timeout_ms), redirect: 'error'});} catch {
        attempt.latency_ms = this.now() - started;
        await this.ledger.settle(receipt, {status: 'unknown', actual_cost_micro: null, usage: attempt.usage});
        throw new AiProviderError('AI_PROVIDER_CALL_UNKNOWN', '模型调用连接中断或超时，费用状态未知；未自动重试', {attempts});
      }
      attempt.provider_request_id = safeId(response.headers.get('x-request-id') ?? response.headers.get('x-ds-request-id') ?? response.headers.get('request-id'));
      if (!response.ok) {
        attempt.latency_ms = this.now() - started;
        const rejected = response.status >= 400 && response.status < 500 && ![408, 499].includes(response.status);
        attempt.status = response.status === 429 ? 'rate_limited' : rejected ? 'rejected' : 'unknown';
        await this.ledger.settle(receipt, {status: rejected ? 'rejected' : 'unknown', actual_cost_micro: rejected ? 0 : null, usage: attempt.usage});
        await response.body?.cancel();
        if (response.status === 429 && rateRetries++ < this.config.retry_429) {
          const seconds = Number(response.headers.get('retry-after'));
          await this.sleep(Number.isFinite(seconds) && seconds > 0 ? Math.min(seconds * 1000, 10_000) : 500);
          continue;
        }
        const code = response.status === 429 ? 'AI_PROVIDER_RATE_LIMITED' : rejected ? 'AI_PROVIDER_REJECTED' : 'AI_PROVIDER_CALL_UNKNOWN';
        throw new AiProviderError(code, rejected ? '模型服务拒绝请求；核对账号可用模型、协议和JSON输出能力' : '模型服务返回异常，费用状态未知；未自动重试', {http_status: response.status, attempts});
      }
      let parsed: Row;
      try {parsed = object(JSON.parse(await boundedText(response)));} catch {
        attempt.latency_ms = this.now() - started;
        await this.ledger.settle(receipt, {status: 'unknown', actual_cost_micro: null, usage: attempt.usage});
        throw new AiProviderError('AI_PROVIDER_ENVELOPE_INVALID', '模型服务响应封装无效，保留未知费用状态', {attempts});
      }
      attempt.latency_ms = this.now() - started; attempt.status = 'received';
      attempt.model = safeId(parsed['model']); attempt.response_id = safeId(parsed['id']);
      attempt.usage = readUsage(parsed, this.config.protocol);
      const catalog = this.catalogs.get(request.context.orgId);
      attempt.price_model_verified = Boolean(pricing && (attempt.model === pricing.model || attempt.model && pricing.aliases?.includes(attempt.model) && this.config.verify_models && catalog?.models.includes(attempt.model)));
      attempt.cost_micro = pricing && attempt.price_model_verified && attempt.usage.input_tokens !== null && attempt.usage.output_tokens !== null ? calculateAiCost(attempt.usage.input_tokens, attempt.usage.output_tokens, pricing) : null;
      await this.ledger.settle(receipt, {status: 'received', actual_cost_micro: attempt.cost_micro, usage: attempt.usage});
      if (this.config.limits.max_cost_micro_per_day !== null && !attempt.price_model_verified) throw new AiProviderError('AI_PROVIDER_PRICE_UNVERIFIED', '响应实际模型未匹配当前计价或经账号目录核实的等价模型；费用未知，未生成业务对象', {attempts});
      if (!attempt.model) throw new AiProviderError('AI_PROVIDER_MODEL_MISSING', '模型服务响应缺少实际模型ID，无法证明真实运行模型', {attempts});
      let text: string | undefined; let finish: unknown;
      if (this.config.protocol === 'messages') {
        const contents = Array.isArray(parsed['content']) ? parsed['content'].map(object) : [];
        if (contents.some(content => !['text', 'thinking', 'redacted_thinking'].includes(String(content['type']))) || ['tool_use', 'function_call'].includes(String(parsed['stop_reason']))) throw new AiProviderError('AI_PROVIDER_TOOL_CALL_BLOCKED', '受约束模型不能发起工具或平台调用', {attempts});
        text = contents.filter(content => content['type'] === 'text' && typeof content['text'] === 'string').map(content => content['text']).join('');
        finish = parsed['stop_reason'];
      } else {
        const choice = object(Array.isArray(parsed['choices']) ? parsed['choices'][0] : null);
        const message = object(choice['message']); text = typeof message['content'] === 'string' ? message['content'] : undefined; finish = choice['finish_reason'];
        if (message['tool_calls'] || message['function_call']) throw new AiProviderError('AI_PROVIDER_TOOL_CALL_BLOCKED', '受约束模型不能发起工具或平台调用', {attempts});
      }
      if (!text?.trim()) throw new AiProviderError('AI_PROVIDER_EMPTY_OUTPUT', '模型返回空正文或拒答，未生成业务对象', {attempts});
      if (finish === 'length' || finish === 'max_tokens') throw new AiProviderError('AI_PROVIDER_OUTPUT_TRUNCATED', '模型输出被token上限截断，未生成业务对象', {attempts});
      if (attempt.usage.output_tokens !== null && attempt.usage.output_tokens > this.config.limits.max_output_tokens || attempt.usage.input_tokens !== null && attempt.usage.input_tokens > this.config.limits.max_input_tokens) throw new AiProviderError('AI_PROVIDER_TOKEN_LIMIT_EXCEEDED', '服务返回usage超过配置token上限', {attempts});
      return {text, attempt, receipt};
    }
  }
  async generate(request: AiRequest): Promise<AiGatewayResult> {
    const started = this.now(); const attempts: AiAttemptMetadata[] = [];
    try {return await this.generateChecked(request, started, attempts);} catch (error) {
      if (attempts.length === 0) {
        if (error instanceof AiProviderError && error.code === 'AI_CALL_LIMIT') throw new AiProviderError(error.code, error.message, {...error.details, safe_not_submitted: true, metadata: {attempts: []}});
        throw error;
      }
      const usageSum = (field: keyof AiUsage): number | null => attempts.every(attempt => attempt.status === 'received' ? attempt.usage[field] !== null : attempt.status === 'rejected' || attempt.status === 'rate_limited') ? attempts.reduce((sum, attempt) => sum + (attempt.usage[field] ?? 0), 0) : null;
      const cost = attempts.every(attempt => attempt.status === 'received' ? attempt.cost_micro !== null : attempt.status !== 'unknown') ? attempts.reduce((sum, attempt) => sum + (attempt.cost_micro ?? 0), 0) : null;
      const route = ['content_draft', 'platform_assets', 'reception_reply'].includes(request.workflow) ? 'content' : 'insight';
      const metadata = {mode: 'real', simulation: false, provider: 'deepseek', protocol: this.config.protocol, requested_model: this.config.models[route], model: attempts.at(-1)?.model ?? null, prompt_version: AI_PROMPT_VERSION, input_hash: aiInputHash(request), output_hash: null, source_version_ids: request.context.sourceVersions.map(source => String(source['source_version_id'])), provider_request_id: attempts.at(-1)?.provider_request_id ?? null, response_id: attempts.at(-1)?.response_id ?? null, usage: {input_tokens: usageSum('input_tokens'), output_tokens: usageSum('output_tokens'), total_tokens: usageSum('total_tokens'), cache_hit_tokens: usageSum('cache_hit_tokens')}, latency_ms: this.now() - started, cost_micro: cost, currency: cost !== null ? this.config.pricing[route]?.currency ?? null : null, pricing_version: cost !== null ? this.config.pricing[route]?.version ?? null : null, cost_basis: cost !== null ? 'configured_model_pricing' : 'unknown', quota_timezone: AI_QUOTA_TIMEZONE, attempts};
      if (error instanceof AiProviderError) throw new AiProviderError(error.code, error.message, {...error.details, safe_not_submitted: false, metadata});
      throw new AiProviderError('AI_OUTPUT_SEMANTIC_INVALID', '模型输出未通过事实、隐私或授权校验，未生成业务对象', {metadata, validation_reason: error instanceof Error ? error.message : 'validation failed'});
    }
  }
  private async generateChecked(request: AiRequest, started: number, attempts: AiAttemptMetadata[]): Promise<AiGatewayResult> {
    assertSafeAiValue(request);
    validateRuntimeEvidenceInput(request);
    if (['insight_topics', 'content_draft', 'platform_assets'].includes(request.workflow) && sourceMaterials(request).length === 0 && !request.context.trustedClaims?.length) throw new AiProviderError('AI_SOURCE_TEXT_REQUIRED', '真实洞察及草稿生成需要已读取的正文和定位证据');
    if (this.config.verify_models) await this.verifyModels(request.context.orgId);
    let reply = await this.call(request, buildAiMessages(request), attempts); let repair_count = 0;
    let structured: ReturnType<typeof validateAiOutputStructure>;
    try {structured = validateAiOutputStructure(JSON.parse(reply.text));} catch (error) {
      if (!(error instanceof SyntaxError || error instanceof ContractValidationError)) throw error;
      // Only JSON/Schema repair is permitted. Invalid raw output is never accepted or persisted as a draft.
      assertSafeAiValue(reply.text);
      repair_count = 1;
      const issues = error instanceof ContractValidationError ? error.details : ['Output was not a single valid JSON object'];
      reply = await this.call(request, buildAiMessages(request, {invalid: reply.text, issues}), attempts);
      try {structured = validateAiOutputStructure(JSON.parse(reply.text));} catch {throw new AiProviderError('AI_STRUCTURE_REPAIR_FAILED', '唯一一次结构修复仍未通过Schema v2', {attempts, repair_count});}
    }
    if (structured.workflow !== request.workflow) throw new ContractValidationError('模型输出流程与当前请求不一致');
    // Semantic or factual failures must never be repaired into invented evidence/authorization.
    let output: ReturnType<typeof validateAiOutput>;
    try {
      output = validateAiOutput(structured, request.context);
      assertSafeAiValue(output);
      validateRuntimeEvidenceOutput(output, request);
    } catch (error) {
      throw new AiProviderError('AI_OUTPUT_SEMANTIC_INVALID', '模型输出未通过事实、隐私或授权语义校验；不进行事实修复', {attempts, repair_count, validation_reason: error instanceof Error ? error.message : 'semantic validation failed', prompt_version: AI_PROMPT_VERSION, input_hash: aiInputHash(request)});
    }
    const sum = (field: keyof AiUsage): number | null => attempts.every(attempt => attempt.status === 'received' ? attempt.usage[field] !== null : attempt.status === 'rejected' || attempt.status === 'rate_limited') ? attempts.reduce((total, attempt) => total + (attempt.usage[field] ?? 0), 0) : null;
    const route = ['content_draft', 'platform_assets', 'reception_reply'].includes(request.workflow) ? 'content' : 'insight'; const pricing: AiPricing | undefined = this.config.pricing[route];
    const cost_micro = attempts.every(attempt => attempt.status === 'received' ? attempt.cost_micro !== null : attempt.status !== 'unknown') ? attempts.reduce((total, attempt) => total + (attempt.cost_micro ?? 0), 0) : null;
    return {output, metadata: {mode: 'real', simulation: false, schema_version: 2, provider: 'deepseek', protocol: this.config.protocol, requested_model: reply.attempt.requested_model, model: reply.attempt.model!, model_alias: reply.attempt.model !== reply.attempt.requested_model, model_alias_verified: Boolean(reply.attempt.model && this.config.verify_models && this.catalogs.get(request.context.orgId)?.models.includes(reply.attempt.model)), cost_basis: cost_micro !== null ? 'configured_model_pricing' : 'unknown', quota_timezone: AI_QUOTA_TIMEZONE, prompt_version: AI_PROMPT_VERSION, input_hash: aiInputHash(request), output_hash: aiOutputHash(output), source_version_ids: request.context.sourceVersions.map(source => String(source['source_version_id'])), provider_request_id: reply.attempt.provider_request_id, response_id: reply.attempt.response_id, usage: {input_tokens: sum('input_tokens'), output_tokens: sum('output_tokens'), total_tokens: sum('total_tokens'), cache_hit_tokens: sum('cache_hit_tokens')}, latency_ms: this.now() - started, cost_micro, currency: cost_micro !== null ? pricing?.currency ?? null : null, pricing_version: cost_micro !== null ? pricing?.version ?? null : null, repair_count, attempts, limit_scope: reply.receipt.scope, quality_result: {schema_valid: true, semantic_valid: true, evidence_valid: true, evidence_scope: 'references_and_hard_claims', business_quality_verified: false, business_review_required: true, strict_schema_requested: this.config.response_format === 'json_schema', model_catalog_verified: this.config.verify_models}}};
  }
}
