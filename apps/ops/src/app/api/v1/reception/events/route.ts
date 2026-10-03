import {createRemoteJWKSet,jwtVerify} from 'jose';
import {validateApiRequest} from '@boran/contracts';
import {DEMO_ORG_ID,DEMO_OWNER_ID} from '@boran/db';
import {DomainError,type ServiceContext} from '@boran/domain/core';
import {ingestReceptionEvent,verifyReceptionSignature,type ReceptionAdapter,type ReceptionEventIngest} from '@boran/domain/reception';
import {errorResponse,idempotencyKey} from '@/lib/http';
import {getDatabase,isLocalIdentity} from '@/lib/server-context';
export const runtime='nodejs';export const dynamic='force-dynamic';
const keys=new Map<string,ReturnType<typeof createRemoteJWKSet>>();
async function authorizeService(request:Request):Promise<void>{
 const issuer=process.env.RECEPTION_CONNECTOR_OIDC_ISSUER,audience=process.env.RECEPTION_CONNECTOR_OIDC_AUDIENCE,jwks=process.env.RECEPTION_CONNECTOR_OIDC_JWKS_URL,subject=process.env.RECEPTION_CONNECTOR_SUBJECT;
 if(!issuer||!audience||!jwks||!subject)throw new DomainError('CONNECTOR_IDENTITY_NOT_CONFIGURED',503,'私有接待连接器身份尚未配置');
 const token=request.headers.get('authorization')?.match(/^Bearer ([^\s]+)$/)?.[1];if(!token)throw new DomainError('UNAUTHENTICATED',401,'私有连接器身份验证失败');
 try{const url=new URL(jwks);if(url.protocol!=='https:'||url.username||url.password)throw new Error('invalid jwks');let remote=keys.get(url.href);if(!remote){remote=createRemoteJWKSet(url);keys.set(url.href,remote);}const {payload}=await jwtVerify(token,remote,{issuer,audience,algorithms:['RS256','ES256'],requiredClaims:['exp','sub','iat']});if(payload.sub!==subject)throw new Error('wrong service');}catch{throw new DomainError('UNAUTHENTICATED',401,'私有连接器身份验证失败');}
}
export async function POST(request:Request){try{
 const local=isLocalIdentity();if(local&&!process.env.RECEPTION_MOCK_CONNECTOR_SECRET)throw new DomainError('integration_required',503,'脱敏接待连接器签名尚未配置');if(!local)await authorizeService(request);
 if(!request.headers.get('content-type')?.toLowerCase().startsWith('application/json'))throw new DomainError('INVALID_CONTENT_TYPE',400,'须发送JSON事件');
 const rawBody=await request.text();if(Buffer.byteLength(rawBody)>32*1024)throw new DomainError('PAYLOAD_TOO_LARGE',413,'接待事件过大');
 const key=idempotencyKey(request);if(key.length<8)throw new DomainError('INVALID_IDEMPOTENCY_KEY',422,'请求键至少8个字符');
 let parsed:unknown;try{parsed=JSON.parse(rawBody);}catch{throw new DomainError('INVALID_REQUEST',400,'事件JSON格式无效');}
 const input=validateApiRequest('ReceptionEventIngest',parsed) as ReceptionEventIngest;
 const signature=request.headers.get('x-reception-signature'),timestamp=request.headers.get('x-reception-timestamp');if(!signature||!timestamp)throw new DomainError('VERIFIED_CONNECTOR_REQUIRED',401,'缺少平台原始签名');
 const db=await getDatabase();const orgId=local?DEMO_ORG_ID:process.env.BORAN_ORG_ID;const actorId=local?DEMO_OWNER_ID:process.env.RECEPTION_CONNECTOR_ACTOR_ID;
 if(!orgId||!actorId)throw new DomainError('CONNECTOR_IDENTITY_NOT_CONFIGURED',503,'私有连接器组织身份尚未配置');
 const membership=(await db.query('SELECT m.roles FROM memberships m JOIN users u ON u.id=m.user_id WHERE m.org_id=$1 AND m.user_id=$2 AND m.active AND u.active',[orgId,actorId])).rows[0];if(!membership)throw new DomainError('FORBIDDEN',403,'连接器服务成员未授权');
 const ctx:ServiceContext={db,orgId,actorId,roles:membership.roles as string[],mode:local?'mock':'live'};
 // This local connector only tests authenticated synthetic ingestion. It cannot claim real delivery or handoff.
 const mockAdapter:ReceptionAdapter|undefined=local?{kind:'mock',verifyEvent:args=>verifyReceptionSignature(process.env.RECEPTION_MOCK_CONNECTOR_SECRET!,args.rawBody,args.signature,args.timestamp),async sendReply(){throw new DomainError('integration_required',503,'没有实际接待发送能力');},async readDelivery(){return {verified:false,external_message_id:'',evidence_ref:{}};},async handoff(){throw new DomainError('integration_required',503,'没有实际人工交接能力');},async readHandoff(){return {verified:false,evidence_ref:{}};}}:undefined;
 const result=await ingestReceptionEvent(ctx,input,{rawBody,signature,timestamp,internalTest:local,...(mockAdapter?{adapter:mockAdapter}:{})});
 return Response.json(result,{status:202,headers:{'Cache-Control':'no-store','X-Content-Type-Options':'nosniff'}});
}catch(error){return errorResponse(error);}}
