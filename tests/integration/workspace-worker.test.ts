import test from 'node:test';
import assert from 'node:assert/strict';
import {createTestDatabase,DEMO_ORG_ID,DEMO_OWNER_ID,DEMO_MARKETER_ID} from '@boran/db';
import {saveWorkspaceTheme,getWorkspaceThemes} from '@boran/domain/workspace';
import {initializeBusinessMaster} from '@boran/domain/marketing';
import {scheduleRun} from '../../apps/worker/src/queue';
import {runOnce} from '../../apps/worker/src/runner';
import {registerDomainHandlers} from '../../apps/worker/src/handlers';
const draft={title:'匿名集成规划',businessLine:'集成服务' as const,status:'草稿' as const,audience:'企业系统管理团队',goal:'收集现状与准备问题',channels:['官网'],owner:'运营 A',tasks:[{id:'new-task',label:'整理范围',done:false}]};
test('database workspace is shared by operators and stale edits cannot overwrite completed planning records',async()=>{
 const db=await createTestDatabase();try{const a={db,orgId:DEMO_ORG_ID,actorId:DEMO_OWNER_ID,roles:['owner','marketer'],mode:'mock' as const};const b={...a,actorId:DEMO_MARKETER_ID,roles:['marketer','sales']};
 await initializeBusinessMaster(a);const created=await saveWorkspaceTheme(a,draft);const before=(await getWorkspaceThemes(b))[0]!;assert.equal(before.id,created.id);
 const updated=await saveWorkspaceTheme(b,{...before,tasks:before.tasks.map(task=>({...task,done:true}))},{id:before.id,expectedVersion:before.version});assert.equal(updated.tasks[0]!.done,true);
 await assert.rejects(()=>saveWorkspaceTheme(a,{...before,title:'覆盖旧版'},{id:before.id,expectedVersion:before.version}),{code:'VERSION_CONFLICT'});
 assert.equal((await getWorkspaceThemes(a))[0]!.title,draft.title);
 await assert.rejects(()=>saveWorkspaceTheme(a,{...draft,status:'进行中'}),{code:'THEME_ACTIVATION_REQUIRED'});
 await db.query('UPDATE memberships SET active=false WHERE org_id=$1 AND user_id=$2',[DEMO_ORG_ID,DEMO_MARKETER_ID]);await assert.rejects(()=>getWorkspaceThemes(b),{code:'FORBIDDEN'});
 }finally{await db.close();}
});
test('registered worker saves a draft plan with honest source gaps, and missing content generator stays needs_human',async()=>{
 const db=await createTestDatabase();try{const ctx={db,orgId:DEMO_ORG_ID,actorId:DEMO_OWNER_ID,roles:['owner','marketer'],mode:'mock' as const};await initializeBusinessMaster(ctx);registerDomainHandlers();
 const plan=await scheduleRun(db,{orgId:DEMO_ORG_ID,kind:'weekly_plan',periodKey:'integration-plan',input:{requested_by:DEMO_OWNER_ID},steps:[{key:'draft_plan',mode:'mock',input:{week_start:'2026-10-05',business_lines:['shared'],goal_ids:[]}}]});
 await runOnce(db,'integration-worker');const persisted=(await db.query('SELECT * FROM plan_cycles WHERE generated_by_run_id=$1',[plan.id])).rows[0]!;assert.equal(persisted.status,'draft');assert.equal((persisted.source_snapshot as Record<string,unknown>).mock,true);assert.equal((await db.query('SELECT id FROM execution_actions')).rows.length,0);
 const generation=await scheduleRun(db,{orgId:DEMO_ORG_ID,kind:'platform_assets',periodKey:'missing-generation',input:{actor_id:DEMO_OWNER_ID},steps:[{key:'content_generate',mode:'mock'}]});
 await runOnce(db,'integration-worker');const state=(await db.query('SELECT status FROM workflow_runs WHERE id=$1',[generation.id])).rows[0]!;assert.equal(state.status,'needs_human');assert.equal((await runOnce(db)).processed,false);
 }finally{await db.close();}
});
