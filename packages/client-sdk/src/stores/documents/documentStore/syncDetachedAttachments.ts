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
): Promise<PendingMutationSyncResult> {
  const currentDoc = generation.currentDoc;
  if (
    !currentDoc ||
    !detachedSyncContextIsCurrent(state, generation, nextRecord)
  ) {
    return { completed: false, nextRecord };
  }

  const detachedMarkers = listDetachedAttachmentMarkers(state, currentDoc);
  if (detachedMarkers.length === 0) {
    return { completed: false, nextRecord };
  }

  if (!nextRecord.documentId) {
    const completed = await cleanupDetachedAttachmentMarkers(
      state,
      currentDoc,
      nextRecord,
      detachedMarkers,
      generation,
    );
    return { completed, nextRecord };
  }

  const remoteDocumentId = nextRecord.documentId;
  const remoteBindings =
    await state.runtime.apiClient.listDocumentAttachments(remoteDocumentId);
  if (
    !remoteBindings ||
    !detachedSyncContextIsCurrent(state, generation, nextRecord)
  ) {
    return { completed: false, nextRecord };
  }

  let completed = false;
  const activeBindingBySlotId = new Map(
    remoteBindings.map((binding) => [binding.slotId, binding]),
  );

  for (const marker of detachedMarkers) {
    if (!detachedSyncContextIsCurrent(state, generation, nextRecord)) {
      return { completed, nextRecord };
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
        return { completed, nextRecord };
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
      return { completed, nextRecord };
    }
    completed = true;
  }

  return { completed, nextRecord };
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
): Promise<boolean> {
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
      return false;
    }
  }
  return true;
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
