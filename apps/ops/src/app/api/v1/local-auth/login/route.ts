import { localIdentityReady, signInLocal } from '../../../../../lib/local-identity';
import { getDatabase } from '../../../../../lib/server-context';
import { DomainError } from '@boran/domain/core';
import { readBody, errorResponse, jsonData } from '../../../../../lib/http';

export const dynamic = 'force-dynamic';
export async function POST(request: Request) {
  try {
    if (!localIdentityReady(process.env)) throw new DomainError('IDENTITY_NOT_CONFIGURED', 503, '本地账号登录尚未配置');
    const origin = new URL(process.env.OPS_BASE_URL ?? request.url).origin;
    if (request.headers.get('origin') !== origin || request.headers.get('sec-fetch-site') === 'cross-site') throw new DomainError('CSRF_REJECTED', 403, '请求来源验证失败');
    const body = await readBody(request);
    if (Object.keys(body).some(key => !['login_name', 'password'].includes(key)) || typeof body.login_name !== 'string' || typeof body.password !== 'string') throw new DomainError('INVALID_REQUEST', 400, '请填写登录名和密码');
    const session = await signInLocal(await getDatabase(), { orgId: process.env.BORAN_ORG_ID!, name: body.login_name, password: body.password });
    const response = jsonData({ actor_id: session.actorId, expires_at: session.expiresAt, mode: 'live' });
    response.headers.append('Set-Cookie', `boran_local_session=${session.token}; Path=/; HttpOnly; SameSite=Strict; Max-Age=28800${new URL(request.url).protocol === 'https:' ? '; Secure' : ''}`);
    return response;
  } catch (error) { return errorResponse(error); }
}
