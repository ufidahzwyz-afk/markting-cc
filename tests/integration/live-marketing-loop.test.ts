import test from 'node:test';
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {createHash} from 'node:crypto';
import {mkdtemp,rm} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {createTestDatabase,DEMO_ORG_ID,DEMO_OWNER_ID,type Database} from '@boran/db';
import {AiProviderError} from '@boran/ai';
import {initializeSecretStore,EncryptedSecretStore} from '@boran/connectors/secrets';
import {createRuntimeSourceReaders} from '@boran/connectors/source-runtime';
import {SourceObjectStore} from '@boran/connectors/source-content';
import {ingestSourceRead,initializeBusinessMaster} from '@boran/domain/marketing';
import {getPrivateDraft,editPrivateDraft} from '@boran/domain/pipeline';
import {stableHash,uuid,type ServiceContext} from '@boran/domain/core';
import {createConfiguredAiGateway,defaultModelConfiguration} from '../../apps/worker/src/automation-runtime';
import {executeMarketingWorkflow} from '../../apps/worker/src/marketing-workflow';
import {dispatchMarketing} from '../../apps/worker/src/marketing-dispatch';
import {scheduleRun,claimStep,completeStep,failStep,type StepClaim} from '../../apps/worker/src/queue';

type Row=Record<string,any>;
function modelOutput(input:Row):Row {
  const context=input.semantic_context,business=input.business_input;
  const common={workflow:input.workflow,schema_version:2,source_versions:context.sourceVersions,policy_refs:context.policyRefs};
  if(input.workflow==='insight_topics'){
    const material=business.source_materials.find((value:Row)=>value.source_version_id===business.changed_source_version_ids[0]),segment=material.segments[0];
    return {...common,claims:[{claim_key:'scope_fact',claim_id:null,claim_text:segment.text,source_version_id:material.source_version_id,locator:segment.locator,assertion_type:'fact',decision_status:null,decision_evidence_ref:null,supersedes_claim_id:null,inference_rationale:null}],output:{data_cutoff:context.dataCutoff,insights:[{proposal_key:'service_change',insight_id:null,summary:'服务资料发生变化',business_line:'shared',customer_problem:'需要了解服务范围',opportunity:'解释更新后的服务范围',inference_text:null,priority_score:null,priority_reason:'来源出现真实文本变化',data_cutoff:context.dataCutoff,evidence:[{claim_key:'scope_fact',relation:'supports'}],candidate_state:'candidate',gaps:[],next_step:'生成私有说明稿'}],topics:[{proposal_key:'service_topic',topic_id:null,insight_key:'service_change',business_line:'shared',title:'企业应用服务范围说明',audience:'企业信息负责人',problem:'了解服务范围',offer:'企业应用服务说明',angle:'解释服务范围',keywords:['企业应用'],claim_keys:['scope_fact'],targets:[],priority:1,priority_reason:'候选解释资料',policy_version_id:null,proposed_scheduled_at:null,auto_schedule_candidate:false,gaps:[{kind:'account',description:'未配置发布账号',reference_key:null,next_step:'保留私有稿'}],metric_keys:['inquiries'],industry_key:null,product_family_key:null,domain_keys:[]}],source_gaps:[]}};
  }
  const id=business.topic.claim_ids[0],claim=context.trustedClaims.find((value:Row)=>value.claim_id===id);
  return {...common,claims:[{claim_key:'draft_fact',claim_id:id,claim_text:claim.claim_text,source_version_id:claim.source_version_id,locator:claim.locator,assertion_type:claim.assertion_type,decision_status:claim.decision_status,decision_evidence_ref:claim.decision_evidence_ref,supersedes_claim_id:claim.supersedes_claim_id,inference_rationale:claim.inference_rationale}],output:{title:'企业应用服务范围说明',body_blocks:[{type:'paragraph',text:claim.claim_text}],claim_refs:[{block_index:0,claim_id:id}],cta:business.cta,warnings:['事实及公开许可仍待独立核实'],topic_id:business.topic.topic_id,source_claim_keys:['draft_fact'],gaps:[{kind:'fact',description:'资料待核实',reference_key:null,next_step:'核对原文'}]}};
}

/** Synthetic local HTTP provider traffic verifies engineering integration, never live business acceptance. */
test('authorized folder changes automatically become evidence, topics and private drafts through durable provider calls',async t=>{
  const db=await createTestDatabase(),root=await mkdtemp(join(tmpdir(),'boran-live-loop-'));
  const envNames=['BORAN_ORG_ID','BORAN_MODE','APP_ENV','AI_MODE','BORAN_SECRET_STORE_ROOT','BORAN_SECRET_KEY_FILE'] as const;
  const previous=Object.fromEntries(envNames.map(key=>[key,process.env[key]]));
  Object.assign(process.env,{BORAN_ORG_ID:DEMO_ORG_ID,BORAN_MODE:'live',APP_ENV:'test',AI_MODE:'real',BORAN_SECRET_STORE_ROOT:join(root,'secrets'),BORAN_SECRET_KEY_FILE:join(root,'master.key')});
  let revision=1,sourceText='泊冉提供企业应用实施服务。',calls=0;
  const server=createServer(async(request,response)=>{
    try{
      const url=new URL(request.url!,'http://fixture.local');let result:Row;
      if(url.pathname==='/models')result={data:[{id:'deepseek-v4-pro'},{id:'deepseek-flash'}]};
      else if(url.pathname==='/chat/completions'){
        const chunks=[];for await(const chunk of request)chunks.push(Buffer.from(chunk));
        const body=JSON.parse(Buffer.concat(chunks).toString()),content=body.messages[1].content as string;
        const input=JSON.parse(content.slice(content.indexOf('\n')+1,content.lastIndexOf('\n')));calls++;
        result={id:`synthetic-provider-${calls}`,model:body.model,choices:[{index:0,finish_reason:'stop',message:{role:'assistant',content:JSON.stringify(modelOutput(input))}}],usage:{prompt_tokens:400,completion_tokens:500,total_tokens:900}};
        response.setHeader('x-request-id',`synthetic-request-${calls}`);
      }else if(url.pathname==='/drive/v3/changes/startPageToken')result={startPageToken:`page-${revision}`};
      else if(url.pathname==='/drive/v3/changes')result={changes:[],newStartPageToken:`page-${revision}`};
      else if(url.pathname==='/drive/v3/files/authorized-root')result={id:'authorized-root',name:'Synthetic authorized folder',mimeType:'application/vnd.google-apps.folder'};
      else if(url.pathname==='/drive/v3/files')result={files:[{id:'fixture-file',name:'Synthetic source document',mimeType:'text/plain',parents:['authorized-root'],version:String(revision),modifiedTime:`2026-10-04T0${revision}:00:00Z`}]};
      else if(url.pathname==='/drive/v3/files/fixture-file'&&url.searchParams.get('alt')==='media'){response.setHeader('content-type','text/plain; charset=utf-8');response.end(sourceText);return;}
      else if(url.pathname==='/drive/v3/files/fixture-file')result={id:'fixture-file',name:'Synthetic source document',mimeType:'text/plain',parents:['authorized-root'],version:String(revision),modifiedTime:`2026-10-04T0${revision}:00:00Z`};
      else {response.writeHead(404);response.end();return;}
      response.setHeader('content-type','application/json');response.end(JSON.stringify(result));
    }catch{response.writeHead(500);response.end();}
  });
  await new Promise<void>(resolve=>server.listen(0,'127.0.0.1',resolve));
  const local=`http://127.0.0.1:${(server.address() as {port:number}).port}`;
  const fixtureFetch:typeof fetch=async(input,init)=>{const url=new URL(input instanceof Request?input.url:String(input));return fetch(`${local}${url.pathname}${url.search}`,init);};
  const ctx:ServiceContext={db,orgId:DEMO_ORG_ID,actorId:DEMO_OWNER_ID,roles:['owner','marketer'],mode:'live',actorType:'service'};
  try{
    await initializeBusinessMaster(ctx);
    const storeOptions={rootDirectory:join(root,'secrets'),keyFile:join(root,'master.key')};await initializeSecretStore(storeOptions);
    const secrets=new EncryptedSecretStore(storeOptions),sourceId=uuid(),modelId=uuid();
    const sourceSecret=await secrets.write({kind:'drive_oauth',clientId:'synthetic-client',clientSecret:'synthetic-only',refreshToken:'synthetic-refresh',accessToken:'synthetic-drive-token',expiresAt:'2030-01-01T00:00:00Z'},{orgId:ctx.orgId,connectionId:sourceId});
    const modelSecret=await secrets.write({kind:'api_key',apiKey:'synthetic-key-never-business-credentials'},{orgId:ctx.orgId,connectionId:modelId});
    await db.query("INSERT INTO connections(id,org_id,provider,account_external_id,display_name,timezone,currency,source_kind,read_mode,scope_json,secret_ref) VALUES($1,$2,'google_drive','fixture','Synthetic source','Asia/Shanghai','CNY','mac_drive','drive_sync',$3,$4)",[sourceId,ctx.orgId,JSON.stringify({folder_ids:['authorized-root']}),sourceSecret]);
    await db.query("INSERT INTO connections(id,org_id,provider,account_external_id,display_name,timezone,currency,read_mode,secret_ref) VALUES($1,$2,'deepseek','fixture','Synthetic model','Asia/Shanghai','CNY','native_api',$3)",[modelId,ctx.orgId,modelSecret]);
    await db.query("INSERT INTO settings(org_id,key,value,schema_version,updated_by) VALUES($1,'ai_configuration',$2,1,$3)",[ctx.orgId,JSON.stringify({configuration:{...defaultModelConfiguration,connection_id:modelId}}),ctx.actorId]);
    const readers=createRuntimeSourceReaders({sourceRoot:join(root,'sources'),fetch:fixtureFetch,resolveSecret:async(reference,scope)=>{const value=await secrets.resolveSecret(reference,scope);return value.kind==='drive_oauth'?value:null;}});
    const objects=new SourceObjectStore(join(root,'sources'));
    const dependencies={gateway:(context:ServiceContext)=>createConfiguredAiGateway(context,{fetch:fixtureFetch}),loadText:(key:string,source:{connectionId:string;textHash:string})=>objects.readText({orgId:ctx.orgId,connectionId:source.connectionId,objectKey:key,expectedHash:source.textHash})};
    async function sync(){const cursor=(await db.query('SELECT cursor FROM connections WHERE id=$1',[sourceId])).rows[0]!.cursor;const result=await readers.mac_drive.read({orgId:ctx.orgId,connectionId:sourceId,sourceKind:'mac_drive',scope:{folderIds:['authorized-root']},credentialRef:sourceSecret,cursor});assert.equal(result.status,'changed');return ingestSourceRead(ctx,{connectionId:sourceId,expectedCursorHash:stableHash(cursor),expectedConfigurationHash:stableHash({scope:{folder_ids:['authorized-root']},readMode:'drive_sync',secretRef:sourceSecret}),verifySnapshot:async snapshot=>{await objects.readBytes({orgId:ctx.orgId,connectionId:sourceId,objectKey:snapshot.objectKey,expectedHash:snapshot.contentHash});if(snapshot.textObjectKey&&snapshot.textHash)await objects.readText({orgId:ctx.orgId,connectionId:sourceId,objectKey:snapshot.textObjectKey,expectedHash:snapshot.textHash});},result});}
    async function step(workflow:'insight_topics'|'content_draft'){const claim=await claimStep(db,{workerId:'synthetic-worker',orgId:ctx.orgId,modes:['read_only']});assert.ok(claim);const result=await executeMarketingWorkflow(ctx,claim,workflow,dependencies);await completeStep(db,claim,result.output);return result.output as Row;}
    const first=await sync();assert.equal(first.sourceVersionIds.length,1);
    await dispatchMarketing(db);const insight=await step('insight_topics');assert.equal(insight.topicIds.length,1);
    await dispatchMarketing(db);const draft=await step('content_draft');const item=String(draft.contentItemId);
    await t.test('actual text and immutable IDs flow through both HTTP models with persistent usage',async()=>{
      assert.equal(calls,2);const view=await getPrivateDraft(ctx,item);assert.equal(view.bodyBlocks[0]!.text,sourceText);assert.deepEqual(view.sourceVersionIds,first.sourceVersionIds);assert.equal(view.state,'private_candidate');
      const ai=(await db.query('SELECT * FROM ai_runs ORDER BY created_at')).rows;assert.equal(ai.length,2);assert.ok(ai.every(row=>row.execution_mode==='live'&&row.provider==='deepseek'&&row.input_tokens===400));assert.ok(ai.every(row=>(row.request_metadata as Row).limit_scope==='persistent'));assert.equal(Number((await db.query('SELECT count(*) AS n FROM ai_usage_reservations')).rows[0]!.n),2);
      assert.equal(Number((await db.query('SELECT count(*) AS n FROM execution_actions')).rows[0]!.n),0);assert.equal(draft.real_integration_accepted,false);
      const records=JSON.stringify((await db.query('SELECT details FROM audit_logs')).rows)+JSON.stringify(ai);assert.equal(records.includes('synthetic-key-never-business-credentials'),false);
    });
    await editPrivateDraft({...ctx,actorType:'user'},item,{expectedVersion:1,title:'人工保存的第一稿',bodyBlocks:[{type:'paragraph',text:`${sourceText} 待内部核对。`}]});
    revision=2;sourceText='泊冉提供企业应用实施与应用集成服务。';const second=await sync();await dispatchMarketing(db);const secondInsight=await step('insight_topics');await dispatchMarketing(db);const updated=await step('content_draft');
    await t.test('a second change appends an AI version while preserving human edits and historical source evidence',async()=>{
      assert.equal(calls,4);assert.equal(updated.contentItemId,item);assert.equal(updated.version,3);const view=await getPrivateDraft(ctx,item);assert.deepEqual(new Set(view.sourceVersionIds),new Set([...first.sourceVersionIds,...second.sourceVersionIds]));assert.equal(view.bodyBlocks[0]!.text,sourceText);
      const historical=(await db.query('SELECT body_json FROM content_versions WHERE content_item_id=$1 AND version_no=2',[item])).rows[0]!.body_json as Row;assert.equal(historical.title,'人工保存的第一稿');assert.equal(Number((await db.query('SELECT count(*) AS n FROM source_versions v JOIN source_documents d ON d.org_id=v.org_id AND d.id=v.document_id WHERE d.connection_id=$1',[sourceId])).rows[0]!.n),2);
      await dispatchMarketing(db);assert.equal(await claimStep(db,{orgId:ctx.orgId,workerId:'idle',modes:['read_only']}),null);assert.equal(calls,4);
    });
    await t.test('a stored paid response resumes after a crash without another HTTP request',async()=>{
      const run=await scheduleRun(db,{orgId:ctx.orgId,kind:'platform_assets',periodKey:'receipt-restart',input:{requested_by:ctx.actorId},steps:[{key:'content_generate',mode:'read_only',input:{topic_id:secondInsight.topicIds[0],source_version_ids:second.sourceVersionIds}}]});
      const claim=await claimStep(db,{orgId:ctx.orgId,workerId:'before-crash',modes:['read_only']});assert.ok(claim);assert.equal(claim.runId,run.id);
      let receiptSaved=false;
      const crashDb:Database={query:async(sql,params)=>{const result=await db.query(sql,params);if(sql.startsWith('UPDATE workflow_steps SET output_ref')&&String(params?.[5]).includes('"status":"received"'))receiptSaved=true;return result;},transaction:fn=>{if(receiptSaved)throw new Error('Synthetic crash after durable provider receipt');return db.transaction(fn);},close:async()=>{}};
      const before=calls;await assert.rejects(executeMarketingWorkflow({...ctx,db:crashDb},claim,'content_draft',dependencies),/Synthetic crash/);assert.equal(calls,before+1);
      await db.query("UPDATE workflow_steps SET lease_until=now()-interval '1 second' WHERE id=$1",[claim.stepId]);const restarted=await claimStep(db,{orgId:ctx.orgId,workerId:'after-crash',modes:['read_only']});assert.ok(restarted);
      const saved=await executeMarketingWorkflow(ctx,restarted,'content_draft',{...dependencies,gateway:async()=>{throw new Error('Must not call the provider twice');}});await completeStep(db,restarted,saved.output);assert.equal(calls,before+1);
    });
    await t.test('an unpaid older source version cannot incur a new provider call after a newer revision arrives',async()=>{
      const run=await scheduleRun(db,{orgId:ctx.orgId,kind:'insight_topics',periodKey:'superseded-before-payment',input:{requested_by:ctx.actorId},steps:[{key:'derive_insights',mode:'read_only',input:{source_version_ids:first.sourceVersionIds}}]});
      const claim=await claimStep(db,{orgId:ctx.orgId,workerId:'old-source',modes:['read_only']});assert.ok(claim);assert.equal(claim.runId,run.id);
      const before=calls;await assert.rejects(executeMarketingWorkflow(ctx,claim,'insight_topics',dependencies),{code:'AI_SOURCE_INPUT_SUPERSEDED'});assert.equal(calls,before);
      await completeStep(db,claim,{mock:false,superseded:true});
    });
    await t.test('untrusted failure metadata is stripped from durable usage audits and receipt DTOs',async()=>{
      const run=await scheduleRun(db,{orgId:ctx.orgId,kind:'insight_topics',periodKey:'unsafe-failure-metadata',input:{requested_by:ctx.actorId},steps:[{key:'derive_insights',mode:'read_only',input:{source_version_ids:second.sourceVersionIds}}]});
      const claim=await claimStep(db,{orgId:ctx.orgId,workerId:'failure-safety',modes:['read_only']});assert.ok(claim);assert.equal(claim.runId,run.id);
      await assert.rejects(executeMarketingWorkflow(ctx,claim,'insight_topics',{...dependencies,gateway:async()=>({mode:'real',generate:async()=>{throw new AiProviderError('AI_PROVIDER_MODEL_REJECTED','safe',{metadata:{mode:'real',simulation:false,provider:'deepseek',model:'synthetic-safety',apiKey:'synthetic-secret-never-audit',usage:{input_tokens:12,password:'synthetic-secret-never-audit'},attempts:[{status:'rejected',raw_response:'synthetic-secret-never-audit'}]}});}})}),{code:'AI_PROVIDER_MODEL_REJECTED'});
      const rows=(await db.query('SELECT request_metadata FROM ai_runs WHERE workflow_run_id=$1',[run.id])).rows;assert.equal(rows.length,1);assert.equal((rows[0]!.request_metadata as Row).usage.input_tokens,12);assert.equal((rows[0]!.request_metadata as Row).apiKey,undefined);
      assert.ok(!JSON.stringify(rows).includes('synthetic-secret-never-audit'));assert.ok(!JSON.stringify((await db.query('SELECT output_ref FROM workflow_steps WHERE id=$1',[claim.stepId])).rows).includes('synthetic-secret-never-audit'));
      await failStep(db,claim,{code:'AI_PROVIDER_MODEL_REJECTED',needsHuman:true});
    });
    await t.test('a paid response with extra secret metadata fails before storing its receipt or any business object',async()=>{
      const run=await scheduleRun(db,{orgId:ctx.orgId,kind:'insight_topics',periodKey:'unsafe-success-metadata',input:{requested_by:ctx.actorId},steps:[{key:'derive_insights',mode:'read_only',input:{source_version_ids:second.sourceVersionIds}}]});
      const claim=await claimStep(db,{orgId:ctx.orgId,workerId:'receipt-safety',modes:['read_only']});assert.ok(claim);assert.equal(claim.runId,run.id);const before=calls;
      await assert.rejects(executeMarketingWorkflow(ctx,claim,'insight_topics',{...dependencies,gateway:async(context)=>{const gateway=await dependencies.gateway(context);return {mode:'real',generate:async(request)=>{const result=await gateway.generate(request);return {...result,metadata:{...result.metadata,apiKey:'synthetic-success-secret-never-persist'}};}};}}),{code:'AI_RUN_METADATA_INVALID'});
      assert.equal(calls,before+1);const records=JSON.stringify((await db.query('SELECT output_ref FROM workflow_steps WHERE id=$1',[claim.stepId])).rows)+JSON.stringify((await db.query('SELECT request_metadata,output_ref FROM ai_runs WHERE workflow_run_id=$1',[run.id])).rows);assert.ok(!records.includes('synthetic-success-secret-never-persist'));
      assert.equal(Number((await db.query('SELECT count(*) AS n FROM insights WHERE ai_run_id IN(SELECT id FROM ai_runs WHERE workflow_run_id=$1)',[run.id])).rows[0]!.n),0);await failStep(db,claim,{code:'AI_RUN_METADATA_INVALID',needsHuman:true});
    });
    await t.test('unknown paid calls are stopped and a stale worker cannot make a model request',async()=>{
      const run=await scheduleRun(db,{orgId:ctx.orgId,kind:'insight_topics',periodKey:'unknown-provider-call',input:{requested_by:ctx.actorId},steps:[{key:'derive_insights',mode:'read_only',input:{source_version_ids:second.sourceVersionIds}}]});
      const claim=await claimStep(db,{orgId:ctx.orgId,workerId:'unknown-call',modes:['read_only']});assert.ok(claim);assert.equal(claim.runId,run.id);
      await db.query("UPDATE workflow_steps SET output_ref=$2 WHERE id=$1",[claim.stepId,JSON.stringify({_ai_execution:{status:'calling'}})]);
      const before=calls;await assert.rejects(executeMarketingWorkflow(ctx,claim,'insight_topics',dependencies),{code:'AI_CALL_RESULT_UNKNOWN'});assert.equal(calls,before);
      await db.query("UPDATE workflow_steps SET lease_until=now()-interval '1 second' WHERE id=$1",[claim.stepId]);await assert.rejects(executeMarketingWorkflow(ctx,claim,'insight_topics',dependencies),/Stale/);assert.equal(calls,before);
    });
  }finally{
    await new Promise<void>(resolve=>server.close(()=>resolve()));await db.close();await rm(root,{recursive:true,force:true});for(const name of envNames){if(previous[name]===undefined)delete process.env[name];else process.env[name]=previous[name];}
  }
});
