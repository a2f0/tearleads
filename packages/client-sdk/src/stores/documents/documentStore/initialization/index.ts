import { mergeVersionVectors } from "@tearleads/loro";
import {
  classifyDatabaseFailure,
  isDatabaseUnavailableError,
  loadPersistedDocumentStoreState,
  retryWhileDatabaseBusy,
} from "../../../../workflows/documents";
import { loadOrganizationSyncPausesBeforeSync } from "../../../../workflows/sync/coordination";
import { runHeldCopyChecks } from "../attachments/heldCopyCheckRun";
import { runDocumentOrphanMaintenance } from "../orphanMaintenance";
import { advancePendingBaseVersion } from "../persistence";
import { noteDocumentStoreWrite } from "../reportWriteFailure";
import {
  type DocumentState,
  type DocumentStoreState,
  EMPTY_DOCUMENT_SNAPSHOT,
  setDocumentSnapshot,
  setReadySnapshot,
} from "../state";
import { createStoredDocument } from "../storedDocument";
import { loadDocumentListingCoverage } from "../sync/listingCoverage";
import { loadDocumentStoreStartupProbe } from "../sync/startupProbeDeferral";
import { captureDocumentStoreSyncGeneration } from "../sync/syncGeneration";
import { createInitialDocumentRecord } from "./createInitialDocumentRecord";
import {
  installPersistedAttachments,
  type LoadedDocumentStoreState,
} from "./initializationAttachments";
import {
  type RestoredHistoryState,
  restoredRemoteTailCoverage,
  restorePersistedDocumentContent,
} from "./initializationHistory";
import {
  healLocalAttachmentDetachState,
  recoverDroppedAttachmentSlots,
} from "./initializationRecovery";

function installPersistedDocumentRecord(
  state: DocumentStoreState,
  record: NonNullable<DocumentStoreState["record"]>,
): void {
  state.record = record;
  state.pullContinuation = record.pullContinuation ?? null;
}

interface RestoredInitialDocumentState {
  activePersistedState: LoadedDocumentStoreState;
  activeRecord: NonNullable<DocumentStoreState["record"]>;
  doc: DocumentState;
  history: RestoredHistoryState | null;
}

async function restoreLoadedInitialDocument(input: {
  initializeGeneration: number;
  nextDoc: DocumentState;
  persistedState: LoadedDocumentStoreState;
  state: DocumentStoreState;
}): Promise<RestoredInitialDocumentState | null> {
  const { initializeGeneration, persistedState, state } = input;
  const record = persistedState.document;
  if (!record) return null;
  const history = await restorePersistedDocumentContent(
    input.nextDoc,
    persistedState.historyRestoreState,
  );
  if (state.localWriteGeneration !== initializeGeneration) return null;
  installPersistedDocumentRecord(state, record);
  return {
    activePersistedState: persistedState,
    activeRecord: record,
    doc: input.nextDoc,
    history,
  };
}

async function restoreOrCreateInitialDocument(input: {
  initializeGeneration: number;
  nextDoc: DocumentState;
  persistedState: LoadedDocumentStoreState;
  state: DocumentStoreState;
}): Promise<RestoredInitialDocumentState | null> {
  const { initializeGeneration, persistedState, state } = input;
  if (persistedState.document) {
    return restoreLoadedInitialDocument(input);
  }
  const created = await createInitialDocumentRecord(state, input.nextDoc);
  if (!created || state.localWriteGeneration !== initializeGeneration) {
    return null;
  }
  const activePersistedState = await loadPersistedDocumentStoreState({
    execSql: state.runtime.infra.execSql,
    localId: state.localId,
    persistence: state.persistence,
  });
  if (state.localWriteGeneration !== initializeGeneration) {
    return null;
  }
  if (!activePersistedState.document) {
    throw new Error("Document creation completed without a durable record");
  }
  const replacementDoc = await createStoredDocument(
    state,
    activePersistedState.document.peerSalt,
  );
  try {
    const restored = await restoreLoadedInitialDocument({
      initializeGeneration,
      nextDoc: replacementDoc,
      persistedState: activePersistedState,
      state,
    });
    if (!restored) replacementDoc.free();
    return restored;
  } catch (error) {
    replacementDoc.free();
    throw error;
  }
}

function restorePendingBaseVersion(input: {
  activeRecord: NonNullable<DocumentStoreState["record"]>;
  doc: DocumentState;
  history: RestoredHistoryState | null;
  state: DocumentStoreState;
}): void {
  const { activeRecord, doc, history, state } = input;
  const markerBase =
    activeRecord.pendingBaseVersion ??
    (activeRecord.snapshotEndVersion.length > 0
      ? activeRecord.snapshotEndVersion
      : null);
  if (markerBase === null) {
    advancePendingBaseVersion(state, doc);
    return;
  }

  const remoteCoverage = restoredRemoteTailCoverage(history);
  state.pendingBaseVersion =
    remoteCoverage.length > 0
      ? mergeVersionVectors([markerBase, ...remoteCoverage])
      : markerBase;
}

interface InitializedDocumentStoreAttempt {
  readonly coveredByListing: boolean;
  readonly restored: RestoredInitialDocumentState;
}

function clearPartialInitialization(state: DocumentStoreState): void {
  if (state.initialized) return;
  const partialDoc = state.doc;
  state.doc = null;
  state.record = null;
  state.pullContinuation = null;
  state.pendingBaseVersion = null;
  state.pendingAttachments = [];
  state.attachmentBlobIdBySlotId = {};
  state.attachmentContentSha256BySlotId = {};
  state.attachmentStorageKeyBySlotId = {};
  if (state.snapshot.ready) {
    setDocumentSnapshot(state, { ...EMPTY_DOCUMENT_SNAPSHOT });
  }
  partialDoc?.free();
}

async function healAndCheckInitialDocument(
  state: DocumentStoreState,
  restored: RestoredInitialDocumentState,
  initializeGeneration: number,
): Promise<InitializedDocumentStoreAttempt | null> {
  const activePersistedState = restored.activePersistedState;
  installPersistedAttachments(state, activePersistedState);

  state.doc = restored.doc;
  // Restore the durable outgoing-delta marker. Re-seeding it to the restored
  // document's version would move it PAST any device-first `deferRemoteSync`
  // op (persisted into the durable history but deliberately left un-enqueued
  // and behind the marker), permanently dropping that op from sync across a
  // restart. When a marker was persisted, restore it so the next edit still
  // re-derives the deferred delta. Only seed for rows that never persisted
  // one, from the RECORD's persisted frontier rather than the restored
  // document: a crash between the tail append and the queue/marker writes can
  // resurrect ops the outgoing queue never durably received, and seeding from
  // the restored document would classify those as covered and orphan them
  // from sync forever.
  restorePendingBaseVersion({
    activeRecord: restored.activeRecord,
    doc: restored.doc,
    history: restored.history,
    state,
  });
  // Heal attachment slots lost to an interrupted attach write before marking
  // ready, so the recovered slots are in the snapshot the editor first renders
  // and are queued for sync. recoverDroppedAttachmentSlots advances the marker
  // again for whatever it re-derives. Both helpers gate every durable write
  // on this generation (validated inside the writes' serialized mutations),
  // so a reset mid-helper cannot repopulate discarded state.
  const writeGeneration = captureDocumentStoreSyncGeneration(
    state,
    restored.doc,
  );
  if (!writeGeneration) {
    return null;
  }
  await recoverDroppedAttachmentSlots(state, restored.doc, writeGeneration);
  if (state.localWriteGeneration !== initializeGeneration) {
    return null;
  }
  await healLocalAttachmentDetachState(
    state,
    restored.doc,
    activePersistedState,
    writeGeneration,
  );
  if (state.localWriteGeneration !== initializeGeneration) {
    return null;
  }
  // What a listing owes the document decides the startup probe below.
  const coveredByListing = await loadDocumentListingCoverage(
    state,
    state.record ?? restored.activeRecord,
    () => state.localWriteGeneration === initializeGeneration,
  );
  if (state.localWriteGeneration !== initializeGeneration) return null;
  return { coveredByListing, restored };
}

async function initializeDocumentStoreAttempt(
  state: DocumentStoreState,
  initializeGeneration: number,
): Promise<InitializedDocumentStoreAttempt | null> {
  const persistedState = await loadPersistedDocumentStoreState({
    execSql: state.runtime.infra.execSql,
    localId: state.localId,
    persistence: state.persistence,
  });
  // A record a peer rebase moved writes on its salted peer.
  const nextDoc = await createStoredDocument(
    state,
    persistedState.document?.peerSalt,
  );
  let returnedDoc: DocumentState | null = null;
  let restoredDoc: DocumentState | null = null;
  try {
    if (state.localWriteGeneration !== initializeGeneration) {
      return null;
    }
    await loadOrganizationSyncPausesBeforeSync({
      domainScope: state.runtime.state.domainScope,
      execSql: state.runtime.infra.execSql,
      log: state.runtime.util.log,
    });
    if (state.localWriteGeneration !== initializeGeneration) {
      return null;
    }
    // Only readers opened this store: leave the record missing until a join.
    // Ending in this same step means a creator that joins later starts its own
    // initialization instead of waiting on this one.
    if (!persistedState.document && state.createIfMissing === false) {
      state.initializePromise = null;
      return null;
    }
    const restored = await restoreOrCreateInitialDocument({
      initializeGeneration,
      nextDoc,
      persistedState,
      state,
    });
    if (!restored) {
      if (state.localWriteGeneration === initializeGeneration) {
        state.initializePromise = null;
      }
      return null;
    }
    restoredDoc = restored.doc;
    const result = await healAndCheckInitialDocument(
      state,
      restored,
      initializeGeneration,
    );
    if (result) returnedDoc = result.restored.doc;
    return result;
  } finally {
    if (nextDoc !== returnedDoc && nextDoc !== state.doc) {
      nextDoc.free();
    }
    if (
      restoredDoc &&
      restoredDoc !== returnedDoc &&
      restoredDoc !== nextDoc &&
      restoredDoc !== state.doc
    ) {
      restoredDoc.free();
    }
    if (!returnedDoc && state.localWriteGeneration === initializeGeneration) {
      clearPartialInitialization(state);
    }
  }
}

function discardStaleLoadedAttempt(
  state: DocumentStoreState,
  loaded: InitializedDocumentStoreAttempt | null,
  initializeGeneration: number,
): void {
  if (!loaded) return;
  if (state.localWriteGeneration === initializeGeneration) {
    clearPartialInitialization(state);
    return;
  }
  if (loaded.restored.doc !== state.doc) {
    loaded.restored.doc.free();
  }
}

async function initializeDocumentStore(
  state: DocumentStoreState,
  scheduleSync: () => void,
) {
  if (state.runtime.infra.dbStatus !== "ready") {
    return;
  }

  // A store reset while this fire-and-forget initialization is loading (a
  // runtime swap, or a local-edits discard that re-seeds the persisted rows)
  // must win: assigning the state loaded BEFORE the reset would bring the
  // replaced record and doc back to life. Every reset bumps the local write
  // generation, so a stale capture here aborts before each assignment batch.
  const initializeGeneration = state.localWriteGeneration;
  const isCurrent = () =>
    state.localWriteGeneration === initializeGeneration &&
    state.runtime.infra.dbStatus === "ready";

  // Each step before `state.initialized = true` is safe to repeat if the
  // SQLite worker refuses a statement behind another tab's transaction: reads
  // are pure, create-only birth adopts any committed row on retry, and
  // attachment recovery / detach healing skip work already committed.
  let loaded: InitializedDocumentStoreAttempt | null;
  try {
    loaded = await retryWhileDatabaseBusy(
      () => initializeDocumentStoreAttempt(state, initializeGeneration),
      {
        isCurrent,
        onBusy: () => {
          noteDocumentStoreWrite(
            state,
            "Documents: initialization delayed behind another tab's database transaction",
          );
        },
      },
    );
  } catch (error) {
    // A reset or database teardown during a busy pause supersedes this
    // initialization; return quietly instead of reporting a stale busy error.
    // Non-busy errors (e.g. identity rebase during recovery) still propagate.
    if (classifyDatabaseFailure(error) === "busy" && !isCurrent()) {
      return;
    }
    if (state.localWriteGeneration === initializeGeneration) {
      clearPartialInitialization(state);
    }
    throw error;
  }
  if (!loaded || !isCurrent()) {
    discardStaleLoadedAttempt(state, loaded, initializeGeneration);
    return;
  }

  const { coveredByListing, restored } = loaded;
  state.initialized = true;
  state.initializePromise = null;
  setReadySnapshot(state, restored.doc, false);
  void runHeldCopyChecks(state);

  // Websocket invalidations are intentionally session-local. A process can
  // stop before receiving a peer device's update event, and no event survives
  // the restart to distinguish a clean local snapshot from a stale one. Probe
  // each opened remote document once after loading it, unless a container
  // listing covers it (`listingCoverage.ts`). A connect attempt in flight arms
  // a later probe on its acknowledgement, which covers this one, so the
  // startup probe waits on that attempt.
  loadDocumentStoreStartupProbe(
    state,
    Boolean(restored.activeRecord.documentId),
    coveredByListing,
  );
  scheduleSync();
  void runDocumentOrphanMaintenance(state);
}

export function ensureDocumentStoreInitialized(
  state: DocumentStoreState,
  scheduleSync: () => void,
) {
  if (
    state.initialized ||
    state.initializePromise ||
    state.runtime.infra.dbStatus !== "ready"
  ) {
    return;
  }

  const initializePromise = initializeDocumentStore(state, scheduleSync).then(
    () => {
      if (state.initializePromise === initializePromise) {
        state.initializePromise = null;
      }
    },
    (error: unknown) => {
      if (state.initializePromise === initializePromise) {
        state.initializePromise = null;
        // A caller that deferred the birth for its attach may give up once
        // opening fails; never leave its durable birth holding sync. No attach
        // has reached a live doc yet, so lifting the hold ships nothing unsafe.
        state.deferInitialUpdate = false;
      }

      if (isDatabaseUnavailableError(error)) {
        return;
      }

      throw error;
    },
  );
  state.initializePromise = initializePromise;
  void initializePromise.catch(() => undefined);
}

export async function awaitInitializationForSync(state: DocumentStoreState) {
  if (!state.initializePromise) {
    return state.initialized;
  }

  try {
    await state.initializePromise;
    return state.initialized;
  } catch (error) {
    if (isDatabaseUnavailableError(error)) {
      return false;
    }

    throw error;
  }
}

export async function ensureDocumentStoreReady(
  state: DocumentStoreState,
  scheduleSync: () => void,
): Promise<boolean> {
  ensureDocumentStoreInitialized(state, scheduleSync);

  if (state.initialized) {
    return true;
  }

  if (!state.initializePromise) {
    return false;
  }

  return awaitInitializationForSync(state);
}
