import { getDocumentAttachments } from "../../../data/documents/documentContent";
import { detachDocumentAttachment } from "../../../workflows/blobs/detach";
import {
  type DocumentRecord,
  resolveDocumentCreateAuthor,
} from "../../../workflows/documents";
import { deleteLocalAttachmentRecord } from "./attachmentPersistence";
import type {
  DocumentAttachmentBinding,
  DocumentState,
  DocumentStoreState,
} from "./state";
import {
  type DocumentStoreSyncGeneration,
  isDocumentStoreSyncGenerationCurrent,
} from "./syncGeneration";
import { documentSyncContextMatches } from "./syncUpdateImport";

interface DetachedAttachmentMarker {
  slotId: string;
  storageKey: string;
}

export async function syncDetachedAttachmentBindings(
  state: DocumentStoreState,
  nextRecord: DocumentRecord,
  generation: DocumentStoreSyncGeneration,
): Promise<void> {
  const currentDoc = generation.currentDoc;
  if (
    !currentDoc ||
    !detachedSyncContextIsCurrent(state, generation, nextRecord)
  ) {
    return;
  }

  const detachedMarkers = listDetachedAttachmentMarkers(state, currentDoc);
  if (detachedMarkers.length === 0) {
    return;
  }

  if (!nextRecord.documentId) {
    await cleanupDetachedAttachmentMarkers(
      state,
      currentDoc,
      nextRecord,
      detachedMarkers,
      generation,
    );
    return;
  }

  const remoteDocumentId = nextRecord.documentId;
  const remoteBindings =
    await state.runtime.apiClient.listDocumentAttachments(remoteDocumentId);
  if (
    !remoteBindings ||
    !detachedSyncContextIsCurrent(state, generation, nextRecord)
  ) {
    return;
  }

  const activeBindingBySlotId = new Map(
    remoteBindings.map((binding) => [binding.slotId, binding]),
  );

  for (const marker of detachedMarkers) {
    if (!detachedSyncContextIsCurrent(state, generation, nextRecord)) {
      return;
    }
    const activeBinding = activeBindingBySlotId.get(marker.slotId);
    if (activeBinding) {
      const detached = await syncDetachedAttachmentBinding({
        binding: activeBinding,
        generation,
        remoteDocumentId,
        requestRecord: nextRecord,
        state,
      });
      if (!detached) {
        return;
      }
    }

    const cleaned = await cleanupDetachedAttachmentMarker(
      state,
      currentDoc,
      nextRecord,
      marker,
      generation,
    );
    if (!cleaned) {
      return;
    }
  }
}

function detachedSyncContextIsCurrent(
  state: DocumentStoreState,
  generation: DocumentStoreSyncGeneration,
  requestRecord: DocumentRecord,
): boolean {
  return (
    isDocumentStoreSyncGenerationCurrent(state, generation) &&
    documentSyncContextMatches(
      state.record,
      requestRecord,
      requestRecord.documentId,
    )
  );
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
  requestRecord: DocumentRecord,
  markers: readonly DetachedAttachmentMarker[],
  generation: DocumentStoreSyncGeneration,
): Promise<void> {
  for (const marker of markers) {
    if (
      !(await cleanupDetachedAttachmentMarker(
        state,
        currentDoc,
        requestRecord,
        marker,
        generation,
      ))
    ) {
      return;
    }
  }
}

async function cleanupDetachedAttachmentMarker(
  state: DocumentStoreState,
  currentDoc: DocumentState,
  requestRecord: DocumentRecord,
  marker: DetachedAttachmentMarker,
  generation: DocumentStoreSyncGeneration,
): Promise<boolean> {
  if (!detachedSyncContextIsCurrent(state, generation, requestRecord)) {
    return false;
  }
  await deleteLocalAttachmentRecord(
    state,
    marker.slotId,
    marker.storageKey,
    currentDoc,
  );
  if (!detachedSyncContextIsCurrent(state, generation, requestRecord)) {
    return false;
  }
  await state.runtime.infra.blobStore.deleteBytes(marker.storageKey);
  return detachedSyncContextIsCurrent(state, generation, requestRecord);
}

async function syncDetachedAttachmentBinding(input: {
  binding: DocumentAttachmentBinding;
  generation: DocumentStoreSyncGeneration;
  remoteDocumentId: string;
  requestRecord: DocumentRecord;
  state: DocumentStoreState;
}): Promise<boolean> {
  const { binding, generation, requestRecord, state } = input;
  const contextIsCurrent = () =>
    detachedSyncContextIsCurrent(state, generation, requestRecord);
  if (!contextIsCurrent()) return false;

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
  let remoteSyncBlocked = false;
  const baseDetachInput = {
    apiClient: state.runtime.apiClient,
    author,
    bindingId: binding.bindingId,
    blobId: binding.blobId,
    documentId: input.remoteDocumentId,
    execSql: generation.execSql,
    isRemoteSyncBlocked: (organizationId: string) => {
      remoteSyncBlocked =
        state.runtime.util.isRemoteSyncBlocked?.(organizationId) ?? false;
      return remoteSyncBlocked;
    },
    resolveProjectionUserKey: generation.resolveProjectionUserKey,
    slotId: binding.slotId,
  };
  let detached = await detachDocumentAttachment({
    ...baseDetachInput,
    writerProjection: writerProjection ?? undefined,
  });
  if (!contextIsCurrent()) return false;
  if (!detached && writerProjection && !remoteSyncBlocked) {
    state.writerProjection = null;
    detached = await detachDocumentAttachment(baseDetachInput);
    if (!contextIsCurrent()) return false;
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
