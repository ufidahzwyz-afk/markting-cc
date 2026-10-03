import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { createTestDatabase, openDatabase, migrateDatabase, seedDemo, DEMO_ORG_ID, DEMO_OWNER_ID, DEMO_MARKETER_ID } from "@boran/db";
import type { Database } from "@boran/db";
import { uuid, stableHash } from "../../packages/domain/src/core";
import type { ServiceContext } from "../../packages/domain/src/core";
import { activatePolicy, claimExecutionAction, completeExecutionAction, createApproval, createExecutionAction, createPolicy, createPolicyVersion, decideApproval, reconcileExecutionAction, recoverExpiredActions, revokePolicy } from "../../packages/domain/src/execution";
import type { ExecutionInput, PolicyInput } from "../../packages/domain/src/execution";
import { commitImport, preflightImport } from "../../packages/domain/src/ads";
import { claimStep, completeStep, heartbeatStep, recoverExpiredSteps, scheduleRun } from "../../apps/worker/src/queue";
import { runOnce } from "../../apps/worker/src/runner";
import { handleExecution } from "../../apps/ops/src/lib/handlers/execution";

let db: Database; let ctx: ServiceContext; let pgAdmin: Database | undefined; let pgSchema: string | undefined;
before(async () => {
  if (process.env.BORAN_QA_TEST_PG_URL) {
    pgSchema = `test_qa_${uuid().replaceAll("-", "")}`;
    pgAdmin = await openDatabase({ url: process.env.BORAN_QA_TEST_PG_URL, mode: "live" });
    await pgAdmin.query(`CREATE SCHEMA ${pgSchema}`);
    const scoped = new URL(process.env.BORAN_QA_TEST_PG_URL); scoped.searchParams.set("options", `-csearch_path=${pgSchema}`);
    db = await openDatabase({ url: scoped.toString(), mode: "live" }); await migrateDatabase(db); await seedDemo(db);
  } else db = await createTestDatabase();
  ctx = { db, orgId: DEMO_ORG_ID, actorId: DEMO_OWNER_ID, roles: ["owner", "marketer"], mode: "mock" };
});
after(async () => { await db?.close(); if (pgAdmin && pgSchema) { await pgAdmin.query(`DROP SCHEMA ${pgSchema} CASCADE`); await pgAdmin.close(); } });
async function account() { const connectionId = uuid(); const accountId = uuid(); await db.query("INSERT INTO connections(id,org_id,provider,account_external_id,display_name,timezone,currency,read_mode,enabled_for_reporting,authoritative_report_type) VALUES($1::uuid,$2,'mock',$1::text,'QA匿名连接','Asia/Shanghai','CNY','mock',true,'campaign_daily')", [connectionId, ctx.orgId]); await db.query("INSERT INTO platform_accounts(id,org_id,connection_id,provider,account_external_id,display_name) VALUES($1::uuid,$2,$3,'mock',$1::text,'QA匿名账号')", [accountId, ctx.orgId, connectionId]); return { connectionId, accountId }; }
async function policy(accountIds: string[], overrides: Partial<PolicyInput> = {}) { const input: PolicyInput = { name: "QA隔离授权", accountIds, businessScope: { business_lines: ["shared"] }, allowedActions: ["external.publish"], publishFrequency: { daily_max: 100, weekly_max: 100, min_interval_minutes: 0 }, publishWindows: [{ timezone: "Asia/Shanghai", weekdays: [0, 1, 2, 3, 4, 5, 6], start: "00:00", end: "24:00" }], stopConditions: { max_errors: 1 }, ...overrides }; const record = await createPolicy(ctx, input); const versionId = String((await db.query("SELECT id FROM policy_versions WHERE policy_id=$1", [record.id])).rows[0]!.id); await activatePolicy(ctx, String(record.id), versionId, 1); return { policyId: String(record.id), versionId, input }; }
function action(accountId: string, policyVersionId: string, key = uuid()): ExecutionInput { return { idempotencyKey: key, actionType: "external.publish", target: { platform_account_id: accountId, business_line: "shared" }, payload: { copy: "匿名隔离素材" }, beforeSnapshot: { test: true }, policyVersionId }; }

test("QA AC07: revoked or replaced rules reject previously queued work before execution", async () => {
  const a = await account(); const p = await policy([a.accountId]); const intent = await createExecutionAction(ctx, action(a.accountId, p.versionId)); await revokePolicy(ctx, p.policyId, 2); await assert.rejects(claimExecutionAction(ctx, String(intent.id), "qa-revoked")); assert.equal((await db.query("SELECT state FROM execution_actions WHERE id=$1", [intent.id])).rows[0]!.state, "blocked");
  const q = await policy([a.accountId]); const old = await createExecutionAction(ctx, action(a.accountId, q.versionId)); const tightened = await createPolicyVersion(ctx, q.policyId, { ...q.input, allowedActions: ["ads.pause"], allowedAdOperations: ["pause"], allowedAdEntityLevels: ["keyword"], dailyBudgetMinor: 100, totalBudgetMinor: 100 }, 2); await activatePolicy(ctx, q.policyId, String(tightened.id), 3); await assert.rejects(claimExecutionAction(ctx, String(old.id), "qa-replaced"), { code: "POLICY_INACTIVE" }); assert.equal((await db.query("SELECT state FROM execution_actions WHERE id=$1", [old.id])).rows[0]!.state, "queued");
});
test("QA AC02/08: action and import batch concurrency persist exactly one intent/batch", async () => {
  const a = await account(); const p = await policy([a.accountId]); const input = action(a.accountId, p.versionId); const intents = await Promise.all(Array.from({ length: 8 }, () => createExecutionAction(ctx, input))); assert.equal(new Set(intents.map((row) => row.id)).size, 1); await assert.rejects(createExecutionAction(ctx, { ...input, payload: { copy: "不同载荷" } }), { code: "IDEMPOTENCY_CONFLICT" });
  assert.equal((await db.query("SELECT id FROM outbox_events WHERE org_id=$1 AND aggregate_id=$2 AND event_type='execution.queued'", [ctx.orgId, intents[0]!.id])).rows.length, 1);
  const csv = `business_date,account_id,entity_level,entity_id,parent_id,currency,impressions,clicks,spend_minor,platform_conversions,device,conversion_definition\n2026-10-01,${a.connectionId},campaign,c1,,CNY,100,10,200,1,all,form_submit\n`;
  const imported = { connectionId: a.connectionId, reportType: "campaign_daily" as const, windowStart: "2026-10-01", windowEnd: "2026-10-01", currency: "CNY", timezone: "Asia/Shanghai", csv }; const batches = await Promise.all(Array.from({ length: 8 }, () => preflightImport(ctx, imported))); assert.equal(new Set(batches.map((batch) => batch.id)).size, 1);
  await Promise.all(batches.map((batch) => commitImport(ctx, batch.id, { expectedFileHash: batch.fileHash, confirmCompleteWindow: true, revisionPolicy: "upsert_by_natural_key" }))); const total = (await db.query("SELECT count(*)::integer AS rows,sum(spend_minor)::integer AS spend FROM ad_daily_facts WHERE connection_id=$1", [a.connectionId])).rows[0]!; assert.equal(total.rows, 1); assert.equal(total.spend, 200);
});
test("QA AC23: one policy's budget reservation includes concurrent target accounts", async () => {
  const a = await account(); const b = await account(); const p = await policy([a.accountId, b.accountId], { allowedActions: ["ads.update"], allowedAdOperations: ["update"], allowedAdEntityLevels: ["keyword"], dailyBudgetMinor: 100, totalBudgetMinor: 100 });
  const attempts = await Promise.allSettled(Array.from({ length: 6 }, (_, i) => createExecutionAction(ctx, { idempotencyKey: uuid(), actionType: "ads.update", target: { platform_account_id: i % 2 ? a.accountId : b.accountId, business_line: "shared" }, payload: { operation: "update", entity_level: "keyword" }, beforeSnapshot: { test: true }, policyVersionId: p.versionId, budgetImpactMinor: 25 })));
  assert.equal(attempts.filter((attempt) => attempt.status === "fulfilled").length, 4); assert.equal(attempts.filter((attempt) => attempt.status === "rejected").length, 2); assert.equal((await db.query("SELECT sum((budget_snapshot->>'reserved_minor')::integer)::integer AS reserved FROM execution_actions WHERE policy_version_id=$1", [p.versionId])).rows[0]!.reserved, 100);
});
test("QA account and connection references must describe the same bound target", async () => {
  const a = await account(); const b = await account(); const p = await policy([a.accountId]); const input = action(a.accountId, p.versionId);
  await assert.rejects(createExecutionAction(ctx, { ...input, target: { ...input.target, connection_id: b.connectionId } }));
  const valid = await createExecutionAction(ctx, { ...input, idempotencyKey: uuid(), target: { ...input.target, connection_id: a.connectionId } }); assert.equal((valid.target as Record<string, unknown>).connection_id, a.connectionId);
});
test("QA AC09/17: unknown is not resubmitted; authoritative absence permits retry with original action ID", async () => {
  const a = await account(); const p = await policy([a.accountId]); const input = action(a.accountId, p.versionId); const intent = await createExecutionAction(ctx, input); const claim = await claimExecutionAction(ctx, String(intent.id), "qa-old"); await db.query("UPDATE execution_actions SET lease_until=now()-interval '1 second' WHERE id=$1", [intent.id]); assert.equal(await recoverExpiredActions(ctx), 1);
  await assert.rejects(completeExecutionAction(ctx, String(intent.id), claim.token, { state: "submitted" }), { code: "STALE_LEASE" }); await assert.rejects(claimExecutionAction(ctx, String(intent.id), "qa-blind"), { code: "RECONCILE_REQUIRED" }); const duplicate = await createExecutionAction(ctx, input); assert.equal(duplicate.id, intent.id);
  const absent = await reconcileExecutionAction(ctx, String(intent.id), { outcome: "absent", evidence: { mode: "mock", result: "definitively_absent" } }); assert.equal(absent.state, "retry_wait"); const recovered = await claimExecutionAction(ctx, String(intent.id), "qa-restored"); assert.equal(recovered.action.id, intent.id); assert.ok(BigInt(recovered.token) > BigInt(claim.token)); await completeExecutionAction(ctx, String(intent.id), recovered.token, { state: "verification_pending", evidence: { mode: "mock" }, afterSnapshot: { simulated: true } });
});
test("QA unknown remains unknown for ambiguous evidence; absence after revocation cannot restart writes", async () => {
  const a = await account(); const p = await policy([a.accountId]); const intent = await createExecutionAction(ctx, action(a.accountId, p.versionId));
  const claim = await claimExecutionAction(ctx, String(intent.id), "qa-uncertain"); await completeExecutionAction(ctx, String(intent.id), claim.token, { state: "unknown", evidence: { mode: "mock", reason: "lost_response" } });
  const ambiguous = await reconcileExecutionAction(ctx, String(intent.id), { outcome: "ambiguous", evidence: { mode: "mock", reason: "readback_inconclusive" } }); assert.equal(ambiguous.state, "unknown");
  await assert.rejects(claimExecutionAction(ctx, String(intent.id), "qa-ambiguous"), { code: "RECONCILE_REQUIRED" });
  await revokePolicy(ctx, p.policyId, 2); const absent = await reconcileExecutionAction(ctx, String(intent.id), { outcome: "absent", evidence: { mode: "mock", result: "definitively_absent" } }); assert.equal(absent.state, "blocked");
  await assert.rejects(claimExecutionAction(ctx, String(intent.id), "qa-revoked-after-readback"));
});
test("QA worker: ordered steps survive takeover; late completion and heartbeat are fenced out", async () => {
  const run = await scheduleRun(db, { orgId: ctx.orgId, kind: "source_watch", periodKey: uuid(), steps: [{ key: "source_sync", mode: "mock" }, { key: "qa_archive", mode: "mock" }] }); const old = await claimStep(db, { orgId: ctx.orgId, workerId: "qa-old-worker" }); assert.ok(old); assert.equal(old.runId, run.id); await db.query("UPDATE workflow_steps SET lease_until=now()-interval '1 second' WHERE id=$1", [old.stepId]); const fresh = await claimStep(db, { orgId: ctx.orgId, workerId: "qa-new-worker" }); assert.ok(fresh); assert.equal(fresh.stepId, old.stepId); assert.ok(BigInt(fresh.token) > BigInt(old.token)); await assert.rejects(heartbeatStep(db, old)); await assert.rejects(completeStep(db, old, { mock: true }, "changed")); await completeStep(db, fresh, { mock: true, rows: 1 }, "changed"); const second = await claimStep(db, { orgId: ctx.orgId, workerId: "qa-next" }); assert.ok(second); assert.equal(second.stepKey, "qa_archive"); await completeStep(db, second, { mock: true }); assert.equal((await db.query("SELECT status FROM workflow_runs WHERE id=$1", [run.id])).rows[0]!.status, "succeeded"); assert.equal((await db.query("SELECT attempts FROM workflow_steps WHERE id=$1", [second.stepId])).rows[0]!.attempts, 1);
});
test("QA AC14: pure sales and service identities cannot approve even with forged ctx roles", async () => {
  const a = await account(); const p = await policy([a.accountId]); const approval = await createApproval(ctx, { actionType: "external.publish", target: { platform_account_id: a.accountId }, payload: { copy: "匿名QA" }, expiresAt: new Date(Date.now() + 3600000).toISOString() });
  await db.query("UPDATE memberships SET roles=ARRAY['sales']::text[] WHERE org_id=$1 AND user_id=$2", [ctx.orgId, DEMO_MARKETER_ID]); const sales = { ...ctx, actorId: DEMO_MARKETER_ID, roles: ["owner"] }; await assert.rejects(activatePolicy(sales, p.policyId, p.versionId, 2), { code: "FORBIDDEN" }); await assert.rejects(decideApproval(sales, String(approval.id), { decision: "approved", expectedPayloadHash: stableHash(approval.payload), expectedVersion: 1 }), { code: "FORBIDDEN" }); await assert.rejects(activatePolicy({ ...ctx, actorType: "service" }, p.policyId, p.versionId, 2), { code: "FORBIDDEN" });
  await db.query("UPDATE memberships SET roles=ARRAY['marketer','sales']::text[] WHERE org_id=$1 AND user_id=$2", [ctx.orgId, DEMO_MARKETER_ID]);
});
test("QA worker: missing handler cannot report success, source failure differs from no-change, external lease stops", async () => {
  const run = await scheduleRun(db, { orgId: ctx.orgId, kind: "platform_assets", periodKey: uuid(), steps: [{ key: "qa_missing_handler", mode: "mock" }] }); const result = await runOnce(db, "qa-no-handler"); assert.equal(result.blocked, true); const step = (await db.query("SELECT * FROM workflow_steps WHERE run_id=$1", [run.id])).rows[0]!; assert.equal(step.state, "needs_human"); assert.equal(step.output_ref, null);
  const source = await scheduleRun(db, { orgId: ctx.orgId, kind: "source_watch", periodKey: uuid(), steps: [{ key: "source_sync", mode: "mock" }] }); const claim = await claimStep(db, { orgId: ctx.orgId, workerId: "qa-source" }); assert.ok(claim); await completeStep(db, claim, { mock: true, reason: "source_unavailable" }, "failed"); assert.equal((await db.query("SELECT status FROM workflow_runs WHERE id=$1", [source.id])).rows[0]!.status, "failed");
  await db.query("UPDATE organizations SET write_enabled=true WHERE id=$1", [ctx.orgId]); const external = await scheduleRun(db, { orgId: ctx.orgId, kind: "publish_content", periodKey: uuid(), steps: [{ key: "qa_external", mode: "external_write" }] }); await db.query("UPDATE workflow_steps SET state='running',lease_until=now()-interval '1 second',lease_owner='qa-dead' WHERE run_id=$1", [external.id]); assert.equal(await recoverExpiredSteps(db), 1); assert.equal((await db.query("SELECT status FROM workflow_runs WHERE id=$1", [external.id])).rows[0]!.status, "needs_human"); assert.equal((await db.query("SELECT state FROM workflow_steps WHERE run_id=$1", [external.id])).rows[0]!.state, "unknown"); await db.query("UPDATE organizations SET write_enabled=false WHERE id=$1", [ctx.orgId]);
});
test("QA execution API: second-org membership does not expose first-org records and current roles override cached roles", async () => {
  const otherOrg = uuid(); await db.query("INSERT INTO organizations(id,name,timezone,base_currency) VALUES($1,'匿名隔离第二组织','Asia/Shanghai','CNY')", [otherOrg]);
  await db.query("INSERT INTO memberships(id,org_id,user_id,roles,active) VALUES($1,$2,$3,ARRAY['owner'],true)", [uuid(), otherOrg, ctx.actorId]);
  const created = await handleExecution(ctx, new Request("http://localhost/api/v1/tasks", { method: "POST", headers: { "idempotency-key": uuid() } }), ["tasks"], { title: "匿名权限QA", type: "source_watch", business_line: "shared" }); const task = (await created!.json()).data;
  await assert.rejects(handleExecution({ ...ctx, orgId: otherOrg }, new Request(`http://localhost/api/v1/tasks/${task.id}`), ["tasks", String(task.id)]), { code: "NOT_FOUND" });
  const records = await handleExecution({ ...ctx, orgId: otherOrg }, new Request("http://localhost/api/v1/tasks"), ["tasks"]); assert.deepEqual((await records!.json()).data, []);
  await db.query("UPDATE memberships SET roles=ARRAY['sales'] WHERE org_id=$1 AND user_id=$2", [ctx.orgId, ctx.actorId]);
  try { for (const resource of ["tasks", "runs", "approvals", "actions", "execution-policies"]) await assert.rejects(handleExecution(ctx, new Request(`http://localhost/api/v1/${resource}`), [resource]), { code: "FORBIDDEN" }); }
  finally { await db.query("UPDATE memberships SET roles=ARRAY['owner','marketer'] WHERE org_id=$1 AND user_id=$2", [ctx.orgId, ctx.actorId]); }
});
test("QA task brief rejects normalized credential labels, full-width bearer syntax and escaped token URL keys", async () => {
  const forbidden = [{ nested: [{ "ａｐｉ＿ｋｅｙ": "PRIVATE_SENTINEL" }] }, { nested: { note: "Ｂｅａｒｅｒ　PRIVATE_SENTINEL" } }, { nested: { url: "https://example.invalid/read?%61ccess%5Ftoken=PRIVATE_SENTINEL" } }];
  for (const brief of forbidden) await assert.rejects(handleExecution(ctx, new Request("http://localhost/api/v1/tasks", { method: "POST", headers: { "idempotency-key": uuid() } }), ["tasks"], { title: "脱敏边界QA", type: "source_watch", business_line: "shared", brief }), { code: "SENSITIVE_TASK_BRIEF" });
});
test("QA publication delayed beyond the approved account window is blocked, while an exact single approval remains executable", async () => {
  const a = await account(); const at = (time: string): ServiceContext => ({ ...ctx, now: () => new Date(time) }); const morning = at("2026-10-05T02:00:00Z");
  const record = await createPolicy(morning, { name: "批准周一上午窗口", accountIds: [a.accountId], businessScope: { business_lines: ["shared"] }, allowedActions: ["external.publish"], publishFrequency: { daily_max: 100, weekly_max: 100, min_interval_minutes: 0 }, publishWindows: [{ timezone: "Asia/Shanghai", account_ids: [a.accountId], weekdays: [1], start: "09:00", end: "11:00" }], stopConditions: { max_errors: 1 } });
  const versionId = String((await db.query("SELECT id FROM policy_versions WHERE policy_id=$1", [record.id])).rows[0]!.id); await activatePolicy(morning, String(record.id), versionId, 1);
  const onTime = await createExecutionAction(morning, action(a.accountId, versionId)); const delayed = await createExecutionAction(morning, action(a.accountId, versionId));
  const accepted = await claimExecutionAction(at("2026-10-05T02:59:00Z"), String(onTime.id), "qa-window-open"); assert.equal(accepted.action.state, "executing");
  await assert.rejects(claimExecutionAction(at("2026-10-05T03:00:00Z"), String(delayed.id), "qa-after-window"), { code: "PUBLISH_WINDOW_CLOSED" }); assert.equal((await db.query("SELECT state FROM execution_actions WHERE id=$1", [delayed.id])).rows[0]!.state, "blocked");
  const evening = at("2026-10-05T11:00:00Z"); const single = await createApproval(evening, { actionType: "external.publish", target: { platform_account_id: a.accountId }, payload: { copy: "单次确切授权" }, expiresAt: "2026-10-06T11:00:00Z" });
  await decideApproval(evening, String(single.id), { decision: "approved", expectedPayloadHash: String(single.payload_hash), expectedVersion: 1 });
  const exception = await createExecutionAction(evening, { idempotencyKey: uuid(), actionType: "external.publish", target: single.target as Record<string, unknown>, payload: single.payload as Record<string, unknown>, beforeSnapshot: single.before_snapshot as Record<string, unknown>, approvalId: String(single.id) });
  assert.equal((await claimExecutionAction(evening, String(exception.id), "qa-approved-exception")).action.state, "executing");
});
