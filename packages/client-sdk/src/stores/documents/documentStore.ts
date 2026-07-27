import { DEFAULT_DOCUMENT_KIND } from "../../data/documents/documentConstants";
import type { StoredDocumentKind } from "../../data/documents/documentKinds";
import type { DomainScope } from "../../data/domainScope";
import {
  createDocumentProjectionUserKeyResolver,
  type DocumentsPersistence,
  defaultDocumentsPersistence,
  didDocumentProjectionKeyRuntimeChange,
  didRegainSyncPrerequisites,
} from "../../workflows/documents";
import {
  attachFilesToDocumentStore,
  removeAttachmentFromDocumentStore,
  replaceAttachmentInDocumentStore,
  setAttachmentInDocumentStore,
} from "./documentStore/attachments";
import { discardDocumentStoreLocalState } from "./documentStore/discard";
import {
  ensureDocumentStoreInitialized,
  ensureDocumentStoreReady,
  relinkDocumentStore,
} from "./documentStore/initialization";
import {
  setDocumentStructuredFields,
  setDocumentText,
} from "./documentStore/mutations";
import { logRevalidationScheduled } from "./documentStore/remoteRevalidationTelemetry";
import { assertDocumentStoreCanRotateContentKey } from "./documentStore/rotation";
import {
  addRowToDocumentStore,
  removeRowFromDocumentStore,
  updateRowInDocumentStore,
} from "./documentStore/rows";
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
  discardRegisteredDocumentLocalState,
  requestDomainDocumentSync,
  subscribeToPersistedDocuments,
} from "./registry";

function updateDocumentStoreRuntime(
  state: DocumentStoreState,
  nextRuntime: DocumentsRuntime,
  scheduleSync: () => void,
) {
  const previousRuntime = state.runtime;
  const serverEventsReconnected =
    (nextRuntime.state.serverEventsConnectionGeneration ?? 0) >
    (previousRuntime.state.serverEventsConnectionGeneration ?? 0);
  const domainScopeChanged =
    previousRuntime.state.domainScope !== nextRuntime.state.domainScope;
  const projectionKeyRuntimeChanged = didDocumentProjectionKeyRuntimeChange(
    previousRuntime,
    nextRuntime,
  );
  if (projectionKeyRuntimeChanged) {
    state.resolveProjectionUserKey =
      createDocumentProjectionUserKeyResolver(nextRuntime);
    state.writerProjection = null;
  }
  state.runtime = nextRuntime;
  if (domainScopeChanged) {
    state.syncLane = registerDocumentStoreSyncLane(state);
    state.locallyAcceptedUpdateIds = new Set();
    state.remoteUpdatePending = false;
    state.writerProjection = null;
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

  if (state.snapshot.ready) {
    if (serverEventsReconnected) {
      // The invalidation stream is lossy while disconnected. Once the server
      // has restored this session's interest baseline, every already-open
      // remote document needs one HTTP probe to cover peer writes made during
      // the gap. This also closes iOS background/resume reconnects where the
      // native network source remained online throughout.
      requestRemoteDocumentStoreSync(state, scheduleSync);
      logRevalidationScheduled(state.runtime, "reconnect");
    } else if (didRegainSyncPrerequisites(previousRuntime, state.runtime)) {
      scheduleSync();
    }
  }
}

function requestRemoteDocumentStoreSync(
  state: DocumentStoreState,
  scheduleSync: () => void,
): void {
  state.remoteUpdatePending = true;
  state.remoteUpdateSignalSeq += 1;
  scheduleSync();
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
    addRow: (fields) => addRowToDocumentStore(state, scheduleSync, fields),
    assertCanRotateContentKey: async () => {
      if (
        !(await ensureDocumentStoreReady(state, scheduleSync)) ||
        !state.doc
      ) {
        throw new Error(
          "Document must finish loading before its content key can rotate",
        );
      }
      return assertDocumentStoreCanRotateContentKey(state);
    },
    attachFiles: (files: ReadonlyArray<DocumentAttachmentUpload>) =>
      attachFilesToDocumentStore(state, scheduleSync, files),
    discardLocalState: async (expectedDocumentId: string) => {
      try {
        return await discardDocumentStoreLocalState(state, expectedDocumentId);
      } finally {
        // Restart hydration whenever the attempt reset the store — success
        // re-pulls the shell, and a refusal or failure reloads the surviving
        // rows. A no-op when the store was never reset. This runs outside
        // the discard's identity-chained task because initialization chains
        // identity writes of its own and would deadlock inside it.
        ensureDocumentStoreInitialized(state, scheduleSync);
        scheduleSync();
      }
    },
    ensureInitialized: () => ensureDocumentStoreReady(state, scheduleSync),
    getSnapshot: () => state.snapshot,
    removeAttachment: (slotId: string) =>
      removeAttachmentFromDocumentStore(state, scheduleSync, slotId),
    removeRow: (id) => removeRowFromDocumentStore(state, scheduleSync, id),
    setAttachment: (slotId: string, file: DocumentAttachmentUpload) =>
      setAttachmentInDocumentStore(state, scheduleSync, slotId, file),
    replaceAttachment: (slotId: string, file: DocumentAttachmentUpload) =>
      replaceAttachmentInDocumentStore(state, scheduleSync, slotId, file),
    requestRemoteSync: () =>
      requestRemoteDocumentStoreSync(state, scheduleSync),
    requestSync: () => scheduleSync(),
    relink: (input) => relinkDocumentStore(state, input, scheduleSync),
    setStructuredFields: (kind, patch, options) =>
      setDocumentStructuredFields(state, scheduleSync, kind, patch, options),
    setText: (value: string) => setDocumentText(state, scheduleSync, value),
    subscribe: (listener: () => void) =>
      subscribeToDocumentStore(state, listener),
    updateRowFields: (id, patch) =>
      updateRowInDocumentStore(state, scheduleSync, id, patch),
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

export function openDocumentStore(
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
