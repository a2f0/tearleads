import { blobStages } from "@tearleads/api-shared/schema";
import { eq } from "drizzle-orm";
import {
  type BlobObjectPart,
  BlobObjectStoreError,
  type CompletedBlobObject,
} from "../../adapters/blobObjectStore";
import { summarizeSha256Stream } from "../../utils/sha256";
import type { OwnedActiveBlobStage } from "../../workflows/blobs/stageAccess";
import type { ApiServiceRuntime } from "../runtime";
import { MultipartBlobStageError } from "./multipartStageAccess";

// Flip the still-pending stage record to complete. This is a separate write
// from the object-store byte commit and cannot share a transaction with it, so
// completion convergence is retry-driven (see the recovery path below).
async function markMultipartStageComplete(
  runtime: ApiServiceRuntime,
  stage: OwnedActiveBlobStage,
): Promise<void> {
  await runtime.db
    .update(blobStages)
    .set({
      completedAt: new Date(),
    })
    .where(eq(blobStages.id, stage.id));
}

// Fail closed unless the assembled object matches the stage's expected size and
// digest, deleting the invalid object first. Shared by the first-attempt path
// (validating the store's completion result) and the recovery path (validating
// a surviving object), so recovery can never accept an object first-attempt
// validation would reject.
async function assertCompletedMultipartObjectMatches(
  runtime: ApiServiceRuntime,
  stage: OwnedActiveBlobStage,
  assembled: { readonly byteLength: number; readonly sha256: string },
): Promise<void> {
  if (assembled.byteLength !== stage.byteLength) {
    await runtime.blobObjectStore.deleteObject(stage.storageKey);
    throw new MultipartBlobStageError(
      "Blob byteLength does not match multipart upload",
      409,
    );
  }
  if (assembled.sha256 !== stage.sha256) {
    await runtime.blobObjectStore.deleteObject(stage.storageKey);
    throw new MultipartBlobStageError(
      "Blob sha256 does not match multipart upload",
      409,
    );
  }
}

// Idempotent recovery for a retry after the object was assembled but the state
// flip never committed (byte commit + row flip can't share a transaction). The
// uploadId is consumed, so the store reports the missing upload. If the object
// survives, RE-VALIDATE its bytes before converging: a prior attempt may have
// assembled a mismatched object and crashed before deleting it, so existence
// alone must not bypass the size/digest check. Rethrows when the error is not
// a recoverable absence or no object is present.
export async function recoverAssembledMultipartStage(
  runtime: ApiServiceRuntime,
  stage: OwnedActiveBlobStage,
  error: unknown,
): Promise<void> {
  if (
    !(error instanceof BlobObjectStoreError) ||
    error.code !== "multipart_upload_not_found"
  ) {
    throw error;
  }
  const existing = await runtime.blobObjectStore.getObjectStream(
    stage.storageKey,
  );
  if (!existing) {
    throw error;
  }
  const assembled = await summarizeSha256Stream(existing);
  await assertCompletedMultipartObjectMatches(runtime, stage, assembled);
  await markMultipartStageComplete(runtime, stage);
}

async function listUploadedParts(
  runtime: ApiServiceRuntime,
  stage: OwnedActiveBlobStage,
): Promise<readonly BlobObjectPart[] | null> {
  try {
    return await runtime.blobObjectStore.listParts({
      key: stage.storageKey,
      uploadId: stage.uploadId,
    });
  } catch (error) {
    await recoverAssembledMultipartStage(runtime, stage, error);
    return null;
  }
}

/**
 * Assemble a stage's uploaded parts and verify the object's exact length and
 * SHA-256 before marking the stage complete. Attachment binding calls this, so
 * a client sends no separate completion request. The parts are the ones the
 * object store holds for the stage's upload id, and whatever they assemble to
 * must match the size and digest declared at initiation, or the object is
 * deleted and the bind refused. Idempotent: a complete stage returns at once,
 * and an object assembled before a lost state flip is re-verified and adopted.
 */
export async function completeOwnedMultipartStage(
  runtime: ApiServiceRuntime,
  stage: OwnedActiveBlobStage,
): Promise<void> {
  if (stage.completedAt !== null) {
    return;
  }
  const parts = await listUploadedParts(runtime, stage);
  if (parts === null) {
    return;
  }
  if (parts.length === 0) {
    throw new MultipartBlobStageError(
      "Blob multipart stage has no uploaded parts",
      409,
    );
  }

  let completed: CompletedBlobObject;
  try {
    completed = await runtime.blobObjectStore.completeMultipartUpload({
      expected: {
        byteLength: stage.byteLength,
        sha256: stage.sha256,
      },
      key: stage.storageKey,
      parts: parts.map(({ etag, partNumber }) => ({ etag, partNumber })),
      uploadId: stage.uploadId,
    });
  } catch (error) {
    await recoverAssembledMultipartStage(runtime, stage, error);
    return;
  }

  await assertCompletedMultipartObjectMatches(runtime, stage, completed);
  await markMultipartStageComplete(runtime, stage);
}
