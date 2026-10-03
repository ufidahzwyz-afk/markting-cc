import Ajv2020 from 'ajv/dist/2020.js';
import addFormats from 'ajv-formats';
import aiSchema from '../schemas/ai_outputs.schema.json' with {type: 'json'};
import pageSchema from '../schemas/page_modules.schema.json' with {type: 'json'};
import openapi from '../schemas/openapi.json' with {type: 'json'};
import type {AiOutput} from './ai.generated';
import type {PageModules} from './pages.generated';
import type {components} from './openapi.generated';
export class ContractValidationError extends Error {
  readonly code = 'CONTRACT_INVALID'; readonly status = 400;
  constructor(message: string, readonly details: readonly unknown[] = []) { super(message); }
}
const ajv = new Ajv2020({allErrors: true, strict: false, coerceTypes: false, removeAdditional: false, useDefaults: false});
addFormats(ajv);
const validateAi = ajv.compile(aiSchema);
const validatePages = ajv.compile(pageSchema);
function rewriteRefs(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(rewriteRefs);
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([key, entry]) => [key, key === '$ref' && typeof entry === 'string' ? entry.replace('#/components/schemas/', '#/$defs/') : rewriteRefs(entry)]));
  return value;
}
ajv.addSchema({$id: 'urn:boran:openapi', $defs: rewriteRefs(openapi.components.schemas)});
export function validateApiRequest<K extends keyof components['schemas']>(name: K, input: unknown): components['schemas'][K] {
  const validator = ajv.getSchema(`urn:boran:openapi#/$defs/${name}`);
  if (!validator || !validator(input)) throw new ContractValidationError(`Invalid ${String(name)}`, validator?.errors ?? []);
  return input as components['schemas'][K];
}
export function validateAiOutputStructure(input: unknown): AiOutput {
  if (!validateAi(input)) throw new ContractValidationError('Invalid AI schema v2 output', validateAi.errors ?? []);
  return input as AiOutput;
}
function checkPageSafety(value: unknown, path = ''): void {
  if (Array.isArray(value)) { value.forEach((entry, index) => checkPageSafety(entry, `${path}/${index}`)); return; }
  if (!value || typeof value !== 'object') return;
  for (const [key, entry] of Object.entries(value)) {
    if (typeof entry === 'string') {
      if (/<\/?[a-z][^>]*>/i.test(entry)) throw new ContractValidationError(`HTML is not allowed at ${path}/${key}`);
      if (/^(href|url|src|link)$/i.test(key)) {
        const approvedFormAnchor=key==='href'&&entry==='#lead-form';
        if (!approvedFormAnchor&&(entry.startsWith('//') || /[\u0000-\u0020\\]/.test(entry) || (!entry.startsWith('/') && !/^https?:\/\//i.test(entry)))) throw new ContractValidationError(`Unsafe URL at ${path}/${key}`);
      }
    } else checkPageSafety(entry, `${path}/${key}`);
  }
}
export function validatePageModules(input: unknown): PageModules {
  if (!validatePages(input)) throw new ContractValidationError('Invalid page modules', validatePages.errors ?? []);
  checkPageSafety(input);
  return input as PageModules;
}
export type PageModule = PageModules[number];
export const parseActionCreateRequest = (input: unknown) => validateApiRequest('ActionCreate', input);
export {aiSchema, pageSchema, openapi};
