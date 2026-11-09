import type { DomainScope } from "../../../data/shared/domainScope";
import {
  getOrCreateDomainSyncCoordinator,
  isDatabaseUnavailableError,
  type SyncLane,
} from "../../../data/sync/syncCoordinator";
import type { PrincipalPolicyOperation } from "../../principals/runtimePolicyWarmer";

// Facade re-export: document stores must reach this shared sync helper
// through this workflow boundary, not by importing data/sync directly.
export { sequenceUnchanged } from "../../../data/sync/sequence";

export type DocumentSyncLane = SyncLane;

function getDocumentSyncLaneKey(localId: string): string {
  return `documents:${localId}`;
}

export function registerDocumentSyncLane(input: {
  readonly domainScope: DomainScope;
  readonly localId: string;
  /** Host diagnostics sink; bare runtimes do not structure errors. */
  readonly logError?: ((message: string, error: unknown) => void) | undefined;
  /**
   * Receives the coordinator drain's pass token, which is the principal-policy
   * operation of every sync this run performs.
   */
  readonly run: (policyOperation: PrincipalPolicyOperation) => Promise<void>;
  readonly priority?: (() => number) | undefined;
}): DocumentSyncLane {
  return getOrCreateDomainSyncCoordinator(input.domainScope).registerLane(
    getDocumentSyncLaneKey(input.localId),
    {
      label: `Document ${input.localId}`,
      onUnexpectedError: (error) => {
        console.error(`Failed to sync document ${input.localId}:`, error);
      },
      phase: "document",
      priority: input.priority,
      // Fixed literal: the local id stays in the console line above, never in
      // a report. The mapped stack identifies which lane body threw. Returning
      // the host's result hands a rejection to the lane reporter's wrapper;
      // discarding it would surface as an unhandled rejection instead.
      reportUnexpectedError: (error) =>
        input.logError?.("Documents: sync lane failed", error),
      run: input.run,
      shouldIgnoreError: isDatabaseUnavailableError,
    },
  );
}

/**
 * How the run requested after `baselineRunCount` ended: abort when the lane
 * or its coordinator is gone or the run was abandoned, pending until a later
 * run settles.
 */
function requestedRunOutcome(
  coordinator: ReturnType<typeof getOrCreateDomainSyncCoordinator>,
  laneKey: string,
  baselineRunCount: number,
): "abort" | "pending" | "completed" | "failed" {
  if (coordinator.isDisposed()) return "abort";
  const lane = coordinator
    .getSnapshot()
    .lanes.find((candidate) => candidate.key === laneKey);
  if (!lane || lane.runAbandoned) return "abort";
  if (lane.runCount <= baselineRunCount || lane.running || lane.requested) {
    return "pending";
  }
  if (lane.lastAction === "completed" || lane.lastAction === "failed") {
    return lane.lastAction;
  }
  return "pending";
}

export function requestDocumentSyncLaneAndWait(input: {
  readonly didCompleteRequest: () => boolean;
  readonly domainScope: DomainScope;
  readonly localId: string;
  readonly onInvalidated?: (() => void) | undefined;
  readonly request: () => void;
  readonly signal?: AbortSignal | undefined;
}): Promise<boolean> {
  if (input.signal?.aborted) {
    input.onInvalidated?.();
    return Promise.resolve(false);
  }
  const coordinator = getOrCreateDomainSyncCoordinator(input.domainScope);
  const laneKey = getDocumentSyncLaneKey(input.localId);
  const initialLane = coordinator
    .getSnapshot()
    .lanes.find((lane) => lane.key === laneKey);
  if (!initialLane) {
    return Promise.resolve(false);
  }
  if (initialLane.runAbandoned) {
    return Promise.resolve(false);
  }
  const baselineRunCount = initialLane.runCount;
  return new Promise((resolve) => {
    let settled = false;
    let unsubscribe: () => void = () => undefined;
    const finish = (completed: boolean) => {
      if (settled) {
        return;
      }
      settled = true;
      unsubscribe();
      input.signal?.removeEventListener("abort", handleAbort);
      resolve(completed);
    };
    const handleAbort = () => {
      if (settled) {
        return;
      }
      input.onInvalidated?.();
      finish(false);
    };
    const inspect = () => {
      const outcome = requestedRunOutcome(
        coordinator,
        laneKey,
        baselineRunCount,
      );
      if (outcome === "abort") {
        handleAbort();
        return;
      }
      if (outcome !== "pending") {
        finish(outcome === "completed" && input.didCompleteRequest());
      }
    };
    unsubscribe = coordinator.subscribe(inspect);
    input.signal?.addEventListener("abort", handleAbort, { once: true });
    if (input.signal?.aborted) {
      handleAbort();
      return;
    }
    input.request();
    inspect();
  });
}
