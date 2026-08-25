import type { DomainScope } from "../../data/domainScope";
import {
  getOrCreateDomainSyncCoordinator,
  isDatabaseUnavailableError,
  type SyncLane,
} from "../../data/sync/syncCoordinator";

// Facade re-export: document stores must reach this shared sync helper
// through this workflow boundary, not by importing data/sync directly.
export { sequenceUnchanged } from "../../data/sync/sequence";

export type DocumentSyncLane = SyncLane;

function getDocumentSyncLaneKey(localId: string): string {
  return `documents:${localId}`;
}

export function registerDocumentSyncLane(input: {
  readonly domainScope: DomainScope;
  readonly localId: string;
  readonly run: () => Promise<void>;
}): DocumentSyncLane {
  return getOrCreateDomainSyncCoordinator(input.domainScope).registerLane(
    getDocumentSyncLaneKey(input.localId),
    {
      label: `Document ${input.localId}`,
      onUnexpectedError: (error) => {
        console.error(`Failed to sync document ${input.localId}:`, error);
      },
      phase: "document",
      run: input.run,
      shouldIgnoreError: isDatabaseUnavailableError,
    },
  );
}

export function requestDocumentSyncLaneAndWait(input: {
  readonly didCompleteRequest: () => boolean;
  readonly domainScope: DomainScope;
  readonly localId: string;
  readonly request: () => void;
  readonly signal?: AbortSignal | undefined;
}): Promise<boolean> {
  if (input.signal?.aborted) {
    return Promise.resolve(false);
  }
  const coordinator = getOrCreateDomainSyncCoordinator(input.domainScope);
  const laneKey = getDocumentSyncLaneKey(input.localId);
  const baselineRunCount =
    coordinator.getSnapshot().lanes.find((lane) => lane.key === laneKey)
      ?.runCount ?? 0;
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
    const handleAbort = () => finish(false);
    const inspect = () => {
      if (coordinator.isDisposed()) {
        finish(false);
        return;
      }
      const lane = coordinator
        .getSnapshot()
        .lanes.find((candidate) => candidate.key === laneKey);
      if (
        !lane ||
        lane.runCount <= baselineRunCount ||
        lane.running ||
        lane.requested
      ) {
        return;
      }
      if (lane.lastAction === "completed" || lane.lastAction === "failed") {
        finish(lane.lastAction === "completed" && input.didCompleteRequest());
      }
    };
    unsubscribe = coordinator.subscribe(inspect);
    input.signal?.addEventListener("abort", handleAbort, { once: true });
    if (input.signal?.aborted) {
      finish(false);
      return;
    }
    input.request();
    inspect();
  });
}
