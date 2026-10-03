import { openDatabase, migrateDatabase, seedDemo } from "@boran/db";

const db = await openDatabase({mode: process.env.BORAN_MODE === "live" ? "live" : "mock"});
try {
  if (process.argv[2] === "migrate") await migrateDatabase(db);
  else if (process.argv[2] === "seed") {
    if (process.env.APP_ENV !== "development" && process.env.APP_ENV !== "test") throw new Error("Demo seeds are only allowed in development/test");
    await seedDemo(db);
  } else throw new Error("Use database.ts migrate or seed");
  console.log("Database command completed.");
} finally { await db.close(); }
