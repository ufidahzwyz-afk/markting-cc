import test, { after, before } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { createTestDatabase, DEMO_ORG_ID, migrateDatabase, openDatabase, seedDemo, type Database } from '@boran/db';
import { DeepSeekAiGateway, type AiLimitReservation, type AiUsage, type AiRequest } from '@boran/ai';
import { DatabaseAiLimitLedger } from '../src/ai-usage';

let db: Database, second: Database, admin: Database | undefined, schema: string | undefined, scopedUrl: string | undefined;
before(async () => {
  if (process.env.BORAN_QA_TEST_PG_URL) {
    admin = await openDatabase({ url: process.env.BORAN_QA_TEST_PG_URL, mode: 'live' });
    schema = `test_ai_quota_${randomUUID().replaceAll('-', '')}`; await admin.query(`CREATE SCHEMA ${schema}`);
    const url = new URL(process.env.BORAN_QA_TEST_PG_URL); url.searchParams.set('options', `-csearch_path=${schema}`); scopedUrl = url.toString();
    db = await openDatabase({ url: scopedUrl, mode: 'live' }); await migrateDatabase(db); await seedDemo(db);
    second = await openDatabase({ url: scopedUrl, mode: 'live' });
  } else { db = await createTestDatabase(); second = db; }
});
after(async () => { if (second !== db) await second?.close(); await db?.close(); if (admin && schema) { await admin.query(`DROP SCHEMA ${schema} CASCADE`); await admin.close(); } });
const usage: AiUsage = { input_tokens: 10, output_tokens: 20, total_tokens: 30, cache_hit_tokens: null };
function reservation(day: string, extra: Partial<AiLimitReservation> = {}): AiLimitReservation {
  return { scope: `${DEMO_ORG_ID}:deepseek`, day, minute: `${day}T08:00`, max_calls_per_day: 100, max_calls_per_minute: 10, reserved_cost_micro: null, max_cost_micro_per_day: null, currency: null, pricing_version: null, ...extra };
}

test('simultaneous worker instances share atomic daily quota; reconnect and another model cannot reset it', async () => {
  const input = reservation('2026-10-05', { max_calls_per_day: 2 });
  const a = new DatabaseAiLimitLedger(db, DEMO_ORG_ID), b = new DatabaseAiLimitLedger(second, DEMO_ORG_ID);
  const results = await Promise.allSettled([a.reserve(input), b.reserve(input), a.reserve(input), b.reserve(input), a.reserve(input)]);
  assert.equal(results.filter(result => result.status === 'fulfilled').length, 2);
  assert.ok(results.filter(result => result.status === 'rejected').every(result => result.status === 'rejected' && result.reason.code === 'AI_CALL_LIMIT'));
  if (scopedUrl) { await second.close(); second = await openDatabase({ url: scopedUrl, mode: 'live' }); }
  await assert.rejects(new DatabaseAiLimitLedger(second, DEMO_ORG_ID).reserve(input), { code: 'AI_CALL_LIMIT' });
  assert.equal(Number((await db.query('SELECT count(*) AS n FROM ai_usage_reservations WHERE org_id=$1 AND day_key=$2', [DEMO_ORG_ID, input.day])).rows[0]!.n), 2);
  const otherOrg = randomUUID(); await db.query("INSERT INTO organizations(id,name,timezone,base_currency) VALUES($1,'Synthetic quota organization','Asia/Shanghai','CNY')", [otherOrg]);
  const other = new DatabaseAiLimitLedger(second, otherOrg);
  const receipt = await other.reserve({ ...input, scope: `${otherOrg}:deepseek` });
  await assert.rejects(a.settle(receipt, { status: 'received', actual_cost_micro: null, usage }), { code: 'AI_LIMIT_RECEIPT_INVALID' });
  await other.settle(receipt, { status: 'received', actual_cost_micro: null, usage });
});

test('minute quota is atomic across worker connections while a later minute remains usable', async () => {
  const input = reservation('2026-10-06', { max_calls_per_minute: 2 });
  const a = new DatabaseAiLimitLedger(db, DEMO_ORG_ID), b = new DatabaseAiLimitLedger(second, DEMO_ORG_ID);
  const results = await Promise.allSettled([a.reserve(input), b.reserve(input), a.reserve(input)]);
  assert.equal(results.filter(result => result.status === 'fulfilled').length, 2);
  await a.reserve({ ...input, minute: `${input.day}T08:01` });
});

test('unknown calls retain worst-case cost; rejected attempts keep call counts and release only their monetary reservation', async () => {
  const a = new DatabaseAiLimitLedger(db, DEMO_ORG_ID);
  const priced = reservation('2026-10-07', { reserved_cost_micro: 60, max_cost_micro_per_day: 100, currency: 'CNY', pricing_version: 'synthetic-approved-rate' });
  const unknown = await a.reserve(priced);
  await a.settle(unknown, { status: 'unknown', actual_cost_micro: null, usage });
  await assert.rejects(new DatabaseAiLimitLedger(second, DEMO_ORG_ID).reserve({ ...priced, reserved_cost_micro: 41 }), { code: 'AI_COST_LIMIT' });
  const next = await a.reserve({ ...priced, reserved_cost_micro: 40 }); await a.settle(next, { status: 'rejected', actual_cost_micro: null, usage });
  const retry = await a.reserve({ ...priced, reserved_cost_micro: 40, max_calls_per_day: 3 });
  await a.settle(retry, { status: 'rejected', actual_cost_micro: null, usage });
  await assert.rejects(a.reserve({ ...priced, reserved_cost_micro: 40, max_calls_per_day: 3 }), { code: 'AI_CALL_LIMIT' });
  const states = (await db.query('SELECT state,actual_cost_micro FROM ai_usage_reservations WHERE org_id=$1 AND day_key=$2 ORDER BY created_at', [DEMO_ORG_ID, priced.day])).rows;
  assert.equal(states[0]!.state, 'unknown'); assert.equal(states[0]!.actual_cost_micro, null); assert.equal(Number(states[1]!.actual_cost_micro), 0);
});

test('unpriced unknown calls block a subsequently configured fee cap instead of becoming zero-cost success', async () => {
  const a = new DatabaseAiLimitLedger(db, DEMO_ORG_ID), input = reservation('2026-10-08');
  const first = await a.reserve(input); await a.settle(first, { status: 'unknown', actual_cost_micro: null, usage });
  await assert.rejects(a.reserve({ ...input, reserved_cost_micro: 1, max_cost_micro_per_day: 100, currency: 'CNY', pricing_version: 'synthetic-rate' }), { code: 'AI_COST_LIMIT' });
});

test('a received response with unverified actual price blocks further fee-capped calls despite a requested-model reservation', async () => {
  const a = new DatabaseAiLimitLedger(db, DEMO_ORG_ID);
  const input = reservation('2026-10-12', { reserved_cost_micro: 40, max_cost_micro_per_day: 100, currency: 'CNY', pricing_version: 'synthetic-requested-model-rate' });
  const receipt = await a.reserve(input); await a.settle(receipt, { status: 'received', actual_cost_micro: null, usage });
  await assert.rejects(new DatabaseAiLimitLedger(second, DEMO_ORG_ID).reserve(input), { code: 'AI_COST_LIMIT' });
  const timeout = { ...input, day: '2026-10-13', minute: '2026-10-13T08:00' };
  const unknown = await a.reserve(timeout); await a.settle(unknown, { status: 'unknown', actual_cost_micro: null, usage });
  await a.reserve(timeout); // Known requested-model timeout retains the reliable worst-case reservation.
});

test('a concurrent paid reservation sees committed settlement cost across separate PostgreSQL connections', { skip: !process.env.BORAN_QA_TEST_PG_URL, timeout: 10_000 }, async () => {
  const input = reservation('2026-10-11', { reserved_cost_micro: 50, max_cost_micro_per_day: 100, currency: 'CNY', pricing_version: 'synthetic-rate' });
  const initial = await new DatabaseAiLimitLedger(db, DEMO_ORG_ID).reserve(input);
  let entered!: () => void, release!: () => void;
  const enteredPromise = new Promise<void>(resolve => { entered = resolve; }), releasePromise = new Promise<void>(resolve => { release = resolve; });
  const delayed: Database = {
    query: db.query.bind(db), close: async () => {},
    transaction: fn => db.transaction(tx => fn({ query: async <T extends Record<string, unknown>>(sql: string, params?: unknown[]) => {
      const result = await tx.query<T>(sql, params);
      if (sql.startsWith('UPDATE ai_usage_reservations')) { entered(); await releasePromise; }
      return result;
    } })),
  };
  const settlement = new DatabaseAiLimitLedger(delayed, DEMO_ORG_ID).settle(initial, { status: 'received', actual_cost_micro: 80, usage });
  try {
    await enteredPromise;
    let completed = false;
    const concurrent = new DatabaseAiLimitLedger(second, DEMO_ORG_ID).reserve({ ...input, reserved_cost_micro: 30 }).then(() => ({ allowed: true, code: '' }), error => ({ allowed: false, code: error.code })).then(result => { completed = true; return result; });
    await new Promise<void>(resolve => setTimeout(resolve, 30)); assert.equal(completed, false);
    release(); await settlement;
    assert.deepEqual(await concurrent, { allowed: false, code: 'AI_COST_LIMIT' });
  } finally { release(); await settlement; }
});

test('schema repair and 429 retry consume three persistent reservations before any further paid request', async () => {
  const ledger = new DatabaseAiLimitLedger(db, DEMO_ORG_ID), cutoff = '2026-10-09T08:00:00.000Z';
  const request: AiRequest = { workflow: 'weekly_plan', context: { orgId: DEMO_ORG_ID, sourceVersions: [], locators: [], dataCutoff: cutoff }, input: { candidate_topics: [] } };
  const output = { workflow: 'weekly_plan', schema_version: 2, source_versions: [], claims: [], policy_refs: [], output: { objectives: ['Synthetic quota verification only'], tasks: [], assumptions: [], evidence_gaps: ['No actual business sources in this quota test'], data_cutoff: cutoff } };
  let posts = 0;
  const gateway = new DeepSeekAiGateway({ env: { APP_ENV: 'test', AI_MODE: 'real', DEEPSEEK_API_KEY_SECRET_REF: 'synthetic-credential-reference', DEEPSEEK_VERIFY_MODELS: 'false', AI_MAX_CALLS_PER_DAY: '3' }, now: () => Date.parse(cutoff), resolveSecret: () => 'synthetic-private-key', sleep: async () => {}, limitLedger: ledger, fetch: async () => {
    posts++;
    if (posts === 2) return new Response('provider error must not be persisted', { status: 429 });
    return Response.json({ model: 'deepseek-v4-pro-test', id: `synthetic-response-${posts}`, choices: [{ message: { content: posts === 1 ? '{broken-json' : JSON.stringify(output) }, finish_reason: 'stop' }], usage: { prompt_tokens: 10, completion_tokens: 20 } });
  } });
  const result = await gateway.generate(request);
  assert.equal(posts, 3); assert.equal(result.metadata.repair_count, 1); assert.equal(result.metadata.limit_scope, 'persistent');
  assert.equal(String((await db.query('SELECT count(*) AS n FROM ai_usage_reservations WHERE org_id=$1 AND day_key=$2', [DEMO_ORG_ID, cutoff.slice(0, 10)])).rows[0]!.n), '3');
  await assert.rejects(gateway.generate(request), { code: 'AI_CALL_LIMIT' }); assert.equal(posts, 3);
  assert.doesNotMatch(JSON.stringify((await db.query('SELECT * FROM ai_usage_reservations WHERE org_id=$1', [DEMO_ORG_ID])).rows), /synthetic-private-key|provider error/);
});

test('settlement validates receipt, usage and organization and never stores extra secret-bearing fields', async () => {
  const a = new DatabaseAiLimitLedger(db, DEMO_ORG_ID), input = reservation('2026-10-10');
  await assert.rejects(a.reserve({ ...input, day: '2026-02-30', minute: '2026-02-30T08:00' }), { code: 'AI_LIMIT_INPUT_INVALID' });
  await assert.rejects(a.reserve({ ...input, minute: `${input.day}T24:59` }), { code: 'AI_LIMIT_INPUT_INVALID' });
  const receipt = await a.reserve(input);
  await assert.rejects(a.settle(receipt, { status: 'received', actual_cost_micro: 50, usage }), { code: 'AI_LIMIT_RECEIPT_INVALID' });
  await assert.rejects(a.settle(receipt, { status: 'received', actual_cost_micro: null, usage: { ...usage, apiKey: 'synthetic-secret-must-not-persist' } as AiUsage }), { code: 'AI_LIMIT_RECEIPT_INVALID' });
  await assert.rejects(a.settle(receipt, { status: 'received', actual_cost_micro: null, usage: { ...usage, total_tokens: -1 } }), { code: 'AI_LIMIT_RECEIPT_INVALID' });
  await a.settle(receipt, { status: 'received', actual_cost_micro: null, usage });
  await assert.rejects(a.settle(receipt, { status: 'received', actual_cost_micro: null, usage }), { code: 'AI_LIMIT_RECEIPT_INVALID' });
  assert.doesNotMatch(JSON.stringify((await db.query('SELECT * FROM ai_usage_reservations WHERE id=$1', [receipt.id])).rows), /synthetic-secret-must-not-persist|apiKey/);
});
