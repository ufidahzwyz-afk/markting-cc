import { openDatabase, type Database } from '@boran/db';
import { assertActionExecutable } from '@boran/domain/execution';
import { DomainError } from '@boran/domain/core';
import { createPlatformRegistry } from '@boran/connectors';
import { createServiceIdentityVerifier } from './auth';
import { createBrowserService, type BrowserServiceDependencies } from './service';
import { createBrowserServer } from './server';
import { BrowserProfilePool } from './profiles';
import { assertPublicationWindow, browserDispatchEnvironment, startBrowserDispatcher } from './dispatcher';

const configuration=browserDispatchEnvironment();
const {mode,readiness,serviceOrganizations}=configuration;
const audience=process.env.BROWSER_OIDC_AUDIENCE;
const verifier=readiness.identityConfigured&&audience?createServiceIdentityVerifier({audience,serviceOrganizations}):undefined;
// Reviewed platform hooks are explicitly registered in deployment code; an env flag cannot invent a working adapter.
const adapters=createPlatformRegistry({mode});
readiness.configuredPlatforms=[...adapters].filter(([,adapter])=>adapter.readiness().configured).map(([channel])=>channel);
const profiles=new BrowserProfilePool({root:process.env.BROWSER_PROFILE_ROOT??'/var/lib/boran/browser-profiles',encryptedVolumeConfirmed:process.env.BROWSER_ENCRYPTED_VOLUME_CONFIRMED==='true',mode,...(process.env.CHROMIUM_EXECUTABLE_PATH?{executablePath:process.env.CHROMIUM_EXECUTABLE_PATH}:{})});
const dependencies:BrowserServiceDependencies={adapters,authorizeAction:async(ctx,tx,actionId)=>{
  const action=(await tx.query('SELECT action_type FROM execution_actions WHERE org_id=$1 AND id=$2',[ctx.orgId,actionId])).rows[0];
  if(mode==='live'&&(!readiness.writeEnabled||action?.action_type==='external.publish'&&!readiness.publishEnabled||String(action?.action_type).startsWith('ads.')&&!readiness.adsWriteEnabled))throw new DomainError('GLOBAL_WRITE_DISABLED',409,'Deployment external write switch is disabled');
  await assertActionExecutable(ctx,tx,actionId);
  await assertPublicationWindow(ctx,tx,actionId);
},withProfile:(input,run)=>profiles.withProfile(input,run)};
let database:Promise<Database>|undefined;
const getDatabase=()=>database??=openDatabase({mode,initialize:false});
let dispatcher:ReturnType<typeof startBrowserDispatcher>|undefined;
let stopping=false;
const server=createBrowserServer({...(verifier?{identityVerifier:verifier}:{}),profilesReady:!!process.env.BROWSER_PROFILE_ROOT&&(mode==='mock'||process.env.BROWSER_ENCRYPTED_VOLUME_CONFIRMED==='true'),getService:async(orgId,identity)=>createBrowserService({db:await getDatabase(),orgId,actorId:identity.email,actorType:'service',roles:['service'],mode},dependencies)});
server.requestTimeout=300_000;
server.listen(Number(process.env.BROWSER_RUNTIME_PORT??3003),process.env.BROWSER_RUNTIME_BIND??'127.0.0.1',()=>{
  console.log(JSON.stringify({service:'browser-runtime',mode,identityConfigured:!!verifier,dispatchOrganizations:readiness.orgIds.length,platformIntegrations:'blocked_until_verified'}));
  if(readiness.orgIds.length)void getDatabase().then(db=>{if(!stopping)dispatcher=startBrowserDispatcher({db,mode,readiness,dependencies,workerId:process.env.BROWSER_WORKER_ID??'dedicated-browser-runtime',onError:code=>process.stderr.write(JSON.stringify({service:'browser-runtime',dispatcherError:code})+'\n')});}).catch(()=>process.stderr.write(JSON.stringify({service:'browser-runtime',dispatcherError:'DATABASE_NOT_CONFIGURED_OR_MIGRATED'})+'\n'));
});
async function shutdown(){if(stopping)return;stopping=true;const closed=new Promise<void>(resolve=>server.close(()=>resolve()));await dispatcher?.stop();await profiles.shutdown();await closed;if(database)await database.then(db=>db.close()).catch(()=>undefined);}
for(const signal of ['SIGTERM','SIGINT'] as const)process.once(signal,()=>{void shutdown().then(()=>process.exit(0));});
