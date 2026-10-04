export type OpsEnvironment = Readonly<{ APP_ENV?: string; AUTH_MODE?: string; BORAN_MODE?: string; OIDC_ISSUER?: string; OIDC_AUDIENCE?: string; OIDC_JWKS_URL?: string; BORAN_ORG_ID?: string }>;
export type OpsAccess =
  | { allowed: true; mode: 'mock' | 'local' | 'oidc'; environment: string }
  | { allowed: false; status: 503; code: 'IDENTITY_NOT_CONFIGURED'; message: string };
export function evaluateOpsAccess(env: OpsEnvironment): OpsAccess {
  const environment = env.APP_ENV ?? 'production';
  if(env.AUTH_MODE==='mock' && ['development','test'].includes(environment) && env.BORAN_MODE!=='live')return {allowed:true,mode:'mock',environment};
  if(env.AUTH_MODE==='local' && ['development','test'].includes(environment) && env.BORAN_MODE==='live' && /^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i.test(env.BORAN_ORG_ID??''))return {allowed:true,mode:'local',environment};
  if(env.AUTH_MODE==='oidc' && env.BORAN_MODE==='live' && env.OIDC_ISSUER && env.OIDC_AUDIENCE && env.OIDC_JWKS_URL?.startsWith('https://') && env.BORAN_ORG_ID)return {allowed:true,mode:'oidc',environment};
  return {allowed:false,status:503,code:'IDENTITY_NOT_CONFIGURED',message:'组织身份尚未配置。请配置真实身份接入，或显式启动本地测试环境。'};
}
export function currentOpsAccess(): OpsAccess { const keys = ["APP_ENV", "AUTH_MODE", "BORAN_MODE", "OIDC_ISSUER", "OIDC_AUDIENCE", "OIDC_JWKS_URL", "BORAN_ORG_ID"] as const; return evaluateOpsAccess(Object.fromEntries(keys.filter(key => process.env[key] !== undefined).map(key => [key, process.env[key]]))); }
