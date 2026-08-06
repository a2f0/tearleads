import { createAesGcmIv } from "@tearleads/crypto";
import { base64ToBytes, bytesToBase64 } from "@tearleads/encoding";
import type { MultipartStageResolvedListener } from "../../../workflows/blobs";
import type {
  PendingAttachmentRecord,
  PendingAttachmentUploadIdentity,
} from "../../../workflows/documents";
import { savePendingAttachmentUpload } from "./attachmentPersistence";
import type { DocumentStoreState } from "./state";
import {
  type DocumentStoreSyncGeneration,
  isDocumentStoreSyncGenerationCurrent,
} from "./syncGeneration";

function createPendingUploadIdentity(
  plaintextSha256: string,
): PendingAttachmentUploadIdentity {
  // Generated once and persisted before the first upload attempt. The source
  // digest derives an envelope IV from this seed, then each chunk derives its
  // IV. Reusing the material for unchanged bytes makes retries byte-identical.
  return {
    blobId: crypto.randomUUID(),
    contentKey: bytesToBase64(crypto.getRandomValues(new Uint8Array(32))),
    contentKeyEpoch: 1,
    nonceSeed: bytesToBase64(createAesGcmIv()),
    partSize: null,
    plaintextSha256,
    stageId: null,
  };
}

export interface AttachmentUploadResume {
  readonly blobId: string;
  readonly contentKey: Uint8Array;
  readonly contentKeyEpoch: number;
  readonly nonceSeed: Uint8Array;
  readonly multipart: { partSize: number; resumeStageId: string } | undefined;
  readonly onStageResolved: MultipartStageResolvedListener;
}

/**
 * Resolve and persist stable encryption and multipart inputs across retries.
 *
 * Every persist here is an UPSERT of the pending-attachment row, so each one
 * is generation-gated: a store teardown (reset/discard) deletes that row on
 * purpose, and a stale resume racing it would otherwise re-insert the row it
 * just removed. Skipping the persist only costs retry resumability.
 */
export async function resolveAttachmentUploadResume(
  state: DocumentStoreState,
  pendingAttachment: PendingAttachmentRecord,
  plaintextSha256: string,
  attachmentGeneration: DocumentStoreSyncGeneration,
): Promise<AttachmentUploadResume> {
  const uploadIdentity =
    pendingAttachment.upload?.plaintextSha256 === plaintextSha256
      ? pendingAttachment.upload
      : createPendingUploadIdentity(plaintextSha256);
  if (
    pendingAttachment.upload !== uploadIdentity &&
    isDocumentStoreSyncGenerationCurrent(state, attachmentGeneration)
  ) {
    pendingAttachment.upload = uploadIdentity;
    await savePendingAttachmentUpload(
      state,
      pendingAttachment,
      attachmentGeneration,
    );
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
    if (!isDocumentStoreSyncGenerationCurrent(state, attachmentGeneration)) {
      return;
    }
    uploadIdentity.partSize = partSize;
    uploadIdentity.stageId = stageId;
    await savePendingAttachmentUpload(
      state,
      pendingAttachment,
      attachmentGeneration,
    );
  };

  return {
    blobId: uploadIdentity.blobId,
    contentKey: base64ToBytes(uploadIdentity.contentKey),
    contentKeyEpoch: uploadIdentity.contentKeyEpoch,
    nonceSeed: base64ToBytes(uploadIdentity.nonceSeed),
    multipart,
    onStageResolved,
  };
}
