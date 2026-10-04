import { readFileSync, realpathSync, statSync } from "node:fs";
import { createHash } from "node:crypto";
import { dirname, resolve, sep } from "node:path";
import { ConnectorBlockedError, type CapabilityVerification, type PlatformExecutionContext } from "@boran/connectors";
import { stableHash } from "@boran/domain/core";

interface CapabilityArtifact {
  id: string; orgId: string; accountId: string; connectionId: string; configurationHash: string;
  externalAccountId: string; adapterVersion: string; sessionVersion: number; acceptedAt: string;
  tests: { capability: string; evidenceRef: string; evidencePath: string; sha256: string; capturedAt: string; kind: "api_readback" | "browser_readback"; externalAccountId: string }[];
}
const object = (value: unknown): Record<string, unknown> => value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
const hash = (value: Buffer) => createHash("sha256").update(value).digest("hex");
const validId = (value: unknown): value is string => typeof value === "string" && /^[A-Za-z0-9_.:-]{1,128}$/.test(value);
const validHash = (value: unknown): value is string => typeof value === "string" && /^[a-f0-9]{64}$/.test(value);
export function platformConfigurationHash(row: Record<string, unknown>): string {
  return stableHash({ connection_id: row.connection_id ?? row.id, account_external_id: row.connection_external_id ?? row.account_external_id, read_mode: row.read_mode, scope_json: row.scope_json, secret_ref: row.secret_ref });
}
/** Only a private reviewed artifact can register independent execution capabilities. */
export class CapabilityArtifactRegistry {
  private readonly entries: CapabilityArtifact[] = [];
  private readonly root: string | undefined;
  constructor(path?: string) {
    if (!path) return;
    try {
      const real = realpathSync(path), stat = statSync(real);
      if (!stat.isFile() || stat.size > 256_000 || (stat.mode & 0o077) !== 0) throw new Error();
      this.root = realpathSync(dirname(real));
      const values: unknown = JSON.parse(readFileSync(real, "utf8"));
      if (!Array.isArray(values) || values.length > 200) throw new Error();
      for (const value of values) {
        const entry = object(value) as unknown as CapabilityArtifact;
        if (!validId(entry.id) || ![entry.orgId, entry.accountId, entry.connectionId, entry.externalAccountId, entry.adapterVersion].every(validId) || !validHash(entry.configurationHash) || !Number.isSafeInteger(entry.sessionVersion) || entry.sessionVersion < 0 || !Number.isFinite(Date.parse(entry.acceptedAt)) || !Array.isArray(entry.tests) || !entry.tests.length || entry.tests.length > 80 || new Set(entry.tests.map(row => row.capability)).size !== entry.tests.length) throw new Error();
        for (const proof of entry.tests) if (!validId(proof.capability) || !validHash(proof.sha256) || typeof proof.evidenceRef !== "string" || !/^[A-Za-z0-9_./:-]{1,512}$/.test(proof.evidenceRef) || !["api_readback", "browser_readback"].includes(proof.kind) || proof.externalAccountId !== entry.externalAccountId || !Number.isFinite(Date.parse(proof.capturedAt)) || typeof proof.evidencePath !== "string" || !/^[A-Za-z0-9_./-]{1,300}$/.test(proof.evidencePath) || proof.evidencePath.includes("..") || proof.evidencePath.startsWith("/")) throw new Error();
        this.entries.push(entry);
      }
    } catch { throw new ConnectorBlockedError("capability_artifact_invalid"); }
  }
  select(context: PlatformExecutionContext, connection: Record<string, unknown>): CapabilityVerification {
    const configurationHash = platformConfigurationHash(connection);
    const matches = this.entries.filter(entry => entry.orgId === context.orgId && entry.accountId === context.accountId && entry.connectionId === String(connection.connection_id ?? connection.id) && entry.configurationHash === configurationHash && entry.externalAccountId === context.externalAccountId && entry.adapterVersion === context.adapterVersion && entry.sessionVersion === context.sessionVersion);
    if (matches.length !== 1) throw new ConnectorBlockedError(matches.length ? "capability_artifact_ambiguous" : "capability_artifact_not_configured");
    const entry = matches[0]!, now = Date.now();
    if (Date.parse(entry.acceptedAt) < now - 86400_000 || Date.parse(entry.acceptedAt) > now + 60_000 || entry.tests.some(proof => Date.parse(proof.capturedAt) < now - 86400_000 || Date.parse(proof.capturedAt) > now + 60_000 || Date.parse(proof.capturedAt) > Date.parse(entry.acceptedAt) + 60_000)) throw new ConnectorBlockedError("capability_artifact_expired");
    try {
      for (const proof of entry.tests) {
        const path = realpathSync(resolve(this.root!, proof.evidencePath));
        if (!path.startsWith(`${this.root}${sep}`)) throw new Error();
        const stat = statSync(path); if (!stat.isFile() || stat.size > 1_000_000 || (stat.mode & 0o077) !== 0) throw new Error();
        const raw = readFileSync(path); if (hash(raw) !== proof.sha256) throw new Error();
        const actual = object(JSON.parse(raw.toString("utf8")));
        // The original independent test receipt must preserve its account/configuration bindings and actual observation.
        if (actual.orgId !== entry.orgId || actual.accountId !== entry.accountId || actual.connectionId !== entry.connectionId || actual.configurationHash !== entry.configurationHash || actual.adapterVersion !== entry.adapterVersion || actual.sessionVersion !== entry.sessionVersion || actual.capability !== proof.capability || actual.externalAccountId !== entry.externalAccountId || actual.kind !== proof.kind || actual.capturedAt !== proof.capturedAt || actual.evidenceRef !== proof.evidenceRef || actual.source !== "platform_readback" || !Object.keys(object(actual.observed)).length) throw new Error();
      }
    } catch { throw new ConnectorBlockedError("capability_evidence_invalid"); }
    return { verified: true, externalAccountId: context.externalAccountId, capturedAt: entry.acceptedAt, kind: "browser_readback", evidenceRef: `capability-artifact:${entry.id}`, capabilities: entry.tests.map(proof => proof.capability), adapterVersion: entry.adapterVersion, artifactId: entry.id, orgId: entry.orgId, accountId: entry.accountId, connectionId: entry.connectionId, configurationHash: entry.configurationHash, sessionVersion: entry.sessionVersion, acceptedAt: entry.acceptedAt, capabilityEvidence: entry.tests.map(({ evidencePath: _path, ...proof }) => proof) };
  }
}

export function validStoredCapabilityProof(context: PlatformExecutionContext, row: Record<string, unknown>): CapabilityVerification | undefined {
  const proof = object(object(row.capabilities).platform_execution) as unknown as CapabilityVerification;
  if (!proof.verified || proof.orgId !== context.orgId || proof.accountId !== context.accountId || proof.connectionId !== String(row.connection_id ?? row.id) || proof.configurationHash !== platformConfigurationHash(row) || proof.externalAccountId !== context.externalAccountId || proof.adapterVersion !== context.adapterVersion || proof.sessionVersion !== context.sessionVersion || !proof.artifactId || !proof.acceptedAt || !Number.isFinite(Date.parse(proof.acceptedAt)) || Date.parse(proof.acceptedAt) < Date.now() - 86400_000 || Date.parse(proof.acceptedAt) > Date.now() + 60_000 || !Array.isArray(proof.capabilities) || !Array.isArray(proof.capabilityEvidence) || !proof.capabilityEvidence.length || proof.capabilities.some(cap => !proof.capabilityEvidence!.some(evidence => evidence.capability === cap)) || proof.capabilityEvidence.some(evidence => evidence.externalAccountId !== context.externalAccountId || !validHash(evidence.sha256) || !Number.isFinite(Date.parse(evidence.capturedAt)) || Date.parse(evidence.capturedAt) < Date.now() - 86400_000 || Date.parse(evidence.capturedAt) > Date.now() + 60_000)) return undefined;
  return proof;
}
