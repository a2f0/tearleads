import { encodeVersionVector, importUpdates } from "@tearleads/loro";
import {
  createDocumentWriterPublicKeyResolver,
  type DocumentRecord,
  type DocumentSyncLane,
  deletePersistedDocument,
  isDestroyedDocumentSyncRuntimeError,
  type PendingUpdateRecord,
  registerDocumentSyncLane,
  resolveDocumentCreateAuthor,
  syncRemoteDocument,
} from "../../../workflows/documents";
import { requestDocumentStoreSync } from "../registry";
import { awaitInitializationForSync } from "./initialization";
import {
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
import {
  syncDetachedAttachmentBindings,
  syncPendingAttachments,
} from "./syncAttachments";
import { ensureRemoteDocument } from "./syncShared";

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
    `Documents: removed local document ${state.localId} because the remote document was deleted.`,
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
  if (
    typeof event !== "object" ||
    event === null ||
    !("type" in event) ||
    event.type !== "document_update_created" ||
    !("documentId" in event) ||
    typeof event.documentId !== "string"
  ) {
    return null;
  }

  const updateIds =
    "updateIds" in event &&
    Array.isArray(event.updateIds) &&
    event.updateIds.every((updateId) => typeof updateId === "string")
      ? event.updateIds
      : null;

  return {
    documentId: event.documentId,
    updateIds,
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

/**
 * A sync pass may clear `remoteUpdatePending` only when the remote-update
 * signal sequence it consumed at pass entry is unchanged at pass end. A moved
 * sequence means a new remote update event arrived during the pass's async
 * window; that update may post-date this pass's server snapshot, so the signal
 * must survive for the coalesced re-run. Returns false (keep the signal) on any
 * mismatch. Exported for direct regression testing of the convergence-stall
 * race where this clear used to be unconditional.
 */
export function canClearRemoteUpdateSignalAfterSync(
  currentSignalSeq: number,
  consumedSignalSeq: number,
): boolean {
  return currentSignalSeq === consumedSignalSeq;
}

async function finalizeDocumentSync(
  state: DocumentStoreState,
  currentDoc: DocumentState,
  currentRecord: DocumentRecord,
  syncAttempt: DocumentSyncAttempt,
  consumedRemoteUpdateSignalSeq: number,
): Promise<DocumentRecord> {
  const { synced } = syncAttempt;

  await applyIncomingSyncedUpdates(state, currentDoc, syncAttempt);
  for (const updateId of synced.response.acceptedOutgoingUpdateIds) {
    state.locallyAcceptedUpdateIds.add(updateId);
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

  if (syncAttempt.outgoingUpdateCount > synced.settledPendingUpdateIds.length) {
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

  nextRecord = await syncDocumentState(
    state,
    currentDoc,
    nextRecord,
    encapsulationKeyPair,
  );

  if (!state.doc || !state.record) {
    return;
  }

  if ((await listPendingUpdates(state)).length > 0) {
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
    if (isDestroyedDocumentSyncRuntimeError(error)) {
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
