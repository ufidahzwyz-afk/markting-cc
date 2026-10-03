import assert from "node:assert/strict";
import test from "node:test";
import { randomUUID } from "node:crypto";
import { openDatabase,migrateDatabase,seedDemo,DEMO_ORG_ID } from "../src/index";
import { scheduleRun,claimStep,completeStep } from "../../../apps/worker/src/queue";

test("PostgreSQL DATE remains a calendar string in Shanghai and UTC processes",{skip:!process.env.BORAN_TEST_PG_URL},async()=>{
  const previous=process.env.TZ;
  try{
    for(const timezone of ["Asia/Shanghai","UTC"]){
      process.env.TZ=timezone;
      const db=await openDatabase({url:process.env.BORAN_TEST_PG_URL!,mode:"live"});
      try{
        const sql="SELECT DATE '2026-09-30' AS business_date, DATE '2026-10-01' AS period_end, TIMESTAMPTZ '2026-09-30T16:00:00Z' AS collected_at";
        const check=(row:Record<string,unknown>)=>{assert.equal(row.business_date,"2026-09-30");assert.equal(row.period_end,"2026-10-01");assert.ok(row.collected_at instanceof Date);assert.equal((row.collected_at as Date).toISOString(),"2026-09-30T16:00:00.000Z");};
        check((await db.query(sql)).rows[0]!);
        await db.transaction(async(tx)=>check((await tx.query(sql)).rows[0]!));
      }finally{await db.close();}
    }
  }finally{if(previous===undefined)delete process.env.TZ;else process.env.TZ=previous;}
});

test("PostgreSQL independent transactions skip locked rows and roll back failed mutations",{skip:!process.env.BORAN_TEST_PG_URL},async()=>{
  const base=process.env.BORAN_TEST_PG_URL!,schema=`test_${randomUUID().replaceAll("-","")}`;
  const admin=await openDatabase({url:base,mode:"live"});
  await admin.query(`CREATE SCHEMA ${schema}`);
  const connection=new URL(base);connection.searchParams.set("options",`-csearch_path=${schema}`);
  const db=await openDatabase({url:connection.toString(),mode:"live"});
  try{
    await migrateDatabase(db);await seedDemo(db);
    const first=await scheduleRun(db,{orgId:DEMO_ORG_ID,kind:"source_watch",periodKey:"first",steps:[{key:"source_sync",mode:"mock"}]});
    const second=await scheduleRun(db,{orgId:DEMO_ORG_ID,kind:"source_watch",periodKey:"second",steps:[{key:"source_sync",mode:"mock"}]});
    let release!:()=>void,locked!:()=>void;
    const releaseBarrier=new Promise<void>((resolve)=>{release=resolve;});const lockBarrier=new Promise<void>((resolve)=>{locked=resolve;});
    const holder=db.transaction(async(tx)=>{await tx.query("SELECT id FROM workflow_steps WHERE run_id=$1 FOR UPDATE",[first.id]);locked();await releaseBarrier;});
    await lockBarrier;
    try{const claim=await claimStep(db,{workerId:"independent-pg-worker"});assert.ok(claim);assert.equal(claim.runId,second.id);await completeStep(db,claim,{mock:true},"changed");}finally{release();await holder;}
    await assert.rejects(()=>db.transaction(async(tx)=>{await tx.query("UPDATE organizations SET name='should-rollback' WHERE id=$1",[DEMO_ORG_ID]);throw new Error("rollback");}),/rollback/);
    assert.equal((await db.query("SELECT name FROM organizations WHERE id=$1",[DEMO_ORG_ID])).rows[0]!.name,"开发模拟组织");
  }finally{await db.close();await admin.query(`DROP SCHEMA ${schema} CASCADE`);await admin.close();}
});
