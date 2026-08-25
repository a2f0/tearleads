import type { DocumentProjectionUserKeyResolver } from "../../../workflows/documents";
import type { DocumentState, DocumentStoreState } from "./state";

const remoteSyncGenerations = new WeakMap<DocumentStoreState, number>();
const remoteSyncBlockedStates = new WeakSet<DocumentStoreState>();

function getRemoteSyncGeneration(state: DocumentStoreState): number {
  return remoteSyncGenerations.get(state) ?? 0;
}

/** Immutable identities that define one live document-store generation. */
export interface DocumentStoreSyncGeneration {
  readonly currentDoc: DocumentState | null;
  readonly domainScope: DocumentStoreState["runtime"]["state"]["domainScope"];
  readonly execSql: DocumentStoreState["runtime"]["infra"]["execSql"];
  readonly remoteSyncGeneration: number;
  readonly resolveProjectionUserKey: DocumentProjectionUserKeyResolver;
}

export function captureDocumentStoreSyncGeneration(
  state: DocumentStoreState,
  currentDoc: DocumentState | null,
): DocumentStoreSyncGeneration | null {
  if (state.doc !== currentDoc) return null;

  return {
    currentDoc,
    domainScope: state.runtime.state.domainScope,
    execSql: state.runtime.infra.execSql,
    remoteSyncGeneration: getRemoteSyncGeneration(state),
    resolveProjectionUserKey: state.resolveProjectionUserKey,
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

export function isDocumentStoreRemoteSyncBlocked(
  state: DocumentStoreState,
): boolean {
  return remoteSyncBlockedStates.has(state);
}

export function isDocumentStoreSyncGenerationCurrent(
  state: DocumentStoreState,
  generation: DocumentStoreSyncGeneration,
): boolean {
  return (
    state.doc === generation.currentDoc &&
    state.runtime.state.domainScope === generation.domainScope &&
    state.runtime.infra.execSql === generation.execSql &&
    getRemoteSyncGeneration(state) === generation.remoteSyncGeneration &&
    state.resolveProjectionUserKey === generation.resolveProjectionUserKey
  );
}
