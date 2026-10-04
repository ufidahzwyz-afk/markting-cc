import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {mkdtemp, rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createTestDatabase, DEMO_ORG_ID, DEMO_OWNER_ID, DEMO_MARKETER_ID} from '@boran/db';
import {EncryptedSecretStore, initializeSecretStore} from '@boran/connectors/secrets';
import {createConfiguredAiGateway, createConfiguredSourceReaders, defaultModelConfiguration, getRuntimeModelConfiguration, validateModelConfiguration} from '@boran/worker/automation-runtime';
import {handleModel} from '../src/lib/handlers/model';
import type {ServiceContext} from '@boran/domain/core';
const request = (method: string, path = 'automation/model', version?: number, key = randomUUID()) => new Request(`http://localhost/api/v1/${path}`, {method, headers: {'content-type': 'application/json', 'idempotency-key': key, ...(version === undefined ? {} : {'if-match': String(version)})}});
test('org model settings, encrypted key rotation and provider catalog proof remain separate from generation', async () => {
  const db = await createTestDatabase(); const directory = await mkdtemp(join(tmpdir(), 'boran-model-http-'));
  const rootDirectory = join(directory, 'secrets'), keyFile = join(directory, 'key', 'master.key');
  const env = {...process.env, AI_MODE: 'mock', BORAN_SECRET_STORE_ROOT: rootDirectory, BORAN_SECRET_KEY_FILE: keyFile};
  const ctx: ServiceContext = {db, orgId: DEMO_ORG_ID, actorId: DEMO_OWNER_ID, roles: ['owner'], mode: 'live'};
  const connectionId = randomUUID(); let gets = 0, posts = 0;
  const fetch: typeof globalThis.fetch = async (_url, options) => {
    if (options?.method === 'GET') {gets++; return Response.json({data: [{id: 'deepseek-v4-pro'}, {id: 'deepseek-flash'}]});}
    posts++; const body = JSON.parse(String(options?.body));
    const user = (body.messages as {role: string; content: string}[]).find(message => message.role === 'user')!.content;
    const input = JSON.parse(user.split('\n').slice(1, -1).join('\n'));
    return Response.json({model: 'deepseek-v4-pro-fixture', id: 'synthetic-provider-response', choices: [{message: {content: JSON.stringify({workflow: 'weekly_plan', schema_version: 2, source_versions: [], claims: [], policy_refs: [], output: {objectives: ['Synthetic configuration and quota test'], tasks: [], assumptions: [], evidence_gaps: ['No actual business content in test'], data_cutoff: input.semantic_context.dataCutoff}})}, finish_reason: 'stop'}], usage: {prompt_tokens: 20, completion_tokens: 30, total_tokens: 50}}, {headers: {'x-request-id': 'synthetic-request-id'}});
  };
  const options = {env, fetch};
  try {
    await initializeSecretStore({rootDirectory, keyFile}); const store = new EncryptedSecretStore({rootDirectory, keyFile});
    const firstRef = await store.write({kind: 'api_key', apiKey: 'synthetic-first-api-key'}, {orgId: ctx.orgId, connectionId});
    await db.query("INSERT INTO connections(id,org_id,provider,account_external_id,display_name,timezone,currency,read_mode,secret_ref) VALUES($1,$2,'deepseek','synthetic-account','Synthetic model','Asia/Shanghai','CNY','native_api',$3)", [connectionId, ctx.orgId, firstRef]);
    const initial = (await (await handleModel(ctx, request('GET'), ['automation', 'model'], {}, options))!.json()).data;
    assert.equal(initial.schema_version, 0); assert.equal(initial.readiness.configured, false);
    const config = {...defaultModelConfiguration, connection_id: connectionId}; const saveKey = randomUUID();
    await assert.rejects(handleModel({...ctx, actorId: DEMO_MARKETER_ID, roles: ['marketer']}, request('PUT', 'automation/model', 0), ['automation', 'model'], config, options), {code: 'FORBIDDEN'});
    const saved = (await (await handleModel(ctx, request('PUT', 'automation/model', 0, saveKey), ['automation', 'model'], config, options))!.json()).data;
    assert.equal(saved.schema_version, 1); assert.equal(saved.readiness.configured, true); assert.equal(saved.readiness.mode, 'real'); assert.equal(saved.verification.models_verified, false);
    assert.doesNotMatch(JSON.stringify(saved), /synthetic-first-api-key|boran-secret:|configuration_fingerprint/);
    const replay = await handleModel(ctx, request('PUT', 'automation/model', 0, saveKey), ['automation', 'model'], config, options); assert.equal((await replay!.json()).meta.idempotency_replay, true);
    await assert.rejects(handleModel(ctx, request('PUT', 'automation/model', 0), ['automation', 'model'], config, options), {code: 'VERSION_CONFLICT'});
    const checked = (await (await handleModel(ctx, request('POST', 'automation/model/verify'), ['automation', 'model', 'verify'], {}, options))!.json()).data;
    assert.equal(checked.models_verified, true); assert.equal(checked.actual_generation_verified, false); assert.equal(posts, 0);
    const getter = await getRuntimeModelConfiguration(ctx, options); assert.equal(getter.verification.models_verified, true); assert.equal(getter.readiness.checks.real_call_verified, false);
    const staleGateway = await createConfiguredAiGateway(ctx, options);
    const replacement = await store.write({kind: 'api_key', apiKey: 'synthetic-second-api-key'}, {orgId: ctx.orgId, connectionId});
    await db.query("UPDATE connections SET secret_ref=$3,capabilities='{}',capabilities_verified_at=NULL,access_status='not_configured' WHERE org_id=$1 AND id=$2", [ctx.orgId, connectionId, replacement]);
    assert.equal((await getRuntimeModelConfiguration(ctx, options)).verification.models_verified, false);
    const cutoff = '2026-10-04T00:00:00.000Z';
    await assert.rejects(staleGateway.generate({workflow: 'weekly_plan', context: {orgId: ctx.orgId, sourceVersions: [], dataCutoff: cutoff}, input: {candidate_topics: []}}), {code: 'AI_NOT_CONFIGURED'});
    const currentGateway = await createConfiguredAiGateway(ctx, options); assert.equal(currentGateway.mode, 'real');
    const output = await currentGateway.generate({workflow: 'weekly_plan', context: {orgId: ctx.orgId, sourceVersions: [], dataCutoff: cutoff}, input: {candidate_topics: []}});
    assert.equal(output.metadata.limit_scope, 'persistent'); assert.equal(posts, 1); assert.equal(output.metadata.provider, 'deepseek');
    assert.equal(Number((await db.query('SELECT count(*) AS n FROM ai_usage_reservations WHERE org_id=$1', [ctx.orgId])).rows[0]!.n), 1);
    assert.equal((await createConfiguredAiGateway({...ctx, mode: 'mock'}, options)).mode, 'mock');
    const audits = JSON.stringify((await db.query('SELECT details FROM audit_logs WHERE org_id=$1', [ctx.orgId])).rows);
    const idempotency = JSON.stringify((await db.query('SELECT response_json FROM idempotency_records WHERE org_id=$1', [ctx.orgId])).rows);
    assert.doesNotMatch(audits + idempotency, /synthetic-first-api-key|synthetic-second-api-key|boran-secret:/);
    assert.ok(gets >= 2);
  } finally {await db.close(); await rm(directory, {recursive: true, force: true});}
});
test('model configuration prevents SSRF, credential injection, invalid wire protocols and unsafe limits', () => {
  const config = {...defaultModelConfiguration, connection_id: '10000000-0000-4000-8000-000000000001'};
  for (const input of [{...config, base_url: 'http://127.0.0.1/private'}, {...config, base_url: 'https://api.deepseek.com.evil.example'}, {...config, base_url: 'https://api.deepseek.com:444'}, {...config, base_url: 'https://credential@api.deepseek.com'}, {...config, base_url: 'https://api.deepseek.com/?api_key=secret'}, {...config, api_key: 'secret'}, {...config, max_calls_per_day: Number.MAX_SAFE_INTEGER}, {...config, protocol: 'messages'}, {...config, base_url: 'https://api.deepseek.com/anthropic'}]) assert.throws(() => validateModelConfiguration(input));
  const messages = validateModelConfiguration({...config, protocol: 'messages', base_url: 'https://api.deepseek.com/anthropic', response_format: 'none'}); assert.equal(messages.protocol, 'messages');
});
test('environment credential references require explicit server allowlist and key changes invalidate catalog proof', async () => {
  const db = await createTestDatabase(); const connectionId = randomUUID();
  const ctx: ServiceContext = {db, orgId: DEMO_ORG_ID, actorId: DEMO_OWNER_ID, roles: ['owner'], mode: 'live'};
  const config = {...defaultModelConfiguration, connection_id: connectionId};
  const env = {...process.env, SYNTHETIC_ALLOWED_MODEL_KEY: 'synthetic-first-env-api-key'};
  try {
    await db.query("INSERT INTO connections(id,org_id,provider,account_external_id,display_name,timezone,currency,read_mode,secret_ref) VALUES($1,$2,'deepseek','synthetic-env-account','Synthetic env model','Asia/Shanghai','CNY','native_api','env:SYNTHETIC_ALLOWED_MODEL_KEY')", [connectionId, ctx.orgId]);
    await db.query("INSERT INTO settings(org_id,key,value,updated_by) VALUES($1,'ai_configuration',$2,$3)", [ctx.orgId, JSON.stringify({configuration: config}), ctx.actorId]);
    assert.equal((await getRuntimeModelConfiguration(ctx, {env})).readiness.configured, false);
    const allowed = {...env, BORAN_ALLOWED_SECRET_ENV_KEYS: 'SYNTHETIC_ALLOWED_MODEL_KEY'};
    assert.equal((await getRuntimeModelConfiguration(ctx, {env: allowed})).readiness.configured, true);
    const fetch: typeof globalThis.fetch = async () => Response.json({data: [{id: 'deepseek-v4-pro'}, {id: 'deepseek-flash'}]});
    await handleModel(ctx, request('POST', 'automation/model/verify'), ['automation', 'model', 'verify'], {}, {env: allowed, fetch});
    assert.equal((await getRuntimeModelConfiguration(ctx, {env: allowed})).verification.models_verified, true);
    assert.equal((await getRuntimeModelConfiguration(ctx, {env: {...allowed, SYNTHETIC_ALLOWED_MODEL_KEY: 'synthetic-second-env-api-key'}})).verification.models_verified, false);
    const foreignOrg = randomUUID(); await db.query("INSERT INTO organizations(id,name,timezone,base_currency) VALUES($1,'Synthetic foreign org','Asia/Shanghai','CNY')", [foreignOrg]);
    await db.query("INSERT INTO memberships(org_id,user_id,roles,active) VALUES($1,$2,ARRAY['owner'],true)", [foreignOrg, ctx.actorId]);
    await assert.rejects(handleModel({...ctx, orgId: foreignOrg}, request('PUT', 'automation/model', 0), ['automation', 'model'], config, {env: allowed}), {code: 'INVALID_MODEL_CONNECTION'});
  } finally {await db.close();}
});
test('a mock identity cannot mutate or verify a real model configuration and its safe GET never resolves credentials', async () => {
  const db = await createTestDatabase(); const connectionId = randomUUID();
  const ctx: ServiceContext = {db, orgId: DEMO_ORG_ID, actorId: DEMO_OWNER_ID, roles: ['owner'], mode: 'mock'};
  const config = {...defaultModelConfiguration, connection_id: connectionId};
  let credentialReads = 0, providerCalls = 0;
  const options = {
    env: {...process.env, AI_MODE: 'real'},
    resolveSecret: async () => {credentialReads++; return 'synthetic-unread-model-key';},
    fetch: (async () => {providerCalls++; return Response.json({data: [{id: 'deepseek-v4-pro'}, {id: 'deepseek-flash'}]});}) as typeof fetch,
  };
  try {
    await db.query("INSERT INTO connections(id,org_id,provider,account_external_id,display_name,timezone,currency,read_mode,secret_ref) VALUES($1,$2,'deepseek','synthetic-real-account','Synthetic live configuration','Asia/Shanghai','CNY','native_api','env:UNUSED_MODEL_KEY')", [connectionId, ctx.orgId]);
    const stored = {configuration: config, verification: {models_verified: true, verified_at: '2026-10-04T00:00:00Z', configuration_fingerprint: 'synthetic-old-proof'}};
    await db.query("INSERT INTO settings(org_id,key,value,schema_version,updated_by) VALUES($1,'ai_configuration',$2,7,$3)", [ctx.orgId, JSON.stringify(stored), ctx.actorId]);
    await assert.rejects(handleModel(ctx, request('PUT', 'automation/model', 7), ['automation', 'model'], config, options), {code: 'LIVE_IDENTITY_REQUIRED', status: 403});
    await assert.rejects(handleModel(ctx, request('POST', 'automation/model/verify'), ['automation', 'model', 'verify'], {}, options), {code: 'LIVE_IDENTITY_REQUIRED', status: 403});
    const dto = (await (await handleModel(ctx, request('GET'), ['automation', 'model'], {}, options))!.json()).data;
    assert.equal(dto.schema_version, 7); assert.equal(dto.readiness.mode, 'mock'); assert.equal(dto.readiness.configured, false); assert.equal(dto.verification.models_verified, false);
    assert.equal(credentialReads, 0); assert.equal(providerCalls, 0); assert.doesNotMatch(JSON.stringify(dto), /UNUSED_MODEL_KEY|synthetic-unread-model-key|configuration_fingerprint/);
    const current = (await db.query("SELECT schema_version,value FROM settings WHERE org_id=$1 AND key='ai_configuration'", [ctx.orgId])).rows[0]!;
    assert.equal(Number(current.schema_version), 7); assert.deepEqual(current.value, stored);
    assert.equal((await createConfiguredAiGateway(ctx, options)).mode, 'mock'); assert.equal(providerCalls, 0);
    const mockReaders = await createConfiguredSourceReaders(ctx, options);
    const liveReaders = await createConfiguredSourceReaders({...ctx, mode: 'live'}, {...options, env: {NODE_ENV: 'test'}});
    for (const kind of ['market_public', 'competitor_public', 'mac_drive', 'chatgpt'] as const) {
      const readRequest = {orgId: ctx.orgId, connectionId, sourceKind: kind, scope: {}, cursor: null};
      const mocked = await mockReaders[kind].read(readRequest); const unconfigured = await liveReaders[kind].read(readRequest);
      assert.equal(mockReaders[kind].mode, 'mock'); assert.equal(mocked.mode, 'mock'); assert.equal(mocked.status, 'failed'); assert.deepEqual(mocked.snapshots, []);
      assert.equal(liveReaders[kind].mode, 'live'); assert.equal(unconfigured.mode, 'live'); assert.equal(unconfigured.status, 'failed'); assert.deepEqual(unconfigured.snapshots, []);
    }
    assert.equal(credentialReads, 0); assert.equal(providerCalls, 0);
  } finally {await db.close();}
});
