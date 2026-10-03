import { createRemoteJWKSet, jwtVerify, type JWTVerifyGetKey } from "jose";
import { DomainError } from "@boran/domain/core";

export interface ServiceIdentity { subject: string; email: string; orgIds: readonly string[] }
export type ServiceIdentityVerifier = (token: string) => Promise<ServiceIdentity>;
/** Google service OIDC only. The org allowlist comes from deployment configuration, never token/body claims. */
export function createServiceIdentityVerifier(options: { audience: string; serviceOrganizations: Readonly<Record<string, readonly string[]>>; trustedJwks?: JWTVerifyGetKey }): ServiceIdentityVerifier {
  if (!options.audience || !Object.keys(options.serviceOrganizations).length) throw new DomainError("IDENTITY_NOT_CONFIGURED", 503, "OIDC audience and service allowlist are required");
  const keys = options.trustedJwks ?? createRemoteJWKSet(new URL("https://www.googleapis.com/oauth2/v3/certs"));
  return async (token) => {
    try {
      const { payload } = await jwtVerify(token, keys, { issuer: ["https://accounts.google.com", "accounts.google.com"], audience: options.audience, algorithms: ["RS256"], clockTolerance: 5 });
      const email = payload.email;
      if (typeof email !== "string" || !email.endsWith(".gserviceaccount.com") || payload.email_verified !== true || typeof payload.sub !== "string" || typeof payload.exp !== "number" || !options.serviceOrganizations[email]?.length) throw new Error("Service not allowed");
      return { subject: payload.sub, email, orgIds: options.serviceOrganizations[email]! };
    } catch { throw new DomainError("INVALID_SERVICE_IDENTITY", 401, "Service identity token could not be verified"); }
  };
}
