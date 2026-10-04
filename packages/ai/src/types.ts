import type {AiOutput, AiSemanticContext} from '@boran/contracts';

export interface AiSourceMaterial {
  source_version_id: string;
  segments: readonly {locator: {kind: 'web' | 'document' | 'message' | 'sheet' | 'other'; value: string}; text: string}[];
}
export interface AiRequest {workflow: AiOutput['workflow']; context: AiSemanticContext; input: unknown}
export interface AiUsage {input_tokens: number | null; output_tokens: number | null; total_tokens: number | null; cache_hit_tokens: number | null}
export interface AiAttemptMetadata {
  requested_model: string;
  model: string | null;
  provider_request_id: string | null;
  response_id: string | null;
  status: 'received' | 'rate_limited' | 'rejected' | 'unknown';
  usage: AiUsage;
  latency_ms: number;
  cost_micro: number | null;
  price_model_verified: boolean;
}
export interface AiGatewayMetadata {
  mode: 'mock' | 'real'; simulation: boolean; schema_version: 2; model: string; output_hash: string;
  provider?: 'deepseek' | 'injected'; protocol?: 'chat_completions' | 'messages';
  requested_model?: string; model_alias?: boolean; model_alias_verified?: boolean; cost_basis?: 'configured_model_pricing' | 'unknown'; quota_timezone?: 'Asia/Shanghai'; prompt_version?: string; input_hash?: string;
  source_version_ids?: string[]; provider_request_id?: string | null; response_id?: string | null;
  usage?: AiUsage; latency_ms?: number; cost_micro?: number | null; currency?: string | null;
  pricing_version?: string | null; repair_count?: number; attempts?: AiAttemptMetadata[];
  quality_result?: {schema_valid: true; semantic_valid: true; evidence_valid: true; evidence_scope: 'references_and_hard_claims'; business_quality_verified: false; business_review_required: true; strict_schema_requested: boolean; model_catalog_verified: boolean};
  limit_scope?: 'process' | 'persistent';
}
export interface AiGatewayResult {output: AiOutput; metadata: AiGatewayMetadata}
export interface AiGateway {readonly mode: 'mock' | 'real'; generate(request: AiRequest): Promise<AiGatewayResult>}
export type AiTransport = (request: AiRequest) => Promise<unknown>;
export class AiNotConfiguredError extends Error {readonly code = 'AI_NOT_CONFIGURED'; readonly status = 503;}
export class AiProviderError extends Error {
  readonly status = 503;
  constructor(readonly code: string, message: string, readonly details: Readonly<Record<string, unknown>> = {}) {super(message);}
}
