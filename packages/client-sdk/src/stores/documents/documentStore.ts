import { DEFAULT_DOCUMENT_KIND } from "../../data/documents/documentConstants";
import type { StoredDocumentKind } from "../../data/documents/documentKinds";
import type { DomainScope } from "../../data/domainScope";
import {
  createDocumentProjectionUserKeyResolver,
  type DocumentsPersistence,
  defaultDocumentsPersistence,
  didDocumentProjectionKeyRuntimeChange,
  didRegainDocumentSyncPrerequisites,
} from "../../workflows/documents";
import {
  attachFilesToDocumentStore,
  replaceAttachmentInDocumentStore,
  setAttachmentInDocumentStore,
} from "./documentStore/attachments";
import {
  ensureDocumentStoreInitialized,
  ensureDocumentStoreReady,
  relinkDocumentStore,
} from "./documentStore/initialization";
import {
  setDocumentStructuredFields,
  setDocumentText,
} from "./documentStore/mutations";
import {
  createDocumentStoreState,
  type DocumentStoreState,
  refreshAttachabilitySnapshot,
  resetDocumentStore,
  subscribeToDocumentStore,
} from "./documentStore/state";
import {
  handleDocumentRemoteEvents,
  registerDocumentStoreSyncLane,
} from "./documentStore/sync";
import {
  createDocumentStoreFacade,
  emitPersistedDocument,
  getOrCreateDocumentStoreRegistry,
  registerDocumentStore,
  registerDocumentStoreIdentity,
  requestDocumentStoreSync,
  resolveDocumentStoreKey,
} from "./registry";
import type {
  DocumentAttachmentUpload,
  DocumentStore,
  DocumentStoreFacade,
  DocumentsRuntime,
} from "./types";

export {
  requestDomainDocumentSync,
  subscribeToPersistedDocuments,
} from "./registry";

function updateDocumentStoreRuntime(
  state: DocumentStoreState,
  nextRuntime: DocumentsRuntime,
  scheduleSync: () => void,
) {
  const previousRuntime = state.runtime;
  const domainScopeChanged =
    previousRuntime.state.domainScope !== nextRuntime.state.domainScope;
  if (didDocumentProjectionKeyRuntimeChange(previousRuntime, nextRuntime)) {
    state.resolveProjectionUserKey =
      createDocumentProjectionUserKeyResolver(nextRuntime);
  }
  state.runtime = nextRuntime;
  if (domainScopeChanged) {
    state.syncLane = registerDocumentStoreSyncLane(state);
    state.locallyAcceptedUpdateIds = new Set();
    state.remoteUpdatePending = false;
  }

  if (nextRuntime.infra.dbStatus !== "ready") {
    if (state.snapshot.ready || state.initialized || state.initializePromise) {
      resetDocumentStore(state);
    }
    state.lastEventCount = nextRuntime.state.events.length;
    return;
  }

  refreshAttachabilitySnapshot(state);
  ensureDocumentStoreInitialized(state, scheduleSync);
  handleDocumentRemoteEvents(state, scheduleSync);

  if (
    state.snapshot.ready &&
    didRegainDocumentSyncPrerequisites(previousRuntime, state.runtime)
  ) {
    scheduleSync();
  }
}

function createBackingDocumentStore(
  localId: string,
  initialRuntime: DocumentsRuntime,
  persistence: DocumentsPersistence = defaultDocumentsPersistence,
  initialDocumentId: string | null = null,
  initialText = "",
  initialDocumentKind: StoredDocumentKind = DEFAULT_DOCUMENT_KIND,
): DocumentStore {
  const state = createDocumentStoreState(
    localId,
    initialRuntime,
    persistence,
    {
      emitPersistedDocument,
      registerDocumentIdentity: registerDocumentStoreIdentity,
    },
    initialDocumentId,
    initialText,
    initialDocumentKind,
  );
  state.syncLane = registerDocumentStoreSyncLane(state);
  const scheduleSync = () => requestDocumentStoreSync(state);

  return {
    attachFiles: (files: ReadonlyArray<DocumentAttachmentUpload>) =>
      attachFilesToDocumentStore(state, files),
    ensureInitialized: () => ensureDocumentStoreReady(state, scheduleSync),
    getSnapshot: () => state.snapshot,
    setAttachment: (slotId: string, file: DocumentAttachmentUpload) =>
      setAttachmentInDocumentStore(state, slotId, file),
    replaceAttachment: (slotId: string, file: DocumentAttachmentUpload) =>
      replaceAttachmentInDocumentStore(state, slotId, file),
    requestSync: () => scheduleSync(),
    relink: (input) => relinkDocumentStore(state, input),
    setStructuredFields: (kind, patch) =>
      setDocumentStructuredFields(state, kind, patch),
    setText: (value: string) => setDocumentText(state, value),
    subscribe: (listener: () => void) =>
      subscribeToDocumentStore(state, listener),
    updateRuntime: (runtime: DocumentsRuntime) =>
      updateDocumentStoreRuntime(state, runtime, scheduleSync),
  };
}

function createRegisteredDocumentStore(
  localId: string,
  initialRuntime: DocumentsRuntime,
  persistence: DocumentsPersistence = defaultDocumentsPersistence,
  initialDocumentId: string | null = null,
  initialText = "",
  initialDocumentKind: StoredDocumentKind = DEFAULT_DOCUMENT_KIND,
): DocumentStoreFacade {
  return createDocumentStoreFacade(
    createBackingDocumentStore(
      localId,
      initialRuntime,
      persistence,
      initialDocumentId,
      initialText,
      initialDocumentKind,
    ),
  );
}

export function createDocumentStore(
  localId: string,
  initialRuntime: DocumentsRuntime,
  persistence: DocumentsPersistence = defaultDocumentsPersistence,
  initialDocumentId: string | null = null,
  initialText = "",
  initialDocumentKind: StoredDocumentKind = DEFAULT_DOCUMENT_KIND,
): DocumentStore {
  return createRegisteredDocumentStore(
    localId,
    initialRuntime,
    persistence,
    initialDocumentId,
    initialText,
    initialDocumentKind,
  );
}

export function getOrCreateDocumentStore(
  domainScope: DomainScope,
  localId: string,
  runtime: DocumentsRuntime,
  initialDocumentId: string | null = null,
  initialText = "",
  initialDocumentKind: StoredDocumentKind = DEFAULT_DOCUMENT_KIND,
): DocumentStore {
  const registry = getOrCreateDocumentStoreRegistry(domainScope);
  const existingStore = registry.storesByKey.get(
    resolveDocumentStoreKey(registry, localId, initialDocumentId),
  );
  if (existingStore) {
    registerDocumentStore(
      domainScope,
      localId,
      existingStore,
      initialDocumentId,
    );
    return existingStore;
  }

  const nextStore = createRegisteredDocumentStore(
    localId,
    runtime,
    defaultDocumentsPersistence,
    initialDocumentId,
    initialText,
    initialDocumentKind,
  );
  registerDocumentStore(domainScope, localId, nextStore, initialDocumentId);
  return nextStore;
}

export function primeDocumentStore(
  domainScope: DomainScope,
  localId: string,
  runtime: DocumentsRuntime,
  initialDocumentId: string | null = null,
  initialText = "",
  initialDocumentKind: StoredDocumentKind = DEFAULT_DOCUMENT_KIND,
): DocumentStore {
  const store = getOrCreateDocumentStore(
    domainScope,
    localId,
    runtime,
    initialDocumentId,
    initialText,
    initialDocumentKind,
  );
  store.updateRuntime(runtime);
  return store;
}
