import { DomainError } from '@boran/domain/core';

type Row = Record<string, unknown>;
const scopeKeys = ['urls', 'folder_ids', 'file_ids', 'conversation_ids', 'project_ids'] as const;
export type SourceScope = Partial<Record<typeof scopeKeys[number], string[]>> & { platform_login?: Row };

/** Only explicit collection scope is stored here. Tokens and collection cursors are server-owned. */
export function sourceScope(value: unknown, kind: unknown, required: boolean): SourceScope {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new DomainError('INVALID_SOURCE_SCOPE', 422, '来源范围须为对象');
  const input = value as Row;
  if (Object.keys(input).some(key => !(scopeKeys as readonly string[]).includes(key) && !(kind === 'chatgpt' && key === 'platform_login'))) throw new DomainError('INVALID_SOURCE_SCOPE', 422, '来源范围包含未允许字段');
  const permitted = kind === 'mac_drive' ? ['folder_ids', 'file_ids'] : kind === 'chatgpt' ? ['conversation_ids', 'project_ids', 'platform_login'] : ['market_public', 'competitor_public'].includes(String(kind)) ? ['urls'] : [];
  if (Object.keys(input).some(key => !permitted.includes(key))) throw new DomainError('INVALID_SOURCE_SCOPE', 422, '读取范围与来源类型不一致');
  const output: SourceScope = {};
  for (const key of scopeKeys) {
    if (input[key] === undefined) continue;
    const values = input[key];
    if (!Array.isArray(values) || values.length > 100 || values.some(item => typeof item !== 'string' || !item.trim() || item !== item.trim() || item.length > (key === 'urls' ? 2000 : 200))) throw new DomainError('INVALID_SOURCE_SCOPE', 422, '读取范围列表无效');
    if (new Set(values).size !== values.length) throw new DomainError('INVALID_SOURCE_SCOPE', 422, '读取范围不可重复');
    if (key === 'urls') {
      for (const value of values as string[]) {
        let url: URL;
        try { url = new URL(value); } catch { throw new DomainError('INVALID_SOURCE_SCOPE', 422, '网站地址无效'); }
        if (!['https:', 'http:'].includes(url.protocol) || url.username || url.password || url.hash || url.hostname === 'localhost' || /(?:^|\.)localhost$|\.local$/.test(url.hostname) || /^127\.|^10\.|^192\.168\.|^169\.254\.|^0\.|^172\.(?:1[6-9]|2\d|3[01])\./.test(url.hostname) || url.hostname.startsWith('[')) throw new DomainError('INVALID_SOURCE_SCOPE', 422, '来源须使用公开网站地址');
      }
    } else if ((values as string[]).some(item => !/^[A-Za-z0-9_-]{1,200}$/.test(item))) throw new DomainError('INVALID_SOURCE_SCOPE', 422, '资料、会话或项目 ID 无效');
    output[key] = values as string[];
  }
  if (input.platform_login !== undefined) output.platform_login = platformLoginScope({ platform_login: input.platform_login }).platform_login as Row;
  if (required && !scopeKeys.some(key => output[key]?.length)) throw new DomainError('SOURCE_SCOPE_REQUIRED', 422, '请指定授权网站、Drive 目录或 ChatGPT 会话范围');
  return output;
}

export function credentialReference(value: unknown): string | null {
  if (value === null || value === '') return null;
  if (typeof value !== 'string' || !(/^env:[A-Z][A-Z0-9_]{2,99}$/.test(value) || /^boran-secret:[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(value))) throw new DomainError('INVALID_CREDENTIAL_REFERENCE', 422, '仅支持本地环境变量引用或组织加密凭据引用');
  return value;
}

export function platformLoginScope(value: unknown): Row {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new DomainError('INVALID_LOGIN_SCOPE', 422, '账号登录配置无效');
  const scope = value as Row;
  if (Object.keys(scope).some(key => key !== 'platform_login')) throw new DomainError('INVALID_LOGIN_SCOPE', 422, '账号登录配置包含未允许字段');
  if (scope.platform_login === undefined) return {};
  const login = scope.platform_login as Row;
  if (!login || typeof login !== 'object' || Array.isArray(login) || Object.keys(login).some(key => !['method', 'recipe_id', 'recipe_version'].includes(key)) || !['password', 'qr', 'oauth'].includes(String(login.method)) || typeof login.recipe_id !== 'string' || !/^[A-Za-z0-9_.-]{1,100}$/.test(login.recipe_id) || typeof login.recipe_version !== 'string' || !/^[A-Za-z0-9_.-]{1,80}$/.test(login.recipe_version)) throw new DomainError('INVALID_LOGIN_SCOPE', 422, '请选择服务端配置的登录适配器及其版本');
  return { platform_login: { method: login.method, recipe_id: login.recipe_id, recipe_version: login.recipe_version } };
}

export function sourceProvider(kind: unknown): string | undefined {
  return kind === 'mac_drive' ? 'google_drive' : kind === 'chatgpt' ? 'chatgpt_authorized' : ['market_public', 'competitor_public'].includes(String(kind)) ? 'public_web' : undefined;
}
