import type { NextRequest } from 'next/server';
import { NextResponse } from 'next/server';
import { currentOpsAccess } from './lib/access';
import { authenticate } from './lib/server-context';
import { errorResponse } from './lib/http';
export async function proxy(request: NextRequest) {
  // This dedicated callback verifies its own service identity and exact provider signature.
  if(request.nextUrl.pathname==='/api/v1/reception/events')return NextResponse.next();
  const access=currentOpsAccess();
  if(access.allowed){
    if(access.mode==='mock')return NextResponse.next();
    try { await authenticate(request.headers); return NextResponse.next(); }
    catch(error){ return errorResponse(error); }
  }
  if(request.nextUrl.pathname.startsWith('/api/'))return NextResponse.json({error:{code:access.code,message:access.message}},{status:access.status,headers:{'Cache-Control':'no-store'}});
  return new NextResponse(`<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><title>泊冉 · 身份接入待配置</title></head><body style="margin:0;background:#f3f5f8;color:#1d2b3e;font:16px/1.7 system-ui,sans-serif"><main style="max-width:580px;margin:15vh auto;padding:32px"><p>泊冉 · 市场推广工作台</p><h1>身份接入待配置</h1><p>${access.message}</p></main></body></html>`,{status:503,headers:{'Content-Type':'text/html; charset=utf-8','Cache-Control':'no-store','X-Content-Type-Options':'nosniff'}});
}
export const config={matcher:['/((?!_next/static|_next/image|api/health(?:/|$)|favicon.ico).*)']};
