import type {Database} from '@boran/db';
import {BrowserRecipeRegistry,createRuntimePlatformRegistry} from '@boran/browser-runtime';
import {assertActionExecutable} from '@boran/domain/execution';
import type {BrowserServiceDependencies} from '@boran/browser-runtime/service';
import {browserDispatchEnvironment,queueBrowserActions,type BrowserDispatchReadiness} from '@boran/browser-runtime/dispatcher';

/** No capability booleans are accepted from HTTP. Overrides are for reviewed in-process adapters / tests only. */
export async function dispatchBrowserWork(db:Database,options?:{mode?:'mock'|'live';workerId?:string;dependencies?:BrowserServiceDependencies;readiness?:BrowserDispatchReadiness}){
 const env=browserDispatchEnvironment();const mode=options?.mode??env.mode;
 const recipes=options?.dependencies?undefined:await BrowserRecipeRegistry.fromFile(process.env.BROWSER_RECIPES_FILE,(process.env.BROWSER_WEBSITE_ALLOWED_ORIGINS??'').split(',').map(value=>value.trim()).filter(Boolean));
 const dependencies:BrowserServiceDependencies=options?.dependencies??{adapters:createRuntimePlatformRegistry({mode,database:async()=>db,recipes:recipes!}),authorizeAction:async(ctx,tx,actionId)=>{await assertActionExecutable(ctx,tx,actionId);}};
 const readiness=options?.readiness??{...env.readiness,configuredPlatforms:[...dependencies.adapters].filter(([,adapter])=>adapter.mode===mode&&(adapter.readiness().configured??adapter.readiness().connected)).map(([channel])=>channel)};
 let queued=0,blocked=0;
 for(const orgId of readiness.orgIds){const result=await queueBrowserActions({db,orgId,actorId:options?.workerId??'persistent-worker',actorType:'service',roles:['service'],mode},readiness,dependencies);queued+=result.queued;blocked+=result.blocked;}
 return{queued,blocked};
}
