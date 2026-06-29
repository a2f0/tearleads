import { markOriginatedDocuments } from "../../../sync/reconciliation";
import {
  type MultipartUploadProgressListener,
  uploadDocumentAttachment,
} from "../../../workflows/blobs";
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

interface AttachmentUploadLaneReporter {
  complete: () => void;
  fail: (error: unknown) => void;
  onMultipartProgress: MultipartUploadProgressListener;
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

  // Only record the origination once a write actually landed: the server echoes
  // a document_update_created for it, and this lets the reconciler skip
  // re-discovering a delta we already have locally rather than cycling its lane
  // per uploaded file. Marking here (not before the loop) avoids a dangling id
  // that would suppress the next genuine remote update if every upload failed.
  markOriginatedDocuments(state.runtime.state.domainScope, [remoteDocumentId]);

  if (currentDoc === state.doc) {
    setReadySnapshot(
      state,
      currentDoc,
      state.snapshot.syncing,
      state.snapshot.text,
      state.snapshot.structuredFields,
    );
  }

  return { completed: true, nextRecord: currentRecord };
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

  const uploadLane = createAttachmentUploadLaneReporter({
    pendingAttachment,
    state,
  });

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
    onMultipartProgress: uploadLane.onMultipartProgress,
    resolveProjectionUserKey: state.resolveProjectionUserKey,
    slotId: pendingAttachment.slotId,
    targetSecretKey: input.encapsulationKeyPair.secretKey,
  };
  const uploadAttempt = await uploadAttachmentWithWriterProjectionRetry({
    baseUploadInput,
    state,
    writerProjection,
  });
  const { error: uploadError, uploaded } = uploadAttempt;
  if (!uploaded) {
    reportAttachmentUploadFailure({
      error: uploadError,
      pendingAttachment,
      state,
      uploadLane,
    });
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
  uploadLane.complete();
  state.runtime.util.log(
    `Uploaded attachment ${pendingAttachment.name} for document ${input.remoteDocumentId}.`,
  );
  return true;
}

async function uploadAttachmentWithWriterProjectionRetry(input: {
  baseUploadInput: Parameters<typeof uploadDocumentAttachment>[0];
  state: DocumentStoreState;
  writerProjection: DocumentStoreState["writerProjection"];
}): Promise<{
  error: unknown;
  uploaded: Awaited<ReturnType<typeof uploadDocumentAttachment>>;
}> {
  let uploadError: unknown;
  let uploaded = await tryUploadDocumentAttachment({
    input: {
      ...input.baseUploadInput,
      writerProjection: input.writerProjection ?? undefined,
    },
    onError: (error) => {
      uploadError = error;
    },
  });
  if (!uploaded && input.writerProjection) {
    // The stale writer projection was rejected; retry once without it.
    input.state.writerProjection = null;
    uploaded = await tryUploadDocumentAttachment({
      input: input.baseUploadInput,
      onError: (error) => {
        uploadError = error;
      },
    });
  }

  return { error: uploadError, uploaded };
}

function reportAttachmentUploadFailure(input: {
  error: unknown;
  pendingAttachment: PendingAttachmentRecord;
  state: DocumentStoreState;
  uploadLane: AttachmentUploadLaneReporter;
}): void {
  const error = createAttachmentUploadFailedError(
    input.pendingAttachment,
    input.error,
  );
  input.uploadLane.fail(error);
  input.state.runtime.util.log(`Documents: ${error.message}`);
}

async function tryUploadDocumentAttachment(input: {
  input: Parameters<typeof uploadDocumentAttachment>[0];
  onError: (error: unknown) => void;
}): ReturnType<typeof uploadDocumentAttachment> {
  try {
    return await uploadDocumentAttachment(input.input);
  } catch (error) {
    input.onError(error);
    return null;
  }
}

function getAttachmentUploadLaneLabel(name: string | null | undefined): string {
  return name ? `Upload ${name}` : "Attachment upload";
}

function getAttachmentUploadFailureTarget(
  pendingAttachment: PendingAttachmentRecord,
): string {
  return pendingAttachment.name
    ? `${pendingAttachment.name} (slot ${pendingAttachment.slotId})`
    : `slot ${pendingAttachment.slotId}`;
}

function createAttachmentUploadFailedError(
  pendingAttachment: PendingAttachmentRecord,
  cause: unknown,
): Error {
  const error = new Error(
    `Attachment upload failed for ${getAttachmentUploadFailureTarget(pendingAttachment)}.`,
  );
  if (cause !== undefined) Reflect.set(error, "cause", cause);

  return error;
}

// Surfaces multipart uploads as sync lanes, forcing lane creation on failure.
function createAttachmentUploadLaneReporter(input: {
  pendingAttachment: PendingAttachmentRecord;
  state: DocumentStoreState;
}): AttachmentUploadLaneReporter {
  const { pendingAttachment, state } = input;
  const laneRef: { current: UploadSyncLane | null } = { current: null };

  const ensureLane = (): UploadSyncLane => {
    if (!laneRef.current) {
      laneRef.current = beginDomainSyncUploadLane(
        state.runtime.state.domainScope,
        `blob-upload:${pendingAttachment.slotId}`,
        { label: getAttachmentUploadLaneLabel(pendingAttachment.name) },
      );
    }

    return laneRef.current;
  };

  const onMultipartProgress: MultipartUploadProgressListener = (progress) => {
    ensureLane().reportProgress(progress);
  };

  return {
    complete() {
      laneRef.current?.complete();
    },
    fail(error: unknown) {
      ensureLane().fail(error);
    },
    onMultipartProgress,
  };
}
