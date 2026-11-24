import type { DomainScope } from "../../data/shared/domainScope";
import {
  registerInternalDocumentRelink,
  relinkDocumentStoreWithCommitSideEffect,
} from "./documentStore/internalRelink";
import type {
  DocumentAttachmentUpload,
  DocumentSnapshot,
  DocumentStore,
  DocumentStoreFacade,
  DocumentStoreJoiningOpen,
  DocumentsRuntime,
  PersistedDocumentListener,
} from "./types";

interface DocumentStoreRegistry {
  storeKeysByDocumentId: Map<string, string>;
  storeKeysByLocalId: Map<string, string>;
  storesByKey: Map<string, DocumentStoreFacade>;
  /** Open views another record displaced; their queued writes still count. */
  supersededStores: Set<DocumentStoreFacade>;
}

const documentStoreRegistriesByScope = new WeakMap<
  DomainScope,
  DocumentStoreRegistry
>();
type PersistedDocumentDeletionListener = (localId: string) => void;

// Per-scope listener plumbing shared by the persisted-document and
// persisted-document-deletion channels: emit fans out to the scope's
// listeners, and unsubscribing the last listener drops the scope entry.
function createScopedListenerRegistry<
  Listener extends (...args: never[]) => void,
>() {
  const listenersByScope = new WeakMap<DomainScope, Set<Listener>>();

  return {
    emit: (domainScope: DomainScope, ...args: Parameters<Listener>): void => {
      const listeners = listenersByScope.get(domainScope);
      if (!listeners) {
        return;
      }

      for (const listener of listeners) {
        listener(...args);
      }
    },
    subscribe: (domainScope: DomainScope, listener: Listener): (() => void) => {
      const listeners =
        listenersByScope.get(domainScope) ?? new Set<Listener>();
      listeners.add(listener);
      listenersByScope.set(domainScope, listeners);

      return () => {
        listeners.delete(listener);
        if (listeners.size === 0) {
          listenersByScope.delete(domainScope);
        }
      };
    },
  };
}

const persistedDocumentListeners =
  createScopedListenerRegistry<PersistedDocumentListener>();
const persistedDocumentDeletionListeners =
  createScopedListenerRegistry<PersistedDocumentDeletionListener>();

export function getOrCreateDocumentStoreRegistry(
  domainScope: DomainScope,
): DocumentStoreRegistry {
  const existingRegistry = documentStoreRegistriesByScope.get(domainScope);
  if (existingRegistry) {
    return existingRegistry;
  }

  const nextRegistry: DocumentStoreRegistry = {
    storeKeysByDocumentId: new Map(),
    storeKeysByLocalId: new Map(),
    storesByKey: new Map(),
    supersededStores: new Set(),
  };
  documentStoreRegistriesByScope.set(domainScope, nextRegistry);
  return nextRegistry;
}

export function resolveDocumentStoreKey(
  registry: DocumentStoreRegistry,
  localId: string,
  documentId: string | null,
): string {
  return (
    (documentId ? registry.storeKeysByDocumentId.get(documentId) : undefined) ??
    registry.storeKeysByLocalId.get(localId) ??
    localId
  );
}

export function registerDocumentStore(
  domainScope: DomainScope,
  localId: string,
  store: DocumentStoreFacade,
  documentId: string | null,
) {
  const registry = getOrCreateDocumentStoreRegistry(domainScope);
  const storeKey = resolveDocumentStoreKey(registry, localId, documentId);
  registry.storeKeysByLocalId.set(localId, storeKey);
  if (documentId) {
    registry.storeKeysByDocumentId.set(documentId, storeKey);
  }
  registry.storesByKey.set(storeKey, store);
}

export function registerDocumentStoreIdentity(
  domainScope: DomainScope,
  localId: string,
  documentId: string | null,
) {
  if (!documentId) {
    return;
  }

  const registry = getOrCreateDocumentStoreRegistry(domainScope);
  const localStoreKey = registry.storeKeysByLocalId.get(localId) ?? localId;
  const documentStoreKey =
    registry.storeKeysByDocumentId.get(documentId) ?? documentId;

  registry.storeKeysByLocalId.set(localId, documentStoreKey);
  registry.storeKeysByDocumentId.set(documentId, documentStoreKey);

  if (documentStoreKey === localStoreKey) {
    return;
  }

  const localStore = registry.storesByKey.get(localStoreKey);
  const documentStore = registry.storesByKey.get(documentStoreKey);
  if (localStore) {
    // Another local record now owns this document id. A view that already
    // has the previous record open stays on it instead of switching records
    // under its editor: its draft, uploads, and edits keep their identity,
    // and a reopen resolves to the new owner.
    if (documentStore && documentStore !== localStore) {
      documentStore.supersede();
      registry.supersededStores.add(documentStore);
    }
    registry.storesByKey.set(documentStoreKey, localStore);
  }
  registry.storesByKey.delete(localStoreKey);
}

/**
 * Whether any open store in `domainScope` holds local edits that have not
 * reached SQLite yet — queued writes, or applied edits whose save failed — so
 * a host can warn before an unload loses them.
 */
export function hasPendingLocalDocumentWrites(
  domainScope: DomainScope,
): boolean {
  const registry = documentStoreRegistriesByScope.get(domainScope);
  if (!registry) return false;
  // A displaced view accepts no new writes, so once its queue has reached
  // SQLite it can never hold the page open again.
  for (const store of registry.supersededStores) {
    if (!store.hasQueuedWrites() && !store.hasUnsavedLocalEdits())
      registry.supersededStores.delete(store);
  }
  for (const store of [
    ...registry.storesByKey.values(),
    ...registry.supersededStores,
  ]) {
    if (store.hasQueuedWrites() || store.hasUnsavedLocalEdits()) return true;
  }
  return false;
}

export function requestDocumentStoreSync(state: {
  syncLane: {
    requestSync: () => void;
  } | null;
}) {
  state.syncLane?.requestSync();
}

export function requestRegisteredDocumentRemoteSync(
  domainScope: DomainScope,
  localId: string,
  documentId: string | null,
): boolean {
  const registry = documentStoreRegistriesByScope.get(domainScope);
  if (!registry) {
    return false;
  }

  const storeKey = resolveDocumentStoreKey(registry, localId, documentId);
  const store = registry.storesByKey.get(storeKey);
  if (!store) {
    return false;
  }

  // Explicit refresh uses this path to recover missed websocket invalidations
  // without instantiating every unopened document discovered in the container.
  store.requestRemoteSync();
  return true;
}

/**
 * Discard a registered document's local edits through its store, so the
 * teardown serializes on the store's write machinery instead of racing an
 * in-flight persist that would resurrect the deleted rows. Only registered
 * stores qualify — an unregistered document has no lane submitting its queue,
 * so there is nothing this escape hatch could unstick. No deletion is
 * emitted: the document survives as a re-seeded shell that keeps its listing
 * entry, and the re-pull's own persist announces the restored content.
 *
 * Resolution is strict, unlike the read-side lookups: a destructive action
 * must never run against whichever store won a lookup priority. Both
 * identifiers must map to the SAME registered store — an unknown or stale
 * documentId refuses rather than trusting the localId alone — and the store
 * revalidates the expected documentId against its persisted record inside
 * the teardown's serialized mutation, so even a stale registry mapping
 * cannot discard a different identity's edits.
 */
export async function discardRegisteredDocumentLocalState(
  domainScope: DomainScope,
  localId: string,
  documentId: string,
): Promise<boolean> {
  const registry = documentStoreRegistriesByScope.get(domainScope);
  if (!registry) {
    return false;
  }

  const localStoreKey = registry.storeKeysByLocalId.get(localId);
  const documentStoreKey = registry.storeKeysByDocumentId.get(documentId);
  if (
    !localStoreKey ||
    !documentStoreKey ||
    documentStoreKey !== localStoreKey
  ) {
    return false;
  }
  const store = registry.storesByKey.get(localStoreKey);
  if (!store) {
    return false;
  }

  return store.discardLocalState(documentId);
}

const supersedeHandlers = new WeakMap<DocumentStore, () => void>();

/** A content write through a view another record displaced. */
class DocumentRelinkedElsewhereError extends Error {
  constructor() {
    super("This document view is read-only; reopen the document to edit it.");
    this.name = "DocumentRelinkedElsewhereError";
  }
}

function refuseWrite(): Promise<never> {
  return Promise.reject(new DocumentRelinkedElsewhereError());
}

/** How a backing store stops work that only its displaced view owned. */
export function registerDocumentStoreSupersedeHandler(
  store: DocumentStore,
  handler: () => void,
): void {
  supersedeHandlers.set(store, handler);
}

const openJoins = new WeakMap<
  DocumentStore,
  (open: DocumentStoreJoiningOpen) => void
>();

/** How a backing store takes in a later open of it; see `openJoin.ts`. */
export function registerDocumentStoreOpenJoin(
  store: DocumentStore,
  join: (open: DocumentStoreJoiningOpen) => void,
): void {
  openJoins.set(store, join);
}

/** A facade takes in a later open through the store it wraps. */
export function forwardDocumentStoreOpenJoin(
  facade: DocumentStore,
  target: DocumentStore,
): void {
  openJoins.set(facade, (open) => openJoins.get(target)?.(open));
}

/**
 * A later open of an already-registered store joins it: the open that wants
 * more (a startup probe, or a record created when missing) wins, whichever
 * opened first.
 */
export function joinDocumentStoreOpen(
  store: DocumentStore,
  open: DocumentStoreJoiningOpen,
): void {
  openJoins.get(store)?.(open);
}

export function createDocumentStoreFacade(
  targetStore: DocumentStore,
): DocumentStoreFacade {
  const listeners = new Set<() => void>();
  let superseded = false;
  let supersededSource: DocumentSnapshot | null = null;
  let supersededSnapshot: DocumentSnapshot | null = null;

  const emitFacade = () => {
    for (const listener of listeners) {
      listener();
    }
  };

  targetStore.subscribe(emitFacade);

  // Stable per source snapshot, as external-store readers require.
  const getSnapshot = (): DocumentSnapshot => {
    const snapshot = targetStore.getSnapshot();
    if (!superseded) return snapshot;
    if (snapshot !== supersededSource || !supersededSnapshot) {
      supersededSource = snapshot;
      supersededSnapshot = {
        ...snapshot,
        canAttach: false,
        canWrite: false,
        relinkedElsewhere: true,
      };
    }
    return supersededSnapshot;
  };

  const facade: DocumentStoreFacade = {
    addRow: (fields, options) =>
      superseded ? refuseWrite() : targetStore.addRow(fields, options),
    assertCanRotateContentKey: (proof) =>
      targetStore.assertCanRotateContentKey(proof),
    // Returned as-is: callers await the store's work behind the void type.
    attachFiles: (files: ReadonlyArray<DocumentAttachmentUpload>) =>
      superseded ? undefined : targetStore.attachFiles(files),
    checkHeldAttachments: () => targetStore.checkHeldAttachments(),
    discardLocalState: (expectedDocumentId: string) =>
      targetStore.discardLocalState(expectedDocumentId),
    ensureInitialized: () => targetStore.ensureInitialized(),
    getSnapshot,
    hasQueuedWrites: () => targetStore.hasQueuedWrites(),
    hasUnsavedLocalEdits: () => targetStore.hasUnsavedLocalEdits(),
    removeAttachment: (slotId: string) =>
      superseded ? undefined : targetStore.removeAttachment(slotId),
    removeRow: (id, options) =>
      superseded ? refuseWrite() : targetStore.removeRow(id, options),
    replaceAttachment: (slotId: string, file: DocumentAttachmentUpload) =>
      superseded ? refuseWrite() : targetStore.replaceAttachment(slotId, file),
    requestRemoteSync: () => targetStore.requestRemoteSync(),
    requestRemoteSyncAndWait: (signal) =>
      targetStore.requestRemoteSyncAndWait(signal),
    requestSync: () => targetStore.requestSync(),
    relink: (input) => targetStore.relink(input),
    supersede: () => {
      if (superseded) return;
      superseded = true;
      supersedeHandlers.get(targetStore)?.();
      emitFacade();
    },
    restoreContent: async (content, options) =>
      !superseded && (await targetStore.restoreContent(content, options)),
    setStructuredFields: (kind, patch, options) =>
      superseded
        ? refuseWrite()
        : targetStore.setStructuredFields(kind, patch, options),
    setText: (value: string) =>
      superseded ? refuseWrite() : targetStore.setText(value),
    subscribe: (listener: () => void) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    updateRowFields: (id, patch, options) =>
      superseded
        ? refuseWrite()
        : targetStore.updateRowFields(id, patch, options),
    updateRuntime: (runtime: DocumentsRuntime) =>
      targetStore.updateRuntime(runtime),
  };
  registerInternalDocumentRelink(facade, (input, commitSideEffect) =>
    relinkDocumentStoreWithCommitSideEffect(
      targetStore,
      input,
      commitSideEffect,
    ),
  );
  return facade;
}

export function emitPersistedDocument(
  domainScope: DomainScope,
  persistedDocument: Parameters<PersistedDocumentListener>[0],
  placementChanged = false,
): void {
  persistedDocumentListeners.emit(domainScope, persistedDocument, {
    placementChanged,
  });
}

export function subscribeToPersistedDocuments(
  domainScope: DomainScope,
  listener: PersistedDocumentListener,
): () => void {
  return persistedDocumentListeners.subscribe(domainScope, listener);
}

export function emitPersistedDocumentDeletion(
  domainScope: DomainScope,
  localId: string,
): void {
  persistedDocumentDeletionListeners.emit(domainScope, localId);
}

export function subscribeToPersistedDocumentDeletions(
  domainScope: DomainScope,
  listener: PersistedDocumentDeletionListener,
): () => void {
  return persistedDocumentDeletionListeners.subscribe(domainScope, listener);
}

export function requestDomainDocumentSync(domainScope: DomainScope): void {
  const registry = documentStoreRegistriesByScope.get(domainScope);
  if (!registry) {
    return;
  }

  for (const store of registry.storesByKey.values()) {
    store.requestSync();
  }
}
