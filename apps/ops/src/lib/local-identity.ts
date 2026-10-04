import { randomBytes, randomUUID, scrypt, timingSafeEqual, createHash } from 'node:crypto';
import { promisify } from 'node:util';
import type { Database, SqlExecutor } from '@boran/db';
import { DomainError } from '@boran/domain/core';

const derive = promisify(scrypt);
const uuid = /^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i;
const hash = (text: string) => createHash('sha256').update(text).digest('hex');
interface Identity { login_name: string; salt: string; password_hash: string; version: number }
interface Session { actor_id: string; identity_version: number; expires_at: string }
export function localIdentityReady(env: Readonly<Record<string, string | undefined>>): boolean {
  return env.AUTH_MODE === 'local' && ['development', 'test'].includes(env.APP_ENV ?? '') && env.BORAN_MODE === 'live' && uuid.test(env.BORAN_ORG_ID ?? '');
}
function loginName(value: string): string {
  const name = value.trim().toLowerCase();
  if (!/^[a-z0-9][a-z0-9_.-]{2,63}$/.test(name)) throw new DomainError('INVALID_LOGIN_NAME', 422, '登录名须为 3 至 64 个英文字母、数字或 ._-');
  return name;
}
function validIdentity(value: unknown): value is Identity {
  if (!value || typeof value !== 'object') return false;
  const v = value as Identity;
  return typeof v.login_name === 'string' && /^[a-f0-9]{32}$/.test(v.salt) && /^[a-f0-9]{128}$/.test(v.password_hash) && Number.isSafeInteger(v.version) && v.version > 0;
}
async function put(tx: SqlExecutor, orgId: string, key: string, value: unknown, actorId: string) {
  await tx.query('INSERT INTO settings(org_id,key,value,schema_version,updated_by) VALUES($1,$2,$3,1,$4) ON CONFLICT(org_id,key) DO UPDATE SET value=excluded.value,schema_version=settings.schema_version+1,updated_by=excluded.updated_by,updated_at=now()', [orgId, key, JSON.stringify(value), actorId]);
}
/** Called only by the local provisioning command; no password is put in logs or response DTOs. */
export async function configureLocalIdentity(db: Database, input: { orgId: string; ownerId: string; userId: string; loginName: string; password: string }): Promise<void> {
  const name = loginName(input.loginName);
  if (typeof input.password !== 'string' || input.password.length < 12 || Buffer.byteLength(input.password) > 256) throw new DomainError('INVALID_PASSWORD', 422, '本地登录密码须为 12 至 256 字节');
  const salt = randomBytes(16).toString('hex');
  const passwordHash = Buffer.from(await derive(input.password, salt, 64) as Buffer).toString('hex');
  await db.transaction(async tx => {
    await tx.query('SELECT id FROM organizations WHERE id=$1 FOR UPDATE', [input.orgId]);
    const owner = (await tx.query("SELECT m.id FROM memberships m JOIN users u ON u.id=m.user_id WHERE m.org_id=$1 AND m.user_id=$2 AND m.active AND u.active AND 'owner'=ANY(m.roles)", [input.orgId, input.ownerId])).rows[0];
    if (!owner) throw new DomainError('FORBIDDEN', 403, '仅当前负责人可初始化本地登录');
    if (!(await tx.query("SELECT m.id FROM memberships m JOIN users u ON u.id=m.user_id WHERE m.org_id=$1 AND m.user_id=$2 AND m.active AND u.active AND ('owner'=ANY(m.roles) OR 'marketer'=ANY(m.roles))", [input.orgId, input.userId])).rows.length) throw new DomainError('NOT_FOUND', 404, '成员不存在或已停用');
    const duplicate = (await tx.query("SELECT key FROM settings WHERE org_id=$1 AND key LIKE 'local_identity:%' AND value->>'login_name'=$2 AND key<>$3", [input.orgId, name, `local_identity:${input.userId}`])).rows[0];
    if (duplicate) throw new DomainError('LOGIN_NAME_TAKEN', 409, '登录名已被其他成员使用');
    const prior = (await tx.query('SELECT value FROM settings WHERE org_id=$1 AND key=$2', [input.orgId, `local_identity:${input.userId}`])).rows[0]?.value as Identity | undefined;
    await put(tx, input.orgId, `local_identity:${input.userId}`, { login_name: name, salt, password_hash: passwordHash, version: (prior?.version ?? 0) + 1 }, input.ownerId);
    await tx.query("INSERT INTO audit_logs(org_id,actor_type,actor_id,action,target_type,target_id,request_id,details) VALUES($1,'user',$2,'identity.local_configured','user',$3,$4,$5)", [input.orgId, input.ownerId, input.userId, randomUUID(), JSON.stringify({ password_hash_stored: true })]);
  });
}

export async function signInLocal(db: Database, input: { orgId: string; name: string; password: string }, now = new Date()): Promise<{ token: string; actorId: string; expiresAt: string }> {
  const name = loginName(input.name);
  if (typeof input.password !== 'string' || Buffer.byteLength(input.password) > 256) throw new DomainError('UNAUTHENTICATED', 401, '登录名或密码无效');
  const failureKey = `local_login_guard:${hash(name)}`;
  const priorGuard = (await db.query('SELECT value FROM settings WHERE org_id=$1 AND key=$2', [input.orgId, failureKey])).rows[0]?.value as { failures: number; started_at: string } | undefined;
  if (priorGuard && priorGuard.failures >= 10 && Date.parse(priorGuard.started_at) + 15 * 60_000 > now.getTime()) throw new DomainError('RATE_LIMITED', 429, '登录尝试过多，请稍后再试');
  const found = (await db.query("SELECT key,value FROM settings WHERE org_id=$1 AND key LIKE 'local_identity:%' AND value->>'login_name'=$2", [input.orgId, name])).rows[0];
  const identity = validIdentity(found?.value) ? found.value : undefined;
  const candidate = Buffer.from(await derive(input.password, identity?.salt ?? '00000000000000000000000000000000', 64) as Buffer);
  const matches = !!identity && timingSafeEqual(candidate, Buffer.from(identity.password_hash, 'hex'));
  const result = await db.transaction(async tx => {
    await tx.query('SELECT id FROM organizations WHERE id=$1 FOR UPDATE', [input.orgId]);
    const guard = (await tx.query('SELECT value FROM settings WHERE org_id=$1 AND key=$2', [input.orgId, failureKey])).rows[0]?.value as { failures: number; started_at: string } | undefined;
    const activeGuard = guard && Date.parse(guard.started_at) + 15 * 60_000 > now.getTime();
    if (activeGuard && guard.failures >= 10) return { error: 'RATE_LIMITED' as const };
    const actorId = typeof found?.key === 'string' ? found.key.slice('local_identity:'.length) : null;
    const current = actorId ? (await tx.query('SELECT value FROM settings WHERE org_id=$1 AND key=$2', [input.orgId, found!.key])).rows[0]?.value as Identity | undefined : undefined;
    const member = actorId ? (await tx.query('SELECT m.id FROM memberships m JOIN users u ON u.id=m.user_id WHERE m.org_id=$1 AND m.user_id=$2 AND m.active AND u.active', [input.orgId, actorId])).rows[0] : undefined;
    if (!matches || !member || current?.version !== identity?.version) {
      // A valid org member is necessary for the settings foreign key, even for failed logins.
      const recorder = (await tx.query("SELECT m.user_id FROM memberships m JOIN users u ON u.id=m.user_id WHERE m.org_id=$1 AND m.active AND u.active AND 'owner'=ANY(m.roles) ORDER BY m.user_id LIMIT 1", [input.orgId])).rows[0]?.user_id;
      if (recorder) await put(tx, input.orgId, failureKey, { failures: (activeGuard ? guard!.failures : 0) + 1, started_at: activeGuard ? guard!.started_at : now.toISOString() }, String(recorder));
      return { error: 'UNAUTHENTICATED' as const };
    }
    await tx.query('DELETE FROM settings WHERE org_id=$1 AND key=$2', [input.orgId, failureKey]);
    const token = randomBytes(32).toString('hex');
    const expiresAt = new Date(now.getTime() + 8 * 60 * 60_000).toISOString();
    await put(tx, input.orgId, `local_session:${hash(token)}`, { actor_id: actorId, identity_version: identity!.version, expires_at: expiresAt }, actorId!);
    return { token, actorId: actorId!, expiresAt };
  });
  if ('error' in result) throw new DomainError(result.error, result.error === 'RATE_LIMITED' ? 429 : 401, result.error === 'RATE_LIMITED' ? '登录尝试过多，请稍后再试' : '登录名或密码无效');
  return result;
}

export async function resolveLocalSession(db: Database, orgId: string, token: string | undefined, now = new Date()): Promise<string> {
  if (!token || !/^[a-f0-9]{64}$/.test(token)) throw new DomainError('UNAUTHENTICATED', 401, '请登录本地工作台');
  const row = (await db.query('SELECT value FROM settings WHERE org_id=$1 AND key=$2', [orgId, `local_session:${hash(token)}`])).rows[0];
  const session = row?.value as Session | undefined;
  if (!session || !uuid.test(session.actor_id) || !Number.isFinite(Date.parse(session.expires_at)) || Date.parse(session.expires_at) <= now.getTime()) throw new DomainError('UNAUTHENTICATED', 401, '本地登录已过期');
  const identity = (await db.query('SELECT value FROM settings WHERE org_id=$1 AND key=$2', [orgId, `local_identity:${session.actor_id}`])).rows[0]?.value;
  if (!validIdentity(identity) || identity.version !== session.identity_version) throw new DomainError('UNAUTHENTICATED', 401, '登录凭据已更新，请重新登录');
  const member = (await db.query('SELECT m.id FROM memberships m JOIN users u ON u.id=m.user_id WHERE m.org_id=$1 AND m.user_id=$2 AND m.active AND u.active', [orgId, session.actor_id])).rows[0];
  if (!member) throw new DomainError('FORBIDDEN', 403, '组织成员权限已停用');
  return session.actor_id;
}
export async function revokeLocalSession(db: Database, orgId: string, token: string | undefined): Promise<void> {
  if (token && /^[a-f0-9]{64}$/.test(token)) await db.query('DELETE FROM settings WHERE org_id=$1 AND key=$2', [orgId, `local_session:${hash(token)}`]);
}
