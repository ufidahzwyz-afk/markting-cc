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
  /** Recheck ownership immediately before every external mutation and evidence write. */
  assertLease(): Promise<void>;
}
export interface PlatformCommand {
  commandType: BrowserCommandType;
  inputRef: Readonly<Record<string, string>>;
  actionId?: string;
}
export type PlatformResult =
  | { status: "verified"; evidence: VerificationEvidence; data?: Record<string, unknown> }
  | { status: "submitted"; externalId: string; evidenceRef?: string }
  | { status: "challenge_required"; reason: string }
  | { status: "unknown"; reason: string }
  | { status: "blocked"; reason: string };
export interface PlatformHooks {
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
  readiness(): { configured?: boolean; connected: boolean; reason: string | null; capabilities: string[] };
  verify(context: PlatformExecutionContext): Promise<CapabilityVerification>;
  execute(context: PlatformExecutionContext, command: PlatformCommand): Promise<PlatformResult>;
  reconcile(context: PlatformExecutionContext, command: PlatformCommand): Promise<PlatformResult>;
}
