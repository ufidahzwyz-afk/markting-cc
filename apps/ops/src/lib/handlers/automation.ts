import { requireActiveRole } from '@boran/domain/authz';
import { DomainError, type ServiceContext } from '@boran/domain/core';
import { listPrivateDrafts, getPrivateDraft, editPrivateDraft } from '@boran/domain/pipeline';
import { getRuntimeModelConfiguration } from '@boran/worker/automation-runtime';
import { databaseCommand, expectedVersion, jsonData } from '../http';

type Row = Record<string, unknown>;
const fields = (row: Row, keys: string[]) => Object.fromEntries(keys.filter(key => row[key] !== undefined).map(key => [key, row[key]]));
const qualityFields = ['schema', 'semantic', 'schema_version', 'private_candidate', 'mode', 'status', 'schema_valid', 'semantic_valid', 'validated', 'attempts', 'real_call_verified', 'request_id', 'actual_model', 'code', 'error_code'];

/** Organization-only business evidence, with no raw provider response or secret references. */
export async function handleAutomation(ctx: ServiceContext, request: Request, segments: string[], body: Row = {}): Promise<Response | null> {
  if (segments[0] !== 'automation') return null;
  await requireActiveRole(ctx, ctx.db, 'owner', 'admin', 'marketer', 'reviewer');
  const requestedMode = new URL(request.url).searchParams.get('mode');
  if (requestedMode && !['mock', 'live'].includes(requestedMode)) throw new DomainError('INVALID_MODE', 422, '运行模式无效');
  if (ctx.mode === 'mock' && requestedMode === 'live') throw new DomainError('LIVE_IDENTITY_REQUIRED', 403, '运行模式仅过滤数据，真实资料与草稿须使用独立登录的真实工作空间');
  ctx = { ...ctx, mode: requestedMode === 'live' ? 'live' : requestedMode === 'mock' ? 'mock' : ctx.mode };
  if (request.method === 'GET' && segments.length === 2 && segments[1] === 'status') {
    const [changes, insights, topics, runs, drafts, modelState] = await Promise.all([
      ctx.db.query("SELECT v.id,v.document_id,d.connection_id,d.title,d.source_kind,d.source_url,d.provider_file_id,d.conversation_id,v.revision,v.content_hash,v.mime_type,v.extraction_status,v.retrieved_at,v.source_modified_at,v.coverage_json,v.execution_mode,d.deleted_at FROM source_versions v JOIN source_documents d ON d.org_id=v.org_id AND d.id=v.document_id WHERE v.org_id=$1 AND v.execution_mode=$2 ORDER BY v.retrieved_at DESC,v.id LIMIT 50", [ctx.orgId, ctx.mode]),
      ctx.db.query("SELECT i.id,i.summary,i.business_line,i.customer_problem,i.opportunity,i.inference_text,i.priority_reason,i.priority_label,i.data_cutoff,i.state,i.ai_run_id,i.execution_mode,i.gaps_json,ARRAY(SELECT e.claim_id FROM insight_evidence e WHERE e.org_id=i.org_id AND e.insight_id=i.id ORDER BY e.claim_id) AS claim_ids FROM insights i WHERE i.org_id=$1 AND i.execution_mode=$2 ORDER BY i.priority_label,i.data_cutoff DESC,i.id LIMIT 50", [ctx.orgId, ctx.mode]),
      ctx.db.query("SELECT t.id,t.insight_id,t.business_line,t.title,t.audience,t.problem,t.offer,t.angle,t.claim_ids,t.priority,t.state,t.version,t.execution_mode,t.gaps_json,COALESCE(t.priority_reason,i.priority_reason) AS priority_reason,i.summary AS insight_summary,i.ai_run_id,COALESCE((SELECT MAX(v.source_modified_at) FROM evidence_claims c JOIN source_versions v ON v.org_id=c.org_id AND v.id=c.source_version_id WHERE c.org_id=t.org_id AND c.id=ANY(t.claim_ids)),i.data_cutoff,t.updated_at) AS source_changed_at FROM topics t LEFT JOIN insights i ON i.org_id=t.org_id AND i.id=t.insight_id WHERE t.org_id=$1 AND t.execution_mode=$2 AND t.insight_id IS NOT NULL AND t.state<>'discarded' ORDER BY t.priority,source_changed_at DESC,t.id LIMIT 100", [ctx.orgId, ctx.mode]),
      ctx.db.query("SELECT id,workflow_run_id,provider,model,prompt_version,input_hash,output_hash,source_ids,input_tokens,output_tokens,cost_micro,currency,latency_ms,quality_result,execution_mode,request_metadata,created_at FROM ai_runs WHERE org_id=$1 AND execution_mode=$2 ORDER BY created_at DESC,id LIMIT 30", [ctx.orgId, ctx.mode]),
      listPrivateDrafts(ctx, { limit: 100 }),
      getRuntimeModelConfiguration(ctx),
    ]);
    return jsonData({ mode: ctx.mode, source_changes: changes.rows, insights: insights.rows, recommendations: topics.rows, ai_runs: runs.rows.map(row => ({ ...fields(row, ['id', 'workflow_run_id', 'provider', 'model', 'prompt_version', 'input_hash', 'output_hash', 'source_ids', 'input_tokens', 'output_tokens', 'cost_micro', 'currency', 'latency_ms', 'execution_mode', 'created_at']), request: fields((row.request_metadata ?? {}) as Row, ['provider_request_id','request_id','response_model','actual_model','protocol','simulation','pricing_version','usage']), quality: fields((row.quality_result ?? {}) as Row, qualityFields) })), drafts, model: modelState.readiness, acceptance: { requires_business_review: true, note: '业务验收需核对真实来源变化、实际模型调用和运营确认，页面记录不自动代表验收通过。' } });
  }
  if (segments[1] === 'drafts' && segments.length === 2 && request.method === 'GET') return jsonData(await listPrivateDrafts(ctx, { limit: 100 }));
  if (segments[1] === 'drafts' && segments[2] && segments.length === 3) {
    if (request.method === 'GET') return jsonData(await getPrivateDraft(ctx, segments[2]));
    if (request.method === 'PATCH') {
      await requireActiveRole(ctx, ctx.db, 'owner', 'admin', 'marketer');
      if (Array.isArray(body.claim_refs) && (body.claim_refs.length > 500 || body.claim_refs.some(ref => !ref || typeof ref !== 'object' || Array.isArray(ref) || Object.keys(ref).some(key=>!['block_index','claim_id'].includes(key)) || !Number.isInteger((ref as Row).block_index) || typeof (ref as Row).claim_id !== 'string'))) throw new DomainError('INVALID_REQUEST', 422, '逐段引用格式无效');
      if (Object.keys(body).some(key => !['title', 'body_blocks', 'claim_refs', 'cta'].includes(key)) || typeof body.title !== 'string' || !Array.isArray(body.body_blocks) || !Array.isArray(body.claim_refs)) throw new DomainError('INVALID_REQUEST', 422, '候选草稿编辑字段无效');
      if (body.body_blocks.length < 1 || body.body_blocks.length > 60 || body.body_blocks.some(block => !block || typeof block !== 'object' || Array.isArray(block) || Object.keys(block).some(key => !['type', 'text'].includes(key)) || !['paragraph', 'bullet', 'heading'].includes(String((block as Row).type)) || typeof (block as Row).text !== 'string')) throw new DomainError('INVALID_REQUEST', 422, '候选正文段落格式无效');
      if (body.cta !== undefined && body.cta !== null && (typeof body.cta !== 'object' || Array.isArray(body.cta) || Object.keys(body.cta).some(key => !['label', 'href', 'action'].includes(key)) || !['navigate', 'scroll_to_form', 'contact'].includes(String((body.cta as Row).action)) || typeof (body.cta as Row).href !== 'string' || typeof (body.cta as Row).label !== 'string')) throw new DomainError('INVALID_REQUEST', 422, 'CTA 格式无效');
      const current = await getPrivateDraft(ctx, segments[2]);
      // Editing keeps the source lineage and unresolved publication blockers intact.
      return databaseCommand(ctx, request, body, 200, c => editPrivateDraft(c, segments[2]!, { expectedVersion: expectedVersion(request), title: body.title as string, bodyBlocks: body.body_blocks as Parameters<typeof editPrivateDraft>[2]['bodyBlocks'], claimRefs: (body.claim_refs as Row[]).map(ref => ({ blockIndex: Number(ref.block_index), claimId: String(ref.claim_id) })), ...(body.cta === undefined ? {} : { cta: body.cta as Exclude<Parameters<typeof editPrivateDraft>[2]['cta'], undefined> }), warnings: current.warnings, gaps: current.gaps }));
    }
  }
  return null;
}
