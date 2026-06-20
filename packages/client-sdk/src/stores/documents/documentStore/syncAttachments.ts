import { getDocumentAttachments } from "../../../data/documents/documentContent";
import {
  type MultipartUploadProgressListener,
  uploadDocumentAttachment,
} from "../../../workflows/blobs";
import { detachDocumentAttachment } from "../../../workflows/blobs/detach";
import {
  type DocumentRecord,
  type PendingAttachmentRecord,
  resolveDocumentCreateAuthor,
} from "../../../workflows/documents";
import {
  beginDomainSyncUploadLane,
  type UploadSyncLane,
} from "../../../workflows/sync";
import {
  deleteLocalAttachmentRecord,
  deletePendingAttachment,
  saveLocalAttachmentRecord,
} from "./persistence";
import {
  type DocumentAttachmentBinding,
  type DocumentState,
  type DocumentStoreState,
  type EncapsulationKeyPair,
  type PendingMutationSyncResult,
  setReadySnapshot,
} from "./state";
import { ensureRemoteDocument } from "./syncShared";

interface DetachedAttachmentMarker {
  slotId: string;
  storageKey: string;
}

export async function syncPendingAttachments(
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

  const activeBindingBySlotId = new Map<string, DocumentAttachmentBinding>();
  let fetchedRemoteBindings = false;
  const completedSlotIds = new Set<string>();

  for (const pendingAttachment of [...state.pendingAttachments]) {
    if (
      !fetchedRemoteBindings &&
      !isNewPendingAttachmentSlot(state, pendingAttachment)
    ) {
      const remoteBindings =
        await state.runtime.apiClient.listDocumentAttachments(remoteDocumentId);
      if (!remoteBindings) {
        return {
          completed: completedSlotIds.size > 0,
          nextRecord: currentRecord,
        };
      }

      fetchedRemoteBindings = true;
      for (const binding of remoteBindings) {
        activeBindingBySlotId.set(binding.slotId, binding);
      }
    }

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

export async function syncDetachedAttachmentBindings(
  state: DocumentStoreState,
  nextRecord: DocumentRecord,
): Promise<PendingMutationSyncResult> {
  const currentDoc = state.doc;
  if (!currentDoc) {
    return { completed: false, nextRecord };
  }

  const detachedMarkers = listDetachedAttachmentMarkers(state, currentDoc);
  if (detachedMarkers.length === 0) {
    return { completed: false, nextRecord };
  }

  if (!nextRecord.documentId) {
    await cleanupDetachedAttachmentMarkers(state, currentDoc, detachedMarkers);
    return { completed: true, nextRecord };
  }

  const remoteBindings = await state.runtime.apiClient.listDocumentAttachments(
    nextRecord.documentId,
  );
  if (!remoteBindings) {
    return { completed: false, nextRecord };
  }

  let completed = false;
  const activeBindingBySlotId = new Map(
    remoteBindings.map((binding) => [binding.slotId, binding]),
  );

  for (const marker of detachedMarkers) {
    const activeBinding = activeBindingBySlotId.get(marker.slotId);
    if (activeBinding) {
      const detached = await syncDetachedAttachmentBinding({
        binding: activeBinding,
        remoteDocumentId: nextRecord.documentId,
        state,
      });
      if (!detached) {
        return { completed, nextRecord };
      }
    }

    await cleanupDetachedAttachmentMarker(state, currentDoc, marker);
    completed = true;
  }

  return { completed, nextRecord };
}

function listDetachedAttachmentMarkers(
  state: DocumentStoreState,
  currentDoc: DocumentState,
): DetachedAttachmentMarker[] {
  const currentSlotIds = new Set(
    getDocumentAttachments(currentDoc).map((attachment) => attachment.slotId),
  );

  return Object.entries(state.attachmentStorageKeyBySlotId).flatMap(
    ([slotId, storageKey]) =>
      currentSlotIds.has(slotId) ? [] : [{ slotId, storageKey }],
  );
}

async function cleanupDetachedAttachmentMarkers(
  state: DocumentStoreState,
  currentDoc: DocumentState,
  markers: readonly DetachedAttachmentMarker[],
) {
  for (const marker of markers) {
    await cleanupDetachedAttachmentMarker(state, currentDoc, marker);
  }
}

async function cleanupDetachedAttachmentMarker(
  state: DocumentStoreState,
  currentDoc: DocumentState,
  marker: DetachedAttachmentMarker,
) {
  await deleteLocalAttachmentRecord(
    state,
    marker.slotId,
    marker.storageKey,
    currentDoc,
  );
  await state.runtime.infra.blobStore.deleteBytes(marker.storageKey);
}

async function syncDetachedAttachmentBinding(input: {
  binding: DocumentAttachmentBinding;
  remoteDocumentId: string;
  state: DocumentStoreState;
}): Promise<boolean> {
  const { binding, state } = input;
  const author = resolveDocumentCreateAuthor(state.runtime);
  if (!author) {
    state.runtime.util.log(
      "Documents: skipped attachment detach because the writer context is unavailable.",
    );
    return false;
  }

  const writerProjection =
    state.writerProjection?.documentId === input.remoteDocumentId
      ? state.writerProjection
      : null;
  const baseDetachInput = {
    apiClient: state.runtime.apiClient,
    author,
    bindingId: binding.bindingId,
    blobId: binding.blobId,
    documentId: input.remoteDocumentId,
    execSql: state.runtime.infra.execSql,
    resolveProjectionUserKey: state.resolveProjectionUserKey,
    slotId: binding.slotId,
  };
  let detached = await detachDocumentAttachment({
    ...baseDetachInput,
    writerProjection: writerProjection ?? undefined,
  });
  if (!detached && writerProjection) {
    state.writerProjection = null;
    detached = await detachDocumentAttachment(baseDetachInput);
  }
  if (!detached) {
    return false;
  }

  state.writerProjection = detached.writerProjection;
  state.runtime.util.log(
    `Detached attachment ${binding.slotId} from document ${input.remoteDocumentId}.`,
  );
  return true;
}

function isNewPendingAttachmentSlot(
  state: DocumentStoreState,
  pendingAttachment: PendingAttachmentRecord,
): boolean {
  // Fresh slots use a deterministic key; replacements append a UUID.
  return (
    pendingAttachment.storageKey ===
    `${state.localId}-${pendingAttachment.slotId}`
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

  const { laneRef: uploadLaneRef, onMultipartProgress } =
    createAttachmentUploadLaneReporter({ pendingAttachment, state });

  const writerProjection =
    state.writerProjection?.documentId === input.remoteDocumentId
      ? state.writerProjection
      : null;
  const baseUploadInput = {
    apiClient: state.runtime.apiClient,
    author,
    bytes,
    documentId: input.remoteDocumentId,
    execSql: state.runtime.infra.execSql,
    expectedBindingId:
      input.activeBindingBySlotId.get(pendingAttachment.slotId)?.bindingId ??
      null,
    onMultipartProgress,
    resolveProjectionUserKey: state.resolveProjectionUserKey,
    slotId: pendingAttachment.slotId,
    targetSecretKey: input.encapsulationKeyPair.secretKey,
  };
  let uploaded = await uploadDocumentAttachment({
    ...baseUploadInput,
    writerProjection: writerProjection ?? undefined,
  });
  if (!uploaded && writerProjection) {
    // The stale writer projection was rejected; retry once without it.
    state.writerProjection = null;
    uploaded = await uploadDocumentAttachment(baseUploadInput);
  }
  if (!uploaded) {
    uploadLaneRef.current?.fail(
      new Error(
        `Attachment upload failed for slot ${pendingAttachment.slotId}.`,
      ),
    );
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
  state.writerProjection = uploaded.writerProjection;
  uploadLaneRef.current?.complete();
  state.runtime.util.log(
    `Uploaded attachment ${pendingAttachment.name} for document ${input.remoteDocumentId}.`,
  );
  return true;
}

function getAttachmentUploadLaneLabel(name: string | null | undefined): string {
  return name ? `Upload ${name}` : "Attachment upload";
}

// Surfaces a multipart upload as its own lane in the sync visualizer. The lane
// is created lazily on the first progress event, so single-shot uploads (below
// the multipart threshold) stay laneless. The holder keeps the lane reference
// visible to the caller despite being assigned inside the progress callback.
function createAttachmentUploadLaneReporter(input: {
  pendingAttachment: PendingAttachmentRecord;
  state: DocumentStoreState;
}): {
  laneRef: { current: UploadSyncLane | null };
  onMultipartProgress: MultipartUploadProgressListener;
} {
  const { pendingAttachment, state } = input;
  const laneRef: { current: UploadSyncLane | null } = { current: null };
  const onMultipartProgress: MultipartUploadProgressListener = (progress) => {
    if (!laneRef.current) {
      laneRef.current = beginDomainSyncUploadLane(
        state.runtime.state.domainScope,
        `blob-upload:${pendingAttachment.slotId}`,
        { label: getAttachmentUploadLaneLabel(pendingAttachment.name) },
      );
    }
    laneRef.current.reportProgress(progress);
  };

  return { laneRef, onMultipartProgress };
}
