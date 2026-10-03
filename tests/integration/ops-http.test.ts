import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
const base=process.env.BORAN_TEST_OPS_URL;
interface Session {actorId:string;cookie:string;csrf:string}
interface Theme {id:string;title:string;businessLine:string;status:string;audience:string;goal:string;channels:string[];owner:string;ownerId?:string;version:number;tasks:Array<{id:string;label:string;done:boolean}>}
async function session(actorId?:string):Promise<Session>{
 const response=await fetch(`${base}/api/v1/session`,{headers:actorId?{cookie:`boran_dev_actor=${actorId}`}:{}});assert.equal(response.status,200);
 const body=await response.json() as {data:{actor_id:string;csrf_token:string;mode:string}};assert.equal(body.data.mode,'mock');const cookie=response.headers.getSetCookie().find(value=>value.startsWith('boran_csrf='))?.split(';')[0];assert.ok(cookie);
 return {actorId:body.data.actor_id,csrf:body.data.csrf_token,cookie:`${cookie}${actorId?`; boran_dev_actor=${actorId}`:''}`};
}
async function request(s:Session,path:string,method='GET',body?:unknown,options:{key?:string;version?:number;origin?:string;csrf?:string}={}){
 const headers:Record<string,string>={cookie:s.cookie};if(method!=='GET'){headers['content-type']='application/json';headers.origin=options.origin ?? new URL(base!).origin;headers['x-csrf-token']=options.csrf ?? s.csrf;headers['idempotency-key']=options.key ?? randomUUID();if(options.version!==undefined)headers['if-match']=String(options.version);}
 return fetch(`${base}/api/v1${path}`,{method,headers,...(body!==undefined?{body:JSON.stringify(body)}:{})});
}
function input(theme:Theme){const {id:_id,version:_version,...value}=theme;return value;}

test('real Next HTTP: two operators share one persisted theme, idempotency and If-Match prevent lost changes',{skip:!base},async()=>{
 const a=await session();const b=await session('00000000-0000-4000-8000-000000000003');const title=`质检记录 ${randomUUID().slice(0,8)}`;
 const value={title,businessLine:'集成服务',status:'草稿',audience:'脱敏验收企业用户',goal:'验证共享主题数据库、请求幂等与并发冲突。',channels:['官网'],owner:'运营 A',ownerId:a.actorId,tasks:[{id:randomUUID(),label:'独立 API 质检任务',done:false}]};
 const key=randomUUID();const first=await request(a,'/workspace/themes','POST',value,{key});assert.equal(first.status,201);const created=((await first.json()) as {data:Theme}).data;assert.ok(created.id);
 try{
  const replay=await request(a,'/workspace/themes','POST',value,{key});assert.equal(replay.status,201);assert.equal(((await replay.json()) as {data:Theme}).data.id,created.id);
  const changed=await request(a,'/workspace/themes','POST',{...value,title:`${title}不同载荷`},{key});assert.equal(changed.status,409);assert.equal(((await changed.json()) as {error:{code:string}}).error.code,'IDEMPOTENCY_CONFLICT');
  const shared=await request(b,'/workspace/themes');assert.equal(shared.status,200);assert.ok(((await shared.json()) as {data:Theme[]}).data.some(theme=>theme.id===created.id));
  const updated=await request(b,`/workspace/themes/${created.id}`,'PATCH',{...input(created),title:`${title} B 已更新`},{version:created.version});assert.equal(updated.status,200);const current=((await updated.json()) as {data:Theme}).data;assert.equal(current.version,created.version+1);
  const lost=await request(a,`/workspace/themes/${created.id}`,'PATCH',{...input(created),title:`${title} 旧版本覆盖`},{version:created.version});assert.equal(lost.status,409);assert.equal(((await lost.json()) as {error:{code:string}}).error.code,'VERSION_CONFLICT');
  const ownerView=((await(await request(a,'/workspace/themes')).json()) as {data:Theme[]}).data.find(theme=>theme.id===created.id)!;assert.equal(ownerView.title,current.title);
  const forbidden=await request(b,'/settings/privacy_configuration','PUT',{enabled:false});assert.equal(forbidden.status,403);
 }finally{
  // Only the fixture created by this test is changed; existing workspace records are preserved.
  const rows=((await(await request(a,'/workspace/themes')).json()) as {data:Theme[]}).data;const latest=rows.find(theme=>theme.id===created.id);if(latest){const paused=await request(a,`/workspace/themes/${created.id}`,'PATCH',{...input(latest),title:`${title}（验收结束）`,status:'已暂停',tasks:latest.tasks.map(task=>({...task,done:true}))},{version:latest.version});assert.equal(paused.status,200);}
 }
});
test('real Next HTTP: cookie alone cannot bypass CSRF and unapproved test actors fail closed',{skip:!base},async()=>{
 const s=await session();const rejected=await request(s,'/workspace/themes','POST',{}, {csrf:'0'.repeat(64)});assert.equal(rejected.status,403);assert.equal(((await rejected.json()) as {error:{code:string}}).error.code,'CSRF_REJECTED');
 const origin=await request(s,'/workspace/themes','POST',{}, {origin:'https://example.invalid'});assert.equal(origin.status,403);
 const forged=await fetch(`${base}/api/v1/workspace/themes`,{headers:{cookie:`boran_dev_actor=${randomUUID()}`}});assert.equal(forged.status,401);
 const connector=await fetch(`${base}/api/v1/reception/events`,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({org_id:randomUUID(),roles:['owner']})});assert.ok([401,503].includes(connector.status));
});
test('real public Next HTTP: anonymous body validation and privacy-off prevent real collection',{skip:!base||!process.env.BORAN_TEST_PUBLIC_URL},async()=>{
 const publicUrl=process.env.BORAN_TEST_PUBLIC_URL!;const headers={'content-type':'application/json',origin:new URL(publicUrl).origin};
 const malformed=await fetch(`${publicUrl}/api/v1/leads`,{method:'POST',headers,body:'null'});assert.equal(malformed.status,400);
 const body={submission_id:randomUUID(),page_id:randomUUID(),release_id:randomUUID(),contact_email:'only-synthetic@example.invalid',privacy_notice_version:'mock-v1',consent:true};const disabled=await fetch(`${publicUrl}/api/v1/leads`,{method:'POST',headers,body:JSON.stringify(body)});assert.equal(disabled.status,503);assert.equal(((await disabled.json()) as {error:{code:string}}).error.code,'privacy_configuration_required');
 const origin=await fetch(`${publicUrl}/api/v1/leads`,{method:'POST',headers:{...headers,origin:'https://example.invalid'},body:JSON.stringify(body)});assert.equal(origin.status,403);
 const preview=await fetch(`${publicUrl}/preview/${randomUUID()}`);assert.equal(preview.status,404);
});
test('deployed defaults: missing real identity leaves pages and business APIs closed while health stays minimal',{skip:!process.env.BORAN_TEST_PROTECTED_URL},async()=>{
 const url=process.env.BORAN_TEST_PROTECTED_URL!;for(const path of ['/overview','/themes','/api/v1/workspace/themes']){const result=await fetch(`${url}${path}`);assert.equal(result.status,503);}
 const health=await fetch(`${url}/api/health`);assert.equal(health.status,200);assert.deepEqual(await health.json(),{status:'ok'});
});
test('real public Next HTTP: canonical and spec-alias event paths enforce same source, size and strict schema',{skip:!process.env.BORAN_TEST_PUBLIC_URL},async()=>{
 const url=process.env.BORAN_TEST_PUBLIC_URL!;const origin=new URL(url).origin;const headers={'content-type':'application/json',origin};
 for(const path of ['/api/v1/events','/api/v1/public/events']){
  const invalid=await fetch(`${url}${path}`,{method:'POST',headers,body:JSON.stringify({events:[],roles:['owner']})});assert.equal(invalid.status,400);assert.equal(((await invalid.json()) as {error:{code:string}}).error.code,'INVALID_REQUEST');
  const wrongOrigin=await fetch(`${url}${path}`,{method:'POST',headers:{...headers,origin:'https://example.invalid'},body:'{}'});assert.equal(wrongOrigin.status,403);
  const tooLarge=await fetch(`${url}${path}`,{method:'POST',headers,body:JSON.stringify({events:[],unknown:'x'.repeat(17000)})});assert.equal(tooLarge.status,413);
  const source=await fetch(`${url}${path}`,{method:'POST',headers,body:JSON.stringify({events:[{event_id:randomUUID(),event_type:'page_view',occurred_at:new Date().toISOString(),page_id:randomUUID(),release_id:randomUUID()}]})});assert.equal(source.status,409);assert.equal(((await source.json()) as {error:{code:string}}).error.code,'EVENT_PAGE_NOT_PUBLISHED');
 }
 const alias=await fetch(`${url}/api/v1/public/leads`,{method:'POST',headers,body:'null'});assert.equal(alias.status,400);
});
