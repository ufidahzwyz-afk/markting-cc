import {validateAiOutput, aiOutputHash, ContractValidationError, type AiOutput, type AiSemanticContext} from '@boran/contracts';
export interface AiRequest {workflow: AiOutput['workflow']; context: AiSemanticContext; input: unknown}
export interface AiGatewayResult {output: AiOutput; metadata: {mode: 'mock' | 'real'; simulation: boolean; schema_version: 2; model: string; output_hash: string}}
export interface AiGateway {readonly mode: 'mock' | 'real'; generate(request: AiRequest): Promise<AiGatewayResult>}
export class AiNotConfiguredError extends Error {readonly code = 'AI_NOT_CONFIGURED'; readonly status = 503;}
export class UnconfiguredAiGateway implements AiGateway {
  readonly mode = 'real' as const;
  async generate(_request: AiRequest): Promise<AiGatewayResult> {throw new AiNotConfiguredError('真实模型网关尚未配置；没有模拟回退');}
}
export class MockAiGateway implements AiGateway {
  readonly mode = 'mock' as const;
  async generate(request: AiRequest): Promise<AiGatewayResult> {
    const cutoff = request.context.dataCutoff ?? '2026-01-01T00:00:00.000Z';
    if (request.workflow !== 'insight_topics' && request.workflow !== 'weekly_plan') throw new AiNotConfiguredError('此模拟流程没有实现；不伪造模型产物');
    const output: unknown = {workflow: request.workflow, schema_version: 2, source_versions: [], claims: [], policy_refs: [], output: request.workflow === 'insight_topics' ? {data_cutoff: cutoff, insights: [], topics: [], source_gaps: [{kind: 'source', description: '模拟输出，尚无真实来源或可发布主题', reference_key: null, next_step: '接入真实来源并核验证据'}]} : {objectives: ['模拟计划，仅用于验证工程链路'], tasks: [], assumptions: ['模拟输出'], evidence_gaps: ['没有真实来源，不产生执行任务'], data_cutoff: cutoff}};
    const parsed = validateAiOutput(output, request.context);
    return {output: parsed, metadata: {mode: 'mock', simulation: true, schema_version: 2, model: 'boran-mock-v2', output_hash: aiOutputHash(parsed)}};
  }
}
export type AiTransport = (request: AiRequest) => Promise<unknown>;
export class ConfiguredAiGateway implements AiGateway {
  readonly mode = 'real' as const;
  constructor(private readonly transport: AiTransport, private readonly model: string) {if (!model.trim()) throw new AiNotConfiguredError('模型名称不能为空');}
  async generate(request: AiRequest): Promise<AiGatewayResult> {
    // The transport sees a service-constructed input; contacts and secrets are rejected before any provider call.
    const sensitiveKeys=new Set(['authorization','cookie','cookies','setcookie','session','sessiontoken','sessioncookie','accesstoken','refreshtoken','apikey','password','pwd','clientsecret','privatekey','credentials','secret','secretref']);
    function safe(value:unknown):void {
      if(Array.isArray(value)){value.forEach(safe);return;}
      if(value&&typeof value==='object'){for(const [key,entry] of Object.entries(value)){if(sensitiveKeys.has(key.toLowerCase().replace(/[^a-z0-9]/g,'')))throw new AiNotConfiguredError('模型输入必须脱敏且不得含凭据');safe(entry);}return;}
      if(typeof value==='string' && /\b1[3-9]\d{9}\b|[\w.+-]+@[\w.-]+\.[a-z]{2,}|\bBearer\s+[a-z0-9._-]+/i.test(value))throw new AiNotConfiguredError('模型输入必须脱敏且不得含凭据');
      if(typeof value==='number'&& /^1[3-9]\d{9}$/.test(String(value)))throw new AiNotConfiguredError('模型输入必须脱敏且不得含凭据');
    }
    safe(request);
    const output = validateAiOutput(await this.transport(request), request.context);
    if(output.workflow!==request.workflow)throw new ContractValidationError('模型输出流程与当前请求不一致');
    return {output, metadata: {mode: 'real', simulation: false, schema_version: 2, model: this.model, output_hash: aiOutputHash(output)}};
  }
}
export function createAiGateway(config: {aiMode: 'mock' | 'real'; transport?: AiTransport; model?: string}): AiGateway {
  return config.aiMode === 'mock' ? new MockAiGateway() : config.transport && config.model ? new ConfiguredAiGateway(config.transport, config.model) : new UnconfiguredAiGateway();
}
