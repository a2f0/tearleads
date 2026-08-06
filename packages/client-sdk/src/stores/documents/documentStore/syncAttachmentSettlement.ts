import type { uploadPreparedDocumentAttachment as uploadDocumentAttachment } from "../../../workflows/blobs/upload";
import type { PendingAttachmentRecord } from "../../../workflows/documents";
import {
  deletePendingAttachment,
  saveLocalAttachmentRecord,
} from "./attachmentPersistence";
import type { AttachmentUploadLaneReporter } from "./attachmentUploadLane";
import {
  type DocumentAttachmentBinding,
  type DocumentState,
  type DocumentStoreState,
  setReadySnapshot,
} from "./state";
import {
  type DocumentStoreSyncGeneration,
  isDocumentStoreSyncGenerationCurrent,
} from "./syncGeneration";

export function removeSettledPendingAttachment(
  state: DocumentStoreState,
  currentDoc: DocumentState,
  pendingAttachment: PendingAttachmentRecord,
): void {
  // Every non-retry outcome removed the durable row: uploaded now, recovered
  // after an ambiguous response, or discarded because local bytes vanished.
  state.pendingAttachments = state.pendingAttachments.filter(
    (attachment) => attachment !== pendingAttachment,
  );
  if (currentDoc !== state.doc) {
    return;
  }

  // Republish progressively so the attachment drops its syncing badge even if
  // a later attachment returns retry before the loop finishes.
  setReadySnapshot(
    state,
    currentDoc,
    state.snapshot.syncing,
    state.snapshot.text,
    state.snapshot.structuredFields,
  );
}

export async function settleUploadedAttachment(input: {
  activeBindingBySlotId: Map<string, DocumentAttachmentBinding>;
  attachmentGeneration: DocumentStoreSyncGeneration;
  pendingAttachment: PendingAttachmentRecord;
  remoteDocumentId: string;
  state: DocumentStoreState;
  uploaded: NonNullable<Awaited<ReturnType<typeof uploadDocumentAttachment>>>;
  uploadLane: AttachmentUploadLaneReporter;
}): Promise<void> {
  const { pendingAttachment, state, uploaded } = input;
  // A teardown (reset/discard) during the upload's awaits deleted the rows
  // this settle would rewrite; the remote commit stands, and the re-pull owns
  // reconciling it. Complete the lane so no phantom upload stays running.
  if (
    !isDocumentStoreSyncGenerationCurrent(state, input.attachmentGeneration)
  ) {
    input.uploadLane.complete();
    return;
  }
  await persistSettledAttachment(
    state,
    pendingAttachment,
    uploaded.blobId,
    input.attachmentGeneration,
  );
  input.activeBindingBySlotId.set(pendingAttachment.slotId, {
    bindingId: uploaded.bindingId,
    blobId: uploaded.blobId,
    contentKeyBundle: uploaded.response.contentKeyBundle,
    slotId: pendingAttachment.slotId,
  });
  state.writerProjection = uploaded.writerProjection;
  input.uploadLane.complete();
  state.runtime.util.log(
    `Uploaded attachment ${pendingAttachment.name} for document ${input.remoteDocumentId}.`,
  );
}

export async function settleRecoveredAttachment(input: {
  attachmentGeneration: DocumentStoreSyncGeneration;
  binding: DocumentAttachmentBinding;
  pendingAttachment: PendingAttachmentRecord;
  remoteDocumentId: string;
  state: DocumentStoreState;
  uploadLane: AttachmentUploadLaneReporter;
}): Promise<void> {
  // See settleUploadedAttachment: never rewrite rows a teardown just removed.
  if (
    !isDocumentStoreSyncGenerationCurrent(
      input.state,
      input.attachmentGeneration,
    )
  ) {
    input.uploadLane.complete();
    return;
  }
  await persistSettledAttachment(
    input.state,
    input.pendingAttachment,
    input.binding.blobId,
    input.attachmentGeneration,
  );
  input.uploadLane.complete();
  input.state.runtime.util.log(
    `Recovered uploaded attachment ${input.pendingAttachment.name} for document ${input.remoteDocumentId}.`,
  );
}

async function persistSettledAttachment(
  state: DocumentStoreState,
  pendingAttachment: PendingAttachmentRecord,
  blobId: string,
  attachmentGeneration: DocumentStoreSyncGeneration,
): Promise<void> {
  // The save validates the generation inside its serialized mutation, so a
  // teardown racing this settle can never see its rows re-inserted.
  await saveLocalAttachmentRecord(
    state,
    {
      blobId,
      byteLength: pendingAttachment.byteLength,
      detachedAt: null,
      localId: state.localId,
      mimeType: pendingAttachment.mimeType,
      slotId: pendingAttachment.slotId,
      storageKey: pendingAttachment.storageKey,
    },
    state.doc,
    attachmentGeneration,
  );
  await deletePendingAttachment(
    state,
    pendingAttachment.slotId,
    pendingAttachment.storageKey,
    attachmentGeneration,
  );
}

export function isNewPendingAttachmentSlot(
  state: DocumentStoreState,
  pendingAttachment: PendingAttachmentRecord,
): boolean {
  // Fresh slots use a deterministic key; replacements append a UUID.
  return (
    pendingAttachment.storageKey ===
    `${state.localId}-${pendingAttachment.slotId}`
  );
}
