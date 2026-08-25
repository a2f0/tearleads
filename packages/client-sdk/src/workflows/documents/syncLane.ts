import type { DomainScope } from "../../data/domainScope";
import {
  getDomainSyncCoordinatorSnapshot,
  getOrCreateDomainSyncCoordinator,
  isDatabaseUnavailableError,
  type SyncLane,
  subscribeToDomainSyncCoordinator,
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
  readonly domainScope: DomainScope;
  readonly localId: string;
  readonly request: () => void;
  readonly signal?: AbortSignal | undefined;
}): Promise<boolean> {
  if (input.signal?.aborted) {
    return Promise.resolve(false);
  }
  const laneKey = getDocumentSyncLaneKey(input.localId);
  const baselineRunCount =
    getDomainSyncCoordinatorSnapshot(input.domainScope).lanes.find(
      (lane) => lane.key === laneKey,
    )?.runCount ?? 0;
  return new Promise((resolve) => {
    let unsubscribe: () => void = () => undefined;
    const finish = (completed: boolean) => {
      unsubscribe();
      input.signal?.removeEventListener("abort", handleAbort);
      resolve(completed);
    };
    const handleAbort = () => finish(false);
    const inspect = () => {
      const lane = getDomainSyncCoordinatorSnapshot(
        input.domainScope,
      ).lanes.find((candidate) => candidate.key === laneKey);
      if (
        !lane ||
        lane.runCount <= baselineRunCount ||
        lane.running ||
        lane.requested
      ) {
        return;
      }
      if (lane.lastAction === "completed" || lane.lastAction === "failed") {
        finish(lane.lastAction === "completed");
      }
    };
    unsubscribe = subscribeToDomainSyncCoordinator(input.domainScope, inspect);
    input.signal?.addEventListener("abort", handleAbort, { once: true });
    input.request();
    inspect();
  });
}
