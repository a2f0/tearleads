import { reportAndRethrowKeyingVerificationError } from "../../../../data/keyingProjectionVerification/error";
import {
  type DocumentRecord,
  type DocumentSyncLane,
  isDatabaseUnavailableError,
  type PendingUpdateRecord,
  registerDocumentSyncLane,
  resolveDocumentCreateAuthor,
} from "../../../../workflows/documents";
import type { PrincipalPolicyOperation } from "../../../../workflows/principals/runtimePolicyWarmer";
import {
  onDocumentStoreRetired,
  requestDocumentStoreSync,
} from "../../registry";
import { awaitInitializationForSync } from "../initialization";
import { listPendingUpdates } from "../persistence";
import {
  type DocumentState,
  type DocumentStoreState,
  type DocumentSyncAttempt,
  type EncapsulationKeyPair,
  setDocumentSyncing,
} from "../state";
import { logRevalidationUnavailable as logUnavailable } from "./remoteRevalidationTelemetry";
import {
  getActiveDocumentRemoteWork,
  runDocumentRemoteWork,
} from "./remoteWork";
import {
  cleanupPreRegisteredUpdateIdsOnFailure,
  discardPreRegisteredUpdateIds,
  preRegisterMaterializedDocumentSyncUpdateIds,
} from "./syncAcceptedUpdateIds";
import { syncPendingAttachments } from "./syncAttachments";
import { syncDetachedAttachmentBindings } from "./syncDetachedAttachments";
import { finalizeDocumentSync } from "./syncFinalize";
import {
  captureDocumentStoreAttachmentSyncGeneration,
  captureDocumentStoreRemoteSyncGeneration,
  captureDocumentStoreSyncGeneration,
  type DocumentStoreSyncGeneration,
  type DocumentStoreSyncLaneGeneration,
  invalidateDocumentStoreSyncLane,
  isDocumentStoreRemoteSyncBlocked,
  isDocumentStoreSyncGenerationCurrent,
  isDocumentStoreSyncLaneGenerationCurrent,
} from "./syncGeneration";
import { prepareDocumentOutgoingCoverage } from "./syncOutgoingCoverage";
import { mergeQueuedDocumentUpdates } from "./syncQueueMerge";
import { requestRemoteDocumentSync } from "./syncRequest";
import { revalidateRemoteDocumentBeforeAttachments } from "./syncRevalidation";
import {
  ensureSeededRemoteDocument,
  remoteCreateGate,
} from "./syncSeededCreate";
import { shouldSkipCleanScheduledDocumentSync } from "./syncShared";

function canRunScheduledSync(state: DocumentStoreState): boolean {
  return (
    // A deferred birth waits for its attach to carry it (see
    // deferredInitialUpdate.ts); a pass now would ship it on its own.
    state.deferInitialUpdate !== true &&
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
  readonly policyOperation: PrincipalPolicyOperation;
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
        policyOperation: input.policyOperation,
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

/** Another pass picks up whatever this stale one could not finish. */
function requestSyncAgain(
  state: DocumentStoreState,
  fallback: DocumentRecord,
): DocumentRecord {
  requestDocumentStoreSync(state);
  return state.record ?? fallback;
}

async function syncDocumentState(
  state: DocumentStoreState,
  currentDoc: DocumentState,
  nextRecord: DocumentRecord,
  encapsulationKeyPair: EncapsulationKeyPair,
  generation: DocumentStoreSyncGeneration,
  policyOperation: PrincipalPolicyOperation,
): Promise<DocumentRecord> {
  // Snapshot the remote-update signal sequence before any await. The GET below
  // fetches server state as of its own snapshot; any remote event delivered
  // after this point describes an update that may not be in that response, so
  // finalizeDocumentSync must not clear the signal if this sequence has moved.
  const consumedRemoteUpdateSignalSeq = state.remoteUpdateSignalSeq;
  const wasRemoteProbe = state.remoteUpdatePending;
  let pendingUpdates: PendingUpdateRecord[] = await listPendingUpdates(state);
  if (!isDocumentStoreSyncGenerationCurrent(state, generation))
    return requestSyncAgain(state, nextRecord);
  if (pendingUpdates.length === 0 && isDocumentStoreRemoteSyncBlocked(state)) {
    return nextRecord;
  }
  // Create the remote document even when nothing is queued to send: a note
  // created and never edited enqueues no updates, but its local row is still a
  // pending create the write queue reports — it must flush, not sit. Defer
  // while the container itself still awaits its remote create — with OR
  // without queued edits, since the create cannot succeed before its parent
  // exists and attempting it just records a spurious failure. The structural
  // lane primes this store again as soon as the container create lands.
  const createGate = await remoteCreateGate(state, nextRecord, generation);
  if (createGate === "stale") return requestSyncAgain(state, nextRecord);
  if (createGate === "defer") return nextRecord;
  const created = await ensureSeededRemoteDocument({
    consumedRemoteUpdateSignalSeq,
    currentDoc,
    encapsulationKeyPair,
    generation,
    nextRecord,
    pendingUpdates,
    policyOperation,
    state,
  });
  let nextRemoteRecord = created.record;
  pendingUpdates = created.pendingUpdates;
  if (!isDocumentStoreSyncGenerationCurrent(state, generation))
    return requestSyncAgain(state, nextRecord);
  if (!nextRemoteRecord?.documentId) return nextRecord;

  const preparedCoverage = await prepareDocumentOutgoingCoverage({
    currentDoc,
    generation,
    pendingUpdates,
    state,
  });
  if (!preparedCoverage) return requestSyncAgain(state, nextRemoteRecord);
  nextRemoteRecord = preparedCoverage.record;
  pendingUpdates = await mergeQueuedDocumentUpdates({
    currentDoc,
    generation,
    pendingUpdates: preparedCoverage.pendingUpdates,
    state,
  });

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
  // `document_update_created` echo (fanned back over realtime) is classified as
  // self-authored and never re-arms a redundant sync. Registering BEFORE the
  // network await closes the race where the echo lands before
  // finalizeDocumentSync records the accepted IDs — the gap that turned every
  // fast keystroke into an extra self-triggered sync.
  const { sentUpdateIds, syncAttempt } = await requestOutgoingDocumentBatch({
    currentDoc,
    encapsulationKeyPair,
    generation,
    pendingUpdates,
    policyOperation,
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

async function runDocumentSyncPass(
  state: DocumentStoreState,
  syncLaneGeneration: DocumentStoreSyncLaneGeneration,
  policyOperation: PrincipalPolicyOperation,
) {
  const currentDoc = state.doc;
  const encapsulationKeyPair = state.runtime.crypto.encapsulationKeyPair;
  let nextRecord = state.record;

  if (!currentDoc || !nextRecord || !encapsulationKeyPair) {
    return;
  }

  const generation = captureDocumentStoreRemoteSyncGeneration(
    state,
    currentDoc,
    syncLaneGeneration,
  );
  const attachmentGeneration = captureDocumentStoreAttachmentSyncGeneration(
    state,
    currentDoc,
    syncLaneGeneration,
  );
  if (!generation || !attachmentGeneration) {
    requestDocumentStoreSync(state);
    return;
  }

  const revalidation = await revalidateRemoteDocumentBeforeAttachments(
    state,
    currentDoc,
    nextRecord,
    encapsulationKeyPair,
    generation,
    policyOperation,
  );
  nextRecord = revalidation.nextRecord;
  if (!revalidation.canSyncAttachments) {
    return;
  }

  const attachmentResult = await syncPendingAttachments(
    state,
    nextRecord,
    encapsulationKeyPair,
    attachmentGeneration,
    policyOperation,
  );
  nextRecord = attachmentResult.nextRecord;
  if (state.pendingAttachments.length > 0) {
    return;
  }
  // A settled bind and the content update carrying its digest are two server
  // writes. Push the content in this same pass rather than re-arming a later
  // one, so a device lost between them is the only remaining window: peers
  // otherwise see the old digest against the new binding.

  nextRecord = await syncDocumentState(
    state,
    currentDoc,
    nextRecord,
    encapsulationKeyPair,
    generation,
    policyOperation,
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

  await syncDetachedAttachmentBindings(
    state,
    nextRecord,
    generation,
    policyOperation,
  );
  if (!isDocumentStoreSyncGenerationCurrent(state, generation)) {
    requestDocumentStoreSync(state);
  }
}

async function runScheduledSyncIteration(
  state: DocumentStoreState,
  syncLaneGeneration: DocumentStoreSyncLaneGeneration,
  policyOperation: PrincipalPolicyOperation,
) {
  if (!(await awaitInitializationForSync(state))) {
    return false;
  }
  if (!isDocumentStoreSyncLaneGenerationCurrent(state, syncLaneGeneration)) {
    return true;
  }

  if (!canRunScheduledSync(state)) {
    return true;
  }

  try {
    await runDocumentSyncPass(state, syncLaneGeneration, policyOperation);
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

async function runScheduledSyncLoop(
  state: DocumentStoreState,
  syncLaneGeneration: DocumentStoreSyncLaneGeneration,
  policyOperation: PrincipalPolicyOperation,
) {
  const syncingGeneration = captureDocumentStoreSyncGeneration(
    state,
    state.doc,
  );
  setDocumentSyncing(state, true);

  try {
    await runScheduledSyncIteration(state, syncLaneGeneration, policyOperation);
  } finally {
    if (
      syncingGeneration &&
      isDocumentStoreSyncGenerationCurrent(state, syncingGeneration) &&
      isDocumentStoreSyncLaneGenerationCurrent(state, syncLaneGeneration)
    ) {
      setDocumentSyncing(state, false);
    }
  }
}

export function registerDocumentStoreSyncLane(
  state: DocumentStoreState,
  getSyncLaneGeneration: () => DocumentStoreSyncLaneGeneration | null,
): DocumentSyncLane {
  // Retiring the store (its document removed under it) ends this lane's
  // current and in-flight work; a replacement store registers its own.
  onDocumentStoreRetired(state.runtime.state.domainScope, state.localId, () =>
    invalidateDocumentStoreSyncLane(state),
  );
  return registerDocumentSyncLane({
    domainScope: state.runtime.state.domainScope,
    localId: state.localId,
    priority: () =>
      state.remoteUpdatePending || state.record?.snapshotEndVersion === ""
        ? -1
        : 0,
    logError: (message, error) => {
      // Read the runtime lazily: a store's runtime is replaced in place, and a
      // reference captured here would report into a torn-down host.
      const { log, logError } = state.runtime.util;
      // Return the host's result: both callbacks are declared `=> void` but may
      // be async, and the lane reporter only catches a rejection it is handed.
      return logError ? logError(message, error) : log(message);
    },
    run: (policyOperation) => {
      const syncLaneGeneration = getSyncLaneGeneration();
      if (!syncLaneGeneration) return Promise.resolve();
      const activeWork = getActiveDocumentRemoteWork(state);
      if (activeWork) {
        // Re-arm on settlement, not immediately: immediate re-requests would
        // spin this lane and starve other work while the HTTP request is held.
        void activeWork.then(() => {
          if (
            isDocumentStoreSyncLaneGenerationCurrent(state, syncLaneGeneration)
          ) {
            requestDocumentStoreSync(state);
          }
        });
        return Promise.resolve();
      }
      return runDocumentRemoteWork(state, () =>
        isDocumentStoreSyncLaneGenerationCurrent(state, syncLaneGeneration)
          ? runScheduledSyncLoop(state, syncLaneGeneration, policyOperation)
          : Promise.resolve(),
      );
    },
  });
}
