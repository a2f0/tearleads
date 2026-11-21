import { isRejectedDecodedProjection } from "@tearleads/validators/response";
import type {
  BlobAttachmentService,
  BlobByteSource,
  BlobSourceSnapshot,
} from "../../../../workflows/blobs";
import type { PreparedUploadDocumentAttachmentRequest } from "../../../../workflows/blobs/upload";
import {
  type PendingAttachmentRecord,
  resolveDocumentCreateAuthor,
} from "../../../../workflows/documents";
import type { PrincipalPolicyOperation } from "../../../../workflows/principals/principalPolicyService";
import { requestDocumentStoreSync } from "../../registry";
import {
  pendingAttachmentDocumentVersion,
  recordDocumentChangedRefusal,
  settleDocumentChangedPasses,
} from "../attachmentUpload/attachmentDocumentVersion";
import {
  dropUnavailablePendingAttachment,
  matchingDocumentVersion,
  pendingAttachmentMatchesIntent,
  resolveAttachmentSourceUpload,
} from "../attachmentUpload/attachmentSourceUpload";
import { uploadAttachmentWithWriterProjectionRetry } from "../attachmentUpload/attachmentUploadAttempt";
import {
  type AttachmentUploadLaneReporter,
  createAttachmentUploadLaneReporter,
} from "../attachmentUpload/attachmentUploadLane";
import type { AttachmentUploadResume } from "../attachmentUpload/attachmentUploadResume";
import type { DocumentAttachmentBinding, DocumentStoreState } from "../state";
import { reportAttachmentUploadFailure } from "./attachmentUploadFailure";
import {
  type CarriedFirstUpdate,
  uploadCarryingFirstUpdate,
} from "./carriedFirstUpdate";
import {
  settleRecoveredAttachment,
  settleUploadedAttachment,
} from "./syncAttachmentSettlement";
import {
  type DocumentStoreSyncGeneration,
  isDocumentStoreSyncGenerationCurrent,
} from "./syncGeneration";

// Preserve transient failures for retry. Drop irrecoverable missing bytes so a
// pending attachment cannot wedge the document sync lane across restarts.
export type PendingAttachmentUploadOutcome =
  | "uploaded"
  | "recovered"
  | "retry"
  | "dropped";

export interface PendingAttachmentUploadInput {
  activeBindingBySlotId: Map<string, DocumentAttachmentBinding>;
  attachmentGeneration: DocumentStoreSyncGeneration;
  carriedFirstUpdate?: CarriedFirstUpdate | undefined;
  pendingAttachment: PendingAttachmentRecord;
  policyOperation: PrincipalPolicyOperation;
  /**
   * Pulls the document within this pass after the API refused a bind because
   * the document advanced; false when the pull is incomplete or stale.
   */
  pullDocument: () => Promise<boolean>;
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
  author: PreparedUploadDocumentAttachmentRequest["author"];
  checkedVersion: string;
  pendingUpload: PendingAttachmentUploadInput;
  resume: AttachmentUploadResume;
  source: BlobByteSource;
  sourceSnapshot: BlobSourceSnapshot;
  uploadLane: AttachmentUploadLaneReporter;
}): PreparedUploadDocumentAttachmentRequest {
  const { pendingAttachment, state } = input.pendingUpload;
  return {
    author: input.author,
    blobId: input.resume.blobId,
    bytes: input.source,
    contentKey: input.resume.contentKey,
    contentKeyEpoch: input.resume.contentKeyEpoch,
    documentId: input.pendingUpload.remoteDocumentId,
    documentSync: input.pendingUpload.carriedFirstUpdate?.request,
    expectedBindingId:
      input.pendingUpload.activeBindingBySlotId.get(pendingAttachment.slotId)
        ?.bindingId ?? null,
    nonceSeed: input.resume.nonceSeed,
    multipart: input.resume.multipart,
    onMultipartProgress: input.uploadLane.onMultipartProgress,
    onStageResolved: input.resume.onStageResolved,
    onStageUnavailable: async (stageId) => {
      await input.resume.onStageUnavailable(
        stageId,
        input.pendingUpload.remoteDocumentId,
      );
      requestDocumentStoreSync(state);
    },
    resolveProjectionUserKey: state.resolveProjectionUserKey,
    slotId: pendingAttachment.slotId,
    sourceSnapshot: input.sourceSnapshot,
    verifiedDocumentVersion: pendingAttachmentDocumentVersion({
      checkedVersion: input.checkedVersion,
      matchingVersion: () => matchingDocumentVersion(input.pendingUpload),
      pull: input.pendingUpload.pullDocument,
    }),
    warmReferencedPrincipalPolicies:
      state.runtime.principalPolicies.createWarmer({
        operation: input.pendingUpload.policyOperation,
      }),
  };
}

async function uploadPendingAttachmentBytes(input: {
  baseUploadInput: PreparedUploadDocumentAttachmentRequest;
  /** Read from the runtime the base input was built from. */
  blobAttachments: BlobAttachmentService;
  pendingUpload: PendingAttachmentUploadInput;
  uploadLane: AttachmentUploadLaneReporter;
}): Promise<PendingAttachmentUploadOutcome> {
  const { pendingAttachment, state } = input.pendingUpload;
  const writerProjection =
    state.writerProjection?.documentId ===
      input.pendingUpload.remoteDocumentId &&
    !isRejectedDecodedProjection(state.writerProjection)
      ? state.writerProjection
      : null;
  const writerProjectionGeneration = state.writerProjectionGeneration;

  try {
    const attempt = await uploadCarryingFirstUpdate({
      attachmentGeneration: input.pendingUpload.attachmentGeneration,
      carried: input.pendingUpload.carriedFirstUpdate,
      committed: (result) =>
        result.status === "uploaded"
          ? result.uploaded.response.documentSync
          : undefined,
      remoteDocumentId: input.pendingUpload.remoteDocumentId,
      state,
      upload: () =>
        uploadAttachmentWithWriterProjectionRetry({
          baseUploadInput: input.baseUploadInput,
          blobAttachments: input.blobAttachments,
          state,
          writerProjection,
        }),
    });
    if (attempt.status === "documentChanged") {
      if (recordDocumentChangedRefusal(state, pendingAttachment)) {
        // Another device committed inside every pull-then-bind window this
        // pass had. A fresh pass pulls, checks the slot, and binds the kept
        // stage against the newer version.
        input.uploadLane.failIfStarted(
          new Error("Attachment upload paused because the document changed."),
        );
        requestDocumentStoreSync(state);
        return "retry";
      }
    } else {
      settleDocumentChangedPasses(state, pendingAttachment);
    }
    if (attempt.status === "syncBlocked") {
      input.uploadLane.failIfStarted(
        new Error("Attachment upload paused because remote sync is blocked."),
      );
      return "retry";
    }
    if (attempt.status !== "uploaded") {
      reportAttachmentUploadFailure({
        attachmentGeneration: input.pendingUpload.attachmentGeneration,
        error: attempt.error,
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
      uploaded: attempt.uploaded,
      writerProjectionGeneration,
    });
    return "uploaded";
  } catch (error) {
    settleDocumentChangedPasses(state, pendingAttachment);
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

/** Uploads and binds one queued attachment, or settles why it cannot. */
export async function syncPendingAttachmentUpload(
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
  if (!pendingAttachmentMatchesIntent(input)) {
    return dropUnavailablePendingAttachment(input);
  }
  if (await recoverCommittedAttachment(input)) {
    return "recovered";
  }

  const source = await state.runtime.infra.blobStore.openByteSource(
    pendingAttachment.storageKey,
  );
  if (!source) {
    return dropUnavailablePendingAttachment(input);
  }

  const author = resolveDocumentCreateAuthor(state.runtime);
  if (!author) {
    state.runtime.util.log(
      "Documents: skipped attachment upload because the writer context is unavailable.",
    );
    return "retry";
  }

  const prepared = await resolveAttachmentSourceUpload({
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
  if (!prepared) return dropUnavailablePendingAttachment(input);
  const { checkedVersion, resume, snapshot } = prepared;
  const uploadLane = createAttachmentUploadLaneReporter({
    blobId: resume.blobId,
    domainScope: state.runtime.state.domainScope,
    pendingAttachment,
  });
  const baseUploadInput = createAttachmentBaseUploadInput({
    author,
    checkedVersion,
    pendingUpload: input,
    resume,
    source,
    sourceSnapshot: snapshot,
    uploadLane,
  });
  return uploadPendingAttachmentBytes({
    baseUploadInput,
    blobAttachments: state.runtime.blobAttachments,
    pendingUpload: input,
    uploadLane,
  });
}
