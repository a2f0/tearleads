import type { DomainScope } from "../../data/shared/domainScope";
import {
  registerInternalDocumentRelink,
  relinkDocumentStoreWithCommitSideEffect,
} from "./documentStore/internalRelink";
import { createRemovedDocumentStore } from "./removedDocumentStore";
import type {
  DocumentAttachmentUpload,
  DocumentStore,
  DocumentStoreFacade,
  DocumentsRuntime,
  PersistedDocumentListener,
} from "./types";

interface DocumentStoreRegistry {
  /** How the last open built each store's backing store, by store key. */
  freshStoreFactories: Map<string, () => DocumentStore>;
  /** Each backing store's way to stop its sync lane, by local id. */
  retireHandlersByLocalId: Map<string, () => void>;
  /**
   * Stores whose document was removed under them, each with whether its
   * removal still holds; see retireDocumentStore.
   */
  retiredStores: Map<string, () => boolean>;
  storeKeysByDocumentId: Map<string, string>;
  storeKeysByLocalId: Map<string, string>;
  storesByKey: Map<string, DocumentStoreFacade>;
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
    freshStoreFactories: new Map(),
    retireHandlersByLocalId: new Map(),
    retiredStores: new Map(),
    storeKeysByDocumentId: new Map(),
    storeKeysByLocalId: new Map(),
    storesByKey: new Map(),
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
    documentStore?.rebindTo(localStore);
    registry.storesByKey.set(documentStoreKey, localStore);
    // The store's retirement and how to rebuild it move with it.
    moveKeyedEntry(
      registry.freshStoreFactories,
      localStoreKey,
      documentStoreKey,
    );
    moveKeyedEntry(registry.retiredStores, localStoreKey, documentStoreKey);
  }
  registry.storesByKey.delete(localStoreKey);
}

function moveKeyedEntry<Value>(
  entries: Map<string, Value>,
  fromKey: string,
  toKey: string,
): void {
  const value = entries.get(fromKey);
  entries.delete(fromKey);
  if (value !== undefined) entries.set(toKey, value);
}

/**
 * Whether an open store holds local writes for the document that have not
 * reached SQLite yet, which no persisted-write scan can see.
 */
export function hasQueuedDocumentStoreWrites(
  domainScope: DomainScope,
  localId: string,
): boolean {
  const registry = documentStoreRegistriesByScope.get(domainScope);
  const storeKey = registry?.storeKeysByLocalId.get(localId) ?? localId;
  return registry?.storesByKey.get(storeKey)?.hasQueuedWrites() ?? false;
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
  if (!store || registry.retiredStores.has(storeKey)) {
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

export function createDocumentStoreFacade(
  initialStore: DocumentStore,
): DocumentStoreFacade {
  let targetStore = initialStore;
  const listeners = new Set<() => void>();

  const emitFacade = () => {
    for (const listener of listeners) {
      listener();
    }
  };

  let unsubscribeTarget = targetStore.subscribe(() => {
    emitFacade();
  });

  const connectTarget = (nextStore: DocumentStore) => {
    if (targetStore === nextStore) {
      return;
    }

    unsubscribeTarget();
    targetStore = nextStore;
    unsubscribeTarget = targetStore.subscribe(() => {
      emitFacade();
    });
    emitFacade();
  };

  const facade: DocumentStoreFacade = {
    addRow: (fields) => targetStore.addRow(fields),
    assertCanRotateContentKey: () => targetStore.assertCanRotateContentKey(),
    attachFiles: (files: ReadonlyArray<DocumentAttachmentUpload>) =>
      targetStore.attachFiles(files),
    discardLocalState: (expectedDocumentId: string) =>
      targetStore.discardLocalState(expectedDocumentId),
    ensureInitialized: () => targetStore.ensureInitialized(),
    getSnapshot: () => targetStore.getSnapshot(),
    hasQueuedWrites: () => targetStore.hasQueuedWrites(),
    removeAttachment: (slotId: string) => targetStore.removeAttachment(slotId),
    removeRow: (id) => targetStore.removeRow(id),
    replaceAttachment: (slotId: string, file: DocumentAttachmentUpload) =>
      targetStore.replaceAttachment(slotId, file),
    requestRemoteSync: () => targetStore.requestRemoteSync(),
    requestRemoteSyncAndWait: (signal) =>
      targetStore.requestRemoteSyncAndWait(signal),
    requestSync: () => targetStore.requestSync(),
    relink: (input) => targetStore.relink(input),
    rebindTo: (store) => connectTarget(store),
    setStructuredFields: (kind, patch, options) =>
      targetStore.setStructuredFields(kind, patch, options),
    setText: (value: string) => targetStore.setText(value),
    subscribe: (listener: () => void) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    updateRowFields: (id, patch) => targetStore.updateRowFields(id, patch),
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

  for (const [storeKey, store] of registry.storesByKey) {
    if (!registry.retiredStores.has(storeKey)) store.requestSync();
  }
}

/** Lets the backing store for `localId` stop its sync lane when retired. */
export function onDocumentStoreRetired(
  domainScope: DomainScope,
  localId: string,
  stopSyncLane: () => void,
): void {
  getOrCreateDocumentStoreRegistry(domainScope).retireHandlersByLocalId.set(
    localId,
    stopSyncLane,
  );
}

/**
 * Retires the store of a document a paused organization's cleanup removed.
 * Its backing store's sync lane stops and the facade an editor may hold
 * switches to a read-only stand-in, so nothing recreates or downloads the
 * document. While `stillRemoved()` holds, reopening returns the stand-in;
 * after that, the next open rebinds the facade to a fresh backing store that
 * loads whatever SQLite holds by then, such as a copy rediscovered on resume.
 */
export function retireDocumentStore(
  domainScope: DomainScope,
  localId: string,
  stillRemoved: () => boolean,
): void {
  const registry = documentStoreRegistriesByScope.get(domainScope);
  const storeKey = registry?.storeKeysByLocalId.get(localId) ?? localId;
  const store = registry?.storesByKey.get(storeKey);
  if (!registry || !store || registry.retiredStores.has(storeKey)) return;
  registry.retireHandlersByLocalId.get(localId)?.();
  store.rebindTo(createRemovedDocumentStore(store.getSnapshot()));
  registry.retiredStores.set(storeKey, stillRemoved);
}

/**
 * Undoes a retirement whose deletion did not commit: the document survives,
 * so its facade gets a fresh backing store again.
 */
export function restoreDocumentStore(
  domainScope: DomainScope,
  localId: string,
): void {
  const registry = documentStoreRegistriesByScope.get(domainScope);
  const storeKey = registry?.storeKeysByLocalId.get(localId) ?? localId;
  const store = registry?.storesByKey.get(storeKey);
  if (!registry || !store || !registry.retiredStores.delete(storeKey)) return;
  const createFresh = registry.freshStoreFactories.get(storeKey);
  // Without a factory the next open rebinds it instead.
  if (createFresh) store.rebindTo(createFresh());
  else registry.retiredStores.set(storeKey, () => false);
}

/** The registered store for a key, rebound once its removal has lifted. */
export function takeRegisteredDocumentStore(
  registry: DocumentStoreRegistry,
  storeKey: string,
  createFresh: () => DocumentStore,
): DocumentStoreFacade | undefined {
  registry.freshStoreFactories.set(storeKey, createFresh);
  const store = registry.storesByKey.get(storeKey);
  const stillRemoved = registry.retiredStores.get(storeKey);
  if (store && stillRemoved && !stillRemoved()) {
    registry.retiredStores.delete(storeKey);
    store.rebindTo(createFresh());
  }
  return store;
}
