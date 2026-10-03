import {createHash} from 'node:crypto';
import {ContractValidationError, validateAiOutputStructure} from './validation';
import type {AiOutput} from './ai.generated';
type Row = Record<string, unknown>;
export interface AiSemanticContext {
  orgId: string;
  sourceVersions: readonly Row[];
  policyRefs?: readonly Row[];
  allowedIds?: Readonly<Record<string, readonly string[]>>;
  businessKeys?: Readonly<Record<string, readonly string[]>>;
  locators?: readonly {source_version_id: string; locator: unknown}[];
  decisionExpressions?: readonly {source_version_id: string; locator: unknown; actor: 'user'; claim_text: string; decision_status: 'confirmed' | 'revoked'}[];
  trustedClaims?: readonly Row[];
  accountProfiles?: readonly {platform_account_id: string; platform_profile_version_id: string; formats: readonly string[]}[];
  executedActions?: readonly Row[];
  reportFacts?: readonly Row[];
  dataCutoff?: string;
}
function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (value && typeof value === 'object') return `{${Object.keys(value).filter(k => k !== 'org_id').sort().map(k => `${JSON.stringify(k)}:${canonical((value as Row)[k])}`).join(',')}}`;
  return JSON.stringify(value) ?? 'null';
}
function reject(message: string): never { throw new ContractValidationError(message); }
function record(value: unknown): Row { return value as Row; }
function rows(value: unknown): Row[] { return Array.isArray(value) ? value.map(record) : []; }
function same(a: unknown, b: unknown): boolean { return canonical(a) === canonical(b); }
export function validateAiOutput(input: unknown, context: AiSemanticContext): AiOutput {
  const result = validateAiOutputStructure(input);
  const envelope = record(result); const output = record(envelope['output']);
  const sources = rows(envelope['source_versions']); const claims = rows(envelope['claims']);
  const trustedById = new Map(context.sourceVersions.map(source => [source['source_version_id'], source]));
  for (const source of [...context.sourceVersions,...context.policyRefs??[],...context.trustedClaims??[],...context.executedActions??[]]) if (source['org_id'] !== undefined && source['org_id'] !== context.orgId) reject('Source context crosses organizations');
  if(new Set(sources.map(source=>source['source_version_id'])).size!==sources.length)reject('Duplicate source version reference');
  for (const source of sources) {
    const trusted = trustedById.get(source['source_version_id']);
    if (!trusted || !same(source, trusted)) reject('Source version, revision, retrieval time or coverage was not supplied by the server');
  }
  const policyRefs = rows(envelope['policy_refs']);
  for (const policy of policyRefs) if (!context.policyRefs?.some(trusted => same(policy, trusted))) reject('AI cannot invent or expand an authorization');
  const allowed = new Map<string, Set<string>>(Object.entries(context.allowedIds ?? {}).map(([key, values]) => [key, new Set(values)]));
  function add(field: string, values: unknown[]): void { const set = allowed.get(field) ?? new Set<string>(); values.forEach(value => { if (typeof value === 'string') set.add(value); }); allowed.set(field, set); }
  add('source_version_id', sources.map(s => s['source_version_id'])); add('document_id', sources.map(s => s['document_id']));
  add('claim_id', (context.trustedClaims ?? []).map(c => c['claim_id'] ?? c['id'])); add('supersedes_claim_id', [...(allowed.get('claim_id') ?? [])]);
  add('policy_version_id', (context.policyRefs ?? []).map(p => p['policy_version_id'])); add('policy_id', (context.policyRefs ?? []).map(p => p['policy_id']));
  add('platform_account_id', (context.accountProfiles ?? []).map(p => p.platform_account_id)); add('platform_profile_version_id', (context.accountProfiles ?? []).map(p => p.platform_profile_version_id));
  add('execution_action_id', (context.executedActions ?? []).map(a => a['execution_action_id']));
  const claimMap = new Map<string, Row>(); const proposalKeys = new Set<string>();
  function visit(value: unknown): void {
    if (Array.isArray(value)) { value.forEach(visit); return; }
    if (!value || typeof value !== 'object') return;
    const object = record(value);
    for (const [key, entry] of Object.entries(object)) {
      if ((key === 'proposal_key' || key === 'claim_key' && object['claim_text'] !== undefined) && typeof entry === 'string') {
        if (proposalKeys.has(entry)) reject('Proposal keys must be unique'); proposalKeys.add(entry);
      }
      if (key.endsWith('_id') && typeof entry === 'string' && !allowed.get(key)?.has(entry)) reject(`ID ${key} is outside the server allowlist`);
      if (key.endsWith('_ids') && Array.isArray(entry)) {
        const singular = key.slice(0, -1);
        if (entry.some(id => typeof id !== 'string' || !allowed.get(singular)?.has(id))) reject(`IDs ${key} are outside the server allowlist`);
      }
      if (['industry_key', 'product_family_key'].includes(key) && entry !== null && typeof entry === 'string' && !context.businessKeys?.[key]?.includes(entry)) reject(`Unknown business key ${key}`);
      if (key === 'domain_keys' && Array.isArray(entry) && entry.some(item => !context.businessKeys?.['domain_keys']?.includes(String(item)))) reject('Unknown business domain');
      visit(entry);
    }
  }
  visit(result);
  for (const claim of claims) {
    claimMap.set(String(claim['claim_key']), claim);
    if (!context.locators?.some(locator => locator.source_version_id === claim['source_version_id'] && same(locator.locator, claim['locator']))) reject('Claim locator is outside the retrieved source coverage');
    if (claim['claim_id'] !== null) {
      const trusted = context.trustedClaims?.find(c => (c['claim_id'] ?? c['id']) === claim['claim_id']);
      if (!trusted || ['claim_text', 'source_version_id', 'locator', 'assertion_type', 'decision_status'].some(field => !same(claim[field], trusted[field]))) reject('AI altered an existing claim');
    }
    if (claim['assertion_type'] === 'decision' && ['confirmed', 'revoked'].includes(String(claim['decision_status']))) {
      const ref = record(claim['decision_evidence_ref']);
      if (ref['actor'] !== 'user' || !context.decisionExpressions?.some(expression => expression.source_version_id === ref['source_version_id'] && same(expression.locator, ref['locator']) && expression.claim_text === claim['claim_text'] && expression.decision_status === claim['decision_status'])) reject('Confirmation or revocation requires a matching user expression');
    }
  }
  // Walk the supersession graph; a supplied old ID is not evidence that the chain is acyclic.
  const byId = new Map<string, Row>((context.trustedClaims ?? []).map(c => [String(c['claim_id'] ?? c['id']), c]));
  claims.filter(c => c['claim_id'] !== null).forEach(c => byId.set(String(c['claim_id']), c));
  for (const claim of claims) {
    const seen = new Set<string>(); let cursor: Row | undefined = claim;
    while (cursor && cursor['supersedes_claim_id']) {
      const id = String(cursor['supersedes_claim_id']);
      if (seen.has(id) || id === claim['claim_id']) reject('Claim supersession contains a cycle'); seen.add(id); cursor = byId.get(id);
    }
  }
  function checkReferences(value: unknown): void {
    if (Array.isArray(value)) { value.forEach(checkReferences); return; }
    if (!value || typeof value !== 'object') return;
    const object = record(value);
    if (typeof object['claim_key'] === 'string' && object['claim_text'] === undefined && !claimMap.has(object['claim_key'])) reject('Unresolvable claim key');
    for (const field of ['claim_keys', 'source_claim_keys']) if (Array.isArray(object[field]) && (object[field] as unknown[]).some(key => !claimMap.has(String(key)))) reject('Unresolvable claim key');
    if ('platform_account_id' in object && 'platform_profile_version_id' in object && !context.accountProfiles?.some(target => target.platform_account_id === object['platform_account_id'] && target.platform_profile_version_id === object['platform_profile_version_id'] && target.formats.includes(String(object['format'])))) reject('Platform profile and format do not match the account');
    if (Array.isArray(object['body_blocks']) && Array.isArray(object['claim_refs']) && rows(object['claim_refs']).some(ref => Number(ref['block_index']) >= (object['body_blocks'] as unknown[]).length)) reject('Claim reference lies outside body blocks');
    if (typeof object['start_ms'] === 'number' && typeof object['end_ms'] === 'number' && object['end_ms'] <= object['start_ms']) reject('Media interval must have a positive duration');
    if (context.dataCutoff && object['data_cutoff'] !== undefined && object['data_cutoff'] !== context.dataCutoff) reject('AI changed the deterministic data cutoff');
    Object.values(object).forEach(checkReferences);
  }
  checkReferences(result);
  for (const insight of rows(output['insights'])) if(insight['candidate_state']==='ready' && !rows(insight['evidence']).some(ref=>{const claim=claimMap.get(String(ref['claim_key']));return ref['relation']==='supports' && claim && context.trustedClaims?.some(trusted=>(trusted['claim_id']??trusted['id'])===claim['claim_id'] && trusted['verification_status']==='verified' && trusted['public_permission']==='allowed' && trusted['decision_status']!=='revoked');}))reject('Ready insight needs an independently verified, permitted supporting claim');
  const insightKeys = new Set(rows(output['insights']).map(insight => insight['proposal_key']));
  for (const topic of rows(output['topics'])) if (!insightKeys.has(topic['insight_key'])) reject('Unresolvable insight key');
  for (const action of rows(output['executed_actions'])) if (!context.executedActions?.some(trusted => same(action, trusted))) reject('AI cannot invent an executed state or readback evidence');
  for (const fact of rows(output['facts'])) if (!context.reportFacts?.some(trusted => same(fact, trusted))) reject('Report facts must copy deterministic input');
  if (result.workflow === 'reception_reply') {
    const text = String(output['reply_text']);
    if (/\b1[3-9]\d{9}\b|[\w.+-]+@[\w.-]+\.[a-z]{2,}|(?:微信|wechat|weixin)\s*[:：]\s*[a-zA-Z0-9_-]{5,}/i.test(text)) reject('Reception output must not expose contact PII');
  }
  return result;
}
export function aiOutputHash(value: AiOutput): string { return createHash('sha256').update(canonical(value)).digest('hex'); }
