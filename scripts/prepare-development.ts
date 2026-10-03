import { openDatabase, migrateDatabase, seedDemo, DEMO_ORG_ID, DEMO_OWNER_ID } from '@boran/db';
import { initializeBusinessMaster } from '@boran/domain/marketing';
import { getWorkspaceThemes, saveWorkspaceTheme } from '@boran/domain/workspace';
import { freshWorkspaceThemes } from '../apps/ops/src/lib/workspace-fixtures';

if (!['development','test'].includes(process.env.APP_ENV ?? '') || process.env.BORAN_MODE === 'live') throw new Error('Development bootstrap requires explicit development/test and mock mode');
const db = await openDatabase({mode:'mock'});
try {
  await migrateDatabase(db);
  await seedDemo(db);
  const ctx = {db,orgId:DEMO_ORG_ID,actorId:DEMO_OWNER_ID,roles:['owner','marketer'],mode:'mock' as const};
  await initializeBusinessMaster(ctx);
  await db.query("INSERT INTO connections(org_id,provider,account_external_id,display_name,timezone,currency,read_mode,access_status,health,enabled_for_reporting) VALUES($1,'baidu_ads','demo_baidu','百度搜索 · 测试报表','Asia/Shanghai','CNY','mock','not_configured','unknown',true) ON CONFLICT(org_id,provider,account_external_id) DO NOTHING",[DEMO_ORG_ID]);
  await db.query("UPDATE connections SET authoritative_report_type='campaign_daily' WHERE org_id=$1 AND provider='baidu_ads' AND account_external_id='demo_baidu' AND read_mode='mock' AND authoritative_report_type IS NULL",[DEMO_ORG_ID]);
  if (!(await getWorkspaceThemes(ctx)).length) for (const theme of freshWorkspaceThemes()) {
    await saveWorkspaceTheme(ctx,{...theme,status:theme.status === '进行中' ? '草稿' : theme.status,tasks:theme.tasks.map(task=>({...task,done:false}))});
  }
  console.log('Development database ready: two synthetic operators, business dictionary and draft planning tasks. External writes disabled.');
} finally { await db.close(); }
