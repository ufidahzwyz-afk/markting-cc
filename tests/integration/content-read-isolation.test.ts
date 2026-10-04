import test from 'node:test';
import assert from 'node:assert/strict';
import {tsImport} from 'tsx/esm/api';
import {createTestDatabase,DEMO_ORG_ID,DEMO_OWNER_ID} from '@boran/db';
import {createContentItem,createContentVersion,createPage,getPagePreview} from '@boran/domain/content';
import type {ServiceContext} from '@boran/domain/core';
const {handleContent}=await tsImport('../../apps/ops/src/lib/handlers/content.ts',{parentURL:import.meta.url,tsconfig:new URL('../../apps/ops/tsconfig.json',import.meta.url).pathname}) as typeof import('../../apps/ops/src/lib/handlers/content');

test('mock content reads cannot expose live private drafts or page previews; original history remains readable',async()=>{
 const db=await createTestDatabase(),mock:ServiceContext={db,orgId:DEMO_ORG_ID,actorId:DEMO_OWNER_ID,roles:['owner','marketer'],mode:'mock'},live={...mock,mode:'live' as const};
 const modules=[{type:'hero',schema_version:1,data:{headline:'Synthetic confidential live text',description:'Synthetic private engineering fixture only.',cta:{label:'Read',href:'/articles/private',action:'navigate'}}}];
 try{
  const old=await createContentItem(mock,{title:'Original demo history',kind:'article',business_line:'shared'});
  // Existing pre-migration manual rows retain their original unknown mode.
  await db.query('UPDATE content_items SET execution_mode=NULL WHERE id=$1',[old.id]);
  const item=await createContentItem(live,{title:'Synthetic confidential live item',kind:'article',business_line:'shared'});
  const version=await createContentVersion(live,item.id,{title:'Synthetic confidential live draft',modules,claim_ids:[]},0);
  const site={publicOrigin:'https://public.example.invalid',allowedPathPrefixes:['/articles']};
  const page=await createPage(live,{host:'public.example.invalid',path:'/articles/private',business_line:'shared',template_key:'article',content_item_id:item.id,seo_title:'Synthetic private title',description:'Synthetic private fixture',canonical_url:'https://public.example.invalid/articles/private',index_policy:'noindex'},site);
  const call=(ctx:ServiceContext,parts:string[])=>handleContent(ctx,new Request('http://localhost/api/v1/'+parts.join('/')),parts);
  for(const parts of [['content',item.id],['content',item.id,'versions'],['pages',page.page_id],['pages',page.page_id,'preview']])await assert.rejects(call(mock,parts),{code:'NOT_FOUND'});
  await assert.rejects(getPagePreview(mock,page.page_id),{code:'NOT_FOUND'});
  for(const resource of ['content','pages']){
   const response=await call(mock,[resource]);assert.ok(response);
   const payload=await response.json();assert.equal(JSON.stringify(payload).includes('confidential'),false);assert.equal(JSON.stringify(payload).includes(item.id),false);
  }
  const history=await call(mock,['content',old.id]);assert.equal((await history!.json()).data.id,old.id);
  const actual=await call(live,['content',item.id,'versions']);assert.equal((await actual!.json()).data[0].id,version.id);
  assert.equal((await call(live,['content',old.id]))!.status,200);
  assert.equal((await db.query('SELECT execution_mode FROM content_items WHERE id=$1',[old.id])).rows[0]!.execution_mode,null);
 }finally{await db.close();}
});
