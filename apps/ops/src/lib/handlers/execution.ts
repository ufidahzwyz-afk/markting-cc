import { validateApiRequest, type components } from "@boran/contracts";
import { DomainError, audit, assertVersion, nowIso, stableHash, type ServiceContext } from "@boran/domain/core";
import { requireActiveRole } from "@boran/domain/authz";
import { sanitizePrivateText } from "@boran/domain/privacy";
import { activatePolicy, createPolicy, createPolicyVersion, revokePolicy, createApproval, decideApproval, createExecutionAction, type PolicyInput, type ActionType } from "@boran/domain/execution";
import { databaseCommand, expectedVersion, idempotencyKey, jsonData } from "../http";

type Json = Record<string, unknown>;
function object(value:unknown):Json { return value && typeof value==="object" && !Array.isArray(value)?value as Json:{}; }
function definition(input:components["schemas"]["PolicyDefinition"],name:string):PolicyInput {
  return { name,businessScope:input.business_scope,accountIds:input.account_ids,allowedActions:input.allowed_actions,currency:input.currency,publishFrequency:input.publish_frequency,publishWindows:input.publish_windows,stopConditions:input.stop_conditions,validFrom:input.valid_from,allowedAdOperations:input.allowed_ad_operations,allowedAdEntityLevels:input.allowed_ad_entity_levels,approvedPathPrefixes:input.approved_path_prefixes,receptionScope:input.reception_scope,
    ...(input.daily_budget_minor!==null?{dailyBudgetMinor:input.daily_budget_minor}:{}),...(input.total_budget_minor!==null?{totalBudgetMinor:input.total_budget_minor}:{}),...(input.max_bid_change_pct!==null?{maxBidChangePct:input.max_bid_change_pct}:{}),...(input.valid_until!==null?{validUntil:input.valid_until}:{}) };
}
async function get(ctx:ServiceContext,table:string,id:string):Promise<Json>{const row=(await ctx.db.query(`SELECT * FROM ${table} WHERE org_id=$1 AND id=$2`,[ctx.orgId,id])).rows[0];if(!row)throw new DomainError("NOT_FOUND",404,"组织内记录不存在");return row;}
async function beforeSnapshot(ctx:ServiceContext,target:Json):Promise<Json>{
  if(target.page_id){const page=await get(ctx,"pages",String(target.page_id));return{version:page.version,published_release_id:page.published_release_id};}
  if(ctx.mode==="mock")return{mode:"mock",target};
  throw new DomainError("ADAPTER_READBACK_REQUIRED",503,"平台目标回读能力尚未接通");
}
function boundedString(value:unknown,field:string,max=200):string{if(typeof value!=="string"||!value.trim()||value.length>max)throw new DomainError("INVALID_REQUEST",422,`${field}字段无效`);return value;}
function assertKnown(body:Json,fields:string[]):void{if(Object.keys(body).some((field)=>!fields.includes(field)))throw new DomainError("INVALID_REQUEST",400,"请求包含不支持的字段");}
function safeTaskBrief(value:unknown):Json {
  if(value===undefined)return {};
  const sensitiveKeys=new Set(["authorization","cookie","cookies","setcookie","sessiontoken","sessioncookie","accesstoken","refreshtoken","token","apikey","password","pwd","clientsecret","privatekey","credentials","secret","contactvalue","contactciphertext","contactemail","contactphone","email","phone","wechat"]);
  const normalizedKey=(field:string)=>field.normalize("NFKC").toLowerCase().replace(/[^a-z0-9]/g,"");
  function inspectionText(value:string):string {
    let inspected=value.normalize("NFKC");
    for(let count=0;count<2&&/%[a-f0-9]{2}/i.test(inspected);count++){try{const decoded=decodeURIComponent(inspected).normalize("NFKC");if(decoded===inspected)break;inspected=decoded;}catch{break;}}
    return inspected;
  }
  let visited=0;
  function reject():never{throw new DomainError("SENSITIVE_TASK_BRIEF",422,"任务摘要只允许脱敏信息与引用，不允许联系方式或凭据");}
  function visit(input:unknown,key="",depth=0):void {
    if(++visited>1000||depth>12)throw new DomainError("INVALID_TASK_BRIEF",422,"任务摘要结构超出范围");
    if(Array.isArray(input)){input.forEach(item=>visit(item,key,depth+1));return;}
    if(input&&typeof input==="object"){
      for(const [field,item] of Object.entries(input)){if(sensitiveKeys.has(normalizedKey(field)))reject();visit(item,field,depth+1);}return;
    }
    if(typeof input==="number"&&/^1[3-9]\d{9}$/.test(String(input)))reject();
    if(typeof input!=="string")return;
    const inspected=inspectionText(input);
    if(/^(?:\+?86)?1[3-9]\d{9}$/.test(inspected)||/\bBearer\s+\S+|-----BEGIN (?:[A-Z ]+)?PRIVATE KEY-----|\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}|(?:password|api[_-]?key|access[_-]?token|refresh[_-]?token|client[_-]?secret)\s*[:=]\s*\S+|\b(?:sk-(?:proj-)?|gh[pousr]_)[A-Za-z0-9_-]{20,}|\bAIza[A-Za-z0-9_-]{25,}/i.test(inspected))reject();
    // Machine identifiers can contain long digit sequences. Their constrained
    // alphabet prevents an email, bearer credential or URL being disguised as an ID.
    if(/(?:_id|_ids)$/.test(key)&&/^[a-z0-9_.:-]{1,200}$/i.test(input))return;
    if(/(?:_hash|_hmac)$/.test(key)&&/^[a-f0-9]{64}$/i.test(input))return;
    if(sanitizePrivateText(inspected)!==inspected)reject();
    if(/^https?:\/\//i.test(inspected)){try{const url=new URL(inspected);if(url.username||url.password||[...url.searchParams.keys()].some(field=>sensitiveKeys.has(normalizedKey(field))))reject();}catch(error){if(error instanceof DomainError)throw error;}}
  }
  if(!value||typeof value!=="object"||Array.isArray(value))throw new DomainError("INVALID_TASK_BRIEF",422,"任务摘要须为脱敏对象");
  visit(value);return value as Json;
}

export async function handleExecution(ctx:ServiceContext,request:Request,segments:string[],body:Json={}):Promise<Response|null>{
  const [resource,id,operation]=segments;
  const method=request.method;
  if(method==="GET"&&["execution-policies","approvals","actions","runs","tasks"].includes(resource??""))await requireActiveRole(ctx,ctx.db,"owner","marketer");
  if(resource==="execution-policies"){
    if(method==="GET"&&!id){const rows=(await ctx.db.query("SELECT p.*,v.payload_hash,v.allowed_actions FROM execution_policies p LEFT JOIN policy_versions v ON v.org_id=p.org_id AND v.id=p.active_version_id WHERE p.org_id=$1 ORDER BY p.created_at DESC LIMIT 200",[ctx.orgId])).rows;return jsonData(rows);}
    if(method==="GET"&&id&&!operation){const policy=await get(ctx,"execution_policies",id);return jsonData({...policy,versions:(await ctx.db.query("SELECT * FROM policy_versions WHERE org_id=$1 AND policy_id=$2 ORDER BY version_no DESC",[ctx.orgId,id])).rows});}
    if(method==="POST"&&!id){const parsed=validateApiRequest("ExecutionPolicyCreate",body);return databaseCommand(ctx,request,body,201,(tx)=>createPolicy(tx,definition(parsed.definition,parsed.name)));}
    if(method==="POST"&&id&&operation==="versions"){const parsed=validateApiRequest("PolicyDefinition",body),version=expectedVersion(request);return databaseCommand(ctx,request,body,201,async(tx)=>{const policy=await get(tx,"execution_policies",id);const {name:_,...input}=definition(parsed,String(policy.name));return createPolicyVersion(tx,id,input,version);});}
    if(method==="POST"&&id&&operation==="activate"){const parsed=validateApiRequest("ExecutionPolicyActivate",body),version=expectedVersion(request);return databaseCommand(ctx,request,body,200,(tx)=>activatePolicy(tx,id,parsed.version_id,version));}
    if(method==="POST"&&id&&operation==="revoke"){const parsed=validateApiRequest("ExecutionPolicyRevoke",body),version=expectedVersion(request);return databaseCommand(ctx,request,body,200,async(tx)=>{await revokePolicy(tx,id,version);await audit(tx,tx.db,"policy.revocation_reason","execution_policy",id,{reason:parsed.reason});return get(tx,"execution_policies",id);});}
  }
  if(resource==="approvals"){
    if(method==="GET"&&!id)return jsonData((await ctx.db.query("SELECT * FROM approvals WHERE org_id=$1 ORDER BY created_at DESC LIMIT 200",[ctx.orgId])).rows);
    if(method==="GET"&&id&&!operation)return jsonData(await get(ctx,"approvals",id));
    if(method==="POST"&&!id){const parsed=validateApiRequest("ApprovalCreate",body);return databaseCommand(ctx,request,body,201,(tx)=>createApproval(tx,{actionType:parsed.action_type,target:parsed.target,payload:parsed.payload,expiresAt:parsed.expires_at,...(parsed.version_id?{versionId:parsed.version_id}:{}),...(parsed.reason?{reason:parsed.reason}:{})}));}
    if(method==="POST"&&id&&operation==="decisions"){const parsed=validateApiRequest("ApprovalDecision",body),version=expectedVersion(request);return databaseCommand(ctx,request,body,200,(tx)=>decideApproval(tx,id,{decision:parsed.decision,expectedPayloadHash:parsed.expected_payload_hash,expectedVersion:version,...(parsed.reason?{reason:parsed.reason}:{})}));}
  }
  if(resource==="actions"){
    if(method==="GET"&&!id)return jsonData((await ctx.db.query("SELECT * FROM execution_actions WHERE org_id=$1 ORDER BY created_at DESC LIMIT 200",[ctx.orgId])).rows);
    if(method==="GET"&&id&&!operation)return jsonData({...await get(ctx,"execution_actions",id),attempts:(await ctx.db.query("SELECT * FROM action_attempts WHERE org_id=$1 AND action_id=$2 ORDER BY attempt_no",[ctx.orgId,id])).rows});
    if(method==="POST"&&!id){const parsed=validateApiRequest("ActionCreate",body),key=idempotencyKey(request);return databaseCommand(ctx,request,body,202,async(tx)=>{
      if("approval_id"in parsed){const approval=await get(tx,"approvals",parsed.approval_id);if(approval.payload_hash!==parsed.expected_payload_hash)throw new DomainError("PAYLOAD_CHANGED",409,"批准载荷摘要不匹配");return createExecutionAction(tx,{idempotencyKey:key,actionType:approval.action_type as ActionType,target:object(approval.target),payload:object(approval.payload),beforeSnapshot:await beforeSnapshot(tx,object(approval.target)),approvalId:parsed.approval_id,...(approval.version_id?{versionId:String(approval.version_id)}:{})});}
      let payload:Json;
      if(parsed.payload)payload=object(parsed.payload);else{if(!parsed.version_id)throw new DomainError("VERSION_REQUIRED",422,"正文动作需要内容版本");const content=await get(tx,"content_versions",parsed.version_id);payload=object(content.body_json);if(content.payload_hash!==stableHash(payload))throw new DomainError("PAYLOAD_CHANGED",409,"内容版本摘要不一致");}
      if(stableHash(payload)!==parsed.expected_payload_hash)throw new DomainError("PAYLOAD_CHANGED",409,"请求摘要与服务器载荷不一致");
      return createExecutionAction(tx,{idempotencyKey:key,actionType:parsed.action_type,target:parsed.target,payload,beforeSnapshot:await beforeSnapshot(tx,parsed.target),policyVersionId:parsed.policy_version_id,...(parsed.version_id?{versionId:parsed.version_id}:{})});
    });}
    if(method==="POST"&&id&&operation==="reconcile"){await get(ctx,"execution_actions",id);assertKnown(body,[]);throw new DomainError("READBACK_ADAPTER_REQUIRED",503,"对账需要服务器适配器实际回读；当前没有已接通的真实平台回读能力");}
    if(method==="POST"&&id&&operation==="manual-receipt"){const parsed=validateApiRequest("ManualReceipt",body) as {external_id?:string;executed_at:string;url?:string;evidence_object_key?:string;note?:string},version=expectedVersion(request);return databaseCommand(ctx,request,body,200,async(tx)=>{await requireActiveRole(tx,tx.db,"owner","marketer");const action=(await tx.db.query("SELECT * FROM execution_actions WHERE org_id=$1 AND id=$2 FOR UPDATE",[tx.orgId,id])).rows[0];if(!action)throw new DomainError("NOT_FOUND",404,"动作不存在");assertVersion(Number(action.version),version);if(["succeeded","executing"].includes(String(action.state)))throw new DomainError("INVALID_STATE",409,"动作已成功或仍在执行，请先核对状态");const updated=(await tx.db.query("UPDATE execution_actions SET state='externally_completed',manual_receipt=$1,external_id=COALESCE($2,external_id),fencing_token=fencing_token+1,version=version+1,lease_until=NULL,lease_owner=NULL WHERE org_id=$3 AND id=$4 RETURNING *",[JSON.stringify(parsed),parsed.external_id??null,tx.orgId,id])).rows[0]!;await audit(tx,tx.db,"execution.manual_receipt","execution_action",id,{real_integration_accepted:false});return updated;});}
  }
  if(resource==="runs"&&method==="GET"){
    if(!id)return jsonData((await ctx.db.query("SELECT * FROM workflow_runs WHERE org_id=$1 ORDER BY created_at DESC LIMIT 100",[ctx.orgId])).rows);
    const run=await get(ctx,"workflow_runs",id);return jsonData({...run,steps:(await ctx.db.query("SELECT * FROM workflow_steps WHERE org_id=$1 AND run_id=$2 ORDER BY ordinal",[ctx.orgId,id])).rows});
  }
  if(resource==="tasks"){
    if(method==="GET"&&!id)return jsonData((await ctx.db.query("SELECT * FROM tasks WHERE org_id=$1 ORDER BY due_at,created_at LIMIT 200",[ctx.orgId])).rows);
    if(method==="GET"&&id&&!operation)return jsonData(await get(ctx,"tasks",id));
    if(method==="POST"&&!id){assertKnown(body,["title","type","brief","business_line","owner_user_id","due_at","priority","plan_cycle_id"]);const brief=safeTaskBrief(body.brief),title=boundedString(body.title,"title"),type=boundedString(body.type,"type",30),business=boundedString(body.business_line,"business_line",20),owner=boundedString(body.owner_user_id??ctx.actorId,"owner_user_id",36),priority=String(body.priority??"P1"),due=String(body.due_at??nowIso(ctx));if(!["P0","P1","P2"].includes(priority)||!Number.isFinite(Date.parse(due)))throw new DomainError("INVALID_REQUEST",422,"任务优先级或时间无效");return databaseCommand(ctx,request,body,201,async(tx)=>{await requireActiveRole(tx,tx.db,"owner","marketer");const row=(await tx.db.query("INSERT INTO tasks(org_id,plan_cycle_id,type,title,brief,business_line,owner_user_id,due_at,priority,status,version) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,'todo',1) RETURNING *",[tx.orgId,body.plan_cycle_id??null,type,title,JSON.stringify(brief),business,owner,due,priority])).rows[0]!;await audit(tx,tx.db,"task.created","task",String(row.id));return row;});}
    if(method==="PATCH"&&id&&!operation){assertKnown(body,["title","brief","owner_user_id","due_at","priority","status"]);const brief=body.brief!==undefined?safeTaskBrief(body.brief):undefined,version=expectedVersion(request);return databaseCommand(ctx,request,body,200,async(tx)=>{await requireActiveRole(tx,tx.db,"owner","marketer");const row=(await tx.db.query("SELECT * FROM tasks WHERE org_id=$1 AND id=$2 FOR UPDATE",[tx.orgId,id])).rows[0];if(!row)throw new DomainError("NOT_FOUND",404,"任务不存在");assertVersion(Number(row.version),version);const title=body.title!==undefined?boundedString(body.title,"title"):row.title,status=body.status??row.status,priority=body.priority??row.priority,due=body.due_at??row.due_at;if(!["todo","doing","blocked","done","cancelled"].includes(String(status))||!["P0","P1","P2"].includes(String(priority))||!Number.isFinite(Date.parse(String(due))))throw new DomainError("INVALID_REQUEST",422,"任务状态或时间无效");const result=(await tx.db.query("UPDATE tasks SET title=$1,brief=$2,owner_user_id=$3,due_at=$4,priority=$5,status=$6,version=version+1,updated_at=$7 WHERE org_id=$8 AND id=$9 RETURNING *",[title,JSON.stringify(brief??row.brief),body.owner_user_id??row.owner_user_id,due,priority,status,nowIso(tx),tx.orgId,id])).rows[0]!;await audit(tx,tx.db,"task.updated","task",id);return result;});}
  }
  return null;
}
