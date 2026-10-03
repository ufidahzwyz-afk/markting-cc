import {DEMO_ORG_ID,DEMO_OWNER_ID,type Database} from '@boran/db';
import {DomainError,type ServiceContext} from '@boran/domain/core';
import {pruneExpiredPublicEvents} from '@boran/domain/events';

/** Called by the worker's server scheduler only. Organization and service identity never come from an event or workflow input. */
export async function cleanupPublicEvents(db:Database,environment:Record<string,string|undefined>=process.env,clock?:()=>Date){
 const mock=environment.BORAN_MODE==='mock'&&['development','test'].includes(environment.APP_ENV??'production')&&environment.AUTH_MODE==='mock';
 if(environment.BORAN_MODE!=='live'&&!mock)throw new DomainError('EVENTS_CLEANUP_NOT_CONFIGURED',503,'访问记录保留清理尚未配置');
 const orgId=environment.BORAN_ORG_ID??(mock?DEMO_ORG_ID:undefined);const actorId=environment.PUBLIC_EVENTS_CLEANUP_ACTOR_ID??(mock?DEMO_OWNER_ID:undefined);const uuid=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
 if(!orgId||!actorId||!uuid.test(orgId)||!uuid.test(actorId))throw new DomainError('EVENTS_CLEANUP_NOT_CONFIGURED',503,'访问记录保留清理须固定组织与执行成员');
 const member=(await db.query('SELECT m.roles FROM memberships m JOIN users u ON u.id=m.user_id WHERE m.org_id=$1 AND m.user_id=$2 AND m.active AND u.active',[orgId,actorId])).rows[0];
 if(!(member?.roles as string[]|undefined)?.includes('owner'))throw new DomainError('FORBIDDEN',403,'访问记录清理执行成员已停用或无权限');
 const ctx:ServiceContext={db,orgId,actorId,actorType:'service',roles:member!.roles as string[],mode:mock?'mock':'live',...(clock?{now:clock}:{})};
 return {org_id:orgId,mode:ctx.mode,...await pruneExpiredPublicEvents(ctx)};
}
