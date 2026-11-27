import { mergeVersionVectors } from "@tearleads/loro";
import type { DocumentSummary } from "../../../../data/documents/documentSummary";
import {
  classifyDatabaseFailure,
  isDatabaseUnavailableError,
  loadPersistedDocumentStoreState,
  retryWhileDatabaseBusy,
} from "../../../../workflows/documents";
import { loadOrganizationSyncPausesBeforeSync } from "../../../../workflows/sync/coordination";
import type { DocumentStoreRelinkInput } from "../../types";
import { runHeldCopyChecks } from "../attachments/heldCopyCheckRun";
import { chainIdentityWrite } from "../identityWriteChain";
import type { DocumentRelinkCommitSideEffect } from "../internalRelink";
import { runDocumentOrphanMaintenance } from "../orphanMaintenance";
import {
  advancePendingBaseVersion,
  documentSummaryFromRecord,
  persistDocument,
} from "../persistence";
import { noteDocumentStoreWrite } from "../reportWriteFailure";
import {
  type DocumentState,
  type DocumentStoreState,
  setReadySnapshot,
} from "../state";
import { createStoredDocument } from "../storedDocument";
import { loadDocumentListingCoverage } from "../sync/listingCoverage";
import { loadDocumentStoreStartupProbe } from "../sync/startupProbeDeferral";
import {
  captureDocumentStoreSyncGeneration,
  invalidateDocumentStoreRemoteSync,
  isDocumentStoreSyncGenerationCurrent,
} from "../sync/syncGeneration";
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
import { relinkRecordPatch } from "./relinkRecordPatch";

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
  return restoreLoadedInitialDocument({
    initializeGeneration,
    nextDoc: replacementDoc,
    persistedState: activePersistedState,
    state,
  });
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
  if (state.localWriteGeneration !== initializeGeneration) {
    return;
  }
  await loadOrganizationSyncPausesBeforeSync({
    domainScope: state.runtime.state.domainScope,
    execSql: state.runtime.infra.execSql,
    log: state.runtime.util.log,
  });
  if (state.localWriteGeneration !== initializeGeneration) {
    return;
  }
  // Only readers opened this store: leave the record missing until a join.
  // Ending in this same step means a creator that joins later starts its own
  // initialization instead of waiting on this one.
  if (!persistedState.document && state.createIfMissing === false) {
    state.initializePromise = null;
    return;
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
    return;
  }
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
    return;
  }
  await recoverDroppedAttachmentSlots(state, restored.doc, writeGeneration);
  if (state.localWriteGeneration !== initializeGeneration) {
    return;
  }
  await healLocalAttachmentDetachState(
    state,
    restored.doc,
    activePersistedState,
    writeGeneration,
  );
  if (state.localWriteGeneration !== initializeGeneration) {
    return;
  }
  // What a listing owes the document decides the startup probe below.
  const coveredByListing = await loadDocumentListingCoverage(
    state,
    state.record ?? restored.activeRecord,
    () => state.localWriteGeneration === initializeGeneration,
  );
  if (state.localWriteGeneration !== initializeGeneration) return;
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

  const initializeGeneration = state.localWriteGeneration;
  const isCurrentInitialization = () =>
    state.localWriteGeneration === initializeGeneration &&
    state.runtime.infra.dbStatus === "ready";
  // Every SQLite call inside initializeDocumentStore is read-only or idempotent
  // (create-only birth + recovery helpers), so retrying a busy refusal in place
  // avoids dropping the mutation call that triggered initialization (#3373).
  const initializePromise = retryWhileDatabaseBusy(
    () => initializeDocumentStore(state, scheduleSync),
    {
      isCurrent: isCurrentInitialization,
      onBusy: () => {
        noteDocumentStoreWrite(
          state,
          `Documents: retrying initialization of ${state.localId} behind another tab's database transaction`,
        );
      },
    },
  ).catch((error: unknown) => {
    if (state.initializePromise === initializePromise) {
      state.initializePromise = null;
    }
    if (state.localWriteGeneration === initializeGeneration) {
      // A caller that deferred the birth for its attach may give up once
      // opening fails; never leave its durable birth holding sync. No attach
      // has reached a live doc yet, so lifting the hold ships nothing unsafe.
      state.deferInitialUpdate = false;
    }

    if (
      isDatabaseUnavailableError(error) ||
      (classifyDatabaseFailure(error) === "busy" && !isCurrentInitialization())
    ) {
      return;
    }

    throw error;
  });
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

export async function relinkDocumentStore(
  state: DocumentStoreState,
  input: DocumentStoreRelinkInput,
  scheduleSync: () => void,
  commitSideEffect?: DocumentRelinkCommitSideEffect,
): Promise<DocumentSummary | null> {
  if (
    input.stillCurrent?.() === false ||
    !(await ensureDocumentStoreReady(state, scheduleSync)) ||
    input.stillCurrent?.() === false ||
    !state.doc
  ) {
    return null;
  }
  const currentDoc = state.doc;
  const generation = captureDocumentStoreSyncGeneration(state, currentDoc);
  if (!generation) return null;
  // Read the record and persist on the identity-write chain so an in-flight
  // eager create cannot interleave: a create that captured a null identity
  // before its network round trip would otherwise write the derived documentId
  // over the one this relink assigns.
  const persisted = await chainIdentityWrite(state, async () => {
    if (!isDocumentStoreSyncGenerationCurrent(state, generation)) return null;
    const currentDocumentId = state.record?.documentId ?? null;
    const patch = relinkRecordPatch(state.record, input);

    // Relink rewrites access/identity metadata, not content. If it lands while
    // the user is mid-edit, re-deriving text/structured fields from the
    // (possibly lagging) doc would republish a stale read over the live
    // optimistic snapshot and drop in-flight keystrokes; preserve the snapshot
    // like the keystroke and sync persists do.
    // A prior chained write may have cleared this store (resurrect-guard
    // refusal): persisting the captured doc against a null record would
    // resurrect the document as a create. The identity check runs inside
    // the chain, after every earlier write settled.
    if (!isDocumentStoreSyncGenerationCurrent(state, generation)) {
      return null;
    }
    const result = await persistDocument(
      state,
      currentDoc,
      patch,
      {
        preserveSnapshotStructuredFields: true,
        preserveSnapshotText: true,
        stillCurrent: input.stillCurrent,
      },
      generation,
      commitSideEffect,
    );
    if (result && currentDocumentId !== input.documentId) {
      state.writerProjection = null;
      invalidateDocumentStoreRemoteSync(state);
    }
    return result;
  });
  // A refused persist means the durable row vanished mid-relink (resurrect
  // guard); there is no summary to report.
  if (!persisted) {
    return null;
  }
  if (persisted.updatedAt === undefined) {
    return null;
  }
  return documentSummaryFromRecord(
    persisted.record,
    persisted.updatedAt,
    state.runtime.infra.documentProjectors,
  );
}
