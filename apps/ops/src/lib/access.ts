export type OpsEnvironment = Readonly<{ APP_ENV?: string; AUTH_MODE?: string }>;

export type OpsAccess =
  | { allowed: true; mode: "mock"; environment: "development" | "test" }
  | { allowed: false; status: 503; code: "IDENTITY_NOT_CONFIGURED"; message: string };

/** M0 deliberately has no authenticated production access or writable operations. */
export function evaluateOpsAccess(env: OpsEnvironment): OpsAccess {
  const appEnvironment = env.APP_ENV ?? "production";
  if (env.AUTH_MODE === "mock" && (appEnvironment === "development" || appEnvironment === "test")) {
    return { allowed: true, mode: "mock", environment: appEnvironment };
  }
  return {
    allowed: false,
    status: 503,
    code: "IDENTITY_NOT_CONFIGURED",
    message: "身份接入待配置。管理台当前仅允许显式开启的本地开发或测试演练。",
  };
}

export function currentOpsAccess(): OpsAccess {
  return evaluateOpsAccess({
    ...(process.env.APP_ENV !== undefined ? { APP_ENV: process.env.APP_ENV } : {}),
    ...(process.env.AUTH_MODE !== undefined ? { AUTH_MODE: process.env.AUTH_MODE } : {}),
  });
}
