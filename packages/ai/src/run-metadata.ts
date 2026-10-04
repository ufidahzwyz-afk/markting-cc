import {validateAiOutput,aiOutputHash} from '@boran/contracts';
import {assertSafeAiValue,aiInputHash} from './privacy';
import {validateRuntimeEvidenceOutput} from './evidence';
import {AiProviderError,type AiRequest,type AiGatewayResult} from './types';

type Row=Record<string,unknown>;
type Check=(value:unknown)=>boolean;
const object=(value:unknown):value is Row=>!!value&&typeof value==='object'&&!Array.isArray(value);
const integer:Check=value=>Number.isSafeInteger(value)&&Number(value)>=0;
const nullableInteger:Check=value=>value===null||integer(value);
const bool:Check=value=>typeof value==='boolean';
const id:Check=value=>typeof value==='string'&&/^[A-Za-z0-9._:/-]{1,200}$/.test(value);
const nullableId:Check=value=>value===null||id(value);
const boundedId=(maximum:number):Check=>value=>id(value)&&String(value).length<=maximum;
const modelId=boundedId(120);
const hash:Check=value=>typeof value==='string'&&/^[a-f0-9]{64}$/.test(value);
const oneOf=(...values:unknown[]):Check=>value=>values.includes(value);
const currency:Check=value=>value===null||typeof value==='string'&&/^[A-Z]{3}$/.test(value);
const pricing:Check=value=>value===null||typeof value==='string'&&!!value.trim()&&value.length<=200&&!/[\x00-\x1f\x7f]/.test(value);
const usageFields={input_tokens:nullableInteger,output_tokens:nullableInteger,total_tokens:nullableInteger,cache_hit_tokens:nullableInteger};
const attemptFields={requested_model:id,model:nullableId,provider_request_id:nullableId,response_id:nullableId,status:oneOf('received','rate_limited','rejected','unknown'),latency_ms:integer,cost_micro:nullableInteger,price_model_verified:bool};
const qualityFields={schema_valid:oneOf(true),semantic_valid:oneOf(true),evidence_valid:oneOf(true),evidence_scope:oneOf('references_and_hard_claims'),business_quality_verified:oneOf(false),business_review_required:oneOf(true),strict_schema_requested:bool,model_catalog_verified:bool};
const fields:Record<string,Check>={
  mode:oneOf('mock','real'),simulation:bool,schema_version:oneOf(2),model:value=>value===null||modelId(value),output_hash:hash,
  provider:oneOf('deepseek','injected','fixture','mock','unverified_transport'),protocol:oneOf('chat_completions','messages'),
  requested_model:modelId,model_alias:bool,model_alias_verified:bool,cost_basis:oneOf('configured_model_pricing','unknown'),quota_timezone:oneOf('Asia/Shanghai'),
  prompt_version:boundedId(60),input_hash:hash,source_version_ids:value=>Array.isArray(value)&&value.length<=1000&&value.every(item=>typeof item==='string'&&/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(item)),
  provider_request_id:nullableId,response_id:nullableId,latency_ms:value=>integer(value)&&Number(value)<=2147483647,cost_micro:nullableInteger,currency,pricing_version:pricing,
  repair_count:value=>value===0||value===1,limit_scope:oneOf('process','persistent'),input_tokens:nullableInteger,output_tokens:nullableInteger,
};

/** Accept only bounded, classified receipt facts. Provider bodies and unknown nested fields never reach audit DTOs. */
export function sanitizeAiRunMetadata(value:unknown,options:{strict?:boolean}={}):Row {
  const strict=options.strict??false;
  const invalid=()=>{if(strict)throw new AiProviderError('AI_RUN_METADATA_INVALID','模型运行回执包含未允许或无效的记录字段');};
  const checked=(input:unknown,schema:Record<string,Check>):Row=>{
    const result:Row={};if(!object(input)){invalid();return result;}
    for(const [key,item] of Object.entries(input)){
      const check=schema[key];if(!check||!check(item)){invalid();continue;}
      result[key]=Array.isArray(item)?[...item]:item;
    }return result;
  };
  if(!object(value)){invalid();return {};}
  const scalar:Row={};for(const [key,item] of Object.entries(value))if(!['usage','attempts','quality_result'].includes(key))scalar[key]=item;
  const result=checked(scalar,fields);
  if(value.usage!==undefined)result.usage=checked(value.usage,usageFields);
  if(value.quality_result!==undefined)result.quality_result=checked(value.quality_result,qualityFields);
  if(value.attempts!==undefined){
    if(!Array.isArray(value.attempts)||value.attempts.length>12)invalid();
    else result.attempts=value.attempts.flatMap(item=>{
      if(!object(item)){invalid();return [];}
      const scalar:Row={};for(const [key,entry] of Object.entries(item))if(key!=='usage')scalar[key]=entry;
      const attempt=checked(scalar,attemptFields);if(item.usage!==undefined)attempt.usage=checked(item.usage,usageFields);return [attempt];
    });
  }return result;
}

/** Validate a receipt before durable storage, including gateways injected for integration tests. */
export function validateAiRunReceipt(request:AiRequest,result:AiGatewayResult):AiGatewayResult {
  const metadata=sanitizeAiRunMetadata(result.metadata,{strict:true}) as unknown as AiGatewayResult['metadata'];
  if(!modelId(metadata.model)||metadata.schema_version!==2||!['mock','real'].includes(metadata.mode)||metadata.simulation!==(metadata.mode==='mock'))throw new AiProviderError('AI_RUN_RECEIPT_INVALID','模型运行回执缺少准确模式、模型或合同版本');
  assertSafeAiValue(result.output);
  const output=validateAiOutput(result.output,request.context);
  if(output.workflow!==request.workflow||metadata.output_hash!==aiOutputHash(output)||metadata.input_hash!==undefined&&metadata.input_hash!==aiInputHash(request))throw new AiProviderError('AI_RUN_RECEIPT_INVALID','模型运行回执与冻结请求或输出摘要不一致');
  validateRuntimeEvidenceOutput(output,request);
  return {output,metadata};
}
