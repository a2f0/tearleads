import { bytesToBase64 } from "@tearleads/encoding";
import { getImportBlobMetadata, mergeVersionVectors } from "@tearleads/loro";
import { isDocumentUpdateCreatedEvent } from "../../../data/documentSync";
import {
  type DocumentRecord,
  type DocumentSyncLane,
  registerDocumentSyncLane,
  resolveDocumentCreateAuthor,
  settleOutgoingPassAndDecideReArm,
} from "../../../workflows/documents";
import {
  isDatabaseUnavailableError,
  sequenceUnchanged,
} from "../../../workflows/documents/syncLane";
import { requestDocumentStoreSync } from "../registry";
import { hydrateAttachmentBlobs } from "./attachmentHydration";
import { chainIdentityWrite } from "./identityWriteChain";
import { awaitInitializationForSync } from "./initialization";
import { listPendingUpdates, persistDocument } from "./persistence";
import {
  logRevalidationApplied as logApplied,
  logRevalidationUnavailable as logUnavailable,
} from "./remoteRevalidationTelemetry";
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
  discardUnacceptedPreRegisteredUpdateIds,
  preRegisterUpdateIds,
} from "./syncAcceptedUpdateIds";
import { syncPendingAttachments } from "./syncAttachments";
import { syncDetachedAttachmentBindings } from "./syncDetachedAttachments";
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
import {
  applyIncomingSyncedUpdates,
  documentSyncContextMatches,
} from "./syncUpdateImport";

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

function getDocumentUpdateEventDetails(
  event: unknown,
): { documentId: string; updateIds: readonly string[] | null } | null {
  if (!isDocumentUpdateCreatedEvent(event)) {
    return null;
  }

  return {
    documentId: event.documentId,
    updateIds: event.updateIds ?? null,
  };
}

export function hasRemoteDocumentUpdateEvent(
  state: DocumentStoreState,
  events: ReadonlyArray<unknown>,
): boolean {
  let remoteUpdateFound = false;

  for (const event of events) {
    const updateEvent = getDocumentUpdateEventDetails(event);
    if (!updateEvent || updateEvent.documentId !== state.record?.documentId) {
      continue;
    }

    if (updateEvent.updateIds && updateEvent.updateIds.length > 0) {
      for (const updateId of updateEvent.updateIds) {
        if (!state.locallyAcceptedUpdateIds.has(updateId)) {
          remoteUpdateFound = true;
          continue;
        }

        state.locallyAcceptedUpdateIds.delete(updateId);
      }
      continue;
    }

    remoteUpdateFound = true;
  }

  return remoteUpdateFound;
}

function documentWriterProjectionMatchesSyncResponse(
  writerProjection: NonNullable<
    DocumentSyncAttempt["synced"]["writerProjection"]
  >,
  synced: DocumentSyncAttempt["synced"],
): boolean {
  return (
    writerProjection.contentKeyBundle.contentKeyEpoch ===
      synced.response.contentKeyBundle.contentKeyEpoch &&
    writerProjection.contentKeyBundle.linkSetManifestHash ===
      synced.response.contentKeyBundle.linkSetManifestHash &&
    writerProjection.contentKeyBundle.targetHash ===
      synced.response.contentKeyBundle.targetHash &&
    writerProjection.documentKekTargets.linkSetManifestHash ===
      synced.response.documentKekTargets.linkSetManifestHash &&
    writerProjection.documentKekTargets.documentKeyTargetHash ===
      synced.response.documentKekTargets.documentKeyTargetHash
  );
}

function resolveSyncedDocumentWriterProjection(
  state: DocumentStoreState,
  synced: DocumentSyncAttempt["synced"],
) {
  const writerProjection =
    synced.writerProjection ??
    (state.writerProjection?.documentId === synced.plan.documentId
      ? state.writerProjection
      : null);
  return writerProjection &&
    documentWriterProjectionMatchesSyncResponse(writerProjection, synced)
    ? writerProjection
    : null;
}

/** Clear the remote-update signal only when its consumed sequence is unchanged.
 * A moved sequence means a newer remote event arrived mid-pass and must survive
 * for the coalesced re-run to avoid the convergence-stall race.
 */
export const canClearRemoteUpdateSignalAfterSync = sequenceUnchanged;

function clearConsumedRemoteUpdateSignal(
  state: DocumentStoreState,
  consumedSignalSequence: number,
): void {
  // A peer event can arrive while the HTTP request is in flight. Clear only
  // the sequence this pass consumed so the newer event survives for a re-run.
  if (
    canClearRemoteUpdateSignalAfterSync(
      state.remoteUpdateSignalSeq,
      consumedSignalSequence,
    )
  ) {
    state.remoteUpdatePending = false;
  }
}

/**
 * Durable-history tail: append pulled updates BEFORE the record persist so
 * the tail stays a superset of what the snapshot covers (duplicates are
 * idempotent by op identity; a crash between the writes can only leave the
 * safe superset).
 */
async function appendPulledUpdatesToHistory(
  state: DocumentStoreState,
  synced: DocumentSyncAttempt["synced"],
): Promise<void> {
  if (synced.decryptedUpdates.length === 0) {
    return;
  }
  await state.persistence.appendHistoryUpdates(state.runtime.infra.execSql, {
    localId: state.localId,
    origin: "remote",
    updates: synced.decryptedUpdates.map((update) =>
      bytesToBase64(update.updateData),
    ),
  });
}

/**
 * The frontier a finalize persist may publish: the stored frontier advanced
 * by exactly the pulled updates just appended to the durable tail — never the
 * live document's version, which can transiently include an in-flight local
 * edit whose durable row has not landed yet.
 */
function coveredSyncFrontier(
  state: DocumentStoreState,
  currentRecord: DocumentRecord,
  synced: DocumentSyncAttempt["synced"],
): { snapshotEndVersion: string } | Record<string, never> {
  if (synced.decryptedUpdates.length === 0) {
    return {};
  }
  const liveFrontier = (state.record ?? currentRecord).snapshotEndVersion;
  return {
    snapshotEndVersion: mergeVersionVectors([
      ...(liveFrontier.length > 0 ? [liveFrontier] : []),
      ...synced.decryptedUpdates.map(
        (update) =>
          getImportBlobMetadata(update.updateData).partialEndVersionVector,
      ),
    ]),
  };
}

async function finalizeDocumentSync(
  state: DocumentStoreState,
  currentDoc: DocumentState,
  currentRecord: DocumentRecord,
  syncAttempt: DocumentSyncAttempt,
  consumedRemoteUpdateSignalSeq: number,
  generation: DocumentStoreSyncGeneration,
  sentUpdateIds: readonly string[],
  wasRemoteProbe: boolean,
): Promise<DocumentRecord> {
  const { synced } = syncAttempt;
  if (!isDocumentStoreSyncGenerationCurrent(state, generation)) {
    discardPreRegisteredUpdateIds(state, sentUpdateIds);
    requestDocumentStoreSync(state);
    return state.record ?? currentRecord;
  }

  let mergedDoc = currentDoc;
  // The sent IDs were pre-registered as self-authored before the network call so
  // the redis echo can never beat us. Reconcile against what the server actually
  // accepted: an ID we sent but the server did not accept will never be echoed,
  // so drop it to keep locallyAcceptedUpdateIds from leaking. Accepted IDs (a
  // subset of what we sent) stay registered until their echo consumes them.
  discardUnacceptedPreRegisteredUpdateIds(
    state,
    sentUpdateIds,
    synced.response.acceptedOutgoingUpdateIds,
  );
  // Persist on the identity-write chain: synced.persistedState carries this
  // pass's documentId, so it would clobber a relink that landed mid-pass. If
  // the identity moved, the response describes the OLD document — skip every
  // response-derived in-memory mutation and let the new identity's own sync
  // pass take over.
  let responseApplied = false;
  const { record: nextRecord } = await chainIdentityWrite(state, async () => {
    const liveRecord = state.record;
    if (
      !isDocumentStoreSyncGenerationCurrent(state, generation) ||
      !documentSyncContextMatches(
        liveRecord,
        currentRecord,
        synced.plan.documentId,
      )
    ) {
      return { record: liveRecord ?? currentRecord };
    }

    mergedDoc = applyIncomingSyncedUpdates(
      state,
      currentDoc,
      currentRecord,
      syncAttempt,
      generation,
    );
    await appendPulledUpdatesToHistory(state, synced);
    state.writerProjection = resolveSyncedDocumentWriterProjection(
      state,
      synced,
    );
    const persisted = await persistDocument(
      state,
      mergedDoc,
      {
        ...synced.persistedState,
        lastCommitLsn:
          synced.response.commitLsn ?? currentRecord.lastCommitLsn ?? null,
        ...coveredSyncFrontier(state, currentRecord, synced),
      },
      {
        acceptedPendingUpdateIds: synced.settledPendingUpdateIds,
        // This is a BACKGROUND metadata persist (commit LSN, accepted-update
        // bookkeeping), not a content change: any genuinely-new remote text was
        // already folded into the snapshot by applyIncomingSyncedUpdates inside
        // this serialized identity guard.
        // Re-deriving text/structured fields from the doc here is exactly what
        // let a sync pass republish a stale CRDT read over an in-flight
        // optimistic keystroke — regressing the controlled editor value and
        // jumping the caret. Preserve the live snapshot so the latest keystroke
        // always wins.
        preserveSnapshotStructuredFields: true,
        preserveSnapshotText: true,
      },
      generation,
    );
    if (
      !persisted ||
      !isDocumentStoreSyncGenerationCurrent(state, generation)
    ) {
      return { record: state.record ?? currentRecord };
    }

    responseApplied = true;
    return persisted;
  });
  if (!responseApplied) {
    discardPreRegisteredUpdateIds(state, sentUpdateIds);
    requestDocumentStoreSync(state);
    return nextRecord;
  }

  if (!isDocumentStoreSyncGenerationCurrent(state, generation)) {
    discardPreRegisteredUpdateIds(state, sentUpdateIds);
    requestDocumentStoreSync(state);
    return state.record ?? nextRecord;
  }

  clearConsumedRemoteUpdateSignal(state, consumedRemoteUpdateSignalSeq);

  if (
    settleOutgoingPassAndDecideReArm(state, {
      outgoingUpdateCount: syncAttempt.outgoingUpdateCount,
      rekeyedUpdateCount: synced.rekeyedPendingUpdateIds.length,
      settledUpdateCount: synced.settledPendingUpdateIds.length,
    })
  ) {
    requestDocumentStoreSync(state);
  }

  await hydrateAttachmentBlobs(state, mergedDoc, nextRecord, generation);
  logApplied(state, mergedDoc, synced.decryptedUpdates.length, wasRemoteProbe);
  return nextRecord;
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
  const sentUpdateIds = preRegisterUpdateIds(state, pendingUpdates);

  const syncAttempt = await cleanupPreRegisteredUpdateIdsOnFailure(
    state,
    sentUpdateIds,
    () =>
      requestRemoteDocumentSync({
        state,
        currentDoc,
        currentRecord: nextRemoteRecord,
        pendingUpdates,
        encapsulationKeyPair,
        generation,
        unavailableWriterLogMessage:
          "Documents: skipped sync because the writer context is unavailable.",
      }),
  );
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

async function runDocumentSyncPass(state: DocumentStoreState) {
  const currentDoc = state.doc;
  const encapsulationKeyPair = state.runtime.crypto.encapsulationKeyPair;
  let nextRecord = state.record;

  if (!currentDoc || !nextRecord || !encapsulationKeyPair) {
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
  if (pendingUpdates.length > 0) {
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
    const shouldContinue = await runScheduledSyncIteration(state);
    if (!shouldContinue) {
      return;
    }
  } finally {
    if (
      syncingGeneration &&
      isDocumentStoreSyncGenerationCurrent(state, syncingGeneration)
    ) {
      setDocumentSyncing(state, false);
    }
  }
}

export function handleDocumentRemoteEvents(
  state: DocumentStoreState,
  scheduleSync: () => void,
) {
  if (!state.record?.documentId) {
    state.lastEventCount = state.runtime.state.events.length;
    return;
  }

  const nextEvents = state.runtime.state.events.slice(state.lastEventCount);
  state.lastEventCount = state.runtime.state.events.length;

  if (hasRemoteDocumentUpdateEvent(state, nextEvents)) {
    state.remoteUpdatePending = true;
    // Bump the signal sequence so an in-flight sync pass can detect that a NEW
    // remote update arrived after it consumed the signal and must not clear it.
    state.remoteUpdateSignalSeq += 1;
    scheduleSync();
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
