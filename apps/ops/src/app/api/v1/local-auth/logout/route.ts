import { localIdentityReady, revokeLocalSession } from '../../../../../lib/local-identity';
import { authenticate, assertWriteOrigin, cookieValue } from '../../../../../lib/server-context';
import { DomainError } from '@boran/domain/core';
import { errorResponse, jsonData } from '../../../../../lib/http';
export const dynamic = 'force-dynamic';
export async function POST(request: Request) {
  try {
    if (!localIdentityReady(process.env)) throw new DomainError('IDENTITY_NOT_CONFIGURED', 503, '本地账号登录尚未配置');
    const ctx = await authenticate(request.headers);
    assertWriteOrigin(request);
    await revokeLocalSession(ctx.db, ctx.orgId, cookieValue(request.headers, 'boran_local_session'));
    const response = jsonData({ signed_out: true });
    response.headers.append('Set-Cookie', 'boran_local_session=; Path=/; HttpOnly; SameSite=Strict; Max-Age=0');
    return response;
  } catch (error) { return errorResponse(error); }
}
