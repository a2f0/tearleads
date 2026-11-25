import type {
  DocumentRecord,
  DocumentSyncLoroWindow,
  PendingUpdateRecord,
} from "../../../../workflows/documents";
import type { PrincipalPolicyOperation } from "../../../../workflows/principals/principalPolicyService";
import { requestDocumentStoreSync } from "../../registry";
import { listPendingUpdates } from "../persistence";
import type {
  DocumentState,
  DocumentStoreState,
  DocumentSyncAttempt,
  EncapsulationKeyPair,
} from "../state";
import {
  findOwedListingReadBeforePull,
  settleOwedListingReadAfterCompletedPull,
} from "./listingCoverage";
import { logRevalidationUnavailable as logUnavailable } from "./remoteRevalidationTelemetry";
import {
  cleanupPreRegisteredUpdateIdsOnFailure,
  discardPreRegisteredUpdateIds,
  preRegisterMaterializedDocumentSyncUpdateIds,
} from "./syncAcceptedUpdateIds";
import { finalizeDocumentSync } from "./syncFinalize";
import {
  type DocumentStoreSyncGeneration,
  isDocumentStoreRemoteSyncBlocked,
  isDocumentStoreSyncGenerationCurrent,
} from "./syncGeneration";
import { prepareDocumentOutgoingCoverage } from "./syncOutgoingCoverage";
import { mergeQueuedDocumentUpdates } from "./syncQueueMerge";
import { requestRemoteDocumentSync } from "./syncRequest";
import {
  ensureSeededRemoteDocument,
  remoteCreateGate,
} from "./syncSeededCreate";
import { shouldSkipCleanScheduledDocumentSync } from "./syncShared";

/**
 * The document-state step of a scheduled sync pass: create the remote
 * document if needed, send the queued updates with a pull, and finalize the
 * response, reading the page in the pass's Loro read window.
 */

async function requestOutgoingDocumentBatch(input: {
  readonly currentDoc: DocumentState;
  readonly encapsulationKeyPair: EncapsulationKeyPair;
  readonly generation: DocumentStoreSyncGeneration;
  readonly loroWindow: DocumentSyncLoroWindow;
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
        loroWindow: input.loroWindow,
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

/** Another pass picks up whatever this stale one could not finish. */
function requestSyncAgain(
  state: DocumentStoreState,
  fallback: DocumentRecord,
): DocumentRecord {
  requestDocumentStoreSync(state);
  return state.record ?? fallback;
}

/**
 * Sends the queued updates with a pull and finalizes the response. The read a
 * listing owes the document is read before the request and settled after a
 * pull that reached its bound.
 */
async function pullAndFinalizeDocumentSync(input: {
  readonly consumedRemoteUpdateSignalSeq: number;
  readonly currentDoc: DocumentState;
  readonly encapsulationKeyPair: EncapsulationKeyPair;
  readonly generation: DocumentStoreSyncGeneration;
  readonly loroWindow: DocumentSyncLoroWindow;
  readonly pendingUpdates: PendingUpdateRecord[];
  readonly policyOperation: PrincipalPolicyOperation;
  readonly record: DocumentRecord;
  readonly state: DocumentStoreState;
  readonly wasRemoteProbe: boolean;
}): Promise<DocumentRecord> {
  const { currentDoc, generation, state, wasRemoteProbe } = input;
  const nextRemoteRecord = input.record;
  const remoteDocumentId = nextRemoteRecord.documentId;
  if (remoteDocumentId === null) return nextRemoteRecord;
  // The read a listing owes this document, seen before the request: the
  // completed pull settles only that request, and a newer one survives.
  const owedListingRead = await findOwedListingReadBeforePull(
    state,
    generation,
    { documentId: remoteDocumentId, remoteProbe: wasRemoteProbe },
  );
  if (!isDocumentStoreSyncGenerationCurrent(state, generation))
    return requestSyncAgain(state, nextRemoteRecord);

  // Pre-register the IDs we are about to send so the author's OWN
  // `document_update_created` echo (fanned back over realtime) is classified as
  // self-authored and never re-arms a redundant sync. Registering BEFORE the
  // network await closes the race where the echo lands before
  // finalizeDocumentSync records the accepted IDs — the gap that turned every
  // fast keystroke into an extra self-triggered sync.
  const { sentUpdateIds, syncAttempt } = await requestOutgoingDocumentBatch({
    currentDoc,
    encapsulationKeyPair: input.encapsulationKeyPair,
    generation,
    loroWindow: input.loroWindow,
    pendingUpdates: input.pendingUpdates,
    policyOperation: input.policyOperation,
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

  const finalRecord = await cleanupPreRegisteredUpdateIdsOnFailure(
    state,
    sentUpdateIds,
    () =>
      finalizeDocumentSync(
        state,
        currentDoc,
        nextRemoteRecord,
        syncAttempt,
        input.consumedRemoteUpdateSignalSeq,
        generation,
        sentUpdateIds,
        wasRemoteProbe,
      ),
  );
  // A pull that reached its bound may have paid the read a listing owed. The
  // debt settles against the cursor now on disk, whatever this pass saved.
  await settleOwedListingReadAfterCompletedPull(state, generation, {
    frontier: finalRecord.snapshotEndVersion,
    owed: owedListingRead,
    pull: syncAttempt.synced,
  });
  return finalRecord;
}

export async function syncDocumentState(
  state: DocumentStoreState,
  currentDoc: DocumentState,
  nextRecord: DocumentRecord,
  encapsulationKeyPair: EncapsulationKeyPair,
  generation: DocumentStoreSyncGeneration,
  policyOperation: PrincipalPolicyOperation,
  loroWindow: DocumentSyncLoroWindow,
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

  return pullAndFinalizeDocumentSync({
    consumedRemoteUpdateSignalSeq,
    currentDoc,
    encapsulationKeyPair,
    generation,
    loroWindow,
    pendingUpdates,
    policyOperation,
    record: nextRemoteRecord,
    state,
    wasRemoteProbe,
  });
}
