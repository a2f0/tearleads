import { createAesGcmIv } from "@tearleads/crypto";
import { base64ToBytes, bytesToBase64 } from "@tearleads/encoding";
import { markOriginatedDocuments } from "../../../sync/reconciliation/originatedDocuments";
import {
  type MultipartStageResolvedListener,
  type MultipartUploadProgressListener,
  uploadDocumentAttachment,
} from "../../../workflows/blobs";
import {
  type DocumentRecord,
  type PendingAttachmentRecord,
  type PendingAttachmentUploadIdentity,
  resolveDocumentCreateAuthor,
} from "../../../workflows/documents";
import { createRuntimePrincipalPolicyWarmer } from "../../../workflows/principals/runtimePolicyWarmer";
import {
  beginDomainSyncUploadLane,
  type UploadSyncLane,
} from "../../../workflows/sync";
import {
  deletePendingAttachment,
  saveLocalAttachmentRecord,
  savePendingAttachmentUpload,
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

// Preserve transient failures for retry. Drop irrecoverable missing bytes so a
// pending attachment cannot wedge the document sync lane across restarts.
type PendingAttachmentUploadOutcome = "uploaded" | "retry" | "dropped";

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

    const outcome = await syncPendingAttachmentUpload({
      activeBindingBySlotId,
      encapsulationKeyPair,
      pendingAttachment,
      remoteDocumentId,
      state,
    });
    if (outcome === "retry") {
      return {
        completed: completedSlotIds.size > 0,
        nextRecord: currentRecord,
      };
    }

    // "uploaded" or "dropped": the row is gone (uploaded successfully, or
    // discarded because its local bytes were missing). Either way remove it from
    // the in-memory queue and keep draining; only a real upload counts as
    // completed work.
    state.pendingAttachments = state.pendingAttachments.filter(
      (attachment) => attachment !== pendingAttachment,
    );
    if (outcome === "uploaded") {
      completedSlotIds.add(pendingAttachment.slotId);
    }
    // Republish progressively so a settled attachment drops its "syncing" badge
    // (derived from state.pendingAttachments) right away — otherwise a later
    // attachment that returns "retry", or a pass that drops everything without a
    // successful upload, would return before the end-of-loop publish and leave
    // an already-removed attachment stuck "syncing" in the UI.
    if (currentDoc === state.doc) {
      setReadySnapshot(
        state,
        currentDoc,
        state.snapshot.syncing,
        state.snapshot.text,
        state.snapshot.structuredFields,
      );
    }
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

  // The snapshot was already republished progressively inside the loop as each
  // attachment settled, so there is nothing left to publish here.
  return { completed: true, nextRecord: currentRecord };
}

function createPendingUploadIdentity(): PendingAttachmentUploadIdentity {
  // Generated once and persisted before the first upload attempt. Reusing these
  // on a retry makes the encryption byte-identical (same sha256), so the
  // multipart stage recorded in `stageId` can be resumed rather than orphaned.
  return {
    blobId: crypto.randomUUID(),
    contentKey: bytesToBase64(crypto.getRandomValues(new Uint8Array(32))),
    contentKeyEpoch: 1,
    iv: bytesToBase64(createAesGcmIv()),
    partSize: null,
    stageId: null,
  };
}

interface AttachmentUploadResume {
  readonly blobId: string;
  readonly contentKey: Uint8Array;
  readonly contentKeyEpoch: number;
  readonly iv: Uint8Array;
  readonly multipart: { partSize: number; resumeStageId: string } | undefined;
  readonly onStageResolved: MultipartStageResolvedListener;
}

/**
 * Resolve the upload inputs for a pending attachment so a retry reuses the same
 * identity: mint-and-persist one on the first attempt, and reuse (resuming the
 * recorded multipart stage) thereafter. The identity is attached to and mutated
 * on the pending record in place, so the sync loop keeps tracking it by
 * reference and still drops it after a settled upload.
 */
async function resolveAttachmentUploadResume(
  state: DocumentStoreState,
  pendingAttachment: PendingAttachmentRecord,
): Promise<AttachmentUploadResume> {
  const uploadIdentity =
    pendingAttachment.upload ?? createPendingUploadIdentity();
  if (pendingAttachment.upload !== uploadIdentity) {
    pendingAttachment.upload = uploadIdentity;
    await savePendingAttachmentUpload(state, pendingAttachment);
  }

  const multipart =
    uploadIdentity.stageId !== null && uploadIdentity.partSize !== null
      ? {
          partSize: uploadIdentity.partSize,
          resumeStageId: uploadIdentity.stageId,
        }
      : undefined;

  const onStageResolved: MultipartStageResolvedListener = async ({
    partSize,
    stageId,
  }) => {
    if (
      uploadIdentity.stageId === stageId &&
      uploadIdentity.partSize === partSize
    ) {
      return;
    }
    uploadIdentity.partSize = partSize;
    uploadIdentity.stageId = stageId;
    await savePendingAttachmentUpload(state, pendingAttachment);
  };

  return {
    blobId: uploadIdentity.blobId,
    contentKey: base64ToBytes(uploadIdentity.contentKey),
    contentKeyEpoch: uploadIdentity.contentKeyEpoch,
    iv: base64ToBytes(uploadIdentity.iv),
    multipart,
    onStageResolved,
  };
}

async function settleUploadedAttachment(input: {
  activeBindingBySlotId: Map<string, DocumentAttachmentBinding>;
  pendingAttachment: PendingAttachmentRecord;
  remoteDocumentId: string;
  state: DocumentStoreState;
  uploaded: NonNullable<Awaited<ReturnType<typeof uploadDocumentAttachment>>>;
  uploadLane: AttachmentUploadLaneReporter;
}): Promise<void> {
  const { pendingAttachment, state, uploaded } = input;
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
  input.uploadLane.complete();
  state.runtime.util.log(
    `Uploaded attachment ${pendingAttachment.name} for document ${input.remoteDocumentId}.`,
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

async function syncPendingAttachmentUpload(input: {
  activeBindingBySlotId: Map<string, DocumentAttachmentBinding>;
  encapsulationKeyPair: EncapsulationKeyPair;
  pendingAttachment: PendingAttachmentRecord;
  remoteDocumentId: string;
  state: DocumentStoreState;
}): Promise<PendingAttachmentUploadOutcome> {
  const { pendingAttachment, state } = input;
  const bytes = await state.runtime.infra.blobStore.readBytes(
    pendingAttachment.storageKey,
  );
  if (!bytes) {
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

  const uploadLane = createAttachmentUploadLaneReporter({
    pendingAttachment,
    state,
  });
  const writerProjection =
    state.writerProjection?.documentId === input.remoteDocumentId
      ? state.writerProjection
      : null;
  const resume = await resolveAttachmentUploadResume(state, pendingAttachment);

  const baseUploadInput = {
    apiClient: state.runtime.apiClient,
    author,
    blobId: resume.blobId,
    bytes,
    contentKey: resume.contentKey,
    contentKeyEpoch: resume.contentKeyEpoch,
    documentId: input.remoteDocumentId,
    execSql: state.runtime.infra.execSql,
    expectedBindingId:
      input.activeBindingBySlotId.get(pendingAttachment.slotId)?.bindingId ??
      null,
    iv: resume.iv,
    multipart: resume.multipart,
    onMultipartProgress: uploadLane.onMultipartProgress,
    onStageResolved: resume.onStageResolved,
    resolveProjectionUserKey: state.resolveProjectionUserKey,
    slotId: pendingAttachment.slotId,
    targetSecretKey: input.encapsulationKeyPair.secretKey,
    warmReferencedPrincipalPolicies: createRuntimePrincipalPolicyWarmer(
      state.runtime,
    ),
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
    return "retry";
  }

  await settleUploadedAttachment({
    activeBindingBySlotId: input.activeBindingBySlotId,
    pendingAttachment,
    remoteDocumentId: input.remoteDocumentId,
    state,
    uploaded,
    uploadLane,
  });
  return "uploaded";
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
