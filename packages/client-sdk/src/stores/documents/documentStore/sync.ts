import { reportAndRethrowKeyingVerificationError } from "../../../data/keyingProjectionVerification/error";
import {
  type DocumentRecord,
  type DocumentSyncLane,
  isDatabaseUnavailableError,
  type PendingUpdateRecord,
  registerDocumentSyncLane,
  resolveDocumentCreateAuthor,
} from "../../../workflows/documents";
import { requestDocumentStoreSync } from "../registry";
import { awaitInitializationForSync } from "./initialization";
import { listPendingUpdates } from "./persistence";
import { logRevalidationUnavailable as logUnavailable } from "./remoteRevalidationTelemetry";
import {
  type DocumentState,
  type DocumentStoreState,
  type DocumentSyncAttempt,
  type EncapsulationKeyPair,
  setDocumentSyncing,
} from "./state";
import {
  cleanupPreRegisteredUpdateIdsOnFailure,
  discardPreRegisteredUpdateIds,
  preRegisterMaterializedDocumentSyncUpdateIds,
} from "./syncAcceptedUpdateIds";
import { syncPendingAttachments } from "./syncAttachments";
import { syncDetachedAttachmentBindings } from "./syncDetachedAttachments";
import { finalizeDocumentSync } from "./syncFinalize";
import {
  captureDocumentStoreSyncGeneration,
  type DocumentStoreSyncGeneration,
  isDocumentStoreSyncGenerationCurrent,
} from "./syncGeneration";
import { prepareDocumentOutgoingCoverage } from "./syncOutgoingCoverage";
import { requestRemoteDocumentSync } from "./syncRequest";
import {
  ensureRemoteDocument,
  isContainerAwaitingRemoteCreate,
  shouldSkipCleanScheduledDocumentSync,
} from "./syncShared";

function canRunScheduledSync(state: DocumentStoreState): boolean {
  return (
    state.doc !== null &&
    state.snapshot.ready &&
    state.runtime.state.online &&
    state.runtime.auth.isAuthenticated &&
    state.runtime.crypto.encapsulationKeyPair !== null &&
    resolveDocumentCreateAuthor(state.runtime) !== null
  );
}

async function requestOutgoingDocumentBatch(input: {
  readonly currentDoc: DocumentState;
  readonly encapsulationKeyPair: EncapsulationKeyPair;
  readonly generation: DocumentStoreSyncGeneration;
  readonly pendingUpdates: PendingUpdateRecord[];
  readonly record: DocumentRecord;
  readonly state: DocumentStoreState;
}): Promise<{
  sentUpdateIds: string[];
  syncAttempt: DocumentSyncAttempt | null;
}> {
  const { planningUpdates, queuedUpdateCount } = prepareDocumentStoreSyncQueue(
    input.pendingUpdates,
  );
  const sentUpdateIds: string[] = [];
  const syncAttempt = await cleanupPreRegisteredUpdateIdsOnFailure(
    input.state,
    sentUpdateIds,
    () =>
      requestRemoteDocumentSync({
        currentDoc: input.currentDoc,
        currentRecord: input.record,
        encapsulationKeyPair: input.encapsulationKeyPair,
        generation: input.generation,
        onOutgoingUpdatesMaterialized: (updateIds) =>
          preRegisterMaterializedDocumentSyncUpdateIds(
            input.state,
            sentUpdateIds,
            updateIds,
          ),
        pendingUpdates: planningUpdates,
        queuedUpdateCount,
        state: input.state,
        unavailableWriterLogMessage:
          "Documents: skipped sync because the writer context is unavailable.",
      }),
  );
  return { sentUpdateIds, syncAttempt };
}

/**
 * Keep the full durable queue visible to stale-heal/checkpoint classification.
 * The workflow planner owns the final count and byte bounds, and the exact
 * materialized batch is pre-registered immediately before each submit.
 */
export function prepareDocumentStoreSyncQueue(
  pendingUpdates: PendingUpdateRecord[],
): {
  planningUpdates: PendingUpdateRecord[];
  queuedUpdateCount: number;
} {
  return {
    planningUpdates: pendingUpdates,
    queuedUpdateCount: pendingUpdates.length,
  };
}

export function canSyncDetachedAttachmentBindings(
  record: DocumentRecord,
  pendingUpdateCount: number,
): boolean {
  return (
    pendingUpdateCount === 0 &&
    (record.pullContinuation ?? null) === null &&
    !record.pullContinuationRecoveryRequired
  );
}

async function syncDocumentState(
  state: DocumentStoreState,
  currentDoc: DocumentState,
  nextRecord: DocumentRecord,
  encapsulationKeyPair: EncapsulationKeyPair,
  generation: DocumentStoreSyncGeneration,
): Promise<DocumentRecord> {
  // Snapshot the remote-update signal sequence before any await. The GET below
  // fetches server state as of its own snapshot; any remote event delivered
  // after this point describes an update that may not be in that response, so
  // finalizeDocumentSync must not clear the signal if this sequence has moved.
  const consumedRemoteUpdateSignalSeq = state.remoteUpdateSignalSeq;
  const wasRemoteProbe = state.remoteUpdatePending;
  let pendingUpdates = await listPendingUpdates(state);
  if (!isDocumentStoreSyncGenerationCurrent(state, generation)) {
    requestDocumentStoreSync(state);
    return state.record ?? nextRecord;
  }
  // Create the remote document even when nothing is queued to send: a note
  // created and never edited enqueues no updates, but its local row is still a
  // pending create the write queue reports — it must flush, not sit. Defer
  // while the container itself still awaits its remote create — with OR
  // without queued edits, since the create cannot succeed before its parent
  // exists and attempting it just records a spurious failure. The structural
  // lane primes this store again as soon as the container create lands.
  if (!nextRecord.documentId) {
    const containerAwaitsCreate = await isContainerAwaitingRemoteCreate(state);
    if (!isDocumentStoreSyncGenerationCurrent(state, generation)) {
      requestDocumentStoreSync(state);
      return state.record ?? nextRecord;
    }
    if (containerAwaitsCreate) return nextRecord;
  }
  let nextRemoteRecord = await ensureRemoteDocument(
    state,
    currentDoc,
    nextRecord,
    encapsulationKeyPair,
    generation,
  );
  if (!isDocumentStoreSyncGenerationCurrent(state, generation)) {
    requestDocumentStoreSync(state);
    return state.record ?? nextRecord;
  }
  if (!nextRemoteRecord?.documentId) return nextRecord;

  const preparedCoverage = await prepareDocumentOutgoingCoverage({
    currentDoc,
    generation,
    pendingUpdates,
    state,
  });
  if (!preparedCoverage) {
    requestDocumentStoreSync(state);
    return state.record ?? nextRemoteRecord;
  }
  nextRemoteRecord = preparedCoverage.record;
  pendingUpdates = preparedCoverage.pendingUpdates;

  if (
    shouldSkipCleanScheduledDocumentSync({
      currentRecord: nextRemoteRecord,
      pendingUpdates,
      state,
    })
  ) {
    return nextRemoteRecord;
  }

  // Pre-register the IDs we are about to send so the author's OWN
  // `document_update_created` echo (fanned back over redis) is classified as
  // self-authored and never re-arms a redundant sync. Registering BEFORE the
  // network await closes the race where the echo lands before
  // finalizeDocumentSync records the accepted IDs — the gap that turned every
  // fast keystroke into an extra self-triggered sync.
  const { sentUpdateIds, syncAttempt } = await requestOutgoingDocumentBatch({
    currentDoc,
    encapsulationKeyPair,
    generation,
    pendingUpdates,
    record: nextRemoteRecord,
    state,
  });
  if (!isDocumentStoreSyncGenerationCurrent(state, generation)) {
    discardPreRegisteredUpdateIds(state, sentUpdateIds);
    requestDocumentStoreSync(state);
    return state.record ?? nextRemoteRecord;
  }
  if (!syncAttempt) {
    discardPreRegisteredUpdateIds(state, sentUpdateIds);
    logUnavailable(state, wasRemoteProbe);
    return nextRemoteRecord;
  }

  return cleanupPreRegisteredUpdateIdsOnFailure(state, sentUpdateIds, () =>
    finalizeDocumentSync(
      state,
      currentDoc,
      nextRemoteRecord,
      syncAttempt,
      consumedRemoteUpdateSignalSeq,
      generation,
      sentUpdateIds,
      wasRemoteProbe,
    ),
  );
}

async function revalidateRemoteDocumentBeforeAttachments(
  state: DocumentStoreState,
  currentDoc: DocumentState,
  nextRecord: DocumentRecord,
  encapsulationKeyPair: EncapsulationKeyPair,
): Promise<{ canSyncAttachments: boolean; nextRecord: DocumentRecord }> {
  if (state.pendingAttachments.length === 0 || !nextRecord.documentId) {
    return { canSyncAttachments: true, nextRecord };
  }

  const generation = captureDocumentStoreSyncGeneration(state, currentDoc);
  if (!generation) {
    requestDocumentStoreSync(state);
    return { canSyncAttachments: false, nextRecord };
  }

  const consumedRemoteUpdateSignalSeq = state.remoteUpdateSignalSeq;
  const wasRemoteProbe = state.remoteUpdatePending;
  const syncAttempt = await requestRemoteDocumentSync({
    state,
    currentDoc,
    currentRecord: nextRecord,
    encapsulationKeyPair,
    generation,
    pendingUpdates: [],
    unavailableWriterLogMessage:
      "Documents: skipped pre-attachment revalidation because the writer context is unavailable.",
  });
  if (!isDocumentStoreSyncGenerationCurrent(state, generation)) {
    return { canSyncAttachments: false, nextRecord };
  }
  if (!syncAttempt) {
    logUnavailable(state, wasRemoteProbe);
    return { canSyncAttachments: false, nextRecord };
  }

  const refreshedRecord = await finalizeDocumentSync(
    state,
    currentDoc,
    nextRecord,
    syncAttempt,
    consumedRemoteUpdateSignalSeq,
    generation,
    [],
    wasRemoteProbe,
  );
  return {
    canSyncAttachments:
      !syncAttempt.synced.hasIncompletePull &&
      refreshedRecord.pullContinuation == null &&
      refreshedRecord.pullContinuationRecoveryRequired !== true &&
      isDocumentStoreSyncGenerationCurrent(state, generation),
    nextRecord: refreshedRecord,
  };
}

async function runDocumentSyncPass(state: DocumentStoreState) {
  const currentDoc = state.doc;
  const encapsulationKeyPair = state.runtime.crypto.encapsulationKeyPair;
  let nextRecord = state.record;

  if (!currentDoc || !nextRecord || !encapsulationKeyPair) {
    return;
  }

  const revalidation = await revalidateRemoteDocumentBeforeAttachments(
    state,
    currentDoc,
    nextRecord,
    encapsulationKeyPair,
  );
  nextRecord = revalidation.nextRecord;
  if (!revalidation.canSyncAttachments) {
    return;
  }

  const attachmentResult = await syncPendingAttachments(
    state,
    nextRecord,
    encapsulationKeyPair,
  );
  nextRecord = attachmentResult.nextRecord;
  if (state.pendingAttachments.length > 0) {
    return;
  }
  if (attachmentResult.completed) {
    requestDocumentStoreSync(state);
    return;
  }

  const generation = captureDocumentStoreSyncGeneration(state, currentDoc);
  if (!generation) {
    requestDocumentStoreSync(state);
    return;
  }

  nextRecord = await syncDocumentState(
    state,
    currentDoc,
    nextRecord,
    encapsulationKeyPair,
    generation,
  );

  if (!isDocumentStoreSyncGenerationCurrent(state, generation)) {
    requestDocumentStoreSync(state);
    return;
  }

  if (!state.doc || !state.record) return;

  const pendingUpdates = await listPendingUpdates(state);
  if (!isDocumentStoreSyncGenerationCurrent(state, generation)) {
    requestDocumentStoreSync(state);
    return;
  }
  if (!canSyncDetachedAttachmentBindings(nextRecord, pendingUpdates.length)) {
    return;
  }

  await syncDetachedAttachmentBindings(state, nextRecord, generation);
  if (!isDocumentStoreSyncGenerationCurrent(state, generation)) {
    requestDocumentStoreSync(state);
  }
}

async function runScheduledSyncIteration(state: DocumentStoreState) {
  if (!(await awaitInitializationForSync(state))) {
    return false;
  }

  if (!canRunScheduledSync(state)) {
    return true;
  }

  try {
    await runDocumentSyncPass(state);
    return true;
  } catch (error) {
    if (isDatabaseUnavailableError(error)) {
      return false;
    }

    await reportAndRethrowKeyingVerificationError(
      error,
      state.runtime.util.reportSecurityIncident,
      {
        objectId: state.record?.documentId ?? state.localId,
        objectKind: "document",
        operation: "document.sync",
      },
    );

    throw error;
  }
}

async function runScheduledSyncLoop(state: DocumentStoreState) {
  const syncingGeneration = captureDocumentStoreSyncGeneration(
    state,
    state.doc,
  );
  setDocumentSyncing(state, true);

  try {
    await runScheduledSyncIteration(state);
  } finally {
    if (
      syncingGeneration &&
      isDocumentStoreSyncGenerationCurrent(state, syncingGeneration)
    ) {
      setDocumentSyncing(state, false);
    }
  }
}

export function registerDocumentStoreSyncLane(
  state: DocumentStoreState,
): DocumentSyncLane {
  return registerDocumentSyncLane({
    domainScope: state.runtime.state.domainScope,
    localId: state.localId,
    run: () => runScheduledSyncLoop(state),
  });
}
