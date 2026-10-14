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
  reader?: AssembledObjectReader,
): Promise<CompletedBlobObject> {
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
  reader?.restart();
  const assembled = await summarizeSha256Stream(existing, reader?.observe);
  await assertCompletedMultipartObjectMatches(runtime, stage, assembled);
  await markMultipartStageComplete(runtime, stage);
  return assembled;
}

/**
 * Sees every byte of the assembled object during the one read that digests
 * it. `restart` precedes each read, so a reader never mixes two reads' bytes.
 */
export interface AssembledObjectReader {
  readonly observe: (chunk: Uint8Array) => void;
  restart(): void;
}

type UploadedParts =
  | { readonly parts: readonly BlobObjectPart[] }
  | { readonly recovered: CompletedBlobObject };

async function listUploadedParts(
  runtime: ApiServiceRuntime,
  stage: OwnedActiveBlobStage,
  reader: AssembledObjectReader | undefined,
): Promise<UploadedParts> {
  try {
    return {
      parts: await runtime.blobObjectStore.listParts({
        key: stage.storageKey,
        uploadId: stage.uploadId,
      }),
    };
  } catch (error) {
    return {
      recovered: await recoverAssembledMultipartStage(
        runtime,
        stage,
        error,
        reader,
      ),
    };
  }
}

/**
 * The parts that assemble the declared object: parts 1..k, in order, whose
 * lengths add up to exactly the declared byte length. A part numbered past
 * them is left out (completing a subset discards it), so a stray part cannot
 * change the object; a gap, or a run that misses the declared length, is
 * refused before the upload is consumed, so the missing part can still come.
 */
function selectDeclaredParts(
  parts: readonly BlobObjectPart[],
  byteLength: number,
): readonly BlobObjectPart[] {
  if (parts.length === 0) {
    throw new MultipartBlobStageError(
      "Blob multipart stage has no uploaded parts",
      409,
    );
  }
  const byNumber = new Map(parts.map((part) => [part.partNumber, part]));
  const selected: BlobObjectPart[] = [];
  let total = 0;
  for (let partNumber = 1; total < byteLength; partNumber += 1) {
    const part = byNumber.get(partNumber);
    if (!part) {
      // Name the first gap: it is the part an upload resume must send.
      throw new MultipartBlobStageError(
        `Blob multipart stage is missing part ${partNumber}`,
        409,
      );
    }
    selected.push(part);
    total += part.byteLength;
  }
  if (total !== byteLength) {
    throw new MultipartBlobStageError(
      "Blob multipart stage parts do not cover its declared length",
      409,
    );
  }
  return selected;
}

/**
 * Assemble a stage's uploaded parts and verify the object's exact length and
 * SHA-256 before marking the stage complete. Attachment binding calls this, so
 * a client sends no separate completion request. The parts are the run of
 * parts the object store holds for the stage's upload id that covers the
 * declared length, and what they assemble to must match the digest declared
 * at initiation, or the object is deleted and the bind refused. Returns the
 * digest of the one read that verified the object, which `reader` also saw;
 * null when the stage was already complete, so this call read nothing.
 * Idempotent: an object assembled before a lost state flip is re-verified and
 * adopted.
 */
export async function completeOwnedMultipartStage(
  runtime: ApiServiceRuntime,
  stage: OwnedActiveBlobStage,
  reader?: AssembledObjectReader,
): Promise<CompletedBlobObject | null> {
  if (stage.completedAt !== null) {
    return null;
  }
  const uploaded = await listUploadedParts(runtime, stage, reader);
  if ("recovered" in uploaded) {
    return uploaded.recovered;
  }
  const declaredParts = selectDeclaredParts(uploaded.parts, stage.byteLength);

  let completed: CompletedBlobObject;
  try {
    reader?.restart();
    completed = await runtime.blobObjectStore.completeMultipartUpload({
      expected: {
        byteLength: stage.byteLength,
        sha256: stage.sha256,
      },
      key: stage.storageKey,
      observe: reader?.observe,
      parts: declaredParts.map(({ etag, partNumber }) => ({
        etag,
        partNumber,
      })),
      uploadId: stage.uploadId,
    });
  } catch (error) {
    return recoverAssembledMultipartStage(runtime, stage, error, reader);
  }

  await assertCompletedMultipartObjectMatches(runtime, stage, completed);
  await markMultipartStageComplete(runtime, stage);
  return completed;
}
