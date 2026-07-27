import type { BlobByteSource } from "../../../data/blobContracts";
import type { BlobSourceSnapshot } from "../../../data/documents/blob/shared/blobSourceSnapshot";
import { markOriginatedDocuments } from "../../../sync/reconciliation/originatedDocuments";
import type { uploadPreparedDocumentAttachment as uploadDocumentAttachment } from "../../../workflows/blobs/upload";
import {
  clearDocumentSyncFailure,
  DOCUMENTS_APP_KIND,
  type DocumentRecord,
  type PendingAttachmentRecord,
  recordDocumentSyncFailure,
  resolveDocumentCreateAuthor,
  runSerializedSqlMutation,
} from "../../../workflows/documents";
import { createRuntimePrincipalPolicyWarmer } from "../../../workflows/principals/runtimePolicyWarmer";
import { resolveAttachmentSourceUpload } from "./attachmentSourceUpload";
import { uploadAttachmentWithWriterProjectionRetry } from "./attachmentUploadAttempt";
import {
  type AttachmentUploadLaneReporter,
  createAttachmentUploadFailedError,
  createAttachmentUploadLaneReporter,
} from "./attachmentUploadLane";
import type { AttachmentUploadResume } from "./attachmentUploadResume";
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
import {
  captureDocumentStoreSyncGeneration,
  type DocumentStoreSyncGeneration,
  isDocumentStoreSyncGenerationCurrent,
} from "./syncGeneration";
import { ensureRemoteDocument } from "./syncShared";

// Preserve transient failures for retry. Drop irrecoverable missing bytes so a
// pending attachment cannot wedge the document sync lane across restarts.
type PendingAttachmentUploadOutcome =
  | "uploaded"
  | "recovered"
  | "retry"
  | "dropped";

interface AttachmentSyncProgress {
  activeBindingBySlotId: Map<string, DocumentAttachmentBinding>;
  fetchedRemoteBindings: boolean;
  settledAttachment: boolean;
  uploadedAttachment: boolean;
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

  // A store reset (runtime loss, remote deletion, or a local-edits discard)
  // mid-pass swaps or drops the live doc; every local write below would then
  // resurrect rows the teardown removed. Capture the generation now and stop
  // at the loop boundaries once it goes stale.
  const attachmentGeneration = captureDocumentStoreSyncGeneration(
    state,
    currentDoc,
  );
  if (!attachmentGeneration) {
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

  const progress: AttachmentSyncProgress = {
    activeBindingBySlotId: new Map(),
    fetchedRemoteBindings: false,
    settledAttachment: false,
    uploadedAttachment: false,
  };

  for (const pendingAttachment of [...state.pendingAttachments]) {
    if (!isDocumentStoreSyncGenerationCurrent(state, attachmentGeneration)) {
      return {
        completed: progress.settledAttachment,
        nextRecord: currentRecord,
      };
    }
    const bindingsReady = await loadRemoteAttachmentBindings({
      pendingAttachment,
      progress,
      remoteDocumentId,
      state,
    });
    if (!bindingsReady) {
      return {
        completed: progress.settledAttachment,
        nextRecord: currentRecord,
      };
    }

    const outcome = await syncPendingAttachmentUpload({
      activeBindingBySlotId: progress.activeBindingBySlotId,
      attachmentGeneration,
      encapsulationKeyPair,
      pendingAttachment,
      remoteDocumentId,
      state,
    });
    if (outcome === "retry") {
      return {
        completed: progress.settledAttachment,
        nextRecord: currentRecord,
      };
    }

    // Re-check after the upload's awaits: settling writes local rows, which a
    // teardown that happened mid-upload has just deleted on purpose.
    if (!isDocumentStoreSyncGenerationCurrent(state, attachmentGeneration)) {
      return {
        completed: progress.settledAttachment,
        nextRecord: currentRecord,
      };
    }
    removeSettledPendingAttachment(state, currentDoc, pendingAttachment);
    if (outcome === "uploaded" || outcome === "recovered") {
      progress.settledAttachment = true;
    }
    if (outcome === "uploaded") {
      progress.uploadedAttachment = true;
    }
  }

  if (!progress.settledAttachment) {
    return { completed: false, nextRecord: currentRecord };
  }

  // Only record the origination once a write actually landed: the server echoes
  // a document_update_created for it, and this lets the reconciler skip
  // re-discovering a delta we already have locally rather than cycling its lane
  // per uploaded file. Marking here (not before the loop) avoids a dangling id
  // that would suppress the next genuine remote update if every upload failed.
  if (progress.uploadedAttachment) {
    markOriginatedDocuments(state.runtime.state.domainScope, [
      remoteDocumentId,
    ]);
  }

  // A settled attachment pass invalidates any recorded failure itself: a
  // retried upload with no pending CRDT update never reaches the document
  // submission that would otherwise clear it, and the stale row would flag the
  // next unrelated edit as failed before it was attempted.
  await clearDocumentSyncFailure(state.runtime.infra.execSql, {
    appKind: DOCUMENTS_APP_KIND,
    localId: state.localId,
  });

  // The snapshot was already republished progressively inside the loop as each
  // attachment settled, so there is nothing left to publish here.
  return { completed: true, nextRecord: currentRecord };
}

async function loadRemoteAttachmentBindings(input: {
  pendingAttachment: PendingAttachmentRecord;
  progress: AttachmentSyncProgress;
  remoteDocumentId: string;
  state: DocumentStoreState;
}): Promise<boolean> {
  const { pendingAttachment, progress, state } = input;
  const freshUpload =
    pendingAttachment.upload == null &&
    isNewPendingAttachmentSlot(state, pendingAttachment);
  if (progress.fetchedRemoteBindings || freshUpload) {
    return true;
  }

  const remoteBindings = await state.runtime.apiClient.listDocumentAttachments(
    input.remoteDocumentId,
  );
  if (!remoteBindings) {
    return false;
  }

  progress.fetchedRemoteBindings = true;
  for (const binding of remoteBindings) {
    progress.activeBindingBySlotId.set(binding.slotId, binding);
  }
  return true;
}

function removeSettledPendingAttachment(
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

async function settleUploadedAttachment(input: {
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

async function settleRecoveredAttachment(input: {
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

interface PendingAttachmentUploadInput {
  activeBindingBySlotId: Map<string, DocumentAttachmentBinding>;
  attachmentGeneration: DocumentStoreSyncGeneration;
  encapsulationKeyPair: EncapsulationKeyPair;
  pendingAttachment: PendingAttachmentRecord;
  remoteDocumentId: string;
  state: DocumentStoreState;
}

async function recoverCommittedAttachment(
  input: PendingAttachmentUploadInput,
): Promise<boolean> {
  const { pendingAttachment, state } = input;
  const persistedUpload = pendingAttachment.upload;
  const activeBinding = input.activeBindingBySlotId.get(
    pendingAttachment.slotId,
  );
  if (!persistedUpload || activeBinding?.blobId !== persistedUpload.blobId) {
    return false;
  }

  const uploadLane = createAttachmentUploadLaneReporter({
    blobId: persistedUpload.blobId,
    domainScope: state.runtime.state.domainScope,
    pendingAttachment,
  });
  try {
    await settleRecoveredAttachment({
      attachmentGeneration: input.attachmentGeneration,
      binding: activeBinding,
      pendingAttachment,
      remoteDocumentId: input.remoteDocumentId,
      state,
      uploadLane,
    });
    return true;
  } catch (error) {
    reportAttachmentUploadFailure({
      attachmentGeneration: input.attachmentGeneration,
      error,
      pendingAttachment,
      state,
      uploadLane,
    });
    throw error;
  }
}

function createAttachmentBaseUploadInput(input: {
  author: Parameters<typeof uploadDocumentAttachment>[0]["author"];
  pendingUpload: PendingAttachmentUploadInput;
  resume: AttachmentUploadResume;
  source: BlobByteSource;
  sourceSnapshot: BlobSourceSnapshot;
  uploadLane: AttachmentUploadLaneReporter;
}): Parameters<typeof uploadDocumentAttachment>[0] {
  const { pendingAttachment, state } = input.pendingUpload;
  return {
    apiClient: state.runtime.apiClient,
    author: input.author,
    blobId: input.resume.blobId,
    bytes: input.source,
    contentKey: input.resume.contentKey,
    contentKeyEpoch: input.resume.contentKeyEpoch,
    documentId: input.pendingUpload.remoteDocumentId,
    execSql: state.runtime.infra.execSql,
    expectedBindingId:
      input.pendingUpload.activeBindingBySlotId.get(pendingAttachment.slotId)
        ?.bindingId ?? null,
    nonceSeed: input.resume.nonceSeed,
    multipart: input.resume.multipart,
    onMultipartProgress: input.uploadLane.onMultipartProgress,
    onStageResolved: input.resume.onStageResolved,
    resolveProjectionUserKey: state.resolveProjectionUserKey,
    slotId: pendingAttachment.slotId,
    sourceSnapshot: input.sourceSnapshot,
    targetSecretKey: input.pendingUpload.encapsulationKeyPair.secretKey,
    warmReferencedPrincipalPolicies: createRuntimePrincipalPolicyWarmer(
      state.runtime,
    ),
  };
}

async function uploadPendingAttachmentBytes(input: {
  baseUploadInput: Parameters<typeof uploadDocumentAttachment>[0];
  pendingUpload: PendingAttachmentUploadInput;
  uploadLane: AttachmentUploadLaneReporter;
}): Promise<PendingAttachmentUploadOutcome> {
  const { pendingAttachment, state } = input.pendingUpload;
  const writerProjection =
    state.writerProjection?.documentId === input.pendingUpload.remoteDocumentId
      ? state.writerProjection
      : null;

  try {
    const uploadAttempt = await uploadAttachmentWithWriterProjectionRetry({
      baseUploadInput: input.baseUploadInput,
      state,
      writerProjection,
    });
    const { error: uploadError, remoteSyncBlocked, uploaded } = uploadAttempt;
    if (!uploaded) {
      if (remoteSyncBlocked) {
        input.uploadLane.failIfStarted(
          new Error("Attachment upload paused because remote sync is blocked."),
        );
        return "retry";
      }
      reportAttachmentUploadFailure({
        attachmentGeneration: input.pendingUpload.attachmentGeneration,
        error: uploadError,
        pendingAttachment,
        state,
        uploadLane: input.uploadLane,
      });
      return "retry";
    }

    await settleUploadedAttachment({
      activeBindingBySlotId: input.pendingUpload.activeBindingBySlotId,
      attachmentGeneration: input.pendingUpload.attachmentGeneration,
      pendingAttachment,
      remoteDocumentId: input.pendingUpload.remoteDocumentId,
      state,
      uploadLane: input.uploadLane,
      uploaded,
    });
    return "uploaded";
  } catch (error) {
    reportAttachmentUploadFailure({
      attachmentGeneration: input.pendingUpload.attachmentGeneration,
      error,
      pendingAttachment,
      state,
      uploadLane: input.uploadLane,
    });
    throw error;
  }
}

async function syncPendingAttachmentUpload(
  input: PendingAttachmentUploadInput,
): Promise<PendingAttachmentUploadOutcome> {
  const { pendingAttachment, state } = input;
  // The binding fetch before this call awaits; a teardown during it must not
  // let a brand-new upload start against rows that no longer exist.
  if (
    !isDocumentStoreSyncGenerationCurrent(state, input.attachmentGeneration)
  ) {
    return "retry";
  }
  if (await recoverCommittedAttachment(input)) {
    return "recovered";
  }

  const source = await state.runtime.infra.blobStore.openByteSource(
    pendingAttachment.storageKey,
  );
  if (!source) {
    // The local bytes are gone (rollback that deleted bytes but left the row, or
    // OPFS eviction), so this upload can never succeed. Drop the row instead of
    // returning a retry: leaving it would early-return runDocumentSyncPass on
    // every pass and block ALL of this document's CRDT sync forever, surviving
    // restarts, with no way to clear it.
    state.runtime.util.log(
      `Documents: dropping pending attachment ${pendingAttachment.slotId}; local bytes are missing and it can no longer be uploaded.`,
    );
    await deletePendingAttachment(
      state,
      pendingAttachment.slotId,
      pendingAttachment.storageKey,
      input.attachmentGeneration,
    );
    return "dropped";
  }

  const author = resolveDocumentCreateAuthor(state.runtime);
  if (!author) {
    state.runtime.util.log(
      "Documents: skipped attachment upload because the writer context is unavailable.",
    );
    return "retry";
  }

  const { resume, snapshot } = await resolveAttachmentSourceUpload({
    attachmentGeneration: input.attachmentGeneration,
    pendingAttachment,
    source,
    state,
  });
  // Preparation awaited (byte-source open plus resume resolution); a teardown
  // during those awaits must not let the upload itself start — its remote
  // commit could not be recalled once sent.
  if (
    !isDocumentStoreSyncGenerationCurrent(state, input.attachmentGeneration)
  ) {
    return "retry";
  }
  const uploadLane = createAttachmentUploadLaneReporter({
    blobId: resume.blobId,
    domainScope: state.runtime.state.domainScope,
    pendingAttachment,
  });
  const baseUploadInput = createAttachmentBaseUploadInput({
    author,
    pendingUpload: input,
    resume,
    source,
    sourceSnapshot: snapshot,
    uploadLane,
  });
  return uploadPendingAttachmentBytes({
    baseUploadInput,
    pendingUpload: input,
    uploadLane,
  });
}

function reportAttachmentUploadFailure(input: {
  attachmentGeneration: DocumentStoreSyncGeneration;
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
  // Surface the stuck upload in the write queue; a later successful sync pass
  // for the document clears the record. Validated inside the serialized
  // mutation: a teardown (reset/discard) racing this pass just cleared the
  // failure row, and re-recording it would resurrect a phantom queue entry
  // for work that no longer exists.
  void runSerializedSqlMutation(
    input.state.runtime.infra.execSql,
    async (lockedExecSql) => {
      if (
        !isDocumentStoreSyncGenerationCurrent(
          input.state,
          input.attachmentGeneration,
        )
      ) {
        return;
      }
      await recordDocumentSyncFailure(
        lockedExecSql,
        { appKind: DOCUMENTS_APP_KIND, localId: input.state.localId },
        {
          attemptedAt: new Date().toISOString(),
          message: error.message,
          status: null,
        },
      );
    },
  ).catch(() => undefined);
}
