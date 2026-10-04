export class ConnectorBlockedError extends Error {
  readonly status = 503;
  constructor(public readonly code: string, message = "连接器尚未完成真实能力验证") { super(message); this.name = "ConnectorBlockedError"; }
}
export type ConnectorMode = "mock" | "live";
export type BrowserCommandType = "login" | "session_verify" | "source_fetch" | "publish" | "ad_read" | "ad_write" | "reconcile";
export interface VerificationEvidence {
  verified: boolean;
  externalAccountId: string;
  evidenceRef: string;
  capturedAt: string;
  kind: "api_readback" | "browser_readback";
  labelsVerified?: boolean;
  contentHash?: string;
}
export interface CapabilityVerification extends VerificationEvidence {
  capabilities: string[];
  adapterVersion: string;
  /** Private deployment acceptance receipt, bound to the current connection configuration. */
  artifactId?: string;
  orgId?: string;
  accountId?: string;
  connectionId?: string;
  configurationHash?: string;
  sessionVersion?: number;
  acceptedAt?: string;
  registrationCommandId?: string;
  capabilityEvidence?: { capability: string; evidenceRef: string; sha256: string; capturedAt: string; kind: "api_readback" | "browser_readback"; externalAccountId: string }[];
}
export interface PlatformExecutionContext {
  orgId: string;
  accountId: string;
  externalAccountId: string;
  adapterVersion: string;
  sessionVersion: number;
  fencingToken: number;
  commandId: string;
  mode: ConnectorMode;
  /** Process-local trusted browser handle; never serialized in an HTTP response or persisted. */
  browserSession?: unknown;
  capabilityArtifactRequested?: boolean;
  /** Recheck ownership immediately before every external mutation and evidence write. */
  assertLease(): Promise<void>;
  /** Persist the actual submission receipt before beginning independent readback. */
  recordSubmission?(receipt: Extract<PlatformResult, { status: "submitted" }>): Promise<void>;
  /** Set immediately before the external submission boundary; preparation failures remain retryable. */
  markMutationStart?(): void;
}
export interface PlatformCommand {
  commandType: BrowserCommandType;
  inputRef: Readonly<Record<string, string>>;
  actionId?: string;
}
export type PlatformResult =
  | { status: "verified"; evidence: VerificationEvidence; data?: Record<string, unknown> }
  | { status: "submitted"; externalId: string; evidenceRef?: string; data?: Record<string, unknown> }
  | { status: "in_review"; externalId: string; evidenceRef: string; evidence?: VerificationEvidence; data?: Record<string, unknown> }
  | { status: "rejected"; reason: string; externalId?: string; evidenceRef?: string; evidence?: VerificationEvidence; data?: Record<string, unknown> }
  | { status: "challenge_required"; reason: string }
  | { status: "unknown"; reason: string; externalId?: string; evidenceRef?: string; data?: Record<string, unknown> }
  | { status: "blocked"; reason: string };
export interface PlatformHooks {
  /** Reviewed hooks mark the precise click/API mutation boundary after all preparation. */
  mutationBoundaryManaged?: boolean;
  probe(context: PlatformExecutionContext): Promise<CapabilityVerification>;
  sessionVerify?(context: PlatformExecutionContext): Promise<PlatformResult>;
  login?(context: PlatformExecutionContext): Promise<PlatformResult>;
  publish?(context: PlatformExecutionContext, command: PlatformCommand): Promise<PlatformResult>;
  readback?(context: PlatformExecutionContext, command: PlatformCommand, submission: PlatformResult): Promise<PlatformResult>;
  reconcile?(context: PlatformExecutionContext, command: PlatformCommand): Promise<PlatformResult>;
  readMetrics?(context: PlatformExecutionContext, command: PlatformCommand): Promise<PlatformResult>;
  adWrite?(context: PlatformExecutionContext, command: PlatformCommand): Promise<PlatformResult>;
  sourceFetch?(context: PlatformExecutionContext, command: PlatformCommand): Promise<PlatformResult>;
}
export interface PlatformAdapter {
  readonly channelId: string;
  readonly mode: ConnectorMode;
  /** API-only adapters do not open or depend on a Chromium profile. */
  readonly profileRequired?: boolean;
  /** Deployment-reviewed origins for a separately configured website adapter. */
  readonly allowedOrigins?: readonly string[];
  readiness(): { configured?: boolean; connected: boolean; reason: string | null; capabilities: string[] };
  verify(context: PlatformExecutionContext): Promise<CapabilityVerification>;
  execute(context: PlatformExecutionContext, command: PlatformCommand): Promise<PlatformResult>;
  reconcile(context: PlatformExecutionContext, command: PlatformCommand): Promise<PlatformResult>;
}
