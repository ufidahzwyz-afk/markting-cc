import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { currentOpsAccess } from "./lib/access";

export function proxy(request: NextRequest) {
  const access = currentOpsAccess();
  if (access.allowed) return NextResponse.next();

  if (request.nextUrl.pathname.startsWith("/api/")) {
    return NextResponse.json({ error: { code: access.code, message: access.message } }, { status: access.status, headers: { "Cache-Control": "no-store" } });
  }

  return new NextResponse(`<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>泊冉 · 身份接入待配置</title></head><body style="margin:0;background:#f3f5f8;color:#1d2b3e;font:16px/1.7 system-ui,sans-serif"><main style="max-width:580px;margin:15vh auto;padding:32px"><p style="color:#2455c7;font-weight:700">泊冉 · 市场推广工作台</p><h1 style="font-size:28px">身份接入待配置</h1><p>${access.message}</p><p>真实业务访问和写入尚未开放。</p></main></body></html>`, {
    status: access.status,
    headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff" },
  });
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|api/health(?:/|$)|favicon.ico).*)"],
};
