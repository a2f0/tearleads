import type {
  DocumentHistoryView,
  DocumentSnapshot,
  DocumentStore,
} from "@tearleads/client-sdk";

/**
 * The snapshot a document shows at a past version: the version's content with
 * the live document's identity and access, and every write gate closed.
 *
 * A past attachment keeps its bytes only while the live document still holds
 * the same bytes in the same slot; detached bytes are not retained. The live
 * document's own reference is not proof of that: a slot marked
 * `intent-mismatch` holds bytes that differ from what the document records,
 * so it never lends its bytes to a past version.
 */
export function historicalDocumentSnapshot(
  live: DocumentSnapshot,
  view: DocumentHistoryView,
): DocumentSnapshot {
  const liveShaBySlot = new Map(
    live.attachments.map((attachment) => [
      attachment.slotId,
      attachment.contentSha256,
    ]),
  );
  const attachmentStorageKeyBySlotId: Record<string, string> = {};
  for (const attachment of view.attachments) {
    const storageKey = live.attachmentStorageKeyBySlotId[attachment.slotId];
    if (
      storageKey !== undefined &&
      liveShaBySlot.get(attachment.slotId) === attachment.contentSha256 &&
      live.attachmentStatusBySlotId[attachment.slotId] !== "intent-mismatch"
    ) {
      attachmentStorageKeyBySlotId[attachment.slotId] = storageKey;
    }
  }
  return {
    attachments: view.attachments,
    attachmentStatusBySlotId: {},
    attachmentStorageKeyBySlotId,
    canAttach: false,
    canWrite: false,
    currentAuthorId: live.currentAuthorId,
    documentId: live.documentId,
    documentKind: view.documentKind,
    effectiveAccessLevel: live.effectiveAccessLevel,
    fieldValidationIssues: view.fieldValidationIssues,
    ready: true,
    rows: view.rows,
    structuredFields: view.structuredFields,
    syncing: false,
    text: view.text,
    title: view.title,
  };
}

export interface HistoricalDocumentStore {
  /** Replace the version on screen and notify subscribers. */
  show(snapshot: DocumentSnapshot): void;
  readonly store: DocumentStore;
}

/**
 * A document store over a past version. It only reads: every mutation is the
 * no-op a live store performs when its document cannot be written, so an
 * editor that slips past the closed write gates changes nothing.
 */
export function createHistoricalDocumentStore(
  initial: DocumentSnapshot,
): HistoricalDocumentStore {
  let snapshot = initial;
  const listeners = new Set<() => void>();
  const store: DocumentStore = {
    addRow: () => Promise.resolve(""),
    assertCanRotateContentKey: () =>
      Promise.reject(new Error("A past version cannot rotate keys.")),
    attachFiles: () => undefined,
    discardLocalState: () => Promise.resolve(false),
    ensureInitialized: () => Promise.resolve(true),
    getSnapshot: () => snapshot,
    hasQueuedWrites: () => false,
    hasUnsavedLocalEdits: () => false,
    relink: () => Promise.resolve(null),
    removeAttachment: () => undefined,
    removeRow: () => Promise.resolve(),
    replaceAttachment: () => Promise.resolve(),
    requestRemoteSync: () => undefined,
    requestRemoteSyncAndWait: () => Promise.resolve(false),
    requestSync: () => undefined,
    restoreContent: () => Promise.resolve(false),
    setStructuredFields: () => Promise.resolve(),
    setText: () => Promise.resolve(),
    subscribe: (listener) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    updateRowFields: () => Promise.resolve(),
    updateRuntime: () => undefined,
  };
  return {
    show(next) {
      if (next === snapshot) return;
      snapshot = next;
      for (const listener of [...listeners]) listener();
    },
    store,
  };
}
