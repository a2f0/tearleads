import { encodeVersionVector, importUpdates } from "@tearleads/loro";
import { uploadDocumentAttachment } from "../../../workflows/blobs";
import {
  createDocumentWriterPublicKeyResolver,
  createRemoteDocument,
  type DocumentRecord,
  type DocumentSyncLane,
  hasDocumentUpdateEvent,
  isDestroyedDocumentSyncRuntimeError,
  type PendingAttachmentRecord,
  type PendingUpdateRecord,
  registerDocumentSyncLane,
  resolveDocumentCreateAuthor,
  syncRemoteDocument,
} from "../../../workflows/documents";
import { requestDocumentStoreSync } from "../registry";
import { awaitInitializationForSync } from "./initialization";
import {
  deletePendingAttachment,
  hydrateAttachmentBlobs,
  listPendingUpdates,
  persistDocument,
  saveLocalAttachmentRecord,
} from "./persistence";
import {
  type DocumentAttachmentBinding,
  type DocumentState,
  type DocumentStoreState,
  type DocumentSyncAttempt,
  type EncapsulationKeyPair,
  type PendingMutationSyncResult,
  setDocumentSyncing,
  setReadySnapshot,
} from "./state";

async function ensureRemoteDocument(
  state: DocumentStoreState,
  currentDoc: DocumentState,
  nextRecord: DocumentRecord | null,
  encapsulationKeyPair: EncapsulationKeyPair,
): Promise<DocumentRecord | null> {
  if (nextRecord?.documentId) {
    return nextRecord;
  }

  if (!state.runtime.state.containerId) {
    state.runtime.util.log(
      "Documents: cannot create a remote document without a container.",
    );
    return nextRecord;
  }

  const author = resolveDocumentCreateAuthor(state.runtime);
  if (!author) {
    state.runtime.util.log(
      "Documents: skipped remote create because the writer context is unavailable.",
    );
    return nextRecord;
  }

  const created = await createRemoteDocument({
    apiClient: state.runtime.apiClient,
    author,
    containerId: state.runtime.state.containerId,
    execSql: state.runtime.infra.execSql,
    resolveProjectionUserKey: state.resolveProjectionUserKey,
    targetSecretKey: encapsulationKeyPair.secretKey,
  });
  if (!created) {
    return nextRecord;
  }

  state.runtime.util.log(`Created document: ${created.documentId}`);

  return (
    await persistDocument(state, currentDoc, {
      ...created.persistedState,
    })
  ).record;
}

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

async function syncPendingAttachments(
  state: DocumentStoreState,
  nextRecord: DocumentRecord,
  encapsulationKeyPair: EncapsulationKeyPair,
): Promise<PendingMutationSyncResult> {
  if (state.pendingAttachments.length === 0) {
    return { completed: false, nextRecord };
  }

  const currentDoc = state.doc;
  if (!currentDoc) {
    return { completed: false, nextRecord };
  }

  const currentRecord = await ensureRemoteDocumentForAttachmentSync(
    state,
    currentDoc,
    nextRecord,
    encapsulationKeyPair,
  );
  if (!currentRecord?.documentId) {
    return { completed: false, nextRecord };
  }
  const remoteDocumentId = currentRecord.documentId;

  const remoteBindings =
    await state.runtime.apiClient.listDocumentAttachments(remoteDocumentId);
  if (!remoteBindings) {
    return { completed: false, nextRecord: currentRecord };
  }

  const activeBindingBySlotId = new Map(
    remoteBindings.map((binding) => [binding.slotId, binding]),
  );
  const completedSlotIds = new Set<string>();

  for (const pendingAttachment of [...state.pendingAttachments]) {
    const uploaded = await syncPendingAttachmentUpload({
      activeBindingBySlotId,
      encapsulationKeyPair,
      pendingAttachment,
      remoteDocumentId,
      state,
    });
    if (!uploaded) {
      return {
        completed: completedSlotIds.size > 0,
        nextRecord: currentRecord,
      };
    }

    completedSlotIds.add(pendingAttachment.slotId);
    state.pendingAttachments = state.pendingAttachments.filter(
      (attachment) => attachment !== pendingAttachment,
    );
  }

  if (completedSlotIds.size === 0) {
    return { completed: false, nextRecord: currentRecord };
  }

  setReadySnapshot(state, currentDoc, state.snapshot.syncing);

  return { completed: true, nextRecord: currentRecord };
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

async function ensureRemoteDocumentForAttachmentSync(
  state: DocumentStoreState,
  currentDoc: DocumentState,
  nextRecord: DocumentRecord,
  encapsulationKeyPair: EncapsulationKeyPair,
): Promise<DocumentRecord | null> {
  if (nextRecord.documentId) {
    return nextRecord;
  }

  return ensureRemoteDocument(
    state,
    currentDoc,
    nextRecord,
    encapsulationKeyPair,
  );
}

async function syncPendingAttachmentUpload(input: {
  activeBindingBySlotId: Map<string, DocumentAttachmentBinding>;
  encapsulationKeyPair: EncapsulationKeyPair;
  pendingAttachment: PendingAttachmentRecord;
  remoteDocumentId: string;
  state: DocumentStoreState;
}): Promise<boolean> {
  const { pendingAttachment, state } = input;
  const bytes = await state.runtime.infra.blobStore.readBytes(
    pendingAttachment.storageKey,
  );
  if (!bytes) {
    state.runtime.util.log(
      `Documents: pending attachment ${pendingAttachment.slotId} is missing local bytes.`,
    );
    return false;
  }

  const author = resolveDocumentCreateAuthor(state.runtime);
  if (!author) {
    state.runtime.util.log(
      "Documents: skipped attachment upload because the writer context is unavailable.",
    );
    return false;
  }

  const uploaded = await uploadDocumentAttachment({
    apiClient: state.runtime.apiClient,
    author,
    bytes,
    documentId: input.remoteDocumentId,
    execSql: state.runtime.infra.execSql,
    expectedBindingId:
      input.activeBindingBySlotId.get(pendingAttachment.slotId)?.bindingId ??
      null,
    resolveProjectionUserKey: state.resolveProjectionUserKey,
    slotId: pendingAttachment.slotId,
    targetSecretKey: input.encapsulationKeyPair.secretKey,
  });
  if (!uploaded) {
    return false;
  }

  await saveLocalAttachmentRecord(state, {
    blobId: uploaded.blobId,
    byteLength: pendingAttachment.byteLength,
    localId: state.localId,
    mimeType: pendingAttachment.mimeType,
    slotId: pendingAttachment.slotId,
    storageKey: pendingAttachment.storageKey,
  });
  await deletePendingAttachment(
    state,
    pendingAttachment.slotId,
    pendingAttachment.storageKey,
  );
  input.activeBindingBySlotId.set(pendingAttachment.slotId, {
    bindingId: uploaded.bindingId,
    blobId: uploaded.blobId,
    contentKeyBundle: uploaded.response.contentKeyBundle,
    slotId: pendingAttachment.slotId,
  });
  state.runtime.util.log(
    `Uploaded attachment ${pendingAttachment.name} for document ${input.remoteDocumentId}.`,
  );
  return true;
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
  });
  if (!synced) {
    return null;
  }

  return {
    outgoingUpdateCount: pendingUpdates.length,
    synced,
  };
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

async function finalizeDocumentSync(
  state: DocumentStoreState,
  currentDoc: DocumentState,
  currentRecord: DocumentRecord,
  syncAttempt: DocumentSyncAttempt,
): Promise<DocumentRecord> {
  const { synced } = syncAttempt;

  await applyIncomingSyncedUpdates(state, currentDoc, syncAttempt);

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

async function refreshRemoteDocumentBeforePendingAttachmentMutation(
  state: DocumentStoreState,
  currentDoc: DocumentState,
  nextRecord: DocumentRecord,
  encapsulationKeyPair: EncapsulationKeyPair,
): Promise<PendingMutationSyncResult> {
  if (state.pendingAttachments.length === 0 || !nextRecord.documentId) {
    return { completed: false, nextRecord };
  }

  const syncAttempt = await requestRemoteDocumentSync({
    state,
    currentDoc,
    currentRecord: nextRecord,
    encapsulationKeyPair,
    pendingUpdates: [],
    unavailableWriterLogMessage:
      "Documents: skipped sync probe because the writer context is unavailable.",
  });
  if (!syncAttempt) {
    return { completed: false, nextRecord };
  }

  const refreshedRecord = await finalizeDocumentSync(
    state,
    currentDoc,
    nextRecord,
    syncAttempt,
  );

  return {
    // A probe can advance commitLsn without delivering document changes. Keep
    // the current pass going so pending attachment uploads are not starved.
    completed: syncAttempt.synced.decryptedUpdates.length > 0,
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

  const refreshedResult =
    await refreshRemoteDocumentBeforePendingAttachmentMutation(
      state,
      currentDoc,
      nextRecord,
      encapsulationKeyPair,
    );
  nextRecord = refreshedResult.nextRecord;
  if (refreshedResult.completed) {
    requestDocumentStoreSync(state);
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

  await syncDocumentState(state, currentDoc, nextRecord, encapsulationKeyPair);
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

  if (hasDocumentUpdateEvent(nextEvents, state.record?.documentId)) {
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
