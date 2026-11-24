import { DEFAULT_DOCUMENT_KIND } from "../../../data/documents/documentConstants";
import type { StoredDocumentKind } from "../../../data/documents/documentKinds";
import type { DomainScope } from "../../../data/shared/domainScope";
import {
  createDocumentProjectionUserKeyResolver,
  type DocumentsPersistence,
  defaultDocumentsPersistence,
  didDocumentProjectionKeyRuntimeChange,
  didRegainSyncPrerequisites,
  requestDocumentSyncLaneAndWait,
} from "../../../workflows/documents";
import {
  createDocumentStoreFacade,
  emitPersistedDocument,
  forwardDocumentStoreOpenJoin,
  getOrCreateDocumentStoreRegistry,
  joinDocumentStoreOpen,
  registerDocumentStore,
  registerDocumentStoreIdentity,
  registerDocumentStoreOpenJoin,
  registerDocumentStoreSupersedeHandler,
  requestDocumentStoreSync,
  resolveDocumentStoreKey,
} from "../registry";
import type {
  DocumentAttachmentUpload,
  DocumentStore,
  DocumentStoreFacade,
  DocumentStoreOpenOptions,
  DocumentsRuntime,
} from "../types";
import {
  attachFilesToDocumentStore,
  replaceAttachmentInDocumentStore,
} from "./attachments";
import { removeAttachmentFromDocumentStore } from "./attachments/attachmentRemoval";
import { checkHeldAttachmentCopies } from "./attachments/heldCopyCheckRun";
import { discardDocumentStoreLocalState } from "./discard";
import { restoreDocumentStoreContent } from "./history/restoreContent";
import {
  ensureDocumentStoreInitialized,
  ensureDocumentStoreReady,
  relinkDocumentStore,
} from "./initialization";
import { applyDocumentStoreCreationOptions } from "./initialization/initialContent";
import { joinBackingDocumentStoreOpen } from "./initialization/openJoin";
import { registerInternalDocumentRelink } from "./internalRelink";
import { countQueuedWrite } from "./localWriteQueue";
import { setDocumentStructuredFields, setDocumentText } from "./mutations";
import { assertLoadedDocumentStoreCanRotate } from "./rotation/rotationPreflight";
import { createRowWrites } from "./rows";
import {
  createDocumentStoreState,
  type DocumentStoreState,
  refreshAttachabilitySnapshot,
  resetDocumentStore,
  subscribeToDocumentStore,
} from "./state";
import { registerDocumentStoreSyncLane } from "./sync";
import { logRevalidationScheduled } from "./sync/remoteRevalidationTelemetry";
import { settleDeferredStartupProbe } from "./sync/startupProbeDeferral";
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
} from "./sync/syncGeneration";
import { handleDocumentRemoteEvents } from "./sync/syncRemoteSignals";

export {
  discardRegisteredDocumentLocalState,
  requestDomainDocumentSync,
  subscribeToPersistedDocuments,
} from "../registry";

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
    settleDeferredStartupProbe(state, serverEventsReconnected, scheduleSync);
    if (serverEventsReconnected) {
      // The invalidation stream is lossy while disconnected. Once the server
      // has acknowledged this socket's authoritative interest declaration,
      // every already-open remote document needs one HTTP probe to cover peer
      // writes made during the gap. This also closes iOS background/resume reconnects where the
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
  let releaseWaiter: (() => boolean) | null = null;
  const releaseRemoteSyncWaiter = (invalidate: boolean) => {
    const releasedLastWaiter = releaseWaiter?.() ?? false;
    if (
      invalidate &&
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
  };
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
      releaseWaiter = registerDocumentStoreRemoteSyncWaiter(
        state,
        requestGeneration,
      );
      requestedSignalSequence = requestRemoteDocumentStoreSync(
        state,
        scheduleSync,
        "waiter",
      );
    },
    onInvalidated: () => releaseRemoteSyncWaiter(true),
    signal,
  }).then(
    (completed) => {
      releaseRemoteSyncWaiter(!completed);
      return completed;
    },
    (error: unknown) => {
      releaseRemoteSyncWaiter(true);
      throw error;
    },
  );
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

// The internal hooks the registry reaches a backing store through.
function registerBackingStoreHooks(input: {
  scheduleSync: () => void;
  state: DocumentStoreState;
  store: DocumentStore;
  withLiveSyncLane: ReturnType<typeof createLiveSyncLaneRequest>;
}): DocumentStore {
  registerDocumentStoreSupersedeHandler(input.store, () => {
    input.state.relinkedElsewhere = true;
  });
  registerDocumentStoreOpenJoin(input.store, (open) =>
    joinBackingDocumentStoreOpen(input, open),
  );
  registerInternalDocumentRelink(input.store, (relinkInput, commitSideEffect) =>
    input.withLiveSyncLane(() =>
      relinkDocumentStore(
        input.state,
        relinkInput,
        input.scheduleSync,
        commitSideEffect,
      ),
    ),
  );
  return input.store;
}

function createBackingStoreContext(
  localId: string,
  runtime: DocumentsRuntime,
  persistence: DocumentsPersistence,
  documentId: string | null,
  text: string,
  documentKind: StoredDocumentKind,
  options: DocumentStoreOpenOptions,
) {
  const state = createDocumentStoreState(
    localId,
    runtime,
    persistence,
    {
      emitPersistedDocument,
      registerDocumentIdentity: registerDocumentStoreIdentity,
    },
    documentId,
    text,
    documentKind,
    (options.remoteSyncMode ?? "startup") === "startup",
  );
  applyDocumentStoreCreationOptions(state, options);
  refreshDocumentStoreSyncLane(state);
  const scheduleSync = () => requestDocumentStoreSync(state);
  return {
    scheduleSync,
    state,
    withLiveSyncLane: createLiveSyncLaneRequest(state),
  };
}

function createBackingDocumentStore(
  localId: string,
  initialRuntime: DocumentsRuntime,
  persistence: DocumentsPersistence = defaultDocumentsPersistence,
  initialDocumentId: string | null = null,
  initialText = "",
  initialDocumentKind: StoredDocumentKind = DEFAULT_DOCUMENT_KIND,
  openOptions: DocumentStoreOpenOptions = {},
): DocumentStore {
  const context = createBackingStoreContext(
    localId,
    initialRuntime,
    persistence,
    initialDocumentId,
    initialText,
    initialDocumentKind,
    openOptions,
  );

  const { scheduleSync, state, withLiveSyncLane } = context;
  // Local writes count as queued from the call, readiness wait included.
  const liveWrite = <Result>(write: () => Promise<Result>) =>
    withLiveSyncLane(() => countQueuedWrite(state, write()));
  const store: DocumentStore = {
    ...createRowWrites(state, scheduleSync, liveWrite),
    assertCanRotateContentKey: (proof) =>
      withLiveSyncLane(() =>
        assertLoadedDocumentStoreCanRotate(state, scheduleSync, proof),
      ),
    attachFiles: (files: ReadonlyArray<DocumentAttachmentUpload>) =>
      liveWrite(() => attachFilesToDocumentStore(state, scheduleSync, files)),
    checkHeldAttachments: () =>
      withLiveSyncLane(() =>
        checkHeldAttachmentCopies(state, () =>
          ensureDocumentStoreReady(state, scheduleSync),
        ),
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
    hasQueuedWrites: () => state.queuedWrites > 0,
    hasUnsavedLocalEdits: () => state.unsavedLocalEdits,
    removeAttachment: (slotId: string) =>
      liveWrite(() =>
        removeAttachmentFromDocumentStore(state, scheduleSync, slotId),
      ),
    replaceAttachment: (slotId: string, file: DocumentAttachmentUpload) =>
      liveWrite(() =>
        replaceAttachmentInDocumentStore(state, scheduleSync, slotId, file),
      ),
    requestRemoteSync: () =>
      withLiveSyncLane(() =>
        requestRemoteDocumentStoreSync(state, scheduleSync),
      ),
    restoreContent: (content, options) =>
      liveWrite(() =>
        restoreDocumentStoreContent(state, scheduleSync, content, options),
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
      liveWrite(() =>
        setDocumentStructuredFields(state, scheduleSync, kind, patch, options),
      ),
    setText: (value: string) =>
      liveWrite(() => setDocumentText(state, scheduleSync, value)),
    subscribe: (listener) => subscribeToDocumentStore(state, listener),
    updateRuntime: (runtime: DocumentsRuntime) =>
      updateDocumentStoreRuntime(state, runtime, scheduleSync),
  };
  return registerBackingStoreHooks({ ...context, store });
}

export function createDocumentStore(
  localId: string,
  initialRuntime: DocumentsRuntime,
  persistence: DocumentsPersistence = defaultDocumentsPersistence,
  initialDocumentId: string | null = null,
  initialText = "",
  initialDocumentKind: StoredDocumentKind = DEFAULT_DOCUMENT_KIND,
  options: DocumentStoreOpenOptions = {},
): DocumentStoreFacade {
  const backingStore = createBackingDocumentStore(
    localId,
    initialRuntime,
    persistence,
    initialDocumentId,
    initialText,
    initialDocumentKind,
    options,
  );
  const facade = createDocumentStoreFacade(backingStore);
  forwardDocumentStoreOpenJoin(facade, backingStore);
  return facade;
}

export function getOrCreateDocumentStore(
  domainScope: DomainScope,
  localId: string,
  runtime: DocumentsRuntime,
  initialDocumentId: string | null = null,
  initialText = "",
  initialDocumentKind: StoredDocumentKind = DEFAULT_DOCUMENT_KIND,
  options: DocumentStoreOpenOptions = {},
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
    joinDocumentStoreOpen(existingStore, {
      initialDocumentKind,
      initialText,
      options,
    });
    return existingStore;
  }

  const nextStore = createDocumentStore(
    localId,
    runtime,
    defaultDocumentsPersistence,
    initialDocumentId,
    initialText,
    initialDocumentKind,
    options,
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
  options: DocumentStoreOpenOptions = {},
): DocumentStore {
  const store = getOrCreateDocumentStore(
    domainScope,
    localId,
    runtime,
    initialDocumentId,
    initialText,
    initialDocumentKind,
    options,
  );
  store.updateRuntime(runtime);
  return store;
}
