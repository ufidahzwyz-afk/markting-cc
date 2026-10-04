import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createTestDatabase, openDatabase, migrateDatabase, rollbackDatabase, seedDemo, DEMO_ORG_ID, DEMO_OWNER_ID } from "../src/index";

test("upgraded baseline preserves 60 business tables and adds a durable model quota ledger",async()=>{
  const db=await createTestDatabase();
  try{
    assert.equal(Number((await db.query("SELECT count(*) AS count FROM information_schema.tables WHERE table_schema='public'")).rows[0]!.count),62);
    assert.deepEqual(await migrateDatabase(db),[]);await seedDemo(db);
    assert.equal((await db.query("SELECT id FROM users")).rows.length,2);
    assert.equal((await db.query("SELECT id FROM memberships")).rows.length,2);
    assert.equal((await db.query("SELECT write_enabled FROM organizations")).rows[0]!.write_enabled,false);
    assert.equal((await db.query("SELECT sha256 FROM schema_migrations")).rows[0]!.sha256!.toString().length,64);
    await db.query("UPDATE schema_migrations SET sha256=repeat('0',64)");
    await assert.rejects(()=>migrateDatabase(db),/changed after application/);
  }finally{await db.close();}
});

test("composite foreign keys reject cross-org records and immutable audit rows reject edits",async()=>{
  const db=await createTestDatabase();
  try{
    const org="10000000-0000-4000-8000-000000000001";
    await db.query("INSERT INTO organizations(id,name,timezone,base_currency,write_enabled) VALUES($1,'other','Asia/Shanghai','CNY',false)",[org]);
    await assert.rejects(()=>db.query("INSERT INTO tasks(org_id,type,title,brief,business_line,owner_user_id,due_at,priority,status,version) VALUES($1,'content','isolated','{}','shared',$2,now(),'P1','todo',1)",[org,DEMO_OWNER_ID]),/foreign key/i);
    await db.query("INSERT INTO audit_logs(org_id,actor_type,actor_id,action,target_type,target_id,request_id,details) VALUES($1,'service','test','test','test','test','test','{}')",[DEMO_ORG_ID]);
    await assert.rejects(()=>db.query("UPDATE audit_logs SET action='tampered'"),/append-only/i);
    await assert.rejects(()=>db.query("INSERT INTO workflow_runs(org_id,kind,period_key,schedule_version,status,input_ref) VALUES($1,'source_sync','bad',1,'queued','{}')",[DEMO_ORG_ID]),/check constraint/i);
  }finally{await db.close();}
});

test("rollback is explicit, transactional and baseline can be reapplied",async()=>{
  const db=await createTestDatabase();
  try{assert.equal(await rollbackDatabase(db),5);assert.equal(await rollbackDatabase(db),4);assert.equal(await rollbackDatabase(db),3);assert.equal(await rollbackDatabase(db),2);assert.equal(await rollbackDatabase(db),1);assert.deepEqual(await migrateDatabase(db),[1,2,3,4,5]);await seedDemo(db);assert.equal((await db.query("SELECT id FROM users")).rows.length,2);}finally{await db.close();}
});

test("V1.4 additive upgrade retains baseline business rows, original modes and migration checksums",async()=>{
  const db=await createTestDatabase();
  try{
    for(const version of [5,4,3]) assert.equal(await rollbackDatabase(db),version);
    await db.query("INSERT INTO settings(org_id,key,value,schema_version,updated_by) VALUES($1,'existing-business-setting','{\"retained\":true}',3,$2)",[DEMO_ORG_ID,DEMO_OWNER_ID]);
    await db.query("INSERT INTO tasks(org_id,type,title,brief,business_line,owner_user_id,due_at,priority,status,version) VALUES($1,'content','existing editable task','{\"manual\":true}','shared',$2,now(),'P1','todo',7)",[DEMO_ORG_ID,DEMO_OWNER_ID]);
    const baseline = async()=>({settings:(await db.query("SELECT * FROM settings ORDER BY id")).rows,tasks:(await db.query("SELECT * FROM tasks ORDER BY id")).rows,users:(await db.query("SELECT * FROM users ORDER BY id")).rows,memberships:(await db.query("SELECT * FROM memberships ORDER BY id")).rows,checksums:(await db.query("SELECT version,sha256,down_sha256 FROM schema_migrations WHERE version<=2 ORDER BY version")).rows});
    const before=await baseline();
    assert.deepEqual(await migrateDatabase(db),[3,4,5]);
    assert.deepEqual(await baseline(),before);
    assert.equal((await db.query("SELECT write_enabled FROM organizations WHERE id=$1",[DEMO_ORG_ID])).rows[0]!.write_enabled,false);
  }finally{await db.close();}
});

test("persistent local PostgreSQL survives reopen; public-existing mode never bootstraps an absent database",async()=>{
  const dir=await mkdtemp(join(tmpdir(),"boran-db-"));
  try{
    await assert.rejects(()=>openDatabase({dataDir:join(dir,"absent"),mode:"mock",initialize:false}),/Existing database/);
    const db=await openDatabase({dataDir:join(dir,"persist"),mode:"mock"});
    await db.query("INSERT INTO settings(org_id,key,value,schema_version,updated_by) VALUES($1,'persist-test','{\"value\":42}',1,$2)",[DEMO_ORG_ID,DEMO_OWNER_ID]);
    // The process owns one engine per path; callers share it rather than duplicate writers.
    const shared=await openDatabase({dataDir:join(dir,"persist"),mode:"mock",initialize:false});
    assert.equal((await shared.query("SELECT value FROM settings WHERE key='persist-test'")).rows[0]!.value && ((await shared.query("SELECT value FROM settings WHERE key='persist-test'")).rows[0]!.value as {value:number}).value,42);
    await db.close();
    const reopened=await openDatabase({dataDir:join(dir,"persist"),mode:"mock",initialize:false});
    assert.equal((await reopened.query("SELECT id FROM settings WHERE key='persist-test'")).rows.length,1);
    await reopened.close();
  }finally{await rm(dir,{recursive:true,force:true});}
});
