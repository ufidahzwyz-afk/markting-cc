import {createHmac} from 'node:crypto';
import {ContractValidationError,validateApiRequest} from '@boran/contracts';
import {DomainError} from '@boran/domain/core';
import {ingestPublicEvents,type EventBatch} from '@boran/domain/events';
import {publicContext,sitePolicy} from '@/lib/runtime';
export const dynamic='force-dynamic';
async function body(request:Request):Promise<EventBatch>{
 if(Number(request.headers.get('content-length')??0)>16384)throw new DomainError('REQUEST_TOO_LARGE',413,'事件请求过大');const reader=request.body?.getReader();if(!reader)throw new DomainError('INVALID_REQUEST',400,'事件内容为空');let size=0;const chunks:Uint8Array[]=[];
 while(true){const item=await reader.read();if(item.done)break;size+=item.value.byteLength;if(size>16384){await reader.cancel();throw new DomainError('REQUEST_TOO_LARGE',413,'事件请求过大');}chunks.push(item.value);}
 const bytes=new Uint8Array(size);let offset=0;for(const chunk of chunks){bytes.set(chunk,offset);offset+=chunk.length;}let input:unknown;try{input=JSON.parse(new TextDecoder().decode(bytes));}catch{throw new DomainError('INVALID_REQUEST',400,'事件 JSON 无效');}return validateApiRequest('EventBatch',input) as EventBatch;
}
export async function POST(request:Request){
 try{
  if(request.headers.get('origin')!==new URL(sitePolicy().publicOrigin).origin)throw new DomainError('ORIGIN_FORBIDDEN',403,'请求来源不允许');if(!/^application\/json(?:\s*;|$)/i.test(request.headers.get('content-type')??''))throw new DomainError('UNSUPPORTED_CONTENT_TYPE',415,'事件必须为 JSON');
  const input=await body(request);const ctx=await publicContext();const secret=process.env.PUBLIC_RATE_LIMIT_SECRET;if(ctx.mode==='live'&&(!secret||secret.length<32))throw new DomainError('EVENTS_NOT_CONFIGURED',503,'访问统计安全接收尚未配置');
  const proxy=process.env.PUBLIC_SITE_TRUST_PROXY==='true'?request.headers.get('x-forwarded-for')?.split(',')[0]?.trim():undefined;const client=proxy&&proxy.length<=100&&/^[a-f0-9:.]+$/i.test(proxy)?proxy:'unknown-client';
  const rateLimitKey=createHmac('sha256',secret??'local-mock-rate-limit-only').update(client).digest('hex');const internalTest=ctx.mode==='mock'&&['development','test'].includes(process.env.APP_ENV??'production')&&process.env.AUTH_MODE==='mock'&&process.env.PUBLIC_SITE_ALLOW_MOCK_FORMS==='true';
  const result=await ingestPublicEvents(ctx,input,{rateLimitKey,internalTest,publicHost:new URL(sitePolicy().publicOrigin).host});return Response.json(result,{status:202,headers:{'Cache-Control':'no-store'}});
 }catch(error){const known=error instanceof DomainError;return Response.json({error:{code:error instanceof ContractValidationError?'INVALID_REQUEST':known?error.code:'EVENTS_UNAVAILABLE',message:error instanceof ContractValidationError?'事件字段或格式无效':known?error.message:'访问统计暂不可用'}},{status:error instanceof ContractValidationError?400:known?error.status:503,headers:{'Cache-Control':'no-store'}});}
}
