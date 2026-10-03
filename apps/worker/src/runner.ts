import type { Database } from "@boran/db";
import { claimStep, completeStep, dispatchWorkflowOutbox, failStep, heartbeatStep, needsHuman, recoverExpiredSteps, type StepClaim } from "./queue";
export type WorkflowHandler = (context: { db: Database; claim: StepClaim }) => Promise<{ output: Record<string, unknown>; sourceResult?: "changed" | "no_change" | "partial" | "failed" }>;
const handlers = new Map<string, { handler: WorkflowHandler; modes: ("mock" | "read_only")[] }>();
export function registerHandler(stepKey: string, handler: WorkflowHandler, options: { modes?: ("mock" | "read_only")[] } = {}): void {
  if (!stepKey || handlers.has(stepKey)) throw new Error("Handler key is empty or already registered");
  handlers.set(stepKey, { handler, modes: options.modes ?? ["mock"] });
}
export function registeredHandlers(): string[] { return [...handlers.keys()]; }
export async function runOnce(db: Database, workerId = "persistent-worker"): Promise<{ processed: boolean; stepId?: string; recovered: number; dispatched: number; blocked?: boolean }> {
  const recovered = await recoverExpiredSteps(db), dispatched = await dispatchWorkflowOutbox(db);
  const modes: ("mock" | "read_only")[] = handlers.size && [...handlers.values()].some((handler) => handler.modes.includes("read_only")) ? ["mock", "read_only"] : ["mock"];
  const claim = await claimStep(db, { workerId, modes });
  if (!claim) return { processed: false, recovered, dispatched };
  const entry = handlers.get(claim.stepKey);
  if (!entry || !entry.modes.includes(claim.mode as "mock" | "read_only")) {
    await needsHuman(db, claim, "HANDLER_NOT_REGISTERED");
    return { processed: true, stepId: claim.stepId, recovered, dispatched, blocked: true };
  }
  const heartbeat = setInterval(() => { void heartbeatStep(db, claim).catch(() => undefined); }, 30000);
  try {
    const result = await entry.handler({ db, claim });
    await completeStep(db, claim, result.output, result.sourceResult);
    return { processed: true, stepId: claim.stepId, recovered, dispatched };
  } catch (error) {
    // Retry requires an explicit classified transient error; unknown network outcomes stop for reconciliation.
    const code=error && typeof error==="object" && "code" in error ? String(error.code) : "HANDLER_FAILED";
    const transient=["TRANSIENT_READ_FAILURE","RATE_LIMITED"].includes(code);
    await failStep(db,claim,{code,transient,unknown:code==="EXTERNAL_RESULT_UNKNOWN",needsHuman:!transient});
    return { processed: true, stepId: claim.stepId, recovered, dispatched, blocked: !transient };
  } finally { clearInterval(heartbeat); }
}
