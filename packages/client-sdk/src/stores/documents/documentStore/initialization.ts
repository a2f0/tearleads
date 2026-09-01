import { bytesToBase64 } from "@tearleads/encoding";
import {
  encodeVersionVector,
  exportAllUpdates,
  exportFullHistorySnapshot,
  mergeVersionVectors,
} from "@tearleads/loro";
import {
  DEFAULT_DOCUMENT_ACCESS_EPOCH,
  DEFAULT_DOCUMENT_KIND,
} from "../../../data/documents/documentConstants";
import {
  initializeStoredDocumentKind,
  readStoredDocumentState,
} from "../../../data/documents/documentKinds";
import type { DocumentSummary } from "../../../data/documents/documentSummary";
import { createPendingUpdateFields } from "../../../data/documents/documentSync";
import {
  type DocumentRecord,
  isDatabaseUnavailableError,
  loadPersistedDocumentStoreState,
} from "../../../workflows/documents";
import type { DocumentStoreRelinkInput } from "../types";
import { chainIdentityWrite } from "./identityWriteChain";
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
import { runDocumentOrphanMaintenance } from "./orphanMaintenance";
import {
  advancePendingBaseVersion,
  documentSummaryFromRecord,
  persistDocument,
  saveDocumentRecord,
} from "./persistence";
import { logRevalidationScheduled } from "./remoteRevalidationTelemetry";
import {
  type DocumentState,
  type DocumentStoreState,
  setReadySnapshot,
} from "./state";
import { createStoredDocument } from "./storedDocument";
import {
  allowDocumentStoreRemoteSync,
  captureDocumentStoreSyncGeneration,
  invalidateDocumentStoreRemoteSync,
  markDocumentStoreRemoteSyncPending,
} from "./syncGeneration";

async function createInitialDocumentRecord(
  state: DocumentStoreState,
  nextDoc: DocumentState,
): ReturnType<typeof saveDocumentRecord> {
  initializeStoredDocumentKind(
    nextDoc,
    state.initialDocumentKind,
    state.runtime.infra.documentProjectors,
  );
  if (state.initialText.length > 0) {
    nextDoc.getText("text").update(state.initialText);
  }
  const initialDocumentState = readStoredDocumentState(
    nextDoc,
    state.runtime.infra.documentProjectors,
  );
  const hasInitialContent =
    state.initialText.length > 0 ||
    state.initialDocumentKind !== DEFAULT_DOCUMENT_KIND;
  const initialUpdate = hasInitialContent
    ? createPendingUpdateFields(exportAllUpdates(nextDoc))
    : null;

  const created: DocumentRecord = {
    id: state.localId,
    containerId: state.runtime.state.containerId ?? null,
    documentId: state.initialDocumentId,
    documentKind: initialDocumentState.documentKind,
    text: initialDocumentState.text,
    title: initialDocumentState.title,
    snapshotEndVersion: encodeVersionVector(nextDoc),
    accessEpoch: DEFAULT_DOCUMENT_ACCESS_EPOCH,
    accessStateHash: null,
    effectiveAccessLevel: "admin",
    lastCommitLsn: null,
    contentKeyBundle: null,
    documentKekTargets: null,
    documentManifestBundle: null,
  };
  // The create-only persistence primitive commits the canonical row and birth
  // checkpoint together. A concurrent initializer either wins both or adopts
  // both, so it cannot replace another pane's history or keying state.
  const persisted = await saveDocumentRecord(
    state,
    nextDoc,
    {
      ...created,
      snapshotEndVersion: encodeVersionVector(nextDoc),
    },
    {
      historyCheckpoint: {
        coveredTailIds: [],
        endVersionVector: encodeVersionVector(nextDoc),
        pruneCoveredLocalState: false,
        snapshot: bytesToBase64(exportFullHistorySnapshot(nextDoc)),
      },
      ...(initialUpdate ? { pendingUpdate: initialUpdate } : {}),
    },
  );
  return persisted;
}

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
  const replacementDoc = await createStoredDocument(state);
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

  const nextDoc = await createStoredDocument(state);
  const persistedState = await loadPersistedDocumentStoreState({
    execSql: state.runtime.infra.execSql,
    localId: state.localId,
    persistence: state.persistence,
  });
  if (state.localWriteGeneration !== initializeGeneration) {
    return;
  }
  const restored = await restoreOrCreateInitialDocument({
    initializeGeneration,
    nextDoc,
    persistedState,
    state,
  });
  if (!restored) {
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
  state.initialized = true;
  state.initializePromise = null;
  setReadySnapshot(state, restored.doc, false);

  if (restored.activeRecord.documentId && state.scheduleStartupRemoteSync) {
    // Websocket invalidations are intentionally session-local. A process can
    // stop before receiving a peer device's update event, and no event survives
    // the restart to distinguish a clean local snapshot from a stale one. Probe
    // each opened remote document once after loading it; unopened documents stay
    // lazy, while body and attachment state for a restored window converges.
    allowDocumentStoreRemoteSync(state);
    markDocumentStoreRemoteSyncPending(state, "independent");
    logRevalidationScheduled(state.runtime, "startup");
  }
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

  const initializePromise = initializeDocumentStore(state, scheduleSync).catch(
    (error: unknown) => {
      state.initializePromise = null;

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
    return true;
  }

  try {
    await state.initializePromise;
    return true;
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
): Promise<DocumentSummary | null> {
  if (!(await ensureDocumentStoreReady(state, scheduleSync)) || !state.doc) {
    return null;
  }
  const currentDoc = state.doc;
  // Read the record and persist on the identity-write chain so an in-flight
  // eager create cannot interleave: a create that captured a null identity
  // before its network round trip would otherwise write the derived documentId
  // over the one this relink assigns.
  const persisted = await chainIdentityWrite(state, async () => {
    const currentDocumentId = state.record?.documentId ?? null;
    const currentAccessEpoch =
      state.record?.accessEpoch ?? DEFAULT_DOCUMENT_ACCESS_EPOCH;
    const patch: Partial<DocumentRecord> = {
      accessEpoch: Math.max(currentAccessEpoch, input.accessEpoch),
      accessStateHash:
        input.accessStateHash === undefined
          ? (state.record?.accessStateHash ?? null)
          : input.accessStateHash,
      containerId: input.containerId,
      documentId: input.documentId,
    };
    if (input.contentKeyBundle !== undefined) {
      patch.contentKeyBundle = input.contentKeyBundle;
    }
    if (input.documentKekTargets !== undefined) {
      patch.documentKekTargets = input.documentKekTargets;
    }
    if (input.documentManifestBundle !== undefined) {
      patch.documentManifestBundle = input.documentManifestBundle;
    }

    // Relink rewrites access/identity metadata, not content. If it lands while
    // the user is mid-edit, re-deriving text/structured fields from the
    // (possibly lagging) doc would republish a stale read over the live
    // optimistic snapshot and drop in-flight keystrokes; preserve the snapshot
    // like the keystroke and sync persists do.
    // A prior chained write may have cleared this store (resurrect-guard
    // refusal): persisting the captured doc against a null record would
    // resurrect the document as a create. The identity check runs inside
    // the chain, after every earlier write settled.
    if (state.doc !== currentDoc) {
      return null;
    }
    const result = await persistDocument(state, currentDoc, patch, {
      preserveSnapshotStructuredFields: true,
      preserveSnapshotText: true,
    });
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
