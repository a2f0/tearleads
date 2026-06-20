import { encodeVersionVector, importUpdates } from "@tearleads/loro";
import {
  createDocumentWriterPublicKeyResolver,
  type DocumentRecord,
  type DocumentSyncLane,
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

async function finalizeDocumentSync(
  state: DocumentStoreState,
  currentDoc: DocumentState,
  currentRecord: DocumentRecord,
  syncAttempt: DocumentSyncAttempt,
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
  state.remoteUpdatePending = false;

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

  return finalizeDocumentSync(state, currentDoc, nextRemoteRecord, syncAttempt);
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
