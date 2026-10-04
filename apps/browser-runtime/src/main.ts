import { openDatabase, type Database } from '@boran/db';
import { assertActionExecutable } from '@boran/domain/execution';
import { DomainError } from '@boran/domain/core';
import { createLocalServiceIdentityVerifier, createServiceIdentityVerifier } from './auth';
import { createBrowserService, type BrowserServiceDependencies } from './service';
import { createBrowserServer } from './server';
import { BrowserProfilePool } from './profiles';
import { assertPublicationWindow, browserDispatchEnvironment, startBrowserDispatcher } from './dispatcher';
import { BrowserRecipeRegistry } from './recipes';
import { createChatGptLoginHooks, createRuntimePlatformRegistry } from './runtime-hooks';
import { CHATGPT_SOURCE_ORIGINS, createChatGptSourceAdapter, loadChatGptReadRecipe, type ChatGptSourceCapture } from './chatgpt-source';
import { LoginChallengeManager } from './challenges';

const configuration=browserDispatchEnvironment();
const {mode,readiness,serviceOrganizations,localServices,localIdentity}=configuration;
const audience=process.env.BROWSER_OIDC_AUDIENCE;
const verifier=readiness.identityConfigured?(localIdentity?createLocalServiceIdentityVerifier({audience:process.env.BROWSER_LOCAL_SERVICE_AUDIENCE!,keyFile:process.env.BORAN_SERVICE_KEY_FILE!,services:localServices,allowedRoles:(process.env.BROWSER_LOCAL_ALLOWED_ROLES??'worker,ops').split(',').filter(Boolean),replayDirectory:process.env.BROWSER_LOCAL_REPLAY_ROOT!}):audience?createServiceIdentityVerifier({audience,serviceOrganizations}):undefined):undefined;
let database:Promise<Database>|undefined;
const getDatabase=()=>database??=openDatabase({mode,initialize:false});
const websiteOrigins=(process.env.BROWSER_WEBSITE_ALLOWED_ORIGINS??'').split(',').map(value=>value.trim()).filter(Boolean);
const recipes=await BrowserRecipeRegistry.fromFile(process.env.BROWSER_RECIPES_FILE,websiteOrigins);
const chatgptRecipe=await loadChatGptReadRecipe(process.env.BROWSER_CHATGPT_RECIPE_FILE);
const adapters=createRuntimePlatformRegistry({mode,database:getDatabase,recipes});
const sourceLoginHooks=createChatGptLoginHooks({mode,database:getDatabase,recipes});
const sourceAdapter=createChatGptSourceAdapter({mode,...(chatgptRecipe?{recipe:chatgptRecipe}:{}),...(sourceLoginHooks?{loginHooks:sourceLoginHooks}:{}),configuration:async context=>{
  const row=(await (await getDatabase()).query("SELECT account_external_id,scope_json,cursor,read_mode,source_kind,access_status FROM connections WHERE org_id=$1 AND id=$2",[context.orgId,context.accountId])).rows[0];
  if(!row||row.source_kind!=='chatgpt'||row.read_mode!=='authorized_browser'||row.access_status==='disabled')throw new DomainError('SOURCE_SCOPE_NOT_CONFIGURED',503,'Independent ChatGPT scope is unavailable');
  const scope=row.scope_json as Record<string,unknown>;
  return {externalAccountId:String(row.account_external_id),conversationIds:Array.isArray(scope.conversation_ids)?scope.conversation_ids.filter((value):value is string=>typeof value==='string'):[],projectIds:Array.isArray(scope.project_ids)?scope.project_ids.filter((value):value is string=>typeof value==='string'):[],cursor:row.cursor};
}});
readiness.configuredPlatforms=[...adapters].filter(([,adapter])=>adapter.readiness().configured).map(([channel])=>channel);
if(sourceAdapter)readiness.configuredPlatforms=[...readiness.configuredPlatforms,'chatgpt'];
const profiles=new BrowserProfilePool({root:process.env.BROWSER_PROFILE_ROOT??'/var/lib/boran/browser-profiles',encryptedVolumeConfirmed:process.env.BROWSER_ENCRYPTED_VOLUME_CONFIRMED==='true',mode,...(process.env.CHROMIUM_EXECUTABLE_PATH?{executablePath:process.env.CHROMIUM_EXECUTABLE_PATH}:{}),...(process.env.BROWSER_HTTP_PROXY_SERVER?{proxyServer:process.env.BROWSER_HTTP_PROXY_SERVER}:{}),additionalOriginsByChannel:{chatgpt:CHATGPT_SOURCE_ORIGINS,...(recipes.channels().includes('website')?{website:recipes.origins('website')}:{})}});
const challenges=new LoginChallengeManager({database:getDatabase,profiles,recipes,mode});
const dependencies:BrowserServiceDependencies={adapters,authorizeAction:async(ctx,tx,actionId)=>{
  const action=(await tx.query('SELECT action_type FROM execution_actions WHERE org_id=$1 AND id=$2',[ctx.orgId,actionId])).rows[0];
  if(mode==='live'&&(!readiness.writeEnabled||action?.action_type==='external.publish'&&!readiness.publishEnabled||String(action?.action_type).startsWith('ads.')&&!readiness.adsWriteEnabled))throw new DomainError('GLOBAL_WRITE_DISABLED',409,'Deployment external write switch is disabled');
  await assertActionExecutable(ctx,tx,actionId);
  await assertPublicationWindow(ctx,tx,actionId);
},withProfile:(input,run)=>profiles.withProfile(input,run),...(sourceAdapter?{sourceAdapter}:{})};
let dispatcher:ReturnType<typeof startBrowserDispatcher>|undefined;
let stopping=false;
const server=createBrowserServer({...(verifier?{identityVerifier:verifier}:{}),profilesReady:!!process.env.BROWSER_PROFILE_ROOT&&(mode==='mock'||process.env.BROWSER_ENCRYPTED_VOLUME_CONFIRMED==='true'),externalWritesEnabled:mode==='live'&&readiness.writeEnabled&&(readiness.publishEnabled||readiness.adsWriteEnabled),interactionServices:(process.env.BROWSER_INTERACTION_SERVICES??(localIdentity?'boran-ops':'')).split(',').filter(Boolean),interactLogin:(orgId,_identity,id,input)=>challenges.perform(orgId,id,input),getService:async(orgId,identity)=>createBrowserService({db:await getDatabase(),orgId,actorId:identity.email,actorType:'service',roles:['service'],mode},dependencies),...(sourceAdapter&&chatgptRecipe?{readSource:async(orgId,identity,input)=>{
  const db=await getDatabase(),row=(await db.query("SELECT id,source_kind,cursor FROM connections WHERE org_id=$1 AND id=$2",[orgId,input.connection_id])).rows[0];
  if(!row||row.source_kind!=='chatgpt')throw new DomainError('SOURCE_SCOPE_NOT_CONFIGURED',503,'ChatGPT source connection is unavailable');
  const run=(await db.query("SELECT r.id FROM workflow_runs r WHERE r.org_id=$1 AND r.id=$2 AND r.kind='source_watch' AND (r.input_ref->>'connection_id'=$3 OR EXISTS(SELECT 1 FROM workflow_steps s WHERE s.org_id=r.org_id AND s.run_id=r.id AND s.step_key='source_sync' AND s.input_ref->>'connection_id'=$3))",[orgId,input.workflow_run_id,input.connection_id])).rows[0];
  if(!run)throw new DomainError('SOURCE_WORKFLOW_BINDING_REQUIRED',403,'Source workflow must bind to this connection');
  let capture:ChatGptSourceCapture|undefined;
  const service=createBrowserService({db,orgId,actorId:identity.email,actorType:'service',roles:['service'],mode},{...dependencies,captureSource:async data=>{capture=data.source_capture as ChatGptSourceCapture;}});
  const command=await service.enqueue({command_type:'source_fetch',connection_id:input.connection_id,workflow_run_id:input.workflow_run_id,idempotency_key:input.idempotency_key,adapter_version:input.adapter_version??chatgptRecipe.version,input_ref:input.source_id?{source_id:input.source_id}:{}});
  const result=await service.execute(command.id,identity.email);
  if(capture)return capture;
  const reason=(result.result_ref as {reason?:string}|null)?.reason;
  return {status:reason==='challenge_required'||reason==='chatgpt_account_session_required'?'auth_required':'failed',snapshots:[],nextCursor:row.cursor,gaps:[reason??'CHATGPT_SOURCE_READ_NOT_COMPLETED']};
}}: {})});
server.requestTimeout=300_000;
server.listen(Number(process.env.BROWSER_RUNTIME_PORT??3003),process.env.BROWSER_RUNTIME_BIND??'127.0.0.1',()=>{
  console.log(JSON.stringify({service:'browser-runtime',mode,identityConfigured:!!verifier,dispatchOrganizations:readiness.orgIds.length,platformIntegrations:'blocked_until_verified'}));
  if(readiness.orgIds.length)void getDatabase().then(db=>{if(!stopping)dispatcher=startBrowserDispatcher({db,mode,readiness,dependencies,workerId:process.env.BROWSER_WORKER_ID??'dedicated-browser-runtime',onError:code=>process.stderr.write(JSON.stringify({service:'browser-runtime',dispatcherError:code})+'\n')});}).catch(()=>process.stderr.write(JSON.stringify({service:'browser-runtime',dispatcherError:'DATABASE_NOT_CONFIGURED_OR_MIGRATED'})+'\n'));
});
async function shutdown(){if(stopping)return;stopping=true;const closed=new Promise<void>(resolve=>server.close(()=>resolve()));await dispatcher?.stop();await challenges.shutdown();await profiles.shutdown();await closed;if(database)await database.then(db=>db.close()).catch(()=>undefined);}
for(const signal of ['SIGTERM','SIGINT'] as const)process.once(signal,()=>{void shutdown().then(()=>process.exit(0));});
