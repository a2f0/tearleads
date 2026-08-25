import { DEFAULT_DOCUMENT_KIND } from "../../data/documents/documentConstants";
import type { StoredDocumentKind } from "../../data/documents/documentKinds";
import type { DomainScope } from "../../data/domainScope";
import {
  createDocumentProjectionUserKeyResolver,
  type DocumentsPersistence,
  defaultDocumentsPersistence,
  didDocumentProjectionKeyRuntimeChange,
  didRegainSyncPrerequisites,
  requestDocumentSyncLaneAndWait,
} from "../../workflows/documents";
import {
  attachFilesToDocumentStore,
  removeAttachmentFromDocumentStore,
  replaceAttachmentInDocumentStore,
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
import { registerDocumentStoreSyncLane } from "./documentStore/sync";
import {
  allowDocumentStoreRemoteSync,
  captureDocumentStoreRemoteSyncRequestGeneration,
  captureDocumentStoreSyncLaneGeneration,
  type DocumentStoreRemoteSyncRequestGeneration,
  type DocumentStoreSyncLaneGeneration,
  didDocumentStoreRemoteSyncRequestComplete,
  hasPendingIndependentDocumentStoreRemoteSync,
  invalidateDocumentStoreRemoteSync,
  invalidateDocumentStoreSyncLane,
  isDocumentStoreRemoteSyncBlocked,
  isDocumentStoreRemoteSyncRequestGenerationCurrent,
  markDocumentStoreRemoteSyncPending,
  registerDocumentStoreRemoteSyncWaiter,
} from "./documentStore/syncGeneration";
import { handleDocumentRemoteEvents } from "./documentStore/syncRemoteSignals";
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

function refreshDocumentStoreSyncLane(
  state: DocumentStoreState,
  force = false,
): void {
  if (!force && state.syncLane && !state.syncLane.isDisposed?.()) {
    return;
  }
  if (state.syncLane) {
    invalidateDocumentStoreSyncLane(state);
  }
  let syncLaneGeneration: DocumentStoreSyncLaneGeneration | null = null;
  state.syncLane = registerDocumentStoreSyncLane(
    state,
    () => syncLaneGeneration,
  );
  syncLaneGeneration = captureDocumentStoreSyncLaneGeneration(state);
}

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
  refreshDocumentStoreSyncLane(state, domainScopeChanged);
  if (domainScopeChanged) {
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
  owner: "independent" | "waiter" = "independent",
): number {
  allowDocumentStoreRemoteSync(state);
  const signalSequence = markDocumentStoreRemoteSyncPending(state, owner);
  scheduleSync();
  return signalSequence;
}

function requestOrdinaryDocumentStoreSync(
  state: DocumentStoreState,
  scheduleSync: () => void,
): void {
  // A normal UI reopen is a fresh owner for remote-only work. It may recover
  // a probe that an earlier, now-unmounted owner aborted.
  if (isDocumentStoreRemoteSyncBlocked(state)) {
    requestRemoteDocumentStoreSync(state, scheduleSync);
    return;
  }
  scheduleSync();
}

function requestRemoteDocumentStoreSyncAndWait(
  state: DocumentStoreState,
  scheduleSync: () => void,
  signal?: AbortSignal,
): Promise<boolean> {
  let requestGeneration: DocumentStoreRemoteSyncRequestGeneration | null = null;
  let requestedSignalSequence = 0;
  const releaseWaiter = registerDocumentStoreRemoteSyncWaiter(state);
  // A coordinator can be disposed and recreated while this same-scope store
  // remains registered. Refresh its handle before requesting work.
  refreshDocumentStoreSyncLane(state);
  return requestDocumentSyncLaneAndWait({
    didCompleteRequest: () =>
      requestGeneration !== null &&
      didDocumentStoreRemoteSyncRequestComplete(
        state,
        requestGeneration,
        requestedSignalSequence,
      ),
    domainScope: state.runtime.state.domainScope,
    localId: state.localId,
    request: () => {
      requestGeneration =
        captureDocumentStoreRemoteSyncRequestGeneration(state);
      requestedSignalSequence = requestRemoteDocumentStoreSync(
        state,
        scheduleSync,
        "waiter",
      );
    },
    onInvalidated: () => {
      const releasedLastWaiter = releaseWaiter();
      if (
        releasedLastWaiter &&
        requestGeneration !== null &&
        isDocumentStoreRemoteSyncRequestGenerationCurrent(
          state,
          requestGeneration,
        ) &&
        !hasPendingIndependentDocumentStoreRemoteSync(state)
      ) {
        invalidateDocumentStoreRemoteSync(state);
      }
    },
    signal,
  }).finally(() => {
    releaseWaiter();
  });
}

async function assertBackingDocumentStoreCanRotate(
  state: DocumentStoreState,
  scheduleSync: () => void,
) {
  if (!(await ensureDocumentStoreReady(state, scheduleSync)) || !state.doc) {
    throw new Error(
      "Document must finish loading before its content key can rotate",
    );
  }
  return assertDocumentStoreCanRotateContentKey(state);
}

async function discardBackingDocumentStoreLocalState(
  state: DocumentStoreState,
  scheduleSync: () => void,
  expectedDocumentId: string,
) {
  try {
    return await discardDocumentStoreLocalState(state, expectedDocumentId);
  } finally {
    // Restart hydration whenever the attempt reset the store. This runs outside
    // its identity-chained task because initialization also chains writes.
    ensureDocumentStoreInitialized(state, scheduleSync);
    scheduleSync();
  }
}

function createLiveSyncLaneRequest(state: DocumentStoreState) {
  return <Result>(request: () => Result): Result => {
    refreshDocumentStoreSyncLane(state);
    return request();
  };
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
  refreshDocumentStoreSyncLane(state);
  const scheduleSync = () => requestDocumentStoreSync(state);
  const withLiveSyncLane = createLiveSyncLaneRequest(state);

  return {
    addRow: (fields) =>
      withLiveSyncLane(() =>
        addRowToDocumentStore(state, scheduleSync, fields),
      ),
    assertCanRotateContentKey: () =>
      withLiveSyncLane(() =>
        assertBackingDocumentStoreCanRotate(state, scheduleSync),
      ),
    attachFiles: (files: ReadonlyArray<DocumentAttachmentUpload>) =>
      withLiveSyncLane(() =>
        attachFilesToDocumentStore(state, scheduleSync, files),
      ),
    discardLocalState: (expectedDocumentId: string) =>
      withLiveSyncLane(() =>
        discardBackingDocumentStoreLocalState(
          state,
          scheduleSync,
          expectedDocumentId,
        ),
      ),
    ensureInitialized: () =>
      withLiveSyncLane(() => ensureDocumentStoreReady(state, scheduleSync)),
    getSnapshot: () => state.snapshot,
    removeAttachment: (slotId: string) =>
      withLiveSyncLane(() =>
        removeAttachmentFromDocumentStore(state, scheduleSync, slotId),
      ),
    removeRow: (id) =>
      withLiveSyncLane(() =>
        removeRowFromDocumentStore(state, scheduleSync, id),
      ),
    replaceAttachment: (slotId: string, file: DocumentAttachmentUpload) =>
      withLiveSyncLane(() =>
        replaceAttachmentInDocumentStore(state, scheduleSync, slotId, file),
      ),
    requestRemoteSync: () =>
      withLiveSyncLane(() =>
        requestRemoteDocumentStoreSync(state, scheduleSync),
      ),
    requestRemoteSyncAndWait: (signal) =>
      requestRemoteDocumentStoreSyncAndWait(state, scheduleSync, signal),
    requestSync: () =>
      withLiveSyncLane(() =>
        requestOrdinaryDocumentStoreSync(state, scheduleSync),
      ),
    relink: (input) =>
      withLiveSyncLane(() => relinkDocumentStore(state, input, scheduleSync)),
    setStructuredFields: (kind, patch, options) =>
      withLiveSyncLane(() =>
        setDocumentStructuredFields(state, scheduleSync, kind, patch, options),
      ),
    setText: (value: string) =>
      withLiveSyncLane(() => setDocumentText(state, scheduleSync, value)),
    subscribe: (listener: () => void) =>
      subscribeToDocumentStore(state, listener),
    updateRowFields: (id, patch) =>
      withLiveSyncLane(() =>
        updateRowInDocumentStore(state, scheduleSync, id, patch),
      ),
    updateRuntime: (runtime: DocumentsRuntime) =>
      updateDocumentStoreRuntime(state, runtime, scheduleSync),
  };
}

export function createDocumentStore(
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

  const nextStore = createDocumentStore(
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
