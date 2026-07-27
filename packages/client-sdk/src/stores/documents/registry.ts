import type { DomainScope } from "../../data/domainScope";
import type {
  DocumentAttachmentUpload,
  DocumentStore,
  DocumentStoreFacade,
  DocumentsRuntime,
  PersistedDocumentListener,
} from "./types";

interface DocumentStoreRegistry {
  storeKeysByDocumentId: Map<string, string>;
  storeKeysByLocalId: Map<string, string>;
  storesByKey: Map<string, DocumentStoreFacade>;
}

const documentStoreRegistriesByScope = new WeakMap<
  DomainScope,
  DocumentStoreRegistry
>();
const persistedDocumentListenersByScope = new WeakMap<
  DomainScope,
  Set<PersistedDocumentListener>
>();
type PersistedDocumentDeletionListener = (localId: string) => void;
const persistedDocumentDeletionListenersByScope = new WeakMap<
  DomainScope,
  Set<PersistedDocumentDeletionListener>
>();

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
  if (localStore && documentStore) {
    documentStore.rebindTo(localStore);
    registry.storesByKey.set(documentStoreKey, localStore);
  } else if (localStore && !documentStore) {
    registry.storesByKey.set(documentStoreKey, localStore);
  }
  registry.storesByKey.delete(localStoreKey);
}

export function requestDocumentStoreSync(state: {
  syncLane: { requestSync: () => void } | null;
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

  const store = registry.storesByKey.get(
    resolveDocumentStoreKey(registry, localId, documentId),
  );
  if (!store) {
    return false;
  }

  // Explicit refresh uses this path to recover missed websocket invalidations
  // without instantiating every unopened document discovered in the container.
  store.requestRemoteSync();
  return true;
}

/**
 * Discard a registered document's local state through its store, so the
 * teardown serializes on the store's identity-write chain instead of racing
 * an in-flight persist that would resurrect the deleted rows. Only registered
 * stores qualify — an unregistered document has no lane submitting its queue,
 * so there is nothing this escape hatch could unstick. Emits the persisted
 * deletion so listing consumers drop the document until priming restores it.
 */
export async function discardRegisteredDocumentLocalState(
  domainScope: DomainScope,
  localId: string,
  documentId: string | null,
): Promise<boolean> {
  const registry = documentStoreRegistriesByScope.get(domainScope);
  if (!registry) {
    return false;
  }

  const store = registry.storesByKey.get(
    resolveDocumentStoreKey(registry, localId, documentId),
  );
  if (!store) {
    return false;
  }

  const discarded = await store.discardLocalState();
  if (discarded) {
    emitPersistedDocumentDeletion(domainScope, localId);
  }
  return discarded;
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

  return {
    addRow: (fields) => targetStore.addRow(fields),
    assertCanRotateContentKey: () => targetStore.assertCanRotateContentKey(),
    attachFiles: (files: ReadonlyArray<DocumentAttachmentUpload>) =>
      targetStore.attachFiles(files),
    discardLocalState: () => targetStore.discardLocalState(),
    ensureInitialized: () => targetStore.ensureInitialized(),
    getSnapshot: () => targetStore.getSnapshot(),
    removeAttachment: (slotId: string) => targetStore.removeAttachment(slotId),
    removeRow: (id) => targetStore.removeRow(id),
    replaceAttachment: (slotId: string, file: DocumentAttachmentUpload) =>
      targetStore.replaceAttachment(slotId, file),
    requestRemoteSync: () => targetStore.requestRemoteSync(),
    requestSync: () => targetStore.requestSync(),
    relink: (input) => targetStore.relink(input),
    rebindTo: (store) => connectTarget(store),
    setAttachment: (slotId: string, file: DocumentAttachmentUpload) =>
      targetStore.setAttachment(slotId, file),
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
}

export function emitPersistedDocument(
  domainScope: DomainScope,
  persistedDocument: Parameters<PersistedDocumentListener>[0],
): void {
  const listeners = persistedDocumentListenersByScope.get(domainScope);
  if (!listeners) {
    return;
  }

  for (const listener of listeners) {
    listener(persistedDocument);
  }
}

export function subscribeToPersistedDocuments(
  domainScope: DomainScope,
  listener: PersistedDocumentListener,
): () => void {
  const listeners =
    persistedDocumentListenersByScope.get(domainScope) ??
    new Set<PersistedDocumentListener>();
  listeners.add(listener);
  persistedDocumentListenersByScope.set(domainScope, listeners);

  return () => {
    listeners.delete(listener);
    if (listeners.size === 0) {
      persistedDocumentListenersByScope.delete(domainScope);
    }
  };
}

export function emitPersistedDocumentDeletion(
  domainScope: DomainScope,
  localId: string,
): void {
  const listeners = persistedDocumentDeletionListenersByScope.get(domainScope);
  if (!listeners) {
    return;
  }

  for (const listener of listeners) {
    listener(localId);
  }
}

export function subscribeToPersistedDocumentDeletions(
  domainScope: DomainScope,
  listener: PersistedDocumentDeletionListener,
): () => void {
  const listeners =
    persistedDocumentDeletionListenersByScope.get(domainScope) ??
    new Set<PersistedDocumentDeletionListener>();
  listeners.add(listener);
  persistedDocumentDeletionListenersByScope.set(domainScope, listeners);

  return () => {
    listeners.delete(listener);
    if (listeners.size === 0) {
      persistedDocumentDeletionListenersByScope.delete(domainScope);
    }
  };
}

export function requestDomainDocumentSync(domainScope: DomainScope): void {
  const registry = documentStoreRegistriesByScope.get(domainScope);
  if (!registry) {
    return;
  }

  for (const store of new Set(registry.storesByKey.values())) {
    store.requestSync();
  }
}
