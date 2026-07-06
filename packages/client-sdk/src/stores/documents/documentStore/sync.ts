import { encodeVersionVector, importUpdates } from "@tearleads/loro";
import { isDocumentUpdateCreatedEvent } from "../../../data/documentSync";
import {
  createDocumentWriterPublicKeyResolver,
  type DocumentRecord,
  type DocumentSyncLane,
  deletePersistedDocument,
  type PendingUpdateRecord,
  registerDocumentSyncLane,
  resolveDocumentCreateAuthor,
  shouldReArmAfterOutgoingSettlement,
  syncRemoteDocument,
} from "../../../workflows/documents";
import {
  isDestroyedDatabaseClientError,
  sequenceUnchanged,
} from "../../../workflows/documents/syncLane";
import { requestDocumentStoreSync } from "../registry";
import { awaitInitializationForSync } from "./initialization";
import {
  advancePendingBaseVersion,
  hydrateAttachmentBlobs,
  listPendingUpdates,
  persistDocument,
} from "./persistence";
import {
  type DocumentState,
  type DocumentStoreState,
  type DocumentSyncAttempt,
  type EncapsulationKeyPair,
  markDocumentStoreRemoved,
  setDocumentSyncing,
  setReadySnapshot,
} from "./state";
import { syncPendingAttachments } from "./syncAttachments";
import { syncDetachedAttachmentBindings } from "./syncDetachedAttachments";
import { ensureRemoteDocument } from "./syncShared";

function canRunScheduledSync(state: DocumentStoreState): boolean {
  return (
    state.doc !== null &&
    state.snapshot.ready &&
    state.runtime.state.online &&
    state.runtime.util.isRemoteSyncBlocked?.() !== true &&
    state.runtime.auth.isAuthenticated &&
    state.runtime.crypto.encapsulationKeyPair !== null &&
    resolveDocumentCreateAuthor(state.runtime) !== null
  );
}

async function ensureDocumentRecordForSync(
  state: DocumentStoreState,
  currentDoc: DocumentState,
  nextRecord: DocumentRecord,
  pendingUpdates: PendingUpdateRecord[],
  encapsulationKeyPair: EncapsulationKeyPair,
): Promise<DocumentRecord | null> {
  if (nextRecord.documentId || pendingUpdates.length === 0) {
    return nextRecord;
  }

  return ensureRemoteDocument(
    state,
    currentDoc,
    nextRecord,
    encapsulationKeyPair,
  );
}

async function requestRemoteDocumentSync(input: {
  currentDoc: DocumentState;
  currentRecord: DocumentRecord;
  encapsulationKeyPair: EncapsulationKeyPair;
  pendingUpdates: PendingUpdateRecord[];
  state: DocumentStoreState;
  unavailableWriterLogMessage: string;
}): Promise<DocumentSyncAttempt | null> {
  const {
    currentDoc,
    currentRecord,
    encapsulationKeyPair,
    pendingUpdates,
    state,
    unavailableWriterLogMessage,
  } = input;

  if (!currentRecord.documentId) {
    return null;
  }

  const author = resolveDocumentCreateAuthor(state.runtime);
  if (!author) {
    state.runtime.util.log(unavailableWriterLogMessage);
    return null;
  }

  const synced = await syncRemoteDocument({
    apiClient: state.runtime.apiClient,
    author,
    documentId: currentRecord.documentId,
    execSql: state.runtime.infra.execSql,
    localVersionVector: encodeVersionVector(currentDoc),
    minLsn: currentRecord.lastCommitLsn ?? undefined,
    onRemoteDocumentDeleted: () => deleteUpstreamDeletedDocument(state),
    pendingUpdates,
    persistedState: currentRecord,
    resolveProjectionUserKey: state.resolveProjectionUserKey,
    resolveWriterPublicKey: createDocumentWriterPublicKeyResolver({
      logPrefix: "Documents",
      runtime: state.runtime,
      writerKeyLabel: "writer key",
    }),
    targetSecretKey: encapsulationKeyPair.secretKey,
    writerProjection:
      state.writerProjection?.documentId === currentRecord.documentId
        ? state.writerProjection
        : undefined,
  });
  if (!synced) {
    return null;
  }

  return {
    outgoingUpdateCount: pendingUpdates.length,
    synced,
  };
}

async function deleteUpstreamDeletedDocument(state: DocumentStoreState) {
  await deletePersistedDocument({
    documentProjectors: state.runtime.infra.documentProjectors,
    execSql: state.runtime.infra.execSql,
    localId: state.localId,
    persistence: state.persistence,
  });
  markDocumentStoreRemoved(state);
  state.runtime.util.log(
    `Documents: removed local document ${state.localId} after remote deletion.`,
  );
}

function hasPersistedRemoteDocumentSyncState(record: DocumentRecord): boolean {
  return (
    record.lastCommitLsn !== null &&
    record.contentKeyBundle !== null &&
    record.documentKekTargets !== null &&
    record.documentManifestBundle !== null
  );
}

function shouldSkipCleanScheduledDocumentSync(input: {
  currentRecord: DocumentRecord;
  pendingUpdates: readonly PendingUpdateRecord[];
  state: DocumentStoreState;
}): boolean {
  return (
    input.pendingUpdates.length === 0 &&
    input.state.pendingAttachments.length === 0 &&
    !input.state.remoteUpdatePending &&
    hasPersistedRemoteDocumentSyncState(input.currentRecord)
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

async function applyIncomingSyncedUpdates(
  state: DocumentStoreState,
  currentDoc: DocumentState,
  syncAttempt: DocumentSyncAttempt,
) {
  if (syncAttempt.synced.decryptedUpdates.length === 0) {
    return;
  }

  importUpdates(
    currentDoc,
    syncAttempt.synced.decryptedUpdates.map((update) => update.updateData),
  );
  // Remote ops are now in the doc and already on the server, so fold them into
  // the durable marker; a later local edit must not re-export them as outgoing.
  advancePendingBaseVersion(state, currentDoc);

  // Surface the merged text/fields only when the user is not mid-edit. While
  // local writes are in flight the doc can lag the latest keystroke, so reading
  // it here would regress the controlled editor and jump the caret; preserve the
  // optimistic snapshot instead. The merged remote text still surfaces on the
  // trailing coalesced pass once typing drains (pendingLocalWrites back to 0).
  if (state.pendingLocalWrites > 0) {
    setReadySnapshot(
      state,
      currentDoc,
      true,
      state.snapshot.text,
      state.snapshot.structuredFields,
    );
    return;
  }

  setReadySnapshot(state, currentDoc, true);
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
export function canClearRemoteUpdateSignalAfterSync(
  currentSignalSeq: number,
  consumedSignalSeq: number,
): boolean {
  return sequenceUnchanged(currentSignalSeq, consumedSignalSeq);
}

async function finalizeDocumentSync(
  state: DocumentStoreState,
  currentDoc: DocumentState,
  currentRecord: DocumentRecord,
  syncAttempt: DocumentSyncAttempt,
  consumedRemoteUpdateSignalSeq: number,
  sentUpdateIds: readonly string[],
): Promise<DocumentRecord> {
  const { synced } = syncAttempt;

  await applyIncomingSyncedUpdates(state, currentDoc, syncAttempt);
  // The sent IDs were pre-registered as self-authored before the network call so
  // the redis echo can never beat us. Reconcile against what the server actually
  // accepted: an ID we sent but the server did not accept will never be echoed,
  // so drop it to keep locallyAcceptedUpdateIds from leaking. Accepted IDs (a
  // subset of what we sent) stay registered until their echo consumes them.
  const acceptedOutgoing = new Set(synced.response.acceptedOutgoingUpdateIds);
  for (const sentUpdateId of sentUpdateIds) {
    if (!acceptedOutgoing.has(sentUpdateId)) {
      state.locallyAcceptedUpdateIds.delete(sentUpdateId);
    }
  }
  state.writerProjection = resolveSyncedDocumentWriterProjection(state, synced);

  const { record: nextRecord } = await persistDocument(
    state,
    currentDoc,
    {
      ...synced.persistedState,
      lastCommitLsn:
        synced.response.commitLsn ?? currentRecord.lastCommitLsn ?? null,
    },
    {
      acceptedPendingUpdateIds: synced.settledPendingUpdateIds,
      // This is a BACKGROUND metadata persist (commit LSN, accepted-update
      // bookkeeping), not a content change: any genuinely-new remote text was
      // already folded into the snapshot by applyIncomingSyncedUpdates above.
      // Re-deriving text/structured fields from the doc here is exactly what let
      // a sync pass republish a stale CRDT read over an in-flight optimistic
      // keystroke — regressing the controlled editor value and jumping the
      // caret. Preserve the live snapshot so the latest keystroke always wins.
      preserveSnapshotStructuredFields: true,
      preserveSnapshotText: true,
    },
  );
  // Clear the remote-update signal ONLY if no new remote event arrived while
  // this pass was awaiting the network GET and persist. If the sequence moved,
  // a peer update (E2) committed and was signalled mid-pass but is not in this
  // pass's response, so we must leave the signal set for the coalesced re-run
  // to fetch it. Clearing unconditionally here is exactly what dropped E2.
  if (
    canClearRemoteUpdateSignalAfterSync(
      state.remoteUpdateSignalSeq,
      consumedRemoteUpdateSignalSeq,
    )
  ) {
    state.remoteUpdatePending = false;
  }

  if (
    shouldReArmAfterOutgoingSettlement({
      outgoingUpdateCount: syncAttempt.outgoingUpdateCount,
      settledUpdateCount: synced.settledPendingUpdateIds.length,
    })
  ) {
    requestDocumentStoreSync(state);
  }

  await hydrateAttachmentBlobs(state, currentDoc, nextRecord);
  return nextRecord;
}

async function syncDocumentState(
  state: DocumentStoreState,
  currentDoc: DocumentState,
  nextRecord: DocumentRecord,
  encapsulationKeyPair: EncapsulationKeyPair,
): Promise<DocumentRecord> {
  // Snapshot the remote-update signal sequence before any await. The GET below
  // fetches server state as of its own snapshot; any remote event delivered
  // after this point describes an update that may not be in that response, so
  // finalizeDocumentSync must not clear the signal if this sequence has moved.
  const consumedRemoteUpdateSignalSeq = state.remoteUpdateSignalSeq;
  const pendingUpdates = await listPendingUpdates(state);
  const nextRemoteRecord = await ensureDocumentRecordForSync(
    state,
    currentDoc,
    nextRecord,
    pendingUpdates,
    encapsulationKeyPair,
  );
  if (!nextRemoteRecord?.documentId) {
    return nextRecord;
  }

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
  const sentUpdateIds = pendingUpdates.map((pendingUpdate) => pendingUpdate.id);
  for (const sentUpdateId of sentUpdateIds) {
    state.locallyAcceptedUpdateIds.add(sentUpdateId);
  }

  const syncAttempt = await requestRemoteDocumentSync({
    state,
    currentDoc,
    currentRecord: nextRemoteRecord,
    pendingUpdates,
    encapsulationKeyPair,
    unavailableWriterLogMessage:
      "Documents: skipped sync because the writer context is unavailable.",
  });
  if (!syncAttempt) {
    return nextRemoteRecord;
  }

  return finalizeDocumentSync(
    state,
    currentDoc,
    nextRemoteRecord,
    syncAttempt,
    consumedRemoteUpdateSignalSeq,
    sentUpdateIds,
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
  if (state.runtime.util.isRemoteSyncBlocked?.()) {
    return;
  }
  if (state.pendingAttachments.length > 0) {
    return;
  }
  if (attachmentResult.completed) {
    requestDocumentStoreSync(state);
    return;
  }

  nextRecord = await syncDocumentState(
    state,
    currentDoc,
    nextRecord,
    encapsulationKeyPair,
  );

  if (
    !state.doc ||
    !state.record ||
    state.runtime.util.isRemoteSyncBlocked?.() ||
    (await listPendingUpdates(state)).length > 0
  ) {
    return;
  }

  await syncDetachedAttachmentBindings(state, nextRecord);
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
    if (isDestroyedDatabaseClientError(error)) {
      return false;
    }

    throw error;
  }
}

async function runScheduledSyncLoop(state: DocumentStoreState) {
  setDocumentSyncing(state, true);

  try {
    const shouldContinue = await runScheduledSyncIteration(state);
    if (!shouldContinue) {
      return;
    }
  } finally {
    setDocumentSyncing(state, false);
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
