import type { DocumentProjectionUserKeyResolver } from "../../../workflows/documents";
import type { DocumentState, DocumentStoreState } from "./state";

const remoteSyncGenerations = new WeakMap<DocumentStoreState, number>();
const syncLaneGenerations = new WeakMap<DocumentStoreState, number>();
interface RemoteSyncWaiterGeneration {
  count: number;
  readonly generation: DocumentStoreRemoteSyncRequestGeneration;
}

const remoteSyncWaiterGenerations = new WeakMap<
  DocumentStoreState,
  RemoteSyncWaiterGeneration[]
>();
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

interface DocumentStoreGenerationIdentity {
  readonly domainScope: DocumentStoreState["runtime"]["state"]["domainScope"];
  readonly execSql: DocumentStoreState["runtime"]["infra"]["execSql"];
  readonly localWriteGeneration: number;
  readonly resolveProjectionUserKey: DocumentProjectionUserKeyResolver;
}

interface DocumentStoreSyncLaneIdentity {
  readonly syncLaneGeneration: number;
  readonly syncLaneIsDisposed: (() => boolean) | null;
}

export type DocumentStoreSyncLaneGeneration = DocumentStoreSyncLaneIdentity;

function hasDocumentStoreSyncLaneIdentity(
  generation: DocumentStoreGenerationIdentity,
): generation is DocumentStoreGenerationIdentity &
  DocumentStoreSyncLaneIdentity {
  return (
    "syncLaneGeneration" in generation && "syncLaneIsDisposed" in generation
  );
}

/** Immutable identities that define one remote-sync request generation. */
export interface DocumentStoreRemoteSyncRequestGeneration
  extends DocumentStoreGenerationIdentity,
    DocumentStoreSyncLaneIdentity {
  readonly remoteSyncGeneration: number;
}

/** Immutable identities that define one live document-store generation. */
export interface DocumentStoreSyncGeneration
  extends DocumentStoreGenerationIdentity {
  readonly currentDoc: DocumentState | null;
}

/** A live store generation that is also cancelled with a remote-only probe. */
interface DocumentStoreRemoteSyncGeneration
  extends DocumentStoreSyncGeneration,
    DocumentStoreSyncLaneIdentity {
  readonly remoteSyncGeneration: number;
}

function captureDocumentStoreGenerationIdentity(
  state: DocumentStoreState,
): DocumentStoreGenerationIdentity {
  return {
    domainScope: state.runtime.state.domainScope,
    execSql: state.runtime.infra.execSql,
    localWriteGeneration: state.localWriteGeneration,
    resolveProjectionUserKey: state.resolveProjectionUserKey,
  };
}

function captureDocumentStoreSyncLaneIdentity(
  state: DocumentStoreState,
): DocumentStoreSyncLaneIdentity {
  return {
    syncLaneGeneration: syncLaneGenerations.get(state) ?? 0,
    syncLaneIsDisposed: state.syncLane?.isDisposed ?? null,
  };
}

export function captureDocumentStoreSyncLaneGeneration(
  state: DocumentStoreState,
): DocumentStoreSyncLaneGeneration {
  return captureDocumentStoreSyncLaneIdentity(state);
}

/** Invalidate passes owned by a coordinator that has been replaced. */
export function invalidateDocumentStoreSyncLane(
  state: DocumentStoreState,
): void {
  syncLaneGenerations.set(state, (syncLaneGenerations.get(state) ?? 0) + 1);
}

export function captureDocumentStoreRemoteSyncRequestGeneration(
  state: DocumentStoreState,
): DocumentStoreRemoteSyncRequestGeneration {
  return {
    ...captureDocumentStoreGenerationIdentity(state),
    ...captureDocumentStoreSyncLaneIdentity(state),
    remoteSyncGeneration: getRemoteSyncGeneration(state),
  };
}

export function captureDocumentStoreSyncGeneration(
  state: DocumentStoreState,
  currentDoc: DocumentState | null,
): DocumentStoreSyncGeneration | null {
  if (state.doc !== currentDoc) return null;

  return {
    currentDoc,
    ...captureDocumentStoreGenerationIdentity(state),
  };
}

export function captureDocumentStoreRemoteSyncGeneration(
  state: DocumentStoreState,
  currentDoc: DocumentState | null,
  syncLaneGeneration: DocumentStoreSyncLaneGeneration,
): DocumentStoreRemoteSyncGeneration | null {
  const generation = captureDocumentStoreSyncGeneration(state, currentDoc);
  if (
    !generation ||
    !isDocumentStoreSyncLaneGenerationCurrent(state, syncLaneGeneration)
  ) {
    return null;
  }
  return {
    ...generation,
    ...syncLaneGeneration,
    remoteSyncGeneration: getRemoteSyncGeneration(state),
  };
}

export function captureDocumentStoreAttachmentSyncGeneration(
  state: DocumentStoreState,
  currentDoc: DocumentState | null,
  syncLaneGeneration: DocumentStoreSyncLaneGeneration,
): DocumentStoreSyncGeneration | null {
  const generation = captureDocumentStoreSyncGeneration(state, currentDoc);
  if (
    !generation ||
    !isDocumentStoreSyncLaneGenerationCurrent(state, syncLaneGeneration)
  ) {
    return null;
  }
  return { ...generation, ...syncLaneGeneration };
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
  state.remoteSyncBlocked = true;
  state.remoteUpdatePending = false;
}

export function allowDocumentStoreRemoteSync(state: DocumentStoreState): void {
  state.remoteSyncBlocked = false;
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
    (signal.signalSequence > state.remoteUpdateCompletedSignalSeq ||
      state.pullContinuation !== null ||
      state.record?.pullContinuationRecoveryRequired === true)
  );
}

/**
 * Register one live owner of a shared remote probe. The returned release
 * function reports whether that owner was the last one still waiting.
 */
export function registerDocumentStoreRemoteSyncWaiter(
  state: DocumentStoreState,
  generation: DocumentStoreRemoteSyncRequestGeneration,
): () => boolean {
  const generations = remoteSyncWaiterGenerations.get(state) ?? [];
  let entry = generations.find((candidate) =>
    documentStoreRemoteSyncRequestGenerationsMatch(
      candidate.generation,
      generation,
    ),
  );
  if (!entry) {
    entry = { count: 0, generation };
    generations.push(entry);
    remoteSyncWaiterGenerations.set(state, generations);
  }
  entry.count += 1;
  let active = true;
  return () => {
    if (!active) return false;
    active = false;
    entry.count -= 1;
    if (entry.count === 0) {
      const remaining = generations.filter((candidate) => candidate !== entry);
      if (remaining.length === 0) {
        remoteSyncWaiterGenerations.delete(state);
      } else {
        remoteSyncWaiterGenerations.set(state, remaining);
      }
      return true;
    }
    return false;
  };
}

function documentStoreRemoteSyncRequestGenerationsMatch(
  left: DocumentStoreRemoteSyncRequestGeneration,
  right: DocumentStoreRemoteSyncRequestGeneration,
): boolean {
  return (
    left.domainScope === right.domainScope &&
    left.execSql === right.execSql &&
    left.localWriteGeneration === right.localWriteGeneration &&
    left.remoteSyncGeneration === right.remoteSyncGeneration &&
    left.resolveProjectionUserKey === right.resolveProjectionUserKey &&
    left.syncLaneGeneration === right.syncLaneGeneration &&
    left.syncLaneIsDisposed === right.syncLaneIsDisposed
  );
}

export function isDocumentStoreRemoteSyncBlocked(
  state: DocumentStoreState,
): boolean {
  return state.remoteSyncBlocked;
}

export function isDocumentStoreRemoteSyncRequestGenerationCurrent(
  state: DocumentStoreState,
  generation: DocumentStoreRemoteSyncRequestGeneration,
): boolean {
  return (
    isDocumentStoreGenerationIdentityCurrent(state, generation) &&
    getRemoteSyncGeneration(state) === generation.remoteSyncGeneration
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
    isDocumentStoreGenerationIdentityCurrent(state, generation) &&
    (!("remoteSyncGeneration" in generation) ||
      getRemoteSyncGeneration(state) === generation.remoteSyncGeneration)
  );
}

export function isDocumentStoreSyncLaneGenerationCurrent(
  state: DocumentStoreState,
  generation: DocumentStoreSyncLaneGeneration,
): boolean {
  return (
    (syncLaneGenerations.get(state) ?? 0) === generation.syncLaneGeneration &&
    !generation.syncLaneIsDisposed?.()
  );
}

function isDocumentStoreGenerationIdentityCurrent(
  state: DocumentStoreState,
  generation: DocumentStoreGenerationIdentity,
): boolean {
  return (
    state.runtime.state.domainScope === generation.domainScope &&
    state.runtime.infra.execSql === generation.execSql &&
    state.localWriteGeneration === generation.localWriteGeneration &&
    state.resolveProjectionUserKey === generation.resolveProjectionUserKey &&
    (!hasDocumentStoreSyncLaneIdentity(generation) ||
      isDocumentStoreSyncLaneGenerationCurrent(state, generation))
  );
}
