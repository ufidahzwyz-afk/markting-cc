import type { Database } from "./index";

export async function seedDemo(db: Database): Promise<void> {
  await db.transaction(async (tx) => {
    await tx.query("INSERT INTO organizations(id,name,timezone,base_currency,write_enabled,created_at,updated_at) VALUES ('00000000-0000-4000-8000-000000000001','开发模拟组织','Asia/Shanghai','CNY',false,now(),now()) ON CONFLICT(id) DO NOTHING");
    for (const [id, name, role] of [["00000000-0000-4000-8000-000000000002", "模拟运营 A", "owner"], ["00000000-0000-4000-8000-000000000003", "模拟运营 B", "marketer"]]) {
      await tx.query("INSERT INTO users(id,identity_subject,email,display_name,active,created_at,updated_at) VALUES ($1,$2,$3,$4,true,now(),now()) ON CONFLICT(id) DO NOTHING", [id, `mock:${id}`, `${role}@example.invalid`, name]);
      await tx.query("INSERT INTO memberships(id,org_id,user_id,roles,active) VALUES ($1,'00000000-0000-4000-8000-000000000001',$2,$3,true) ON CONFLICT(org_id,user_id) DO NOTHING", [role === "owner" ? "00000000-0000-4000-8000-000000000004" : "00000000-0000-4000-8000-000000000005", id, role === "owner" ? ["owner", "marketer"] : ["marketer", "sales"]]);
    }
  });
}

if (process.argv[1] && new URL(import.meta.url).pathname === process.argv[1]) {
  const { openDatabase } = await import("./index");
  const db = await openDatabase({ initialize: false });
  try { await seedDemo(db); process.stdout.write("Anonymous demo organization and two memberships initialized\n"); }
  finally { await db.close(); }
}
