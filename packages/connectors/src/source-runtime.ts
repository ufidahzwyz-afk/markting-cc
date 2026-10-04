import {createHash} from 'node:crypto';
import {lookup} from 'node:dns/promises';
import {isIP} from 'node:net';
import {request as httpRequest} from 'node:http';
import {request as httpsRequest} from 'node:https';
import type {SourceKind} from '@boran/contracts';
import {createSourceReaders,type SourceCoverage,type SourceReadRequest,type SourceReadResult,type SourceSnapshot,type SourceTransport} from './sources';
import {SourceObjectStore,extractSourceTextAsync} from './source-content';

export type SourceCredential=string|{accessToken:string;expiresAt?:string}|{kind:'drive_oauth';clientId:string;clientSecret:string;refreshToken:string;accessToken?:string;expiresAt?:string};
export type SourceSecretResolver=(reference:string,scope:{orgId:string;connectionId:string})=>Promise<SourceCredential|null>;
export interface RuntimeSourceConfig {
  sourceRoot:string;
  resolveSecret:SourceSecretResolver;
  fetch?:typeof fetch;
  chatgptTransport?:SourceTransport;
  resolveHost?:(hostname:string)=>Promise<readonly {address:string;family:number}[]>;
  maxFiles?:number;
  maxPages?:number;
  maxBytes?:number;
  timeoutMs?:number;
  now?:()=>Date;
}
type FailureCode=Extract<SourceReadResult,{status:'failed'}>['errorCode'];
class SourceFault extends Error {constructor(readonly code:FailureCode,readonly reason?:string){super(code);}}
const sha=(value:string|Uint8Array)=>createHash('sha256').update(value).digest('hex');
const failure=(code:FailureCode,gap='来源读取未完成；完整水位保持不变'):SourceReadResult=>({status:'failed',mode:'live',snapshots:[],errorCode:code,gaps:[gap]});
const safeId=(value:string)=>/^[A-Za-z0-9_-]{1,200}$/.test(value);
const GOOGLE='https://www.googleapis.com/drive/v3';
const GOOGLE_TOKEN='https://oauth2.googleapis.com/token';
const GOOGLE_FOLDER='application/vnd.google-apps.folder';
const fields='id,name,mimeType,parents,modifiedTime,version,md5Checksum,size,trashed,webViewLink';
interface DriveFile {id:string;name:string;mimeType:string;parents?:string[];modifiedTime?:string;version?:string;md5Checksum?:string;size?:string;trashed?:boolean;webViewLink?:string}
interface KnownFile {revision:string;contentHash:string;objectKey:string;textHash:string;textObjectKey:string;title:string;mimeType:string;sourceModifiedAt:string|null;ancestorFolderIds:string[];scopeFolderIds:string[]}
interface DriveCursor {version:'drive-v1';scopeHash:string;pageToken:string;files:Record<string,KnownFile>}
interface PublicCursor {version:'public-v1';scopeHash:string;hashes:Record<string,string>}

function normalizeUrl(value:string):string {let url:URL;try{url=new URL(value);}catch{throw new SourceFault('SCOPE_MISMATCH');}if(!['http:','https:'].includes(url.protocol)||url.username||url.password||url.port&&url.port!=='443'&&url.port!=='80'||[...url.searchParams.keys()].some(name=>/(?:token|secret|password|credential|signature|api[_-]?key)/i.test(name)))throw new SourceFault('SCOPE_MISMATCH');url.hash='';return url.toString();}
/** Explicit public-address policy, including IPv4 mapped IPv6 and local/special ranges. */
export function isPublicSourceAddress(address:string):boolean {
  if(isIP(address)===4){const octets=address.split('.').map(Number),[a,b]=octets;if(a===undefined||b===undefined)return false;return !(a===0||a===10||a===127||a>=224||a===169&&b===254||a===172&&b>=16&&b<=31||a===192&&[0,168].includes(b)||a===100&&b>=64&&b<=127||a===198&&[18,19,51].includes(b)||a===203&&b===0);}
  if(isIP(address)===6){const lower=address.toLowerCase();if(lower.startsWith('::ffff:')){const mapped=lower.slice(7);if(isIP(mapped)===4)return isPublicSourceAddress(mapped);const parts=mapped.split(':');if(parts.length===2){const high=parseInt(parts[0]!,16),low=parseInt(parts[1]!,16);return isPublicSourceAddress(`${high>>>8}.${high&255}.${low>>>8}.${low&255}`);}return false;}return /^[23][0-9a-f]{3}:/.test(lower)&&!lower.startsWith('2001:db8:')&&!lower.startsWith('2001:0:')&&!lower.startsWith('2002:');}return false;
}
async function readBody(response:Response,maxBytes:number):Promise<Buffer> {const length=Number(response.headers.get('content-length'));if(Number.isFinite(length)&&length>maxBytes)throw new SourceFault('SCOPE_INCOMPLETE');if(!response.body)return Buffer.alloc(0);const reader=response.body.getReader(),chunks:Buffer[]=[];let total=0;try{while(true){const value=await reader.read();if(value.done)break;total+=value.value.length;if(total>maxBytes)throw new SourceFault('SCOPE_INCOMPLETE');chunks.push(Buffer.from(value.value));}}finally{await reader.cancel().catch(()=>{});}return Buffer.concat(chunks);}
function validatedJson<T>(bytes:Buffer):T {try{return JSON.parse(bytes.toString('utf8')) as T;}catch{throw new SourceFault('INVALID_READ_RESULT');}}
function fileValid(value:unknown):value is DriveFile {if(!value||typeof value!=='object')return false;const file=value as DriveFile;return typeof file.id==='string'&&safeId(file.id)&&typeof file.name==='string'&&typeof file.mimeType==='string'&&(!file.parents||Array.isArray(file.parents)&&file.parents.every(parent=>typeof parent==='string'&&safeId(parent)));}
function revision(file:DriveFile):string {return sha(JSON.stringify([file.version??null,file.modifiedTime??null,file.md5Checksum??null,file.mimeType]));}

export function createRuntimeSourceTransports(config:RuntimeSourceConfig):Partial<Record<SourceKind,SourceTransport>> {
  const store=new SourceObjectStore(config.sourceRoot),fetcher=config.fetch??fetch,maxBytes=config.maxBytes??32*1024*1024,maxFiles=config.maxFiles??5000,maxPages=config.maxPages??200,timeoutMs=config.timeoutMs??30000,now=config.now??(()=>new Date());
  if(!Number.isSafeInteger(maxFiles)||maxFiles<1||maxFiles>20000||!Number.isSafeInteger(maxPages)||maxPages<1||maxPages>1000||!Number.isSafeInteger(maxBytes)||maxBytes<1||maxBytes>64*1024*1024||!Number.isSafeInteger(timeoutMs)||timeoutMs<1||timeoutMs>120000)throw new Error('SOURCE_LIMIT_INVALID');
  async function fetchLimited(url:string,init:RequestInit={}):Promise<Response> {try{return await fetcher(url,{...init,signal:AbortSignal.timeout(timeoutMs),redirect:'error'});}catch{throw new SourceFault('READ_FAILED');}}
  async function drive(request:SourceReadRequest):Promise<SourceReadResult> {
    if(!request.credentialRef)return failure('NOT_CONFIGURED','Drive 独立 OAuth 凭据未配置');
    const roots=[...new Set(request.scope.folderIds??[])].sort(),explicit=[...new Set(request.scope.fileIds??[])].sort();if([...roots,...explicit].some(id=>!safeId(id)))return failure('SCOPE_MISMATCH');
    let credential:SourceCredential|null;try{credential=await config.resolveSecret(request.credentialRef,{orgId:request.orgId,connectionId:request.connectionId});}catch{return failure('AUTH_REQUIRED','Drive 凭据不可读取或授权范围不匹配');}
    if(!credential)return failure('NOT_CONFIGURED','Drive 独立 OAuth 凭据未配置');
    let token=typeof credential==='string'?credential:credential.accessToken??'';
    const oauth=typeof credential==='object'&&'kind' in credential&&credential.kind==='drive_oauth'?credential:null;
    async function refresh():Promise<void> {
      if(!oauth?.clientId||!oauth.clientSecret||!oauth.refreshToken)throw new SourceFault('AUTH_REQUIRED');
      const response=await fetchLimited(GOOGLE_TOKEN,{method:'POST',headers:{'content-type':'application/x-www-form-urlencoded'},body:new URLSearchParams({grant_type:'refresh_token',client_id:oauth.clientId,client_secret:oauth.clientSecret,refresh_token:oauth.refreshToken}).toString()});
      if(!response.ok)throw new SourceFault('AUTH_REQUIRED');const output=validatedJson<{access_token?:string;token_type?:string}>(await readBody(response,1024*1024));if(!output.access_token||output.token_type?.toLowerCase()!=='bearer')throw new SourceFault('AUTH_REQUIRED');token=output.access_token;
    }
    async function api(path:string,query:Record<string,string>={}):Promise<Response> {
      const url=new URL(`${GOOGLE}/${path}`);for(const [key,value] of Object.entries(query))url.searchParams.set(key,value);
      let response=await fetchLimited(url.toString(),{headers:{authorization:`Bearer ${token}`}});
      if(response.status===401&&oauth){await refresh();response=await fetchLimited(url.toString(),{headers:{authorization:`Bearer ${token}`}});}
      if(response.status===401||response.status===403)throw new SourceFault('AUTH_REQUIRED');return response;
    }
    async function json<T>(path:string,query:Record<string,string>={}):Promise<T>{const response=await api(path,query);if(response.status===410)throw new SourceFault('SCOPE_INCOMPLETE','CURSOR_EXPIRED');if(!response.ok)throw new SourceFault('READ_FAILED');return validatedJson<T>(await readBody(response,Math.min(maxBytes,8*1024*1024)));}
    async function startToken():Promise<string>{const output=await json<{startPageToken?:string}>('changes/startPageToken',{supportsAllDrives:'true'});if(!output.startPageToken)throw new SourceFault('INVALID_READ_RESULT');return output.startPageToken;}
    const scopeHash=sha(JSON.stringify({roots,explicit}));let previous:DriveCursor|null=null;
    if(request.cursor&&typeof request.cursor==='object'){const value=request.cursor as Partial<DriveCursor>;if(value.version==='drive-v1'&&value.scopeHash===scopeHash&&typeof value.pageToken==='string'&&value.files&&typeof value.files==='object'&&!Array.isArray(value.files)&&Object.keys(value.files).length<=maxFiles)previous=value as DriveCursor;}
    const gaps:string[]=[],snapshots:SourceSnapshot[]=[],inventory=new Map<string,{file:DriveFile;ancestors:string[];roots:string[]}>();let pageToken:string;
    try {
      if(!token||typeof credential!=='string'&&credential.expiresAt&&(!Number.isFinite(Date.parse(credential.expiresAt))||Date.parse(credential.expiresAt)<=now().getTime()+60000))await refresh();
      pageToken=previous?.pageToken??await startToken();
      // Consume real provider changes, then inventory the authorized tree to verify moves and ancestry.
      if(previous){let next:string|undefined=pageToken,seen=new Set<string>(),pages=0;try{while(next){if(++pages>maxPages||seen.has(next))throw new SourceFault('SCOPE_INCOMPLETE');seen.add(next);const output:{changes?:unknown[];nextPageToken?:string;newStartPageToken?:string}=await json('changes',{pageToken:next,pageSize:'1000',includeRemoved:'true',supportsAllDrives:'true',includeItemsFromAllDrives:'true',fields:'changes(fileId,removed,file(id,parents,trashed,mimeType)),nextPageToken,newStartPageToken'});if(!Array.isArray(output.changes))throw new SourceFault('INVALID_READ_RESULT');if(output.nextPageToken)next=output.nextPageToken;else{if(!output.newStartPageToken)throw new SourceFault('INVALID_READ_RESULT');pageToken=output.newStartPageToken;next=undefined;}}}catch(error){if(error instanceof SourceFault&&error.reason==='CURSOR_EXPIRED'){pageToken=await startToken();}else throw error;}}
      let listPages=0;const visited=new Set<string>();
      async function folder(id:string,ancestors:string[],root:string):Promise<void> {
        const visitKey=`${root}:${id}`;if(visited.has(visitKey))return;visited.add(visitKey);if(ancestors.length>100||visited.size>maxFiles)throw new SourceFault('SCOPE_INCOMPLETE');
        let next:string|undefined,seen=new Set<string>();do {if(++listPages>maxPages||next&&seen.has(next))throw new SourceFault('SCOPE_INCOMPLETE');if(next)seen.add(next);const output:{files?:unknown[];nextPageToken?:string;incompleteSearch?:boolean}=await json('files',{q:`'${id}' in parents and trashed = false`,pageSize:'1000',fields:`files(${fields}),nextPageToken,incompleteSearch`,supportsAllDrives:'true',includeItemsFromAllDrives:'true',...(next?{pageToken:next}:{})});if(!Array.isArray(output.files))throw new SourceFault('INVALID_READ_RESULT');if(output.incompleteSearch)throw new SourceFault('SCOPE_INCOMPLETE');
          for(const value of output.files){if(!fileValid(value)||!value.parents?.includes(id))throw new SourceFault('INVALID_READ_RESULT');if(value.trashed)continue;if(value.mimeType===GOOGLE_FOLDER){await folder(value.id,[...ancestors,id],root);continue;}const found=inventory.get(value.id);if(found){if(!found.roots.includes(root))found.roots.push(root);for(const ancestor of [...ancestors,id])if(!found.ancestors.includes(ancestor))found.ancestors.push(ancestor);}else inventory.set(value.id,{file:value,ancestors:[...ancestors,id],roots:[root]});if(inventory.size>maxFiles)throw new SourceFault('SCOPE_INCOMPLETE');}next=output.nextPageToken;
        }while(next);
      }
      for(const root of roots){const value=await json<unknown>(`files/${root}`,{fields,supportsAllDrives:'true'});if(!fileValid(value)||value.mimeType!==GOOGLE_FOLDER||value.trashed)throw new SourceFault('SCOPE_MISMATCH');await folder(root,[],root);}
      for(const id of explicit){const value=await json<unknown>(`files/${id}`,{fields,supportsAllDrives:'true'});if(!fileValid(value)||value.id!==id)throw new SourceFault('INVALID_READ_RESULT');if(value.trashed)continue;if(value.mimeType===GOOGLE_FOLDER){gaps.push('指定文件范围包含目录；请使用目录范围登记');continue;}if(!inventory.has(id))inventory.set(id,{file:value,ancestors:[],roots:[]});if(inventory.size>maxFiles)throw new SourceFault('SCOPE_INCOMPLETE');}
      const nextFiles:Record<string,KnownFile>=Object.create(null) as Record<string,KnownFile>;
      for(const [id,entry] of [...inventory.entries()].sort(([a],[b])=>a.localeCompare(b))) {
        const rev=revision(entry.file),known=previous?.files[id];if(known?.revision===rev){nextFiles[id]={...known,ancestorFolderIds:entry.ancestors,scopeFolderIds:entry.roots};continue;}
        try {
          let contentMime=entry.file.mimeType,path=`files/${id}`,query:Record<string,string>={alt:'media',supportsAllDrives:'true'};
          if(contentMime.startsWith('application/vnd.google-apps.')){const exported:Record<string,string>={'application/vnd.google-apps.document':'text/plain','application/vnd.google-apps.presentation':'application/vnd.openxmlformats-officedocument.presentationml.presentation','application/vnd.google-apps.spreadsheet':'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'};const target=exported[contentMime];if(!target)throw new SourceFault('CONTENT_UNSUPPORTED');contentMime=target;path=`files/${id}/export`;query={mimeType:target};}
          if(entry.file.size&&Number(entry.file.size)>maxBytes)throw new SourceFault('SCOPE_INCOMPLETE');const response=await api(path,query);if(!response.ok)throw new SourceFault('READ_FAILED');const bytes=await readBody(response,maxBytes);const after=await json<unknown>(`files/${id}`,{fields,supportsAllDrives:'true'});if(!fileValid(after)||after.id!==id||after.trashed||revision(after)!==rev)throw new SourceFault('SCOPE_INCOMPLETE');if(entry.file.md5Checksum&&!entry.file.mimeType.startsWith('application/vnd.google-apps.')&&createHash('md5').update(bytes).digest('hex')!==entry.file.md5Checksum)throw new SourceFault('SCOPE_INCOMPLETE');let extracted;try{extracted=await extractSourceTextAsync(bytes,contentMime,{timeoutMs:Math.min(timeoutMs,60000)});}catch(error){throw new SourceFault(['SOURCE_CONTENT_UNSUPPORTED','SOURCE_PDF_OCR_REQUIRED','SOURCE_PPTX_OCR_REQUIRED'].includes((error as Error).message)?'CONTENT_UNSUPPORTED':'SCOPE_INCOMPLETE');}
          const objects=await store.put(request.orgId,request.connectionId,bytes,extracted.text),coverage:SourceCoverage={status:extracted.gaps?.length?'partial':'complete',scope:JSON.stringify({folder_ids:entry.roots,file_ids:explicit.includes(id)?[id]:[]}),start_locator:extracted.format==='pptx'?'slide:1':extracted.format==='pdf'?'page:1':'text:1',end_locator:`text:${extracted.text.split('\n').length}`,folder_ids:entry.roots,ancestor_folder_ids:entry.ancestors,...(extracted.gaps?.length?{gaps:extracted.gaps}:{})};
          if(extracted.gaps?.length)gaps.push(...extracted.gaps.map(gap=>`文件 ${id}：${gap}`));
          const snapshot:SourceSnapshot={providerFileId:id,title:entry.file.name,revision:rev,...objects,mimeType:contentMime,retrievedAt:now().toISOString(),sourceModifiedAt:entry.file.modifiedTime??null,sourceUrl:`https://drive.google.com/file/d/${id}/view`,visibility:'internal',scopeFolderIds:entry.roots,ancestorFolderIds:entry.ancestors,coverage};
          // A revision bump alone must not duplicate a content-identical business object.
          if(!known||known.contentHash!==objects.contentHash)snapshots.push(snapshot);nextFiles[id]={revision:rev,...objects,title:entry.file.name,mimeType:contentMime,sourceModifiedAt:entry.file.modifiedTime??null,ancestorFolderIds:entry.ancestors,scopeFolderIds:entry.roots};
        }catch(error){if(error instanceof SourceFault&&error.code==='AUTH_REQUIRED')throw error;gaps.push(`文件 ${id} 的正文或范围未完整读取`);if(known)nextFiles[id]=known;}
      }
      if(previous)for(const [id,known] of Object.entries(previous.files)){if(inventory.has(id))continue;const text='来源文件已删除或移出授权范围；原历史版本保留，当前依据已撤回。',bytes=Buffer.from(JSON.stringify({providerFileId:id,removed:true,previousContentHash:known.contentHash})),objects=await store.put(request.orgId,request.connectionId,bytes,text);snapshots.push({providerFileId:id,title:known.title,revision:`removed:${known.contentHash}`,...objects,mimeType:'application/json',retrievedAt:now().toISOString(),sourceModifiedAt:null,sourceUrl:`https://drive.google.com/file/d/${id}/view`,visibility:'internal',removed:true,scopeFolderIds:known.scopeFolderIds,ancestorFolderIds:known.ancestorFolderIds,coverage:{status:'complete',scope:JSON.stringify({folder_ids:known.scopeFolderIds,file_ids:explicit.includes(id)?[id]:[]}),start_locator:'scope:removed',end_locator:'scope:removed',folder_ids:known.scopeFolderIds,ancestor_folder_ids:known.ancestorFolderIds}});}
      if(gaps.length)return {status:'partial',mode:'live',snapshots,nextCursor:request.cursor,gaps};const nextCursor:DriveCursor={version:'drive-v1',scopeHash,pageToken,files:{...nextFiles}};return snapshots.length?{status:'changed',mode:'live',snapshots,nextCursor,gaps:[]}:{status:'no_change',mode:'live',snapshots:[],nextCursor,gaps:[]};
    } catch(error){return failure(error instanceof SourceFault?error.code:'READ_FAILED');}
  }

  async function publicSource(request:SourceReadRequest):Promise<SourceReadResult> {
    const snapshots:SourceSnapshot[]=[],gaps:string[]=[],hashes:Record<string,string>=Object.create(null) as Record<string,string>;let urls:string[];
    try{urls=[...new Set((request.scope.urls??[]).map(normalizeUrl))].sort();if(urls.length>200)throw new SourceFault('SCOPE_INCOMPLETE');}catch(error){return failure(error instanceof SourceFault?error.code:'SCOPE_MISMATCH');}
    const scopeHash=sha(JSON.stringify(urls)),cursor=request.cursor as Partial<PublicCursor>|null,previous=cursor?.version==='public-v1'&&cursor.scopeHash===scopeHash&&cursor.hashes&&typeof cursor.hashes==='object'?cursor.hashes:{};
    const approved=new Set(urls);
    for(const url of urls) {
      try {
        let current=url,response:Response|undefined;const seen=new Set<string>();
        for(let hop=0;hop<6;hop++){if(seen.has(current))throw new SourceFault('SCOPE_INCOMPLETE');seen.add(current);const parsed=new URL(current),hostname=parsed.hostname.replace(/^\[|\]$/g,'');if(hostname==='localhost'||hostname.endsWith('.localhost')||hostname.endsWith('.local'))throw new SourceFault('SCOPE_MISMATCH');
          const addresses=isIP(hostname)?[{address:hostname,family:isIP(hostname)}]:await (config.resolveHost??(host=>lookup(host,{all:true})))(hostname);if(!addresses.length||addresses.some(address=>!isPublicSourceAddress(address.address)))throw new SourceFault('SCOPE_MISMATCH');
          response=config.fetch?await config.fetch(current,{headers:{accept:'text/html,text/plain,application/json,text/markdown;q=0.9','accept-encoding':'identity'},redirect:'manual',signal:AbortSignal.timeout(timeoutMs)}):await pinnedPublicFetch(parsed,addresses[0]!,timeoutMs,maxBytes);
          if([301,302,303,307,308].includes(response.status)){const location=response.headers.get('location');await response.body?.cancel();if(!location)throw new SourceFault('SCOPE_INCOMPLETE');current=normalizeUrl(new URL(location,current).toString());if(!approved.has(current))throw new SourceFault('SCOPE_MISMATCH');continue;}break;
        }
        if(!response||!response.ok||response.status>=300)throw new SourceFault('READ_FAILED');const contentType=response.headers.get('content-type')??'text/html',mime=contentType.split(';')[0]!;if(response.headers.get('content-encoding')&&!['identity'].includes(response.headers.get('content-encoding')!))throw new SourceFault('CONTENT_UNSUPPORTED');const bytes=await readBody(response,maxBytes),extracted=await extractSourceTextAsync(bytes,contentType,{timeoutMs:Math.min(timeoutMs,60000)}),objects=await store.put(request.orgId,request.connectionId,bytes,extracted.text);hashes[url]=objects.contentHash;if(extracted.gaps?.length)gaps.push(...extracted.gaps.map(gap=>`网页 ${url}：${gap}`));
        if(previous[url]!==objects.contentHash){const title=extracted.title??new URL(url).hostname;snapshots.push({providerFileId:url,title:title.slice(0,500),revision:objects.contentHash,...objects,mimeType:mime,retrievedAt:now().toISOString(),sourceModifiedAt:response.headers.get('last-modified')&&Number.isFinite(Date.parse(response.headers.get('last-modified')!))?new Date(response.headers.get('last-modified')!).toISOString():null,sourceUrl:url,visibility:'public',coverage:{status:extracted.gaps?.length?'partial':'complete',scope:url,start_locator:extracted.format==='pdf'?'page:1':'text:1',end_locator:`text:${extracted.text.split('\n').length}`,...(extracted.gaps?.length?{gaps:extracted.gaps}:{})}});}
      }catch{gaps.push(`网页 ${url} 未完成授权范围内的正文读取`);}
    }
    if(gaps.length)return {status:'partial',mode:'live',snapshots,nextCursor:request.cursor,gaps};const nextCursor:PublicCursor={version:'public-v1',scopeHash,hashes:{...hashes}};return snapshots.length?{status:'changed',mode:'live',snapshots,nextCursor,gaps:[]}:{status:'no_change',mode:'live',snapshots:[],nextCursor,gaps:[]};
  }
  return {mac_drive:drive,market_public:publicSource,competitor_public:publicSource,...(config.chatgptTransport?{chatgpt:config.chatgptTransport}:{})};
}
export function createRuntimeSourceReaders(config:RuntimeSourceConfig) {return createSourceReaders(createRuntimeSourceTransports(config));}

/** Pin the validated public DNS address to this request, while retaining the original Host and TLS SNI. */
function pinnedPublicFetch(url:URL,address:{address:string;family:number},timeoutMs:number,maxBytes:number):Promise<Response> {
  return new Promise((resolve,reject)=>{const request=(url.protocol==='https:'?httpsRequest:httpRequest)(url,{method:'GET',family:address.family,headers:{accept:'text/html,text/plain,application/json,text/markdown;q=0.9','accept-encoding':'identity'},lookup:(_hostname,_options,callback)=>callback(null,address.address,address.family)},response=>{const chunks:Buffer[]=[];let total=0;response.on('data',(chunk:Buffer)=>{total+=chunk.length;if(total>maxBytes){request.destroy(new SourceFault('SCOPE_INCOMPLETE'));return;}chunks.push(chunk);});response.on('error',()=>reject(new SourceFault('READ_FAILED')));response.on('end',()=>{try{const headers=new Headers();for(const [name,value] of Object.entries(response.headers)){if(value!==undefined)headers.set(name,Array.isArray(value)?value.join(','):value);}const status=response.statusCode??502;resolve(new Response([204,304].includes(status)?null:Buffer.concat(chunks),{status:status>=200&&status<=599?status:502,headers}));}catch{reject(new SourceFault('READ_FAILED'));}});});request.setTimeout(timeoutMs,()=>request.destroy(new SourceFault('READ_FAILED')));request.on('error',()=>reject(new SourceFault('READ_FAILED')));request.end();});
}
