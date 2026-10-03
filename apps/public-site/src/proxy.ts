import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
export function proxy(request: NextRequest) {
  const environment = process.env.APP_ENV ?? "production";
  const mock = ["development", "test"].includes(environment) && process.env.BORAN_MODE === "mock";
  const live = process.env.BORAN_MODE === "live" && Boolean(process.env.DATABASE_URL && process.env.PUBLIC_SITE_ORG_ID && (process.env.PUBLIC_BASE_URL || process.env.PUBLIC_SITE_ORIGIN));
  if (mock || live) {
    if (live) {
      try { if (request.headers.get("host") !== new URL(process.env.PUBLIC_BASE_URL ?? process.env.PUBLIC_SITE_ORIGIN!).host) return new NextResponse("Not found", { status: 404 }); }
      catch { return new NextResponse("Site configuration required", { status: 503 }); }
    }
    return NextResponse.next();
  }
  return new NextResponse("公网站点尚未配置，当前不接收真实咨询。", { status: 503, headers: { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "no-store", "X-Robots-Tag": "noindex, nofollow" } });
}
export const config = { matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"] };
