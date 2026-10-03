import type {Database} from '@boran/db';
import {DomainError,type ServiceContext} from '@boran/domain/core';
import {requireOwner} from '@boran/domain/authz';
import {scheduleRun} from './queue';
export const scheduleKinds=['source_watch','insight_topics','weekly_plan','metrics_collect','daily_report','seo_review','geo_review','archive'] as const;
export interface OperatingSchedule {enabled:boolean;timezone:'Asia/Shanghai';workflows:string[];business_lines:('yonyou'|'seeyon'|'shared')[];goal_ids:string[];policy_version_id?:string;revision:number;requested_by:string}
export async function validateOperatingSchedule(ctx:ServiceContext,input:unknown):Promise<OperatingSchedule>{
 await requireOwner(ctx);
 if(!input||typeof input!=='object'||Array.isArray(input))throw new DomainError('INVALID_SCHEDULE',422,'周期配置无效');
 const value=input as Record<string,unknown>;
 if(Object.keys(value).some(key=>!['enabled','timezone','workflows','business_lines','goal_ids','policy_version_id'].includes(key))||typeof value.enabled!=='boolean'||value.timezone!=='Asia/Shanghai'||!Array.isArray(value.workflows)||value.workflows.some(kind=>!scheduleKinds.includes(kind as typeof scheduleKinds[number]))||new Set(value.workflows).size!==value.workflows.length||!Array.isArray(value.business_lines)||!value.business_lines.length||value.business_lines.some(line=>!['yonyou','seeyon','shared'].includes(String(line)))||!Array.isArray(value.goal_ids)||value.goal_ids.some(id=>typeof id!=='string'||!/^[-0-9a-f]{36}$/i.test(id)))throw new DomainError('INVALID_SCHEDULE',422,'周期任务、业务线或时区无效');
 for(const id of value.goal_ids)if(!(await ctx.db.query('SELECT id FROM business_goals WHERE org_id=$1 AND id=$2',[ctx.orgId,id])).rows.length)throw new DomainError('INVALID_REFERENCE',422,'周期目标必须属于当前组织');
 if(value.workflows.includes('insight_topics')){if(typeof value.policy_version_id!=='string'||!(await ctx.db.query("SELECT v.id FROM policy_versions v JOIN execution_policies p ON p.org_id=v.org_id AND p.id=v.policy_id WHERE v.org_id=$1 AND v.id=$2 AND p.status='active' AND p.active_version_id=v.id",[ctx.orgId,value.policy_version_id])).rows.length)throw new DomainError('POLICY_INACTIVE',409,'洞察周期需要当前已启用规则');}
 const prior=(await ctx.db.query("SELECT value FROM settings WHERE org_id=$1 AND key='operating_schedule'",[ctx.orgId])).rows[0]?.value as OperatingSchedule|undefined;
 return {enabled:value.enabled,timezone:'Asia/Shanghai',workflows:value.workflows as string[],business_lines:value.business_lines as OperatingSchedule['business_lines'],goal_ids:value.goal_ids as string[],...(typeof value.policy_version_id==='string'?{policy_version_id:value.policy_version_id}:{}),revision:(prior?.revision??0)+1,requested_by:ctx.actorId};
}
function local(at:Date){const parts=Object.fromEntries(new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Shanghai',year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',hourCycle:'h23',weekday:'short'}).formatToParts(at).map(part=>[part.type,part.value]));return {date:`${parts.year}-${parts.month}-${parts.day}`,hour:Number(parts.hour),minute:Number(parts.minute),weekday:parts.weekday};}
function dateShift(value:string,days:number){return new Date(Date.parse(value+'T00:00:00Z')+days*86400000).toISOString().slice(0,10);}
function previousBusinessDay(value:string){return dateShift(value,-1);}
function monday(value:string){const weekday=new Date(value+'T00:00:00Z').getUTCDay();return dateShift(value,-((weekday+6)%7));}
/** Current-period idempotency provides restart catch-up; each phase retains its original workflow identity. */
export async function scheduleDueWorkflows(db:Database,at=new Date()):Promise<number>{
 const settings=(await db.query("SELECT org_id,value FROM settings WHERE key='operating_schedule' AND value->>'enabled'='true'")).rows;
 const now=local(at),minutes=now.hour*60+now.minute;let scheduled=0;
 for(const setting of settings){const config=setting.value as OperatingSchedule;
   const member=(await db.query("SELECT m.id FROM memberships m JOIN users u ON u.id=m.user_id WHERE m.org_id=$1 AND m.user_id=$2 AND m.active AND u.active AND 'owner'=ANY(m.roles)",[setting.org_id,config.requested_by])).rows[0];if(!member)continue;
   const mode=process.env.BORAN_MODE==='live'?'read_only':'mock';
   async function enqueue(kind:typeof scheduleKinds[number],key:string,period:string,extra:Record<string,unknown>={}){
     const input={requested_by:config.requested_by,business_lines:config.business_lines,goal_ids:config.goal_ids,policy_version_id:config.policy_version_id,data_cutoff:at.toISOString(),...extra};
     await scheduleRun(db,{orgId:String(setting.org_id),kind,periodKey:period,scheduleVersion:config.revision,input,steps:[{key,mode,input}]});scheduled++;
   }
   for(const kind of config.workflows){
     if(kind==='source_watch'){
       const connections=(await db.query("SELECT id,source_kind FROM connections WHERE org_id=$1 AND source_kind IN ('market_public','competitor_public','mac_drive','chatgpt')",[setting.org_id])).rows;
       for(const connection of connections){const interval=connection.source_kind==='mac_drive'?15:connection.source_kind==='chatgpt'?30:1440;const slot=interval===1440?now.date:`${now.date}:${Math.floor(minutes/interval)}`;await enqueue('source_watch','source_sync',`${String(connection.id)}:${slot}`,{connection_id:connection.id});}
       continue;
     }
     const previous=previousBusinessDay(now.date),window={period_start:previous,period_end:previous};
     if(kind==='metrics_collect'){if(minutes>=440)await enqueue('metrics_collect','metrics_collect',`${previous}:collect`,window);if(minutes>=470)await enqueue('metrics_collect','metrics_snapshot',`${previous}:snapshot`,window);continue;}
     if(kind==='daily_report'){if(minutes>=480)await enqueue('daily_report','daily_report',`${now.date}:08`,window);if(minutes>=720)await enqueue('daily_report','daily_report',`${now.date}:12`,window);continue;}
     if(kind==='weekly_plan'){const week=monday(now.date);if(now.date!==week||minutes>=480)await enqueue('weekly_plan','draft_plan',week,{week_start:week});continue;}
     if(kind==='insight_topics'){if(minutes>=480)await enqueue('insight_topics','derive_insights',now.date);continue;}
     if(['geo_review','seo_review'].includes(kind)){if(now.weekday==='Fri'&&minutes>=600)await enqueue(kind as 'geo_review'|'seo_review',kind,now.date,window);continue;}
     if(kind==='archive'&&minutes>=490)await enqueue('archive','archive_reports',now.date,window);
   }
 }
 return scheduled;
}
