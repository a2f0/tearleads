import type { DocumentProjectionUserKeyResolver } from "../../../workflows/documents";
import type { DocumentState, DocumentStoreState } from "./state";

const remoteSyncGenerations = new WeakMap<DocumentStoreState, number>();
const remoteSyncBlockedStates = new WeakSet<DocumentStoreState>();
const remoteSyncWaiterCounts = new WeakMap<DocumentStoreState, number>();
const independentRemoteSyncSignals = new WeakMap<
  DocumentStoreState,
  {
    readonly generation: DocumentStoreRemoteSyncRequestGeneration;
    readonly signalSequence: number;
  }
>();

function getRemoteSyncGeneration(state: DocumentStoreState): number {
  return remoteSyncGenerations.get(state) ?? 0;
}

/** Immutable identities that define one remote-sync request generation. */
export interface DocumentStoreRemoteSyncRequestGeneration {
  readonly domainScope: DocumentStoreState["runtime"]["state"]["domainScope"];
  readonly execSql: DocumentStoreState["runtime"]["infra"]["execSql"];
  readonly localWriteGeneration: number;
  readonly remoteSyncGeneration: number;
  readonly resolveProjectionUserKey: DocumentProjectionUserKeyResolver;
}

/** Immutable identities that define one live document-store generation. */
export interface DocumentStoreSyncGeneration
  extends DocumentStoreRemoteSyncRequestGeneration {
  readonly currentDoc: DocumentState | null;
}

export function captureDocumentStoreRemoteSyncRequestGeneration(
  state: DocumentStoreState,
): DocumentStoreRemoteSyncRequestGeneration {
  return {
    domainScope: state.runtime.state.domainScope,
    execSql: state.runtime.infra.execSql,
    localWriteGeneration: state.localWriteGeneration,
    remoteSyncGeneration: getRemoteSyncGeneration(state),
    resolveProjectionUserKey: state.resolveProjectionUserKey,
  };
}

export function captureDocumentStoreSyncGeneration(
  state: DocumentStoreState,
  currentDoc: DocumentState | null,
): DocumentStoreSyncGeneration | null {
  if (state.doc !== currentDoc) return null;

  return {
    currentDoc,
    ...captureDocumentStoreRemoteSyncRequestGeneration(state),
  };
}

/**
 * Revoke every remote-only pass already in flight for this store. The next
 * ordinary sync captures a fresh generation, so queued local writes still
 * recover while a late response from a cancelled read probe cannot persist.
 */
export function invalidateDocumentStoreRemoteSync(
  state: DocumentStoreState,
): void {
  remoteSyncGenerations.set(state, getRemoteSyncGeneration(state) + 1);
  remoteSyncBlockedStates.add(state);
  state.remoteUpdatePending = false;
}

export function allowDocumentStoreRemoteSync(state: DocumentStoreState): void {
  remoteSyncBlockedStates.delete(state);
}

export function markDocumentStoreRemoteSyncPending(
  state: DocumentStoreState,
  owner: "independent" | "waiter",
): number {
  state.remoteUpdatePending = true;
  state.remoteUpdateSignalSeq += 1;
  if (owner === "independent") {
    independentRemoteSyncSignals.set(state, {
      generation: captureDocumentStoreRemoteSyncRequestGeneration(state),
      signalSequence: state.remoteUpdateSignalSeq,
    });
  }
  return state.remoteUpdateSignalSeq;
}

export function hasPendingIndependentDocumentStoreRemoteSync(
  state: DocumentStoreState,
): boolean {
  const signal = independentRemoteSyncSignals.get(state);
  return (
    signal !== undefined &&
    isDocumentStoreRemoteSyncRequestGenerationCurrent(
      state,
      signal.generation,
    ) &&
    signal.signalSequence > state.remoteUpdateCompletedSignalSeq
  );
}

/**
 * Register one live owner of a shared remote probe. The returned release
 * function reports whether that owner was the last one still waiting.
 */
export function registerDocumentStoreRemoteSyncWaiter(
  state: DocumentStoreState,
): () => boolean {
  remoteSyncWaiterCounts.set(
    state,
    (remoteSyncWaiterCounts.get(state) ?? 0) + 1,
  );
  let active = true;
  return () => {
    if (!active) return false;
    active = false;
    const remaining = Math.max(0, (remoteSyncWaiterCounts.get(state) ?? 1) - 1);
    if (remaining === 0) {
      remoteSyncWaiterCounts.delete(state);
      return true;
    }
    remoteSyncWaiterCounts.set(state, remaining);
    return false;
  };
}

export function isDocumentStoreRemoteSyncBlocked(
  state: DocumentStoreState,
): boolean {
  return remoteSyncBlockedStates.has(state);
}

export function isDocumentStoreRemoteSyncRequestGenerationCurrent(
  state: DocumentStoreState,
  generation: DocumentStoreRemoteSyncRequestGeneration,
): boolean {
  return (
    state.runtime.state.domainScope === generation.domainScope &&
    state.runtime.infra.execSql === generation.execSql &&
    state.localWriteGeneration === generation.localWriteGeneration &&
    getRemoteSyncGeneration(state) === generation.remoteSyncGeneration &&
    state.resolveProjectionUserKey === generation.resolveProjectionUserKey
  );
}

export function didDocumentStoreRemoteSyncRequestComplete(
  state: DocumentStoreState,
  generation: DocumentStoreRemoteSyncRequestGeneration,
  requestedSignalSequence: number,
): boolean {
  return (
    isDocumentStoreRemoteSyncRequestGenerationCurrent(state, generation) &&
    state.remoteUpdateCompletedSignalSeq >= requestedSignalSequence
  );
}

export function isDocumentStoreSyncGenerationCurrent(
  state: DocumentStoreState,
  generation: DocumentStoreSyncGeneration,
): boolean {
  return (
    state.doc === generation.currentDoc &&
    isDocumentStoreRemoteSyncRequestGenerationCurrent(state, generation)
  );
}
