import {ContractValidationError, type AiOutput} from '@boran/contracts';
import type {AiRequest, AiSourceMaterial} from './types';
import {canonicalJson} from './privacy';
type Row = Record<string, unknown>;
function fail(message: string): never {throw new ContractValidationError(message);}
function normal(text: string): string {return text.normalize('NFC').replace(/\s+/g, ' ').trim();}
function numbers(text: string): string[] {return text.match(/\d+(?:[.,]\d+)*(?:%|％)?/g) ?? [];}
function hardTerms(text: string): string[] {
  return text.match(/免费|零费用|无成本|保证|承诺|确保|必然|必定|稳赚|盈利|收益|退款|赔偿|赔付|无风险|零风险|百分之百|(?:全球|全国|国内|行业|市场)?(?:唯一|第一|领先|顶级|首创|独家)|最佳|最优|最强|最高|最低|最大|最快/g) ?? [];
}
function quantities(text: string): string[] {return text.match(/\d+(?:[.,]\d+)*(?:\s*(?:万元|亿元|元|%|％|倍|家|位|项|年|月|天|小时|分钟|秒|人|个|条|套|万|亿|千|百))/g)?.map(quantity => quantity.replace(/\s+/g, '')) ?? [];}
function validateHardClaims(text: string, evidence: string): void {
  if (hardTerms(text).some(term => !evidence.includes(term))) fail('Draft introduced a commitment or superlative absent from its cited evidence');
  const clauses = text.match(/(?:免费|零费用|无成本|保证|承诺|确保|稳赚|无条件退款|(?:全球|全国|国内|行业|市场)?(?:唯一|第一|领先|顶级|首创|独家)|最佳|最优|最强|最高|最低|最大|最快)[^，。；!?！？\n]{0,30}/g) ?? [];
  if (clauses.some(clause => !normal(evidence).includes(normal(clause)))) fail('Draft expanded a commitment or superlative beyond the cited original clause');
  const allowed = new Set(quantities(evidence));
  if (quantities(text).some(quantity => !allowed.has(quantity))) fail('Draft changed a quantitative unit or value from its cited evidence');
}
export function sourceMaterials(request: AiRequest): AiSourceMaterial[] {
  const input = request.input && typeof request.input === 'object' ? request.input as Row : {};
  return Array.isArray(input['source_materials']) ? input['source_materials'] as AiSourceMaterial[] : [];
}
/** Validate the server evidence shape before transmitting any source text to a provider. */
export function validateRuntimeEvidenceInput(request: AiRequest): void {
  const materials = sourceMaterials(request);
  const sources = new Set(request.context.sourceVersions.map(source => String(source['source_version_id'])));
  for (const source of [...request.context.sourceVersions, ...request.context.trustedClaims ?? [], ...request.context.policyRefs ?? [], ...request.context.executedActions ?? [], ...request.context.reportFacts ?? []]) if (source['org_id'] !== undefined && source['org_id'] !== request.context.orgId) fail('Source input crosses organizations');
  if (new Set(materials.map(material => material.source_version_id)).size !== materials.length) fail('Duplicate source material version');
  for (const material of materials) {
    if (!sources.has(material.source_version_id) || !Array.isArray(material.segments) || material.segments.length === 0) fail('Source material is outside server context or lacks excerpts');
    for (const segment of material.segments) {
      if (!segment || typeof segment.text !== 'string' || !segment.text.trim() || !request.context.locators?.some(locator => locator.source_version_id === material.source_version_id && canonicalJson(locator.locator) === canonicalJson(segment.locator))) fail('Source text locator is outside retrieved coverage');
    }
  }
}
/** This checks referential evidence and copied facts; it does not certify public permission or business quality. */
export function validateRuntimeEvidenceOutput(output: AiOutput, request: AiRequest): void {
  const materials = sourceMaterials(request);
  if (['insight_topics', 'content_draft', 'platform_assets'].includes(request.workflow) && materials.length === 0 && !(request.context.trustedClaims?.length)) fail('Real generation requires source text or server-supplied claims');
  for (const claim of output.claims) {
    if (claim.claim_id !== null) continue;
    const segment = materials.find(material => material.source_version_id === claim.source_version_id)?.segments.find(entry => canonicalJson(entry.locator) === canonicalJson(claim.locator));
    if (!segment || typeof segment.text !== 'string' || !normal(segment.text)) fail('Claim evidence has no retrieved original text');
    if (claim.assertion_type === 'fact' && !normal(segment.text).includes(normal(claim.claim_text))) fail('New factual claim must copy the cited source excerpt; paraphrases are inference proposals');
    if (claim.assertion_type === 'inference' && !claim.inference_rationale?.trim()) fail('Inference needs an explicit evidence rationale');
    if (numbers(claim.claim_text).some(number => !new Set(numbers(segment.text)).has(number))) fail('Claim introduced a number absent from its source excerpt');
    if (claim.assertion_type === 'decision' && claim.decision_status === 'proposed' && !normal(segment.text).includes(normal(claim.claim_text))) fail('Proposed decision must be present in the retrieved discussion');
  }
  if (output.workflow === 'insight_topics') {
    if (output.output.insights.length > 0 && !output.claims.length) fail('Nonempty insights need cited claims');
    for (const insight of output.output.insights) {
      if (!insight.summary.trim() || !insight.customer_problem.trim() || !insight.opportunity.trim()) fail('Insight cannot contain empty business conclusions');
    }
  }
  if (output.workflow === 'content_draft') {
    const trusted = new Map((request.context.trustedClaims ?? []).map(claim => [String(claim['claim_id'] ?? claim['id']), claim]));
    output.output.body_blocks.forEach((block, index) => {
      if (!block.text.trim()) fail('Draft block cannot be empty');
      const refs = output.output.claim_refs.filter(ref => ref.block_index === index);
      if (block.type !== 'heading' && refs.length === 0) fail('Every draft paragraph or bullet requires a server-supplied claim reference');
      const evidenceText = refs.map(ref => String(trusted.get(ref.claim_id)?.['claim_text'] ?? '')).join('\n');
      validateHardClaims(block.text, evidenceText);
      const allowed = new Set(numbers(evidenceText));
      if (numbers(block.text).some(number => !allowed.has(number))) fail('Draft introduced a number absent from its cited evidence');
    });
    const cta = (request.input as Row | null)?.['cta'];
    if (!cta || canonicalJson(cta) !== canonicalJson(output.output.cta)) fail('Draft CTA must copy the server-supplied CTA');
    const evidence = output.output.claim_refs.map(ref => trusted.get(ref.claim_id));
    if (evidence.some(claim => !claim || claim['verification_status'] !== 'verified' || claim['public_permission'] !== 'allowed') && !output.output.gaps.some(gap => gap.kind === 'fact' || gap.kind === 'public_permission')) fail('Private candidate draft must disclose unverified facts or missing public permission');
    const titleEvidence = evidence.map(claim => String(claim?.['claim_text'] ?? '')).join('\n');
    validateHardClaims(output.output.title, titleEvidence);
    const allowedTitleNumbers = new Set(numbers(titleEvidence));
    if (numbers(output.output.title).some(number => !allowedTitleNumbers.has(number))) fail('Draft title introduced an unsupported number');
  }
}
