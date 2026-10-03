import { currentOpsAccess } from "@/lib/access";
import { overviewFixture } from "@/lib/fixtures";

export const dynamic = "force-dynamic";

export function GET() {
  const access = currentOpsAccess();
  if (!access.allowed) return Response.json({ error: { code: access.code, message: access.message } }, { status: access.status, headers: { "Cache-Control": "no-store" } });
  return Response.json({ data: overviewFixture, meta: { environment: access.environment, dataSource: "fixture", label: "开发环境 · 模拟数据" } }, { headers: { "Cache-Control": "no-store" } });
}
