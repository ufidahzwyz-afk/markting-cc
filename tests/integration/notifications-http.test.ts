import assert from "node:assert/strict";
import test from "node:test";
import { writeFile } from "node:fs/promises";
import { openDatabase, DEMO_ORG_ID, DEMO_OWNER_ID, DEMO_MARKETER_ID } from "@boran/db";
import { uuid, stableHash } from "@boran/domain/core";

const base = process.env.BORAN_NOTIFICATIONS_HTTP_BASE_URL;
const pg = process.env.BORAN_TEST_PG_URL;
test("production HTTP notifications isolate persisted mock/live reports and each operator's read receipts", { skip: !base || !pg, timeout: 20000 }, async () => {
  const origin = new URL(base!).origin;
  assert.ok(["localhost", "127.0.0.1", "[::1]"].includes(new URL(origin).hostname), "engineering HTTP fixtures only run against loopback");
  const db = await openDatabase({ url: pg!, mode: "live" });
  const evidence: Record<string, unknown> = { checked_at: new Date().toISOString(), http_origin: origin, engineering_fixture: true, real_integrations_verified: false, metrics_supplied: false, checks: [] };
  const checks = evidence.checks as Record<string, unknown>[];
  async function session(actorId: string) {
    const response = await fetch(`${origin}/api/v1/session`, { headers: { cookie: `boran_dev_actor=${actorId}` }, signal: AbortSignal.timeout(5000) });
    assert.equal(response.status, 200); const payload = await response.json(); assert.equal(payload.data.actor_id, actorId); assert.equal(payload.data.org_id, DEMO_ORG_ID); assert.equal(payload.data.mode, "mock");
    const csrf = payload.data.csrf_token as string; assert.match(csrf, /^[a-f\d]{64}$/);
    return { actorId, csrf, cookie: `boran_dev_actor=${actorId}; boran_csrf=${csrf}` };
  }
  async function list(actor: Awaited<ReturnType<typeof session>>) {
    const response = await fetch(`${origin}/api/v1/notifications`, { headers: { cookie: actor.cookie }, signal: AbortSignal.timeout(5000) }); assert.equal(response.status, 200);
    const payload = await response.json(); assert.equal(payload.meta.mode, "mock"); assert.ok(Array.isArray(payload.data)); assert.ok(payload.data.every((row: { mode: string }) => row.mode === "mock")); return payload.data as { id: string; mode: string; read: boolean }[];
  }
  async function markRead(actor: Awaited<ReturnType<typeof session>>, id: string, expected: number) {
    const response = await fetch(`${origin}/api/v1/notifications/${id}/read`, { method: "POST", headers: { cookie: actor.cookie, origin, "sec-fetch-site": "same-origin", "content-type": "application/json", "x-csrf-token": actor.csrf, "idempotency-key": uuid() }, body: "{}", signal: AbortSignal.timeout(5000) });
    assert.equal(response.status, expected); const payload = await response.json(); if (expected === 404) assert.equal(payload.error.code, "NOT_FOUND"); else assert.deepEqual(payload.data, { id, read: true }); return response.status;
  }
  try {
    const a = await session(DEMO_OWNER_ID); const b = await session(DEMO_MARKETER_ID);
    const marker = `engineering-notifications-mode-${uuid()}`; const mockReport = uuid(); const liveReport = uuid(); const mockA = uuid(); const mockB = uuid(); const liveA = uuid();
    await db.transaction(async (tx) => {
      await tx.query("SELECT id FROM organizations WHERE id=$1 FOR UPDATE", [DEMO_ORG_ID]);
      let revision = Number((await tx.query("SELECT COALESCE(max(revision),0) AS n FROM report_snapshots WHERE org_id=$1 AND kind='daily' AND period_start='2000-01-01' AND period_end='2000-01-01'", [DEMO_ORG_ID])).rows[0]!.n);
      for (const [id, mode] of [[mockReport, "mock"], [liveReport, "live"]]) {
        const body = { mode, engineering_test: true, fixture_kind: marker, realAcceptance: false, real_integrations_verified: false, facts: [], actions: [], dataGaps: ["SQL engineering fixture only; no live metrics, account capability or external delivery evidence"] };
        await tx.query("INSERT INTO report_snapshots(id,org_id,kind,period_start,period_end,revision,metric_version,source_batch_ids,query_hash,data_cutoff,quality,metrics_json,body_json,archive_status) VALUES($1,$2,'daily','2000-01-01','2000-01-01',$3,'engineering-http-qa',$4,$5,now(),'missing','{}',$6,'pending')", [id, DEMO_ORG_ID, ++revision, [], stableHash(body), JSON.stringify(body)]);
      }
      for (const [id, reportId, actorId] of [[mockA, mockReport, DEMO_OWNER_ID], [mockB, mockReport, DEMO_MARKETER_ID], [liveA, liveReport, DEMO_OWNER_ID]]) await tx.query("INSERT INTO notifications(id,org_id,report_id,channel,recipient_ref,status,attempts) VALUES($1,$2,$3,'in_app',$4,'pending',0)", [id, DEMO_ORG_ID, reportId, `user:${actorId}`]);
    });
    evidence.fixtures = { marker, mock_report_id: mockReport, live_engineering_report_id: liveReport, mock_operator_a_notification: mockA, mock_operator_b_notification: mockB, live_engineering_notification: liveA, retained_in_local_database: true, external_events_created: false };
    const aRows = await list(a); const bRows = await list(b);
    assert.ok(aRows.some((row) => row.id === mockA)); assert.ok(!aRows.some((row) => row.id === mockB || row.id === liveA));
    assert.ok(bRows.some((row) => row.id === mockB)); assert.ok(!bRows.some((row) => row.id === mockA || row.id === liveA));
    checks.push({ check: "mock_list_excludes_live_engineering_fixture", passed: true }, { check: "operator_a_b_inbox_isolation", passed: true }, { check: "response_row_and_meta_mode", mode: "mock", passed: true });
    checks.push({ check: "cross_mode_read", status: await markRead(a, liveA, 404), passed: true });
    checks.push({ check: "a_cannot_read_b", status: await markRead(a, mockB, 404), passed: true });
    checks.push({ check: "b_cannot_read_a", status: await markRead(b, mockA, 404), passed: true });
    checks.push({ check: "a_reads_own_mock", status: await markRead(a, mockA, 200), passed: true });
    checks.push({ check: "b_reads_own_mock", status: await markRead(b, mockB, 200), passed: true });
    assert.equal((await list(a)).find((row) => row.id === mockA)!.read, true); assert.equal((await list(b)).find((row) => row.id === mockB)!.read, true);
    assert.equal((await db.query("SELECT key FROM settings WHERE org_id=$1 AND key=$2", [DEMO_ORG_ID, `notification.read.${liveA}.${DEMO_OWNER_ID}`])).rows.length, 0);
    checks.push({ check: "rejected_cross_mode_read_has_no_read_marker", passed: true });
    evidence.passed = true;
  } catch (error) { evidence.passed = false; evidence.failure = error instanceof Error ? error.message : "verification_failed"; throw error; }
  finally { await db.close(); if (process.env.BORAN_TEST_EVIDENCE_PATH) await writeFile(process.env.BORAN_TEST_EVIDENCE_PATH, `${JSON.stringify(evidence, null, 2)}\n`); }
});
