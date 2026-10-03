export const SOURCE_KINDS = ['market_public', 'competitor_public', 'mac_drive', 'chatgpt'] as const;
export type SourceKind = typeof SOURCE_KINDS[number];
export const ACTION_TYPES = ['content.publish', 'content.unpublish', 'ads.update', 'ads.pause', 'external.publish', 'reception.reply'] as const;
export type ActionType = typeof ACTION_TYPES[number];
export const ACTION_STATES = ['queued', 'blocked', 'executing', 'submitted', 'waiting_review', 'verification_pending', 'retry_wait', 'succeeded', 'failed', 'unknown', 'externally_completed', 'cancelled'] as const;
export type ActionState = typeof ACTION_STATES[number];
export const PUBLISH_STATES = ['scheduled', 'queued', 'executing', 'submitted', 'in_review', 'published_verified', 'retry_wait', 'blocked', 'rejected', 'failed', 'unknown', 'cancelled'] as const;
export type PublishState = typeof PUBLISH_STATES[number];
export const CONNECTION_ACCESS_STATUSES = ['not_configured', 'verifying', 'connected', 'auth_required', 'unsupported', 'disabled'] as const;
export type ConnectionAccessStatus = typeof CONNECTION_ACCESS_STATUSES[number];
export interface RuntimeConfig {
  appEnv: 'development' | 'test' | 'staging' | 'production';
  authMode: 'mock' | 'oidc' | 'disabled';
  aiMode: 'mock' | 'real';
  writeEnabled: boolean;
  externalWritesEnabled: boolean;
  adsWriteEnabled: boolean;
  publishEnabled: boolean;
  productionPiiAutomationEnabled: boolean;
  timezone: 'Asia/Shanghai';
}
export class RuntimeConfigurationError extends Error {
  readonly code = 'RUNTIME_CONFIGURATION_INVALID';
}
export function parseRuntimeConfig(env: Readonly<Record<string, string | undefined>>): RuntimeConfig {
  function choice<T extends string>(name: string, options: readonly T[], fallback: T): T {
    const value = env[name] ?? fallback;
    if (!options.includes(value as T)) throw new RuntimeConfigurationError(`${name} has an unsupported value`);
    return value as T;
  }
  function flag(name: string): boolean {
    const value = env[name] ?? 'false';
    if (value !== 'true' && value !== 'false') throw new RuntimeConfigurationError(`${name} must explicitly be true or false`);
    return value === 'true';
  }
  const appEnv = choice('APP_ENV', ['development', 'test', 'staging', 'production'], 'production');
  const authMode = choice('AUTH_MODE', ['mock', 'oidc', 'disabled'], 'disabled');
  const aiMode = choice('AI_MODE', ['mock', 'real'], 'mock');
  if (authMode === 'mock' && appEnv !== 'development' && appEnv !== 'test') throw new RuntimeConfigurationError('Mock identity is permitted only in development and test');
  if ((appEnv === 'production' || appEnv === 'staging') && authMode !== 'oidc') throw new RuntimeConfigurationError('Deployed environments require OIDC identity');
  if (authMode === 'oidc') {
    let issuer: URL;
    try { issuer = new URL(env['OIDC_ISSUER'] ?? ''); } catch { throw new RuntimeConfigurationError('OIDC_ISSUER is required'); }
    if (issuer.protocol !== 'https:' || issuer.username || issuer.password || !env['OIDC_AUDIENCE']?.trim()) throw new RuntimeConfigurationError('OIDC requires an HTTPS issuer and audience');
  }
  const writeEnabled = flag('WRITE_ENABLED');
  return {appEnv, authMode, aiMode, writeEnabled, externalWritesEnabled: writeEnabled, adsWriteEnabled: flag('ADS_WRITE_ENABLED'), publishEnabled: flag('PUBLISH_ENABLED'), productionPiiAutomationEnabled: flag('PRODUCTION_PII_AUTOMATION_ENABLED'), timezone: 'Asia/Shanghai'};
}
export function parseAuthorizationReference(value: unknown): {policy_version_id: string; approval_id?: never} | {approval_id: string; policy_version_id?: never} {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new RuntimeConfigurationError('Authorization reference must be an object');
  const input = value as Record<string, unknown>;
  const policy = input['policy_version_id']; const approval = input['approval_id'];
  if ((policy !== undefined && policy !== null) === (approval !== undefined && approval !== null)) throw new RuntimeConfigurationError('Exactly one policy_version_id or approval_id is required');
  const selected = policy ?? approval;
  if (typeof selected !== 'string' || !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(selected)) throw new RuntimeConfigurationError('Authorization reference must be a UUID');
  return policy ? {policy_version_id: selected} : {approval_id: selected};
}
