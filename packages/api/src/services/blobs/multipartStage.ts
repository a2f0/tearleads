import { blobStages } from "@symcrypt/api-shared/schema";
import type {
  CompleteMultipartBlobStageRequest,
  InitiateMultipartBlobStageRequest,
} from "@symcrypt/validators/request";
import type {
  CompleteMultipartBlobStageResponse,
  InitiateMultipartBlobStageResponse,
  MultipartBlobStageStatusResponse,
  UploadMultipartBlobPartResponse,
} from "@symcrypt/validators/response";
import { eq, inArray, lte } from "drizzle-orm";
import {
  BlobObjectStoreError,
  type CompletedBlobObject,
} from "../../adapters/blobObjectStore";
import { summarizeSha256Stream } from "../../utils/sha256";
import {
  loadOwnedActiveBlobStage,
  type OwnedActiveBlobStage,
} from "../../workflows/blobs/stageAccess";
import type { ApiServiceRuntime } from "../runtime";

type MultipartBlobStageStatus = 400 | 403 | 404 | 409 | 500;

interface AuthenticatedMultipartBlobStageInput {
  readonly stageId: string;
  readonly userId: string;
}

export interface CleanupExpiredBlobStagesInput {
  readonly limit?: number | undefined;
  readonly now?: Date | undefined;
}

interface CleanupExpiredBlobStagesResult {
  readonly abortedMultipartUploads: number;
  readonly deletedMultipartObjects: number;
  readonly deletedStages: number;
  readonly failedStages: number;
  readonly scannedStages: number;
}

interface UploadMultipartBlobPartInput
  extends AuthenticatedMultipartBlobStageInput {
  readonly byteLength: number;
  readonly bytes: Uint8Array;
  readonly partNumber: number;
  readonly sha256: string;
  readonly uploadId: string;
}

export class MultipartBlobStageError extends Error {
  constructor(
    message: string,
    readonly status: MultipartBlobStageStatus,
  ) {
    super(message);
    this.name = "MultipartBlobStageError";
  }
}

function toMultipartBlobStageError(
  error: unknown,
): MultipartBlobStageError | null {
  if (!(error instanceof BlobObjectStoreError)) {
    return null;
  }

  if (error.code === "not_found") {
    return new MultipartBlobStageError(error.message, 404);
  }
  if (error.code === "upload_conflict") {
    return new MultipartBlobStageError(error.message, 409);
  }

  return new MultipartBlobStageError(error.message, 400);
}

function storageKeyForStage(stageId: string): string {
  return `blob-stages/${stageId}`;
}

function normalizeCleanupLimit(limit: number | undefined): number {
  if (limit === undefined) {
    return 100;
  }
  if (!Number.isInteger(limit) || limit <= 0) {
    throw new MultipartBlobStageError(
      "Blob stage cleanup limit must be a positive integer",
      400,
    );
  }

  return limit;
}

function assertUploadIdMatches(input: {
  readonly expectedUploadId: string;
  readonly uploadId: string;
}): void {
  if (input.uploadId !== input.expectedUploadId) {
    throw new MultipartBlobStageError("Multipart upload id mismatch", 409);
  }
}

async function loadMultipartBlobStage(
  runtime: ApiServiceRuntime,
  input: AuthenticatedMultipartBlobStageInput,
): Promise<OwnedActiveBlobStage> {
  return loadOwnedActiveBlobStage(runtime.db, {
    error: (message, status) => new MultipartBlobStageError(message, status),
    stageId: input.stageId,
    userId: input.userId,
  });
}

async function listStageParts(
  runtime: ApiServiceRuntime,
  stage: OwnedActiveBlobStage,
) {
  if (stage.completedAt !== null) {
    return [];
  }

  return runtime.blobObjectStore.listParts({
    key: stage.storageKey,
    uploadId: stage.uploadId,
  });
}

export async function cleanupExpiredBlobStages(
  runtime: ApiServiceRuntime,
  input: CleanupExpiredBlobStagesInput = {},
): Promise<CleanupExpiredBlobStagesResult> {
  const now = input.now ?? new Date();
  const limit = normalizeCleanupLimit(input.limit);
  const stages = await runtime.db
    .select({
      completedAt: blobStages.completedAt,
      id: blobStages.id,
      storageKey: blobStages.storageKey,
      uploadId: blobStages.uploadId,
    })
    .from(blobStages)
    .where(lte(blobStages.expiresAt, now))
    .limit(limit);
  let abortedMultipartUploads = 0;
  let deletedMultipartObjects = 0;
  let deletedStages = 0;
  let failedStages = 0;
  const cleanedStageIds: string[] = [];

  for (const stage of stages) {
    try {
      if (stage.completedAt === null) {
        await runtime.blobObjectStore.abortMultipartUpload({
          key: stage.storageKey,
          uploadId: stage.uploadId,
        });
        abortedMultipartUploads += 1;
      } else {
        await runtime.blobObjectStore.deleteObject(stage.storageKey);
        deletedMultipartObjects += 1;
      }
      cleanedStageIds.push(stage.id);
    } catch {
      failedStages += 1;
    }
  }

  if (cleanedStageIds.length > 0) {
    const deletedRows = await runtime.db
      .delete(blobStages)
      .where(inArray(blobStages.id, cleanedStageIds))
      .returning({ id: blobStages.id });
    deletedStages = deletedRows.length;
  }

  return {
    abortedMultipartUploads,
    deletedMultipartObjects,
    deletedStages,
    failedStages,
    scannedStages: stages.length,
  };
}

export async function initiateMultipartBlobStage(
  runtime: ApiServiceRuntime,
  input: InitiateMultipartBlobStageRequest & { readonly userId: string },
): Promise<InitiateMultipartBlobStageResponse> {
  const stageId = crypto.randomUUID();
  const storageKey = storageKeyForStage(stageId);
  const expiresAt = new Date(Date.now() + 60 * 60 * 1000);

  try {
    const upload = await runtime.blobObjectStore.createMultipartUpload({
      key: storageKey,
    });

    try {
      await runtime.db.insert(blobStages).values({
        id: stageId,
        ownerUserId: input.userId,
        storageKey,
        uploadId: upload.uploadId,
        byteLength: input.byteLength,
        sha256: input.sha256,
        expiresAt,
      });
    } catch (error) {
      // Without the stage row, expiry cleanup cannot discover this upload.
      // Abort it best-effort and preserve the database failure.
      await runtime.blobObjectStore
        .abortMultipartUpload({ key: storageKey, uploadId: upload.uploadId })
        .catch(() => {});
      throw error;
    }

    return {
      byteLength: input.byteLength,
      expiresAt: expiresAt.toISOString(),
      sha256: input.sha256,
      stageId,
      uploadId: upload.uploadId,
      uploadedParts: [],
    };
  } catch (error) {
    const multipartError = toMultipartBlobStageError(error);
    if (multipartError) {
      throw multipartError;
    }
    throw error;
  }
}

export async function getMultipartBlobStage(
  runtime: ApiServiceRuntime,
  input: AuthenticatedMultipartBlobStageInput,
): Promise<MultipartBlobStageStatusResponse> {
  try {
    const stage = await loadMultipartBlobStage(runtime, input);
    const uploadedParts = await listStageParts(runtime, stage);

    return {
      byteLength: stage.byteLength,
      completed: stage.completedAt !== null,
      expiresAt: stage.expiresAt.toISOString(),
      sha256: stage.sha256,
      stageId: stage.id,
      uploadId: stage.uploadId,
      uploadedParts: [...uploadedParts],
    };
  } catch (error) {
    const multipartError = toMultipartBlobStageError(error);
    if (multipartError) {
      throw multipartError;
    }
    throw error;
  }
}

export async function uploadMultipartBlobPartBytes(
  runtime: ApiServiceRuntime,
  input: UploadMultipartBlobPartInput,
): Promise<UploadMultipartBlobPartResponse> {
  try {
    const stage = await loadMultipartBlobStage(runtime, input);
    if (stage.completedAt !== null) {
      throw new MultipartBlobStageError(
        "Blob multipart stage is complete",
        409,
      );
    }
    assertUploadIdMatches({
      expectedUploadId: stage.uploadId,
      uploadId: input.uploadId,
    });

    const part = await runtime.blobObjectStore.uploadPart({
      body: {
        byteLength: input.byteLength,
        bytes: input.bytes,
        sha256: input.sha256,
      },
      key: stage.storageKey,
      partNumber: input.partNumber,
      uploadId: stage.uploadId,
    });

    return {
      part,
      stageId: stage.id,
      uploadId: stage.uploadId,
    };
  } catch (error) {
    const multipartError = toMultipartBlobStageError(error);
    if (multipartError) {
      throw multipartError;
    }
    throw error;
  }
}

function multipartStageCompleteResponse(
  stage: OwnedActiveBlobStage,
): CompleteMultipartBlobStageResponse {
  return {
    byteLength: stage.byteLength,
    expiresAt: stage.expiresAt.toISOString(),
    sha256: stage.sha256,
    stageId: stage.id,
  };
}

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
// uploadId is consumed, so completeMultipartUpload throws not_found. If the
// object survives, RE-VALIDATE its bytes before converging: a prior attempt may
// have assembled a mismatched object and crashed before deleting it, so
// existence alone must not bypass the size/digest check. Rethrows when the error
// is not a recoverable not_found or no object is present.
async function recoverCompletedMultipartStage(
  runtime: ApiServiceRuntime,
  stage: OwnedActiveBlobStage,
  error: unknown,
): Promise<CompleteMultipartBlobStageResponse> {
  if (!(error instanceof BlobObjectStoreError) || error.code !== "not_found") {
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
  return multipartStageCompleteResponse(stage);
}

export async function completeMultipartBlobStage(
  runtime: ApiServiceRuntime,
  input: AuthenticatedMultipartBlobStageInput &
    CompleteMultipartBlobStageRequest,
): Promise<CompleteMultipartBlobStageResponse> {
  try {
    const stage = await loadMultipartBlobStage(runtime, input);
    if (stage.completedAt !== null) {
      return multipartStageCompleteResponse(stage);
    }
    assertUploadIdMatches({
      expectedUploadId: stage.uploadId,
      uploadId: input.uploadId,
    });

    let completed: CompletedBlobObject;
    try {
      completed = await runtime.blobObjectStore.completeMultipartUpload({
        expected: {
          byteLength: stage.byteLength,
          sha256: stage.sha256,
        },
        key: stage.storageKey,
        parts: input.parts,
        uploadId: stage.uploadId,
      });
    } catch (error) {
      return await recoverCompletedMultipartStage(runtime, stage, error);
    }

    await assertCompletedMultipartObjectMatches(runtime, stage, completed);
    await markMultipartStageComplete(runtime, stage);
    return multipartStageCompleteResponse(stage);
  } catch (error) {
    const multipartError = toMultipartBlobStageError(error);
    if (multipartError) {
      throw multipartError;
    }
    throw error;
  }
}
