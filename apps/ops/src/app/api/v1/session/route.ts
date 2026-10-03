import { randomBytes } from "node:crypto";
import { DEMO_MARKETER_ID, DEMO_OWNER_ID } from "@boran/db";
import { authenticate, cookieValue, isLocalIdentity } from "@/lib/server-context";
import { errorResponse, jsonData } from "@/lib/http";

export const dynamic = "force-dynamic";
export async function GET(request: Request) {
  try {
    const ctx = await authenticate(request.headers);
    const existing = cookieValue(request.headers, "boran_csrf");
    const csrf = existing && /^[0-9a-f]{64}$/.test(existing) ? existing : randomBytes(32).toString("hex");
    const response = jsonData({ actor_id: ctx.actorId, org_id: ctx.orgId, roles: ctx.roles, mode: ctx.mode, csrf_token: csrf, available_actors: isLocalIdentity() ? [{ id: DEMO_OWNER_ID, name: "运营 A" }, { id: DEMO_MARKETER_ID, name: "运营 B" }] : [] });
    response.headers.append("Set-Cookie", `boran_csrf=${csrf}; Path=/; HttpOnly; SameSite=Strict${new URL(request.url).protocol === "https:" ? "; Secure" : ""}`);
    return response;
  } catch (error) { return errorResponse(error); }
}
