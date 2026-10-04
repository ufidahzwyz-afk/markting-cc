import {createHash,randomUUID} from 'node:crypto';
import {constants} from 'node:fs';
import {mkdir,realpath,lstat,open,link,unlink} from 'node:fs/promises';
import {isAbsolute,join} from 'node:path';
import {inflateRawSync} from 'node:zlib';
import {Worker} from 'node:worker_threads';
import {createRequire} from 'node:module';

const hash=(value:Uint8Array|string)=>createHash('sha256').update(value).digest('hex');
const identifier=/^[A-Za-z0-9_-]{1,200}$/;
export interface SourceObjectIdentity {orgId:string;connectionId:string;objectKey:string;expectedHash:string}
/** Private, content-addressed objects. Existing bytes are verified and never overwritten. */
export class SourceObjectStore {
  private ready?:Promise<string>;
  constructor(private readonly root:string) {
    if(!root||!isAbsolute(root))throw new Error('SOURCE_ROOT_REQUIRED');
  }
  async put(orgId:string,connectionId:string,bytes:Uint8Array,text:string):Promise<{objectKey:string;contentHash:string;textObjectKey:string;textHash:string}> {
    this.validateIds(orgId,connectionId);
    if(bytes.byteLength>64*1024*1024||Buffer.byteLength(text,'utf8')>16*1024*1024)throw new Error('SOURCE_CONTENT_LIMIT');
    const contentHash=hash(bytes),textHash=hash(text);
    const objectKey=`${orgId}/${connectionId}/${contentHash}.bin`,textObjectKey=`${orgId}/${connectionId}/${textHash}.txt`;
    await this.write(objectKey,bytes,contentHash);await this.write(textObjectKey,Buffer.from(text,'utf8'),textHash);
    return {objectKey,contentHash,textObjectKey,textHash};
  }
  async readBytes(identity:SourceObjectIdentity):Promise<Buffer> {
    this.validateIds(identity.orgId,identity.connectionId);
    const parts=identity.objectKey.split('/');
    if(!(/^[a-f0-9]{64}$/).test(identity.expectedHash)||parts.length!==3||parts[0]!==identity.orgId||parts[1]!==identity.connectionId||!new RegExp(`^${identity.expectedHash}\\.(bin|txt)$`).test(parts[2]??''))throw new Error('SOURCE_OBJECT_SCOPE_MISMATCH');
    const path=await this.path(identity.objectKey,false);
    const handle=await open(path,constants.O_RDONLY|constants.O_NOFOLLOW);
    try {const info=await handle.stat();if(!info.isFile()||info.size>64*1024*1024)throw new Error('SOURCE_OBJECT_INVALID');const bytes=await handle.readFile();if(hash(bytes)!==identity.expectedHash)throw new Error('SOURCE_OBJECT_HASH_MISMATCH');return bytes;}finally{await handle.close();}
  }
  async readText(identity:SourceObjectIdentity):Promise<string> {if(!identity.objectKey.endsWith('.txt'))throw new Error('SOURCE_TEXT_OBJECT_REQUIRED');return (await this.readBytes(identity)).toString('utf8');}
  private validateIds(org:string,connection:string) {if(!identifier.test(org)||!identifier.test(connection))throw new Error('SOURCE_OBJECT_SCOPE_INVALID');}
  private async path(key:string,create:boolean):Promise<string> {
    const root=await (this.ready??=mkdir(this.root,{recursive:true,mode:0o700}).then(()=>realpath(this.root))),parts=key.split('/');if(parts.length!==3||!identifier.test(parts[0]??'')||!identifier.test(parts[1]??'')||!(/^[a-f0-9]{64}\.(bin|txt)$/).test(parts[2]??''))throw new Error('SOURCE_OBJECT_KEY_INVALID');
    let current=root;for(const part of parts.slice(0,2)){current=join(current,part);if(create)await mkdir(current,{mode:0o700}).catch(error=>{if((error as NodeJS.ErrnoException).code!=='EEXIST')throw error;});const info=await lstat(current);if(!info.isDirectory()||info.isSymbolicLink())throw new Error('SOURCE_OBJECT_SCOPE_INVALID');}return join(current,parts[2]!);
  }
  private async write(key:string,bytes:Uint8Array,expectedHash:string):Promise<void> {
    const path=await this.path(key,true);
    const temporary=`${path}.${randomUUID()}.tmp`,handle=await open(temporary,constants.O_WRONLY|constants.O_CREAT|constants.O_EXCL|constants.O_NOFOLLOW,0o600);
    try{await handle.writeFile(bytes);await handle.sync();}catch(error){await handle.close();await unlink(temporary).catch(()=>{});throw error;}await handle.close();
    try{await link(temporary,path);}catch(error){if((error as NodeJS.ErrnoException).code!=='EEXIST')throw error;const [orgId,connectionId]=key.split('/');await this.readBytes({orgId:orgId!,connectionId:connectionId!,objectKey:key,expectedHash});}finally{await unlink(temporary).catch(()=>{});}
  }
}

export function decodeSourceXml(value:string):string {return value.replace(/&(?:#(x[\da-f]+|\d+)|([A-Za-z]+));/gi,(all:string,numeric:string|undefined,named:string|undefined)=>{if(numeric){const code=numeric[0]?.toLowerCase()==='x'?parseInt(numeric.slice(1),16):parseInt(numeric,10);return code>=0&&code<=0x10ffff&&! (code>=0xd800&&code<=0xdfff)?String.fromCodePoint(code):all;}return ({amp:'&',lt:'<',gt:'>',quot:'"',apos:"'",nbsp:' '} as Record<string,string>)[named?.toLowerCase()??'']??all;});}
function normalizeText(value:string):string {return value.replace(/\r\n?/g,'\n').replace(/\0/g,'').replace(/[\t ]+\n/g,'\n').replace(/\n{4,}/g,'\n\n\n').trim();}
function decodeText(bytes:Buffer,mimeType:string):string {
  const charset=mimeType.match(/charset\s*=\s*["']?([\w-]+)/i)?.[1]??(mimeType.toLowerCase().startsWith('text/html')?bytes.subarray(0,8192).toString('latin1').match(/<meta\b[^>]*charset\s*=\s*["']?([\w-]+)/i)?.[1]:undefined)??'utf-8';
  try{return new TextDecoder(charset,{fatal:true}).decode(bytes);}catch{throw new Error('SOURCE_TEXT_ENCODING_UNSUPPORTED');}
}
function xmlParagraphs(xml:string,paragraphTag:string,textTag:string):string {
  const paragraphs=[...xml.matchAll(new RegExp(`<${paragraphTag}(?:\\s[^>]*)?>([\\s\\S]*?)<\\/${paragraphTag}>`,'g'))];
  return paragraphs.map(paragraph=>[...paragraph[1]!.matchAll(new RegExp(`<${textTag}(?:\\s[^>]*)?>([\\s\\S]*?)<\\/${textTag}>`,'g'))].map(part=>decodeSourceXml(part[1]!)).join('')).filter(Boolean).join('\n');
}
/** Reads ZIP central-directory sizes first; prevents traversal, encryption and decompression bombs. */
function xmlArchive(bytes:Buffer):Map<string,string> {
  if(bytes.length>32*1024*1024)throw new Error('SOURCE_CONTENT_LIMIT');
  let end=-1;for(let pos=bytes.length-22;pos>=Math.max(0,bytes.length-65557);pos--){if(bytes.readUInt32LE(pos)===0x06054b50){end=pos;break;}}
  if(end<0)throw new Error('SOURCE_ARCHIVE_INVALID');
  const count=bytes.readUInt16LE(end+10),centralSize=bytes.readUInt32LE(end+12),centralStart=bytes.readUInt32LE(end+16);
  if(count>10000||centralStart+centralSize>end||bytes.readUInt16LE(end+4)!==0||bytes.readUInt16LE(end+6)!==0)throw new Error('SOURCE_ARCHIVE_INVALID');
  const entries=new Map<string,string>();let pos=centralStart,total=0;
  for(let index=0;index<count;index++) {
    if(pos+46>bytes.length||bytes.readUInt32LE(pos)!==0x02014b50)throw new Error('SOURCE_ARCHIVE_INVALID');
    const flags=bytes.readUInt16LE(pos+8),method=bytes.readUInt16LE(pos+10),compressed=bytes.readUInt32LE(pos+20),uncompressed=bytes.readUInt32LE(pos+24),nameSize=bytes.readUInt16LE(pos+28),extra=bytes.readUInt16LE(pos+30),comment=bytes.readUInt16LE(pos+32),offset=bytes.readUInt32LE(pos+42);
    const name=bytes.subarray(pos+46,pos+46+nameSize).toString('utf8');pos+=46+nameSize+extra+comment;
    if(name.startsWith('/')||name.includes('\\')||name.split('/').includes('..')||(flags&1)||uncompressed>16*1024*1024)throw new Error('SOURCE_ARCHIVE_INVALID');
    if(!name.endsWith('.xml'))continue;
    total+=uncompressed;if(total>48*1024*1024||offset+30>bytes.length||bytes.readUInt32LE(offset)!==0x04034b50)throw new Error('SOURCE_CONTENT_LIMIT');
    const dataStart=offset+30+bytes.readUInt16LE(offset+26)+bytes.readUInt16LE(offset+28);if(dataStart+compressed>centralStart)throw new Error('SOURCE_ARCHIVE_INVALID');
    const data=bytes.subarray(dataStart,dataStart+compressed);const content=method===0?data:method===8?inflateRawSync(data,{maxOutputLength:Math.max(1,uncompressed)}):null;
    if(!content||content.length!==uncompressed||entries.has(name))throw new Error('SOURCE_ARCHIVE_INVALID');entries.set(name,content.toString('utf8'));
  }return entries;
}
export interface SourceTextExtraction {text:string;format:string;title?:string;gaps?:string[]}
export function extractSourceText(bytes:Uint8Array,mimeType:string):SourceTextExtraction {
  const buffer=Buffer.from(bytes),mime=mimeType.split(';')[0]!.toLowerCase();let text:string,format:string,title:string|undefined;const gaps:string[]=[];
  if(['text/plain','text/csv','text/markdown','application/json','application/xml','text/xml'].includes(mime)){text=decodeText(buffer,mimeType);format=mime;}
  else if(mime==='text/html'||mime==='application/xhtml+xml'){const html=decodeText(buffer,mimeType);title=decodeSourceXml(html.match(/<title\b[^>]*>([\s\S]*?)<\/title>/i)?.[1]?.replace(/<[^>]+>/g,'').trim()??'');text=decodeSourceXml(html.replace(/<(script|style|noscript|template)\b[^>]*>[\s\S]*?<\/\1\s*>/gi,'').replace(/<!--[\s\S]*?-->/g,'').replace(/<(?:\/p|\/div|\/section|\/article|br|\/li|\/h[1-6]|\/tr)\b[^>]*>/gi,'\n').replace(/<[^>]+>/g,' '));format='html';}
  else if(mime==='application/vnd.openxmlformats-officedocument.presentationml.presentation') {
    const archive=xmlArchive(buffer),slides=[...archive.keys()].filter(name=>/^ppt\/slides\/slide\d+\.xml$/.test(name)).sort((a,b)=>Number(a.match(/(\d+)\.xml$/)![1])-Number(b.match(/(\d+)\.xml$/)![1]));
    if(!slides.length)throw new Error('SOURCE_ARCHIVE_INVALID');let hasSourceText=false;
    // Text nodes prove only the extracted text. Images, charts, SmartArt and embedded media
    // retain their original bytes but need their own extraction or a business review.
    const hasUnextractedObject=(xml:string)=>/<(?:[\w.-]+:)?(?:pic|blip|chart|relIds|oleObj|videoFile|audioFile)\b/.test(xml);
    text=slides.map((name,index)=>{const xml=archive.get(name)!,slideText=xmlParagraphs(xml,'a:p','a:t');if(slideText.trim())hasSourceText=true;else gaps.push(`PPTX第${index+1}页没有可验证文字，需OCR或人工核对`);if(hasUnextractedObject(xml))gaps.push(`PPTX第${index+1}页含未提取的图片、图表或嵌入对象，需OCR或人工核对`);return `[Slide ${index+1}]\n${slideText}`;}).join('\n\n');
    const notes=[...archive.keys()].filter(name=>/^ppt\/notesSlides\/notesSlide\d+\.xml$/.test(name)).sort();for(const name of notes){const xml=archive.get(name)!,note=xmlParagraphs(xml,'a:p','a:t');if(note.trim()){hasSourceText=true;text+=`\n\n[${name}]\n${note}`;}if(hasUnextractedObject(xml))gaps.push(`PPTX备注 ${name} 含未提取的对象，需OCR或人工核对`);}
    if([...archive].some(([name,xml])=>/^ppt\/(?:slideMasters|slideLayouts|notesMasters)\//.test(name)&&hasUnextractedObject(xml)))gaps.push('PPTX母版或布局含未提取的图片、图表或嵌入对象，需OCR或人工核对');
    if(!hasSourceText)throw new Error('SOURCE_PPTX_OCR_REQUIRED');format='pptx';
  } else if(mime==='application/vnd.openxmlformats-officedocument.wordprocessingml.document'){const archive=xmlArchive(buffer),document=archive.get('word/document.xml');if(!document)throw new Error('SOURCE_ARCHIVE_INVALID');text=xmlParagraphs(document,'w:p','w:t');format='docx';}
  else if(mime==='application/vnd.openxmlformats-officedocument.spreadsheetml.sheet') {
    const archive=xmlArchive(buffer),strings=[...(archive.get('xl/sharedStrings.xml')??'').matchAll(/<si(?:\s[^>]*)?>([\s\S]*?)<\/si>/g)].map(value=>[...value[1]!.matchAll(/<t(?:\s[^>]*)?>([\s\S]*?)<\/t>/g)].map(part=>decodeSourceXml(part[1]!)).join(''));
    const sheets=[...archive.keys()].filter(name=>/^xl\/worksheets\/sheet\d+\.xml$/.test(name)).sort();if(!sheets.length)throw new Error('SOURCE_ARCHIVE_INVALID');text=sheets.map(name=>`[${name}]\n`+[...archive.get(name)!.matchAll(/<row(?:\s[^>]*)?>([\s\S]*?)<\/row>/g)].map(row=>[...row[1]!.matchAll(/<c\b([^>]*)>([\s\S]*?)<\/c>/g)].map(cell=>{const val=cell[2]!.match(/<v>([\s\S]*?)<\/v>/)?.[1];return /\bt="s"/.test(cell[1]!)?strings[Number(val)]??'':val?decodeSourceXml(val):[...cell[2]!.matchAll(/<t(?:\s[^>]*)?>([\s\S]*?)<\/t>/g)].map(part=>decodeSourceXml(part[1]!)).join('');}).join('\t')).join('\n')).join('\n\n');format='xlsx';
  } else throw new Error('SOURCE_CONTENT_UNSUPPORTED');
  text=normalizeText(text);if(!text||Buffer.byteLength(text,'utf8')>16*1024*1024)throw new Error('SOURCE_CONTENT_EMPTY_OR_LIMIT');return {text,format,...(title?{title}:{}),...(gaps.length?{gaps}:{})};
}
/** PDF parsing runs in a bounded worker so malformed input cannot block the task lease or exhaust this process. */
export async function extractSourceTextAsync(bytes:Uint8Array,mimeType:string,options:{timeoutMs?:number;maxPages?:number}={}):Promise<SourceTextExtraction> {
  if(mimeType.split(';')[0]!.toLowerCase()!=='application/pdf')return extractSourceText(bytes,mimeType);
  const maxPages=options.maxPages??200,timeoutMs=options.timeoutMs??20000;if(bytes.byteLength>32*1024*1024||!Number.isSafeInteger(maxPages)||maxPages<1||maxPages>1000||timeoutMs<1||timeoutMs>60000)throw new Error('SOURCE_CONTENT_LIMIT');
  const modulePath=createRequire(import.meta.url).resolve('unpdf'),data=Uint8Array.from(bytes);
  const code=`const {parentPort,workerData}=require('node:worker_threads');
    (async()=>{const {getDocumentProxy}=require(workerData.modulePath);let pdf;
      try{pdf=await getDocumentProxy(new Uint8Array(workerData.data),{isEvalSupported:false,useSystemFonts:false,disableFontFace:true,useWorkerFetch:false,disableAutoFetch:true,disableStream:true,disableRange:true,verbosity:0});
        if(!pdf.numPages||pdf.numPages>workerData.maxPages)throw new Error('SOURCE_CONTENT_LIMIT');
        const pages=[],gaps=[];let size=0,hasText=false;
        for(let pageNumber=1;pageNumber<=pdf.numPages;pageNumber++){const page=await pdf.getPage(pageNumber);const content=await page.getTextContent();let pageText='';
          for(const item of content.items){if(typeof item.str==='string'){pageText+=item.str+(item.hasEOL?'\\n':' ');size+=Buffer.byteLength(item.str,'utf8')+1;if(size>16*1024*1024)throw new Error('SOURCE_CONTENT_LIMIT');}}
          pageText=pageText.trim();if(!pageText)gaps.push('PDF第'+pageNumber+'页没有可验证文字层，需OCR');else hasText=true;pages.push('[Page '+pageNumber+']\\n'+pageText);page.cleanup();}
        if(!hasText)throw new Error('SOURCE_PDF_OCR_REQUIRED');parentPort.postMessage({ok:true,text:pages.join('\\n\\n'),gaps});
      }catch(error){parentPort.postMessage({ok:false,code:['SOURCE_CONTENT_LIMIT','SOURCE_PDF_OCR_REQUIRED'].includes(error.message)?error.message:'SOURCE_PDF_READ_FAILED'});}finally{if(pdf)await pdf.destroy().catch(()=>{});}
    })().catch(()=>parentPort.postMessage({ok:false,code:'SOURCE_PDF_READ_FAILED'}));`;
  return new Promise((resolve,reject)=>{const worker=new Worker(code,{eval:true,workerData:{modulePath,data:data.buffer,maxPages},transferList:[data.buffer],resourceLimits:{maxOldGenerationSizeMb:128,maxYoungGenerationSizeMb:16,stackSizeMb:4}});let settled=false;
    const finish=(error:Error|null,value?:SourceTextExtraction)=>{if(settled)return;settled=true;clearTimeout(timer);void worker.terminate().catch(()=>{});if(error)reject(error);else resolve(value!);};
    const timer=setTimeout(()=>finish(new Error('SOURCE_PDF_READ_TIMEOUT')),timeoutMs);
    worker.on('message',(value:unknown)=>{if(!value||typeof value!=='object'){finish(new Error('SOURCE_PDF_READ_FAILED'));return;}const result=value as {ok?:boolean;text?:string;gaps?:string[];code?:string};if(!result.ok||typeof result.text!=='string'){finish(new Error(['SOURCE_CONTENT_LIMIT','SOURCE_PDF_OCR_REQUIRED'].includes(result.code??'')?result.code:'SOURCE_PDF_READ_FAILED'));return;}finish(null,{text:normalizeText(result.text),format:'pdf',...(result.gaps?.length?{gaps:result.gaps}:{})});});
    worker.on('error',()=>finish(new Error('SOURCE_PDF_READ_FAILED')));worker.on('exit',()=>{if(!settled)finish(new Error('SOURCE_PDF_READ_FAILED'));});
  });
}
