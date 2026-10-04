import { createBrowserService } from '@boran/browser-runtime/service';
import { createPlatformRegistry } from '@boran/connectors';
import { createSecretStoreFromEnvironment, type SecretPayload } from '@boran/connectors/secrets';
import { requireActiveRole } from '@boran/domain/authz';
import { audit, DomainError, stableHash, type ServiceContext } from '@boran/domain/core';
import { idempotencyKey, jsonData, transactionContext } from '../http';
import { connectionDto, connectionVersion } from './browser';

type Row = Record<string, unknown>;
function secretText(body: Row, key: string, optional = false): string | undefined {
  const value = body[key];
  if (optional && value === undefined) return undefined;
  if (typeof value !== 'string' || !value || value.length > 10000) throw new DomainError('INVALID_CREDENTIAL', 422, '凭据字段缺失或格式无效');
  return value;
}
function payload(body: Row): SecretPayload {
  const permitted: Record<string, string[]> = { api_key: ['kind', 'api_key'], platform_password: ['kind', 'username', 'password', 'token'], drive_oauth: ['kind', 'client_id', 'client_secret', 'refresh_token', 'access_token', 'expires_at'] };
  const keys = permitted[String(body.kind)];
  if (!keys || Object.keys(body).some(key => !keys.includes(key))) throw new DomainError('INVALID_CREDENTIAL', 422, '凭据类型或字段无效');
  if (body.kind === 'api_key') return { kind: 'api_key', apiKey: secretText(body, 'api_key')! };
  if (body.kind === 'platform_password') return { kind: 'platform_password', username: secretText(body, 'username')!, password: secretText(body, 'password')!, ...(body.token === undefined ? {} : { token: secretText(body, 'token')! }) };
  const expires = secretText(body, 'expires_at', true);
  if (expires !== undefined && !Number.isFinite(Date.parse(expires))) throw new DomainError('INVALID_CREDENTIAL', 422, 'OAuth 有效期无效');
  return { kind: 'drive_oauth', clientId: secretText(body, 'client_id')!, clientSecret: secretText(body, 'client_secret')!, refreshToken: secretText(body, 'refresh_token')!, ...(body.access_token === undefined ? {} : { accessToken: secretText(body, 'access_token')! }), ...(expires === undefined ? {} : { expiresAt: expires }) };
}

/** Credential bodies never enter an audit record, idempotency response or ordinary settings JSON. */
export async function handleCredentials(ctx: ServiceContext, request: Request, segments: string[], body: Row = {}): Promise<Response | null> {
  if (!['connections', 'platform-accounts'].includes(segments[0] ?? '') || segments.length !== 3 || segments[2] !== 'credentials' || request.method !== 'POST') return null;
  if (ctx.mode !== 'live') throw new DomainError('LIVE_IDENTITY_REQUIRED', 403, '真实凭据须由独立登录的真实工作空间保存');
  await requireActiveRole(ctx, ctx.db, 'owner', 'admin');
  const resourceId = segments[1]!;
  const account = segments[0] === 'platform-accounts' ? (await ctx.db.query('SELECT connection_id FROM platform_accounts WHERE org_id=$1 AND id=$2', [ctx.orgId, resourceId])).rows[0] : null;
  if (segments[0] === 'platform-accounts' && !account) throw new DomainError('NOT_FOUND', 404, '组织内账号不存在');
  const connectionId = account ? String(account.connection_id) : resourceId;
  const connection = (await ctx.db.query('SELECT * FROM connections WHERE org_id=$1 AND id=$2', [ctx.orgId, connectionId])).rows[0];
  if (!connection) throw new DomainError('NOT_FOUND', 404, '组织内连接不存在');
  if (connection.read_mode === 'mock' || connection.read_mode === 'manual_import') throw new DomainError('CREDENTIAL_MODE_REQUIRED', 409, '真实凭据须保存到独立真实连接，模拟历史不改变模式');
  const value = payload(body);
  if (value.kind === 'drive_oauth' && connection.provider !== 'google_drive' || value.kind === 'platform_password' && ['google_drive', 'public_web', 'mock'].includes(String(connection.provider))) throw new DomainError('CREDENTIAL_PROVIDER_MISMATCH', 422, '凭据类型与连接服务不一致');
  const expected = request.headers.get('if-match')?.replace(/^W\//, '').replaceAll('"', '');
  if (!expected || !/^[a-f0-9]{64}$/.test(expected)) throw new DomainError('VERSION_REQUIRED', 428, '保存凭据需要连接的 If-Match edit_version');
  let store: ReturnType<typeof createSecretStoreFromEnvironment>;
  try { store = createSecretStoreFromEnvironment(process.env); } catch { throw new DomainError('SECRET_STORE_NOT_CONFIGURED', 503, '请先在服务端配置加密凭据存储目录和密钥文件'); }
  const secretScope = { orgId: ctx.orgId, connectionId };
  const key = idempotencyKey(request), scope = `credentials:${segments[0]}:${resourceId}:${ctx.actorId}`;
  const hash = stableHash({ fingerprint: await store.fingerprint(value, secretScope), expected });
  let writtenRef: string | undefined;
  try {
    const result = await ctx.db.transaction(async tx => {
      await requireActiveRole(ctx, tx, 'owner', 'admin');
      await tx.query("INSERT INTO idempotency_records(org_id,scope,key,request_hash,expires_at) VALUES($1,$2,$3,$4,now()+interval '7 days') ON CONFLICT(org_id,scope,key) DO NOTHING", [ctx.orgId, scope, key, hash]);
      const prior = (await tx.query('SELECT request_hash,response_json,status_code FROM idempotency_records WHERE org_id=$1 AND scope=$2 AND key=$3 FOR UPDATE', [ctx.orgId, scope, key])).rows[0]!;
      if (prior.request_hash !== hash) throw new DomainError('IDEMPOTENCY_CONFLICT', 409, '同一幂等键不能保存不同凭据');
      if (prior.status_code !== null) return { data: prior.response_json, replay: true };
      const current = (await tx.query('SELECT * FROM connections WHERE org_id=$1 AND id=$2 FOR UPDATE', [ctx.orgId, connectionId])).rows[0];
      if (!current) throw new DomainError('NOT_FOUND', 404, '组织内连接不存在');
      if (connectionVersion(current) !== expected) throw new DomainError('VERSION_CONFLICT', 409, '连接配置已变化，请刷新后重试');
      writtenRef = await store.write(value, secretScope);
      const updated = (await tx.query("UPDATE connections SET secret_ref=$3,access_status='not_configured',health='unknown',capabilities='{}',capabilities_verified_at=NULL,last_error_code=NULL,updated_at=clock_timestamp() WHERE org_id=$1 AND id=$2 RETURNING *", [ctx.orgId, connectionId, writtenRef])).rows[0]!;
      await tx.query("UPDATE platform_accounts SET session_status='not_connected',enabled=false,adapter_version=NULL,session_version=session_version+1,version=version+1,updated_at=now() WHERE org_id=$1 AND connection_id=$2", [ctx.orgId, connectionId]);
      await tx.query("UPDATE connections SET browser_fencing_token=browser_fencing_token+1 WHERE org_id=$1 AND id=$2", [ctx.orgId, connectionId]);
      await tx.query("UPDATE login_sessions SET state='cancelled' WHERE org_id=$1 AND platform_account_id IN (SELECT id FROM platform_accounts WHERE org_id=$1 AND connection_id=$2) AND state IN ('created','active')", [ctx.orgId, connectionId]);
      await tx.query("UPDATE browser_commands SET state=CASE WHEN state='running' AND command_type IN ('publish','ad_write') THEN 'unknown' ELSE 'blocked' END WHERE org_id=$1 AND connection_id=$2 AND state IN ('queued','running')", [ctx.orgId, connectionId]);
      const login = (updated.scope_json as Row).platform_login as Row | undefined;
      const loginCommands: string[] = [];
      if (value.kind === 'platform_password' && typeof login?.recipe_id === 'string' && typeof login.recipe_version === 'string') {
        const commandContext = { ...transactionContext(ctx, tx), mode: 'live' as const };
        const browser = createBrowserService(commandContext, { adapters: createPlatformRegistry({ mode: 'live' }) });
        const accounts = (await tx.query('SELECT id,session_version FROM platform_accounts WHERE org_id=$1 AND connection_id=$2 ORDER BY id', [ctx.orgId, connectionId])).rows;
        for (const account of accounts) {
          const command = await browser.enqueue({ command_type: 'login', connection_id: connectionId, platform_account_id: String(account.id), adapter_version: login.recipe_version, session_version: Number(account.session_version), idempotency_key: `credential-login:${stableHash({scope,key,accountId:account.id}).slice(0,48)}`, input_ref: {} });
          loginCommands.push(command.id);
        }
        if (!accounts.length && updated.source_kind === 'chatgpt') {
          const command = await browser.enqueue({ command_type: 'login', connection_id: connectionId, adapter_version: login.recipe_version, idempotency_key: `credential-login:${stableHash({scope,key,connectionId}).slice(0,48)}`, input_ref: {} });
          loginCommands.push(command.id);
        }
      }
      const data = { ...connectionDto(updated), credential_kind: value.kind, credential_saved: true, verified: false, login_command_ids: loginCommands, login_status: loginCommands.length ? 'queued' : value.kind === 'platform_password' ? 'adapter_configuration_required' : 'verification_required' };
      await tx.query('UPDATE idempotency_records SET response_json=$4,status_code=200,updated_at=now() WHERE org_id=$1 AND scope=$2 AND key=$3', [ctx.orgId, scope, key, JSON.stringify(data)]);
      await audit(transactionContext(ctx, tx), tx, 'connection.credential.saved', 'connection', connectionId, { credential_kind: value.kind, verified: false });
      return { data, replay: false };
    });
    return jsonData(result.data, 200, { idempotency_replay: result.replay });
  } catch (error) {
    if (writtenRef) await store.delete(writtenRef, secretScope).catch(() => undefined);
    if (error instanceof DomainError) throw error;
    throw new DomainError('CREDENTIAL_SAVE_FAILED', 503, '凭据未保存，请检查服务端加密存储配置');
  }
}
