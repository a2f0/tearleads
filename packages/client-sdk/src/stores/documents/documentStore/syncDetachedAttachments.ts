import { getDocumentAttachments } from "../../../data/documents/documentContent";
import { detachDocumentAttachment } from "../../../workflows/blobs/detach";
import {
  type DocumentRecord,
  resolveDocumentCreateAuthor,
} from "../../../workflows/documents";
import { deleteLocalAttachmentRecord } from "./persistence";
import type {
  DocumentAttachmentBinding,
  DocumentState,
  DocumentStoreState,
  PendingMutationSyncResult,
} from "./state";

interface DetachedAttachmentMarker {
  slotId: string;
  storageKey: string;
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
