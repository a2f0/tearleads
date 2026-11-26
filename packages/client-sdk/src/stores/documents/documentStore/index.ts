import { DEFAULT_DOCUMENT_KIND } from "../../../data/documents/documentConstants";
import type { StoredDocumentKind } from "../../../data/documents/documentKinds";
import type { DomainScope } from "../../../data/shared/domainScope";
import {
  type DocumentsPersistence,
  defaultDocumentsPersistence,
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
import {
  forwardDocumentStoreLoadedRecord,
  registerDocumentStoreLoadedRecord,
} from "../savedElsewhere";
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
  subscribeToDocumentStore,
} from "./state";
import { describeLoadedDocumentRecord } from "./sync/loadedRecord";
import {
  refreshDocumentStoreSyncLane,
  requestRemoteDocumentStoreSync,
  updateDocumentStoreRuntime,
} from "./sync/storeRuntime";
import {
  captureDocumentStoreRemoteSyncRequestGeneration,
  type DocumentStoreRemoteSyncRequestGeneration,
  didDocumentStoreRemoteSyncRequestComplete,
  hasPendingIndependentDocumentStoreRemoteSync,
  invalidateDocumentStoreRemoteSync,
  isDocumentStoreRemoteSyncBlocked,
  isDocumentStoreRemoteSyncRequestGenerationCurrent,
  registerDocumentStoreRemoteSyncWaiter,
} from "./sync/syncGeneration";

export {
  discardRegisteredDocumentLocalState,
  requestDomainDocumentSync,
  subscribeToPersistedDocuments,
} from "../registry";

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
  registerDocumentStoreLoadedRecord(input.store, () =>
    describeLoadedDocumentRecord(input.state),
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
    options.remoteSyncMode ?? "startup",
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
  forwardDocumentStoreLoadedRecord(facade, backingStore);
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
