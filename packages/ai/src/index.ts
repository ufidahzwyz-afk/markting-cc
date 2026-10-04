import {validateAiOutput, aiOutputHash, ContractValidationError} from '@boran/contracts';
import {assertSafeAiValue, aiInputHash} from './privacy';
import {AiNotConfiguredError, type AiRequest, type AiGatewayResult, type AiGateway, type AiTransport} from './types';
import {DeepSeekAiGateway, type RuntimeAiOptions} from './deepseek';
export * from './types';
export * from './privacy';
export * from './config';
export * from './deepseek';
export * from './evidence';
export * from './limits';
export * from './run-metadata';
export {AI_PROMPT_VERSION, workflowOutputSchema} from './prompts';
export class UnconfiguredAiGateway implements AiGateway {
  readonly mode = 'real' as const;
  constructor(private readonly reason = '真实模型网关尚未配置；没有模拟回退') {}
  async generate(_request: AiRequest): Promise<AiGatewayResult> {throw new AiNotConfiguredError(this.reason);}
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
/** Retained injection seam for engineering tests and integrations; it is not proof of a real provider call. */
export class ConfiguredAiGateway implements AiGateway {
  readonly mode = 'real' as const;
  constructor(private readonly transport: AiTransport, private readonly model: string) {if (!model.trim()) throw new AiNotConfiguredError('模型名称不能为空');}
  async generate(request: AiRequest): Promise<AiGatewayResult> {
    assertSafeAiValue(request);
    const output = validateAiOutput(await this.transport(request), request.context);
    if (output.workflow !== request.workflow) throw new ContractValidationError('模型输出流程与当前请求不一致');
    return {output, metadata: {mode: 'real', simulation: false, schema_version: 2, provider: 'injected', model: this.model, input_hash: aiInputHash(request), output_hash: aiOutputHash(output)}};
  }
}
export function createAiGateway(config: {aiMode: 'mock' | 'real'; transport?: AiTransport; model?: string}): AiGateway {
  return config.aiMode === 'mock' ? new MockAiGateway() : config.transport && config.model ? new ConfiguredAiGateway(config.transport, config.model) : new UnconfiguredAiGateway();
}
/** Explicit mock preserves historical simulations; the deployable provider never falls back to it. */
export function createRuntimeAiGateway(options: RuntimeAiOptions = {}): AiGateway {
  const env = options.env ?? process.env;
  if (env.AI_MODE === 'mock') return new MockAiGateway();
  try {return new DeepSeekAiGateway(options);} catch (error) {
    if (error instanceof AiNotConfiguredError) return new UnconfiguredAiGateway(error.message);
    throw error;
  }
}
export async function verifyRuntimeAiModels(options: RuntimeAiOptions, orgId: string): Promise<Awaited<ReturnType<DeepSeekAiGateway['verifyModels']>>> {
  return new DeepSeekAiGateway(options).verifyModels(orgId);
}
