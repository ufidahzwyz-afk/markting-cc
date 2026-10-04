import {createHash} from 'node:crypto';
import {AiNotConfiguredError} from './types';
const sensitiveKeys = new Set(['authorization','cookie','cookies','setcookie','session','sessiontoken','sessioncookie','accesstoken','refreshtoken','apikey','password','pwd','clientsecret','privatekey','credentials','secret','secretref']);
const credentialText = /\bsk-(?:proj-|ant-)?[a-z0-9_-]{20,}\b|(?:access[_-]?token|refresh[_-]?token|api[_-]?key|client[_-]?secret|session[_-]?token)[\s"']*[:=][\s"']*[a-z0-9._~+\/-]{12,}/i;
const pii = /\b1[3-9]\d{9}\b|[\w.+-]+@[\w.-]+\.[a-z]{2,}|\bBearer\s+[a-z0-9._-]+|(?:微信|wechat|weixin)\s*[:：]\s*[a-zA-Z0-9_-]{5,}/i;
/** Fail before sending: credential-shaped values are programming errors, not business evidence. */
export function assertSafeAiValue(value: unknown): void {
  if (Array.isArray(value)) {value.forEach(assertSafeAiValue); return;}
  if (value && typeof value === 'object') {
    for (const [key, entry] of Object.entries(value)) {
      if (sensitiveKeys.has(key.toLowerCase().replace(/[^a-z0-9]/g, ''))) throw new AiNotConfiguredError('模型输入必须脱敏且不得含凭据');
      assertSafeAiValue(entry);
    }
  } else if (typeof value === 'string' && (pii.test(value) || credentialText.test(value) || /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/.test(value))) {
    throw new AiNotConfiguredError('模型输入必须脱敏且不得含凭据');
  } else if (typeof value === 'number' && /^1[3-9]\d{9}$/.test(String(value))) throw new AiNotConfiguredError('模型输入必须脱敏且不得含凭据');
}
/** Source extraction may use this before constructing locator excerpts and the model input. */
export function redactAiText(text: string): string {
  return text.replace(/\b1[3-9]\d{9}\b/g, '[已脱敏手机]')
    .replace(/[\w.+-]+@[\w.-]+\.[a-z]{2,}/gi, '[已脱敏邮箱]')
    .replace(/((?:微信|wechat|weixin)\s*[:：]\s*)[a-zA-Z0-9_-]{5,}/gi, '$1[已脱敏微信]');
}
export function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  if (value && typeof value === 'object') return `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${canonicalJson((value as Record<string, unknown>)[key])}`).join(',')}}`;
  return JSON.stringify(value) ?? 'null';
}
export function aiInputHash(value: unknown): string {return createHash('sha256').update(canonicalJson(value)).digest('hex');}
