import type { DocumentSnapshot, DocumentStore } from "./types";

const REMOVED_DOCUMENT_MESSAGE =
  "This document was removed while its organization's sync is paused";

/**
 * Stands in for a store whose document a paused organization's cleanup
 * removed. It keeps showing the last snapshot, read-only, and does nothing
 * else, so an open editor neither recreates the document nor downloads it
 * while the pause lasts.
 */
export function createRemovedDocumentStore(
  lastSnapshot: DocumentSnapshot,
): DocumentStore {
  const snapshot: DocumentSnapshot = {
    ...lastSnapshot,
    canAttach: false,
    canWrite: false,
    syncing: false,
  };
  const refuse = () => Promise.reject(new Error(REMOVED_DOCUMENT_MESSAGE));
  return {
    addRow: refuse,
    assertCanRotateContentKey: refuse,
    attachFiles: () => undefined,
    discardLocalState: async () => false,
    ensureInitialized: async () => false,
    getSnapshot: () => snapshot,
    hasQueuedWrites: () => false,
    removeAttachment: () => undefined,
    removeRow: refuse,
    replaceAttachment: refuse,
    requestRemoteSync: () => undefined,
    requestRemoteSyncAndWait: async () => false,
    requestSync: () => undefined,
    relink: async () => null,
    setStructuredFields: refuse,
    setText: refuse,
    subscribe: () => () => undefined,
    updateRowFields: refuse,
    updateRuntime: () => undefined,
  };
}
