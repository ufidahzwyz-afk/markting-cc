import {createHash} from 'node:crypto';
import type {SqlExecutor} from '@boran/db';
import {validateApiRequest} from '@boran/contracts';
import {audit,DomainError,nowIso,requireRole,stableHash,uuid,type ServiceContext} from './core';
import {contactHmac,effectiveLeadRoles,privacyKeys,requirePrivacyConfiguration,sanitizeAttribution,type PrivacyOptions} from './privacy';

export interface PublicEvent {event_id:string;event_type:'page_view'|'cta_click'|'form_start'|'form_submit';occurred_at:string;page_id:string;release_id?:string;attribution?:Record<string,string>;properties?:Record<string,unknown>}
export interface EventBatch {events:PublicEvent[]}
export interface AnalyticsConfiguration {enabled:boolean;notice_version:string;purpose:string;lawful_basis:'consent';retention_days:number;allowed_event_types:PublicEvent['event_type'][];allow_attribution:boolean;allow_identifiers:boolean;approved_by?:string;approved_at?:string}
export interface PublicEventOptions extends PrivacyOptions {rateLimitKey:string;publicHost?:string}
const types=['page_view','cta_click','form_start','form_submit'];
const uuid4=/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const configKeys=new Set(['enabled','notice_version','purpose','lawful_basis','retention_days','allowed_event_types','allow_attribution','allow_identifiers']);
const attributionKeys=new Set(['utm_source','utm_medium','utm_campaign','utm_content','utm_term','click_id','session_id','anonymous_id']);
const propertiesKeys=new Set(['analytics_consent','privacy_notice_version','cta_id','form_schema_id']);
function configuration(input:unknown,persisted=false):AnalyticsConfiguration {
 if(!input||typeof input!=='object'||Array.isArray(input))throw new DomainError('INVALID_ANALYTICS_CONFIGURATION',422,'访问统计配置无效');const value=input as Record<string,unknown>;
 if(Object.keys(value).some(key=>!configKeys.has(key)&&!(persisted&&['approved_by','approved_at'].includes(key)))||typeof value.enabled!=='boolean')throw new DomainError('INVALID_ANALYTICS_CONFIGURATION',422,'访问统计配置字段无效');
 for(const [key,limit]of [['notice_version',100],['purpose',2000]] as const)if((value.enabled||value[key]!==undefined)&&(typeof value[key]!=='string'||!value[key].trim()||value[key].length>limit))throw new DomainError('INVALID_ANALYTICS_CONFIGURATION',422,'访问统计告知或用途无效');
 if((value.enabled||value.lawful_basis!==undefined)&&value.lawful_basis!=='consent')throw new DomainError('INVALID_ANALYTICS_CONFIGURATION',422,'行为统计合法基础无效');
 if((value.enabled||value.retention_days!==undefined)&&(!Number.isInteger(value.retention_days)||Number(value.retention_days)<1||Number(value.retention_days)>3650))throw new DomainError('INVALID_ANALYTICS_CONFIGURATION',422,'行为统计保留期无效');
 for(const key of ['allow_attribution','allow_identifiers'])if((value.enabled||value[key]!==undefined)&&typeof value[key]!=='boolean')throw new DomainError('INVALID_ANALYTICS_CONFIGURATION',422,'行为统计选项无效');
 if((value.enabled||value.allowed_event_types!==undefined)&&(!Array.isArray(value.allowed_event_types)||value.allowed_event_types.length<1||value.allowed_event_types.length>4||new Set(value.allowed_event_types).size!==value.allowed_event_types.length||value.allowed_event_types.some(type=>!types.includes(String(type)))))throw new DomainError('INVALID_ANALYTICS_CONFIGURATION',422,'允许事件配置无效');
 if(value.enabled){
  if(persisted&&(typeof value.approved_by!=='string'||typeof value.approved_at!=='string'||!Number.isFinite(Date.parse(value.approved_at))))throw new DomainError('INVALID_ANALYTICS_CONFIGURATION',422,'访问统计批准记录无效');
 }
 return {...value} as unknown as AnalyticsConfiguration;
}
export async function validateAnalyticsConfiguration(ctx:ServiceContext,input:unknown):Promise<AnalyticsConfiguration>{
 requireRole(ctx,'owner');if(!(await effectiveLeadRoles(ctx)).includes('owner'))throw new DomainError('FORBIDDEN',403,'仅负责人可配置行为统计');
 const value=configuration(input);return {...value,approved_by:ctx.actorId,approved_at:nowIso(ctx)};
}
async function analyticsGate(ctx:ServiceContext,event:PublicEvent,options:PublicEventOptions,tx:SqlExecutor){
 const privacy=await requirePrivacyConfiguration(ctx,options,tx);const row=(await tx.query("SELECT value FROM settings WHERE org_id=$1 AND key='analytics_configuration'",[ctx.orgId])).rows[0];
 let config:AnalyticsConfiguration;try{config=configuration(row?.value,true);}catch{throw new DomainError('ANALYTICS_CONFIGURATION_REQUIRED',503,'行为统计尚未配置');}
 const member=(await tx.query('SELECT m.roles FROM memberships m JOIN users u ON u.id=m.user_id WHERE m.org_id=$1 AND m.user_id=$2 AND m.active AND u.active',[ctx.orgId,config.approved_by])).rows[0];
 if(!config.enabled||!(member?.roles as string[]|undefined)?.includes('owner')||config.retention_days>privacy.retention_days||!config.allowed_event_types.includes(event.event_type)||config.notice_version!==privacy.notice_version)throw new DomainError('ANALYTICS_CONFIGURATION_REQUIRED',503,'行为统计配置或批准已失效');
 if(event.properties?.analytics_consent!==true||event.properties.privacy_notice_version!==config.notice_version)throw new DomainError('ANALYTICS_CONSENT_REQUIRED',422,'行为统计须本次明确同意对应告知版本');
 if(Object.keys(event.attribution??{}).length&&!config.allow_attribution)throw new DomainError('ANALYTICS_ATTRIBUTION_DISABLED',422,'归因观测未启用');
 if((event.attribution?.session_id||event.attribution?.anonymous_id)&&!config.allow_identifiers)throw new DomainError('ANALYTICS_IDENTIFIERS_DISABLED',422,'访问标识未启用');
 return config;
}
function restricted(event:PublicEvent){
 if(event.attribution&&Object.keys(event.attribution).some(key=>!attributionKeys.has(key)))throw new DomainError('INVALID_EVENT_ATTRIBUTION',400,'事件来源字段不允许');
 if(event.properties&&Object.keys(event.properties).some(key=>!propertiesKeys.has(key)))throw new DomainError('INVALID_EVENT_PROPERTIES',400,'事件属性不允许');
 for(const key of ['anonymous_id','session_id'])if(event.attribution?.[key]&&!uuid4.test(event.attribution[key]!))throw new DomainError('INVALID_EVENT_IDENTIFIER',400,'访问标识必须是随机 UUID');
 if(event.properties?.analytics_consent!==undefined&&typeof event.properties.analytics_consent!=='boolean')throw new DomainError('INVALID_EVENT_PROPERTIES',400,'事件同意值无效');
 for(const [key,value]of Object.entries(event.properties??{}))if(key!=='analytics_consent'&&(typeof value!=='string'||value.length>100||!value.trim()||key!=='privacy_notice_version'&&!/^[a-zA-Z0-9_-]+$/.test(value)))throw new DomainError('INVALID_EVENT_PROPERTIES',400,'事件属性格式无效');
}
/** The default counter persists page identity only. Identifiers and behavioral attribution require separate informed consent. */
export async function ingestPublicEvents(ctx:ServiceContext,input:EventBatch,options:PublicEventOptions){
 validateApiRequest('EventBatch',input);if(typeof options.rateLimitKey!=='string'||!options.rateLimitKey||options.rateLimitKey.length>200||ctx.mode==='live'&&!options.publicHost)throw new DomainError('EVENTS_NOT_CONFIGURED',503,'访问统计接收尚未配置');
 for(const event of input.events){restricted(event);const occurred=Date.parse(event.occurred_at),now=Date.parse(nowIso(ctx));if(occurred>now+300000||occurred<now-30*86400000)throw new DomainError('INVALID_EVENT_TIME',422,'事件时间超过允许范围');}
 return ctx.db.transaction(async tx=>{
  await tx.query('SELECT id FROM organizations WHERE id=$1 FOR UPDATE',[ctx.orgId]);const time=nowIso(ctx);let accepted=0,duplicate=0;
  const prepared:Array<{event:PublicEvent;attribution:Record<string,string>;properties:Record<string,unknown>;anonymous:string|null;session:string|null;releaseId:string;hash:string;existing:boolean}>=[];
  for(const event of input.events){
   const page=(await tx.query('SELECT p.published_release_id FROM pages p JOIN releases r ON r.org_id=p.org_id AND r.id=p.published_release_id AND r.page_id=p.id JOIN content_versions v ON v.org_id=r.org_id AND v.id=r.content_version_id JOIN content_items c ON c.org_id=v.org_id AND c.id=v.content_item_id WHERE p.org_id=$1 AND p.id=$2 AND c.deleted_at IS NULL AND ($3::text IS NULL OR p.host=$3)',[ctx.orgId,event.page_id,options.publicHost??null])).rows[0];
   if(!page||!event.release_id||event.release_id!==page.published_release_id)throw new DomainError('EVENT_PAGE_NOT_PUBLISHED',409,'事件须指向当前已发布页面版本');
   const behavioral=event.event_type!=='page_view'||Object.keys(event.attribution??{}).length>0||Object.keys(event.properties??{}).length>0;
   let attribution:Record<string,string>={},properties:Record<string,unknown>={},anonymous:string|null=null,session:string|null=null;
   if(behavioral){const config=await analyticsGate(ctx,event,options,tx);attribution=sanitizeAttribution(event.attribution??{});anonymous=attribution.anonymous_id??null;session=attribution.session_id??null;delete attribution.anonymous_id;delete attribution.session_id;
    if(attribution.click_id)attribution.click_id=contactHmac('analytics_click',attribution.click_id,privacyKeys(ctx,options).hmac);
    properties={...event.properties,collection_mode:'consented_behavior',retention_until:new Date(Date.parse(time)+config.retention_days*86400000).toISOString(),synthetic:ctx.mode==='mock'};
   }else properties={collection_mode:'anonymous_page_total',retention_until:new Date(Date.parse(time)+86400000).toISOString(),synthetic:ctx.mode==='mock'};
   const hash=behavioral?contactHmac('analytics_event_payload',stableHash(event),privacyKeys(ctx,options).hmac):stableHash({event_id:event.event_id,event_type:event.event_type,occurred_at:event.occurred_at,page_id:event.page_id,release_id:event.release_id,attribution,properties:event.properties??{},anonymous,session});
   const existing=(await tx.query("SELECT request_hash FROM idempotency_records WHERE org_id=$1 AND scope='public_web_event' AND key=$2",[ctx.orgId,event.event_id])).rows[0];
   if(existing&&existing.request_hash!==hash)throw new DomainError('IDEMPOTENCY_CONFLICT',409,'同一事件标识不能用于不同事件');
   prepared.push({event,attribution,properties,anonymous,session,releaseId:event.release_id,hash,existing:Boolean(existing)});
  }
  const newIds=[...new Set(prepared.filter(entry=>!entry.existing).map(entry=>entry.event.event_id))];const known=(await tx.query('SELECT event_id FROM web_events WHERE org_id=$1 AND event_id=ANY($2::uuid[])',[ctx.orgId,newIds])).rows.length;
  if(known<newIds.length){const minute=time.slice(0,16);const scope=`public_event_rate:${createHash('sha256').update(`${options.rateLimitKey}:${minute}`).digest('hex')}`;const key=stableHash(newIds.sort());const count=await tx.query('SELECT key FROM idempotency_records WHERE org_id=$1 AND scope=$2',[ctx.orgId,scope]);if(count.rowCount>=60)throw new DomainError('RATE_LIMITED',429,'访问统计请求过于频繁');
   await tx.query('INSERT INTO idempotency_records(org_id,scope,key,request_hash,status_code,response_json,expires_at,created_at) VALUES($1,$2,$3::text,$3::text,202,$4,$5,$6) ON CONFLICT(org_id,scope,key) DO NOTHING',[ctx.orgId,scope,key,'{}',new Date(Date.parse(time)+120000).toISOString(),time]);
  }
  for(const entry of prepared){if(entry.existing){duplicate++;continue;}const inserted=await tx.query('INSERT INTO web_events(id,org_id,event_id,event_type,occurred_at,received_at,page_id,release_id,anonymous_id,session_id,attribution,properties) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12) ON CONFLICT(org_id,event_id) DO NOTHING RETURNING id',[uuid(),ctx.orgId,entry.event.event_id,entry.event.event_type,entry.event.occurred_at,time,entry.event.page_id,entry.releaseId,entry.anonymous,entry.session,JSON.stringify(entry.attribution),JSON.stringify(entry.properties)]);
   if(inserted.rowCount){accepted++;await tx.query("INSERT INTO idempotency_records(org_id,scope,key,request_hash,status_code,response_json,resource_id,expires_at) VALUES($1,'public_web_event',$2,$3,202,$4,$5,$6)",[ctx.orgId,entry.event.event_id,entry.hash,'{}',inserted.rows[0]!.id,new Date(Date.parse(time)+30*86400000).toISOString()]);}else{const prior=(await tx.query("SELECT request_hash FROM idempotency_records WHERE org_id=$1 AND scope='public_web_event' AND key=$2",[ctx.orgId,entry.event.event_id])).rows[0];if(prior?.request_hash!==entry.hash)throw new DomainError('IDEMPOTENCY_CONFLICT',409,'同一事件标识不能用于不同事件');duplicate++;}
  }
  const result={data:{accepted_count:accepted,duplicate_count:duplicate},meta:{request_id:uuid()}};validateApiRequest('EventAccepted',result);return result;
 });
}

/** Worker cleanup uses an active configured service member; no anonymous caller can erase event records. */
export async function pruneExpiredPublicEvents(ctx:ServiceContext){
 requireRole(ctx,'owner');return ctx.db.transaction(async tx=>{
  if(!(await effectiveLeadRoles(ctx,tx)).includes('owner'))throw new DomainError('FORBIDDEN',403,'访问记录保留清理须有效执行身份');
  const expired=await tx.query("DELETE FROM web_events WHERE org_id=$1 AND id IN (SELECT id FROM web_events WHERE org_id=$1 AND properties->>'retention_until' IS NOT NULL AND properties->>'retention_until'<=$2 ORDER BY received_at LIMIT 1000) RETURNING id",[ctx.orgId,nowIso(ctx)]);
  if(expired.rowCount)await audit(ctx,tx,'analytics.retention_pruned','organization',ctx.orgId,{deleted_count:expired.rowCount});
  return {deleted_count:expired.rowCount};
 });
}
