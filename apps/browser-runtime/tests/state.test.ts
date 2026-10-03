import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { createTestDatabase, DEMO_ORG_ID, DEMO_OWNER_ID, DEMO_MARKETER_ID } from "@boran/db";
import type { ServiceContext } from "@boran/domain/core";
import { createPlatformRegistry } from "@boran/connectors";
import { createBrowserService, parseBrowserCommand } from "../src/service";

test("persistent browser leases, version fences, uncertainty recovery and bound login tickets", async (t) => {
  const db = await createTestDatabase();
  let now = new Date();
  const ctx: ServiceContext = { db, orgId: DEMO_ORG_ID, actorId: DEMO_OWNER_ID, roles: ["owner"], mode: "mock", now: () => now };
  const adapters = createPlatformRegistry({ mode: "mock" });
  const service = createBrowserService(ctx, { adapters });
  const accounts: string[] = [];
  for (let index = 0; index < 3; index++) {
    const connection = randomUUID(), account = randomUUID(); accounts.push(account);
    await db.query("INSERT INTO connections(id,org_id,provider,account_external_id,display_name,read_mode,timezone,currency) VALUES ($1,$2,'wechat_mp',$3,'isolated test','mock','Asia/Shanghai','CNY')", [connection, ctx.orgId, `test-account-${index}`]);
    await db.query("INSERT INTO platform_accounts(id,org_id,connection_id,provider,channel_id,account_external_id,display_name,enabled,session_status,adapter_version,timezone) VALUES($1,$2,$3,'wechat_mp','wechat_mp',$4,'isolated test',true,'active','test-v1','Asia/Shanghai')", [account, ctx.orgId, connection, `test-account-${index}`]);
  }
  const enqueue = (accountId: string, key: string = randomUUID()) => service.enqueue({ command_type: "session_verify", idempotency_key: key, platform_account_id: accountId, adapter_version: "test-v1", input_ref: {} });
  try {
    await t.test("fixed schema rejects URL/script/shell, unknown command and unbound writes", () => {
      assert.throws(() => parseBrowserCommand({ command_type: "shell", idempotency_key: "bad", connection_id: accounts[0], adapter_version: "v1", input_ref: {} }));
      assert.throws(() => parseBrowserCommand({ command_type: "session_verify", idempotency_key: "bad", platform_account_id: accounts[0], adapter_version: "v1", input_ref: { url: "https://example.com" } }));
      assert.throws(() => parseBrowserCommand({ command_type: "publish", idempotency_key: "bad", platform_account_id: accounts[0], adapter_version: "v1", input_ref: {} }));
    });
    await t.test("same key returns same command; different immutable payload conflicts", async () => {
      const first = await enqueue(accounts[0]!, "same-command");
      assert.equal((await enqueue(accounts[0]!, "same-command")).id, first.id);
      await assert.rejects(() => service.enqueue({ command_type: "ad_read", idempotency_key: "same-command", platform_account_id: accounts[0]!, adapter_version: "test-v1", input_ref: {} }), /idempotency_conflict/);
    });
    await t.test("one account one lease, two global leases, late result version fence", async () => {
      const first = await enqueue(accounts[0]!); const duplicateAccount = await enqueue(accounts[0]!);
      const a = await service.claim(first.id, "node-a");
      await assert.rejects(() => service.claim(duplicateAccount.id, "node-b"), /account_busy/);
      const second = await enqueue(accounts[1]!); await service.claim(second.id, "node-a");
      const third = await enqueue(accounts[2]!); await assert.rejects(() => service.claim(third.id, "node-a"), /browser_capacity_exhausted/);
      await db.query("UPDATE platform_accounts SET session_version=session_version+1 WHERE org_id=$1 AND id=$2", [ctx.orgId, accounts[0]]);
      await assert.rejects(() => service.heartbeat(first.id, "node-a", Number(a.fencing_token)), /stale_browser_lease/);
      await db.query("UPDATE browser_commands SET state='cancelled' WHERE org_id=$1 AND state IN ('running','queued')", [ctx.orgId]);
    });
    await t.test("mock execution blocks external work and cannot fake verified success", async () => {
      const command = await enqueue(accounts[2]!);
      assert.equal((await service.execute(command.id, "mock-node")).state, "blocked");
      const proofCommand = await enqueue(accounts[2]!); const claim = await service.claim(proofCommand.id, "mock-node");
      await assert.rejects(() => service.finish(claim.id, "mock-node", Number(claim.fencing_token), { status: "verified", evidence: { verified: true, externalAccountId: "test-account-2", evidenceRef: "test/evidence", capturedAt: now.toISOString(), kind: "browser_readback" } }), /unverified_result/);
      await service.finish(claim.id, "mock-node", Number(claim.fencing_token), { status: "blocked", reason: "test_complete" });
    });
    await t.test("challenge pauses the account and invalidates earlier session version", async () => {
      const command = await enqueue(accounts[0]!); const claimed = await service.claim(command.id, "challenge-node");
      assert.equal((await service.finish(claimed.id, "challenge-node", Number(claimed.fencing_token), { status: "challenge_required", reason: "platform_mfa" })).state, "blocked");
      const next = await enqueue(accounts[0]!);
      await assert.rejects(() => service.claim(next.id, "challenge-node"), /challenge_required/);
      assert.equal((await db.query("SELECT session_status FROM platform_accounts WHERE id=$1", [accounts[0]])).rows[0]!.session_status, "challenge_required");
    });
    await t.test("expired uncertain write becomes unknown; repeat execute rejected and reconcile is read-only", async () => {
      const command = randomUUID();
      await db.query("INSERT INTO browser_commands(id,org_id,platform_account_id,command_type,idempotency_key,state,fencing_token,session_version,input_ref,lease_owner,lease_until) VALUES($1,$2,$3,'publish',$6,'running',1,0,$4,'lost-node',$5)", [command, ctx.orgId, accounts[1], JSON.stringify({ refs: {}, adapter_version: "test-v1", payload_hash: "test" }), new Date(now.getTime() - 1).toISOString(), command]);
      await service.recoverExpired();
      assert.equal((await service.get(command)).state, "unknown");
      await assert.rejects(() => service.claim(command, "new-node"), /reconciliation_required/);
      const reconciliation = await service.reconcile(command);
      assert.equal(reconciliation.command_type, "reconcile");
      assert.equal(reconciliation.input_ref.refs.reconcile_command_id, command);
    });
    await t.test("login ticket stored as hash, actor/account bound, consumed once, distinct 60s/900s limits", async () => {
      const login = await service.createLogin(accounts[2]!);
      const stored = (await db.query("SELECT * FROM login_sessions WHERE id=$1", [login.id])).rows[0]!;
      assert.notEqual(stored.ticket_hash, login.ticket);
      assert.equal(JSON.stringify(stored).includes(login.ticket), false);
      assert.equal(Date.parse(login.ticketExpiresAt) - now.getTime(), 60_000);
      assert.equal(Date.parse(login.expiresAt) - now.getTime(), 900_000);
      const otherUser = createBrowserService({ ...ctx, actorId: DEMO_MARKETER_ID, roles: ["marketer"] }, { adapters });
      await assert.rejects(() => otherUser.redeemLogin({ sessionId: login.id, accountId: accounts[2]!, ticket: login.ticket }), /login_binding_mismatch/);
      await assert.rejects(() => service.redeemLogin({ sessionId: login.id, accountId: accounts[1]!, ticket: login.ticket }), /login_binding_mismatch/);
      await service.redeemLogin({ sessionId: login.id, accountId: accounts[2]!, ticket: login.ticket });
      await assert.rejects(() => service.redeemLogin({ sessionId: login.id, accountId: accounts[2]!, ticket: login.ticket }), /login_ticket_invalid/);
      const blocked = await enqueue(accounts[2]!);
      await assert.rejects(() => service.claim(blocked.id, "automatic"), /manual_login_active/);
      await assert.rejects(() => service.completeLogin(login.id, accounts[2]!, async () => ({ verified: true, externalAccountId: "test-account-2", evidenceRef: "test/evidence", capturedAt: now.toISOString(), kind: "browser_readback" })), /real_verification_required/);
      now = new Date(now.getTime() + 901_000);
      await assert.rejects(() => service.authorizeInteraction(login.id, accounts[2]!), /login_interaction_denied/);
      await service.recoverExpired(); assert.equal((await db.query("SELECT state FROM login_sessions WHERE id=$1", [login.id])).rows[0]!.state, "expired");
    });
    await t.test("unconsumed ticket is invalid exactly at 60 seconds", async () => {
      const login = await service.createLogin(accounts[2]!);
      now = new Date(now.getTime() + 60_000);
      await assert.rejects(() => service.redeemLogin({ sessionId: login.id, accountId: accounts[2]!, ticket: login.ticket }), /login_ticket_invalid/);
    });
  } finally { await db.close(); }
});
