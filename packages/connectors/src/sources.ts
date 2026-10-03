import type {SourceKind} from '@boran/contracts';
export interface SourceCoverage {
  status: 'complete' | 'partial' | 'unknown';
  scope: string;
  start_locator: string | null;
  end_locator: string | null;
  conversation_id?: string;
  project_id?: string;
  gaps?: string[];
  message_ids?: string[];
  branch?: string;
}
export interface SourceSnapshot {
  providerFileId: string;
  title: string;
  revision: string;
  contentHash: string;
  objectKey: string;
  mimeType: string;
  retrievedAt: string;
  sourceModifiedAt: string | null;
  sourceUrl?: string;
  conversationId?: string;
  projectId?: string;
  visibility: 'internal' | 'public' | 'restricted';
  coverage: SourceCoverage;
}
export interface SourceReadRequest {
  orgId: string;
  connectionId: string;
  sourceKind: SourceKind;
  scope: {urls?: readonly string[]; fileIds?: readonly string[]; conversationIds?: readonly string[]; projectIds?: readonly string[]};
  cursor: unknown;
}
export type SourceReadResult =
  | {status: 'changed' | 'partial'; mode: 'mock' | 'live'; snapshots: SourceSnapshot[]; nextCursor: unknown; gaps: string[]}
  | {status: 'no_change'; mode: 'mock' | 'live'; snapshots: []; nextCursor: unknown; gaps: []}
  | {status: 'failed'; mode: 'mock' | 'live'; snapshots: []; errorCode: 'NOT_CONFIGURED' | 'SCOPE_REQUIRED' | 'READ_FAILED' | 'INVALID_READ_RESULT' | 'SCOPE_MISMATCH'; gaps: string[]};
export interface SourceReader {readonly kind: SourceKind; readonly mode: 'mock' | 'live'; read(request: SourceReadRequest): Promise<SourceReadResult>}
export type SourceTransport = (request: SourceReadRequest) => Promise<SourceReadResult>;
export class UnconfiguredSourceReader implements SourceReader {
  readonly mode = 'live' as const;
  constructor(readonly kind: SourceKind) {}
  async read(_request: SourceReadRequest): Promise<SourceReadResult> { return {status: 'failed', mode: this.mode, snapshots: [], errorCode: 'NOT_CONFIGURED', gaps: [this.kind === 'chatgpt' ? '独立授权的指定ChatGPT会话读取未配置；模型API不授予历史会话访问权' : `${this.kind} 的独立来源连接未配置`]}; }
}
export class ConfiguredSourceReader implements SourceReader {
  readonly mode = 'live' as const;
  constructor(readonly kind: SourceKind, private readonly transport: SourceTransport) {}
  async read(request: SourceReadRequest): Promise<SourceReadResult> {
    if (request.sourceKind !== this.kind) return this.failure('SCOPE_MISMATCH');
    const scope = this.kind === 'chatgpt' ? request.scope.conversationIds : this.kind === 'mac_drive' ? request.scope.fileIds : request.scope.urls;
    if (!scope?.length && !(this.kind === 'chatgpt' && request.scope.projectIds?.length)) return this.failure('SCOPE_REQUIRED');
    try {
      const result = await this.transport(request);
      if (result.mode !== 'live') return this.failure('INVALID_READ_RESULT');
      if (result.status === 'failed') return {...result, snapshots: []};
      if (result.status === 'no_change') return result.snapshots.length === 0 ? result : this.failure('INVALID_READ_RESULT');
      if (!result.snapshots.length) return this.failure('INVALID_READ_RESULT');
      for (const snapshot of result.snapshots) {
        const inScope=this.kind==='chatgpt' ? (request.scope.conversationIds?.includes(snapshot.conversationId??'') || request.scope.projectIds?.includes(snapshot.projectId??'') && snapshot.coverage.project_id===snapshot.projectId) : scope!.includes(this.kind === 'mac_drive' ? snapshot.providerFileId : snapshot.sourceUrl ?? snapshot.providerFileId);
        if (!inScope) return this.failure('SCOPE_MISMATCH');
        if (!/^[a-f0-9]{64}$/.test(snapshot.contentHash) || !snapshot.revision || !snapshot.objectKey || !snapshot.coverage.scope || !Number.isFinite(Date.parse(snapshot.retrievedAt))) return this.failure('INVALID_READ_RESULT');
        if (this.kind === 'chatgpt' && (snapshot.coverage.conversation_id !== snapshot.conversationId || !snapshot.coverage.message_ids?.length || !snapshot.coverage.branch)) return this.failure('INVALID_READ_RESULT');
      }
      if(result.status==='partial' || result.gaps.length || result.snapshots.some(snapshot=>snapshot.coverage.status!=='complete'||snapshot.coverage.gaps?.length)) return {...result,status:'partial',gaps:result.gaps.length?result.gaps:['来源覆盖不完整，未推进完整水位']};
      return result;
    } catch { return this.failure('READ_FAILED'); } // Avoid logging provider response bodies or credentials.
  }
  private failure(errorCode: Extract<SourceReadResult, {status:'failed'}>['errorCode']): SourceReadResult { return {status: 'failed', mode: 'live', snapshots: [], errorCode, gaps: [`${this.kind} 读取未完成，水位保持不变`]}; }
}
export class MockSourceReader implements SourceReader {
  readonly mode = 'mock' as const;
  constructor(readonly kind: SourceKind, private readonly result: SourceReadResult) {}
  async read(request: SourceReadRequest): Promise<SourceReadResult> {
    if (request.sourceKind !== this.kind) return {status: 'failed', mode: 'mock', snapshots: [], errorCode: 'SCOPE_MISMATCH', gaps: ['模拟来源类型不匹配']};
    return {...structuredClone(this.result), mode: 'mock'};
  }
}
export function createSourceReaders(transports: Partial<Record<SourceKind, SourceTransport>> = {}): Record<SourceKind, SourceReader> {
  return Object.fromEntries((['market_public', 'competitor_public', 'mac_drive', 'chatgpt'] as const).map(kind => [kind, transports[kind] ? new ConfiguredSourceReader(kind, transports[kind]) : new UnconfiguredSourceReader(kind)])) as Record<SourceKind, SourceReader>;
}
