import {createHash} from 'node:crypto';
import {issueLocalServiceToken} from '@boran/browser-runtime';
import type {SourceCoverage,SourceReadRequest,SourceTransport,SourceReadResult} from '@boran/connectors/sources';
import {SourceObjectStore} from '@boran/connectors/source-content';

const failed=(code:Extract<SourceReadResult,{status:'failed'}>['errorCode'],gap:string):SourceReadResult=>({status:'failed',mode:'live',snapshots:[],errorCode:code,gaps:[gap]});
const sha=(value:string)=>createHash('sha256').update(value).digest('hex');
const uuid=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const sourceId=/^[A-Za-z0-9_-]{1,200}$/;
type Row=Record<string,unknown>;
const object=(value:unknown):Row|undefined=>value&&typeof value==='object'&&!Array.isArray(value)?value as Row:undefined;
function scopeMatches(value:unknown,scope:SourceReadRequest['scope']):boolean {
  if(typeof value!=='string')return false;
  try{
    const parsed=object(JSON.parse(value));if(!parsed||Object.keys(parsed).some(key=>!['conversation_ids','project_ids'].includes(key)))return false;
    return (['conversation_ids','project_ids'] as const).every(key=>{
      const actual=parsed[key],expected=key==='conversation_ids'?scope.conversationIds??[]:scope.projectIds??[];
      return Array.isArray(actual)&&actual.length===expected.length&&new Set(actual).size===actual.length&&actual.every(id=>typeof id==='string'&&expected.includes(id));
    });
  }catch{return false;}
}
interface CheckedSnapshot {providerFileId:string;conversationId:string;projectId?:string;title:string;revision:string;rawContent:string;text:string;sourceModifiedAt:string|null;coverage:SourceCoverage}
function checkedSnapshot(value:unknown,scope:SourceReadRequest['scope']):CheckedSnapshot|undefined {
  const row=object(value),coverage=object(row?.coverage);
  if(coverage&&Object.keys(coverage).some(key=>!['status','scope','conversation_id','project_id','message_ids','branch','start_locator','end_locator','gaps'].includes(key)))return;
  if(!row||!coverage||typeof row.conversationId!=='string'||!sourceId.test(row.conversationId)||row.providerFileId!==row.conversationId||coverage.conversation_id!==row.conversationId||typeof row.rawContent!=='string'||Buffer.byteLength(row.rawContent)>4_000_000||typeof row.text!=='string'||typeof row.revision!=='string'||row.revision!==sha(row.rawContent)||typeof row.title!=='string'||row.title.length>200||!['complete','partial'].includes(String(coverage.status))||!scopeMatches(coverage.scope,scope))return;
  const project=typeof row.projectId==='string'?row.projectId:undefined;
  if(row.projectId!==undefined&&(!project||!sourceId.test(project))||coverage.project_id!==project)return;
  if(!scope.conversationIds?.includes(row.conversationId)&&(!project||!scope.projectIds?.includes(project)))return;
  if(coverage.gaps!==undefined&&(!Array.isArray(coverage.gaps)||coverage.gaps.some(gap=>typeof gap!=='string'||!/^CHATGPT_[A-Z0-9_]{1,90}$/.test(gap))))return;
  let raw:Row|undefined;try{raw=object(JSON.parse(row.rawContent));}catch{return;}
  if(!raw||Object.keys(raw).some(key=>!['conversationId','projectId','branch','messages'].includes(key))||raw.conversationId!==row.conversationId||raw.projectId!==project||typeof raw.branch!=='string'||!raw.branch||raw.branch.length>200||coverage.branch!==raw.branch||!Array.isArray(raw.messages)||!raw.messages.length||raw.messages.length>1000)return;
  const messages:{id:string;role:string;text:string;createdAt:string|null}[]=[];
  for(const value of raw.messages){
    const message=object(value);
    if(!message||Object.keys(message).some(key=>!['id','role','text','createdAt'].includes(key))||typeof message.id!=='string'||!/^[A-Za-z0-9_.:-]{1,200}$/.test(message.id)||!['user','assistant'].includes(String(message.role))||typeof message.text!=='string'||message.createdAt!==null&&(typeof message.createdAt!=='string'||!Number.isFinite(Date.parse(message.createdAt))))return;
    messages.push({id:message.id,role:String(message.role),text:message.text,createdAt:message.createdAt as string|null});
  }
  if(new Set(messages.map(message=>message.id)).size!==messages.length||JSON.stringify(coverage.message_ids)!==JSON.stringify(messages.map(message=>message.id))||coverage.start_locator!==`message:${messages[0]!.id}`||coverage.end_locator!==`message:${messages.at(-1)!.id}`||row.sourceModifiedAt!==messages.at(-1)!.createdAt)return;
  if(coverage.status==='complete'&&(raw.branch==='unverified'||messages.some(message=>message.createdAt===null)||(coverage.gaps as unknown[]|undefined)?.length))return;
  const text=messages.map(message=>`[${message.role}] [${message.id}] [${message.createdAt??'time unavailable'}]\n${message.text}`).join('\n\n');
  if(row.text!==text)return;
  return {providerFileId:row.conversationId,conversationId:row.conversationId,...(project?{projectId:project}:{}),title:row.title,revision:row.revision,rawContent:row.rawContent,text,sourceModifiedAt:row.sourceModifiedAt as string|null,coverage:coverage as unknown as SourceCoverage};
}
function checkedCursor(value:unknown,scope:SourceReadRequest['scope']):boolean {
  const cursor=object(value),revisions=object(cursor?.revisions);
  if(!cursor||Object.keys(cursor).some(key=>!['version','revisions'].includes(key))||typeof cursor.version!=='string'||!/^[A-Za-z0-9_.-]{1,80}$/.test(cursor.version)||!revisions||Object.keys(revisions).length>100)return false;
  return (scope.conversationIds??[]).every(id=>Object.hasOwn(revisions,id))&&Object.entries(revisions).every(([id,hash])=>sourceId.test(id)&&typeof hash==='string'&&/^[a-f0-9]{64}$/.test(hash)&&(scope.projectIds?.length||scope.conversationIds?.includes(id)));
}
/** The worker supplies only persisted source references to the independent authenticated browser. */
export function createBrowserSourceTransport(options:{workflowRunId:string;sourceRoot:string;env?:NodeJS.ProcessEnv;fetch?:typeof fetch}):SourceTransport {
  const env=options.env??process.env,store=new SourceObjectStore(options.sourceRoot);
  return async request=>{
    if(request.sourceKind!=='chatgpt')return failed('SCOPE_MISMATCH','独立浏览器只读取已指定的ChatGPT会话');
    if(!uuid.test(request.orgId)||!uuid.test(request.connectionId)||!uuid.test(options.workflowRunId))return failed('SCOPE_MISMATCH','会话读取需要同组织的持久连接与工作流引用');
    if(!(request.scope.conversationIds?.length||request.scope.projectIds?.length)||[...(request.scope.conversationIds??[]),...(request.scope.projectIds??[])].some(id=>!sourceId.test(id)))return failed('SCOPE_REQUIRED','需要明确授权的指定会话或项目');
    const base=env.BROWSER_RUNTIME_INTERNAL_URL??env.BROWSER_RUNTIME_URL;
    if(!base)return failed('NOT_CONFIGURED','独立ChatGPT浏览器服务未配置');
    let url:URL;
    try{url=new URL(base);if(!['http:','https:'].includes(url.protocol)||url.username||url.password||url.search||url.hash||url.pathname!=='/'||!['browser-runtime','127.0.0.1','localhost'].includes(url.hostname))return failed('NOT_CONFIGURED','浏览器服务必须使用本地固定服务地址');}catch{return failed('NOT_CONFIGURED','浏览器服务地址无效');}
    let token:string;
    try{
      if(env.BROWSER_IDENTITY_MODE==='local_service'){
        if(!['development','test'].includes(env.APP_ENV??''))return failed('NOT_CONFIGURED','本地服务身份只用于开发与测试，生产需要正式OIDC');
        if(!env.BORAN_SERVICE_KEY_FILE||!env.BROWSER_LOCAL_SERVICE_AUDIENCE)return failed('NOT_CONFIGURED','本地服务身份未初始化');
        token=await issueLocalServiceToken({audience:env.BROWSER_LOCAL_SERVICE_AUDIENCE,keyFile:env.BORAN_SERVICE_KEY_FILE,subject:env.BROWSER_WORKER_SERVICE_SUBJECT??'boran-worker',role:'worker'});
      }else{
        // OIDC token is injected by the deployment, never stored in a source cursor or model request.
        token=env.BROWSER_SERVICE_ID_TOKEN??'';
        if(!token)return failed('NOT_CONFIGURED','浏览器服务身份未配置');
      }
      const response=await (options.fetch??fetch)(new URL('/internal/browser/source-read',url),{method:'POST',redirect:'error',signal:AbortSignal.timeout(270000),headers:{authorization:`Bearer ${token}`,'content-type':'application/json','x-org-id':request.orgId},body:JSON.stringify({connection_id:request.connectionId,workflow_run_id:options.workflowRunId,idempotency_key:`source:${sha(JSON.stringify({run:options.workflowRunId,connection:request.connectionId,cursor:request.cursor,scope:request.scope})).slice(0,60)}`})});
      if(!response.ok){await response.body?.cancel();return failed([401,403,409].includes(response.status)?'AUTH_REQUIRED':'READ_FAILED','指定会话的独立登录或读取未完成');}
      if(Number(response.headers.get('content-length'))>16*1024*1024)return failed('SCOPE_INCOMPLETE','会话范围超过本次读取界限');
      if(!response.body)return failed('INVALID_READ_RESULT','浏览器没有返回实际会话内容');
      const reader=response.body.getReader(),chunks:Uint8Array[]=[];let size=0;
      try{while(true){const item=await reader.read();if(item.done)break;size+=item.value.length;if(size>16*1024*1024)return failed('SCOPE_INCOMPLETE','会话范围超过本次读取界限');chunks.push(item.value);}}finally{await reader.cancel().catch(()=>undefined);}
      const capture=object(JSON.parse(Buffer.concat(chunks).toString('utf8')))?.data as Row|undefined;
      if(!capture||!Array.isArray(capture.snapshots)||!Array.isArray(capture.gaps)||capture.snapshots.length>100)return failed('INVALID_READ_RESULT','浏览器返回的会话结构无效');
      if(capture.status==='auth_required')return failed('AUTH_REQUIRED','ChatGPT登录需要扫码或二次验证');
      if(capture.status==='failed')return failed('READ_FAILED','指定会话读取失败，保留原水位');
      if(capture.gaps.some(gap=>typeof gap!=='string'||!/^CHATGPT_[A-Z0-9_]{1,90}$/.test(gap)))return failed('INVALID_READ_RESULT','会话覆盖缺口格式无效');
      if(!['changed','partial','no_change'].includes(String(capture.status)))return failed('INVALID_READ_RESULT','会话状态与实际原文不一致');
      if(capture.status!=='partial'&&!checkedCursor(capture.nextCursor,request.scope))return failed('INVALID_READ_RESULT','会话水位缺少指定范围内的版本证据');
      const checked=capture.snapshots.map(item=>checkedSnapshot(item,request.scope));
      if(checked.some(item=>!item))return failed('SCOPE_MISMATCH','会话原文、正文或范围证据不匹配，未保存正文');
      if(new Set(checked.map(item=>item!.conversationId)).size!==checked.length)return failed('INVALID_READ_RESULT','会话结果包含重复身份');
      if(capture.status==='changed'&&(!checked.length||capture.gaps.length||checked.some(item=>item!.coverage.status!=='complete')))return failed('INVALID_READ_RESULT','完整变化与实际会话覆盖不一致');
      if(capture.status==='changed'&&checked.some(item=>(capture.nextCursor as {revisions:Record<string,unknown>}).revisions[item!.conversationId]!==item!.revision))return failed('INVALID_READ_RESULT','新会话正文与版本水位不一致');
      if(capture.status==='partial'&&!capture.gaps.length)return failed('INVALID_READ_RESULT','不完整会话须保留明确覆盖缺口');
      if(capture.status==='no_change'&&(checked.length||capture.gaps.length))return failed('INVALID_READ_RESULT','无变化状态不得包含新原文或覆盖缺口');
      const snapshots=[];
      for(const verified of checked){
        const item=verified!;
        const objects=await store.put(request.orgId,request.connectionId,Buffer.from(item.rawContent,'utf8'),item.text);
        snapshots.push({providerFileId:item.providerFileId,conversationId:item.conversationId,...(item.projectId?{projectId:item.projectId}:{}),title:item.title,revision:item.revision,...objects,mimeType:'application/json',retrievedAt:new Date().toISOString(),sourceModifiedAt:item.sourceModifiedAt??null,sourceUrl:`https://chatgpt.com/c/${encodeURIComponent(item.conversationId)}`,visibility:'internal' as const,coverage:item.coverage});
      }
      if(capture.status==='no_change'&&snapshots.length===0&&capture.gaps.length===0)return {status:'no_change',mode:'live',snapshots:[],nextCursor:capture.nextCursor,gaps:[]};
      if(!['changed','partial'].includes(String(capture.status)))return failed('INVALID_READ_RESULT','会话状态与实际原文不一致');
      return {status:capture.status as 'changed'|'partial',mode:'live',snapshots,nextCursor:capture.status==='partial'?request.cursor:capture.nextCursor,gaps:capture.gaps as string[]};
    }catch{return failed('READ_FAILED','独立浏览器没有完整返回指定会话，保留原水位');}
  };
}
