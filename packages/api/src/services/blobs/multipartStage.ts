import { blobStages } from "@tearleads/api-shared/schema";
import type {
  CompleteMultipartBlobStageRequest,
  InitiateMultipartBlobStageRequest,
  UploadMultipartBlobPartRequest,
} from "@tearleads/validators/request";
import type {
  CompleteMultipartBlobStageResponse,
  InitiateMultipartBlobStageResponse,
  MultipartBlobStageStatusResponse,
  UploadMultipartBlobPartResponse,
} from "@tearleads/validators/response";
import { eq, inArray, lte } from "drizzle-orm";
import {
  type BlobObjectReadStream,
  BlobObjectStoreError,
  type BlobObjectUploadPartBody,
  type CompletedBlobObject,
} from "../../adapters/blobObjectStore";
import {
  encodeMultipartBlobStageRecord,
  readMultipartBlobStageRecord,
} from "../../utils/blobStageRecords";
import { summarizeSha256Stream } from "../../utils/sha256";
import type { ApiServiceRuntime } from "../runtime";

type MultipartBlobStageStatus = 400 | 403 | 404 | 409 | 500;

interface AuthenticatedMultipartBlobStageInput {
  readonly stageId: string;
  readonly userId: string;
}

interface LoadedMultipartBlobStage {
  readonly byteLength: number;
  readonly expiresAt: Date;
  readonly id: string;
  readonly ownerUserId: string;
  readonly record: NonNullable<ReturnType<typeof readMultipartBlobStageRecord>>;
  readonly sha256: string;
}

export interface CleanupExpiredBlobStagesInput {
  readonly limit?: number | undefined;
  readonly now?: Date | undefined;
}

interface CleanupExpiredBlobStagesResult {
  readonly abortedMultipartUploads: number;
  readonly deletedLegacyStages: number;
  readonly deletedMultipartObjects: number;
  readonly deletedStages: number;
  readonly failedStages: number;
  readonly scannedStages: number;
}

interface UploadMultipartBlobPartStreamInput
  extends AuthenticatedMultipartBlobStageInput {
  readonly byteLength: number;
  readonly partNumber: number;
  readonly sha256: string;
  readonly stream: BlobObjectReadStream;
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

export function storageKeyForStage(stageId: string): string {
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

function assertStageIsPromotable(stage: LoadedMultipartBlobStage): void {
  if (stage.ownerUserId.length === 0) {
    throw new MultipartBlobStageError("Blob stage not found", 404);
  }
  if (stage.expiresAt.getTime() <= Date.now()) {
    throw new MultipartBlobStageError("Blob stage has expired", 409);
  }
}

async function loadMultipartBlobStage(
  runtime: ApiServiceRuntime,
  input: AuthenticatedMultipartBlobStageInput,
): Promise<LoadedMultipartBlobStage> {
  const [stage] = await runtime.db
    .select({
      byteLength: blobStages.byteLength,
      encryptedBytes: blobStages.encryptedBytes,
      expiresAt: blobStages.expiresAt,
      id: blobStages.id,
      ownerUserId: blobStages.ownerUserId,
      sha256: blobStages.sha256,
    })
    .from(blobStages)
    .where(eq(blobStages.id, input.stageId))
    .limit(1);

  if (!stage) {
    throw new MultipartBlobStageError("Blob stage not found", 404);
  }
  if (stage.ownerUserId !== input.userId) {
    throw new MultipartBlobStageError("Forbidden", 403);
  }

  const record = readMultipartBlobStageRecord(stage.encryptedBytes);
  if (!record) {
    throw new MultipartBlobStageError("Blob stage is not multipart", 409);
  }

  const loaded = { ...stage, record };
  assertStageIsPromotable(loaded);

  return loaded;
}

async function listStageParts(
  runtime: ApiServiceRuntime,
  stage: LoadedMultipartBlobStage,
) {
  if (stage.record.state === "complete") {
    return [];
  }

  return runtime.blobObjectStore.listParts({
    key: stage.record.storageKey,
    uploadId: stage.record.uploadId,
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
      encryptedBytes: blobStages.encryptedBytes,
      id: blobStages.id,
    })
    .from(blobStages)
    .where(lte(blobStages.expiresAt, now))
    .limit(limit);
  let abortedMultipartUploads = 0;
  let deletedLegacyStages = 0;
  let deletedMultipartObjects = 0;
  let deletedStages = 0;
  let failedStages = 0;
  const cleanedStageIds: string[] = [];

  for (const stage of stages) {
    const record = readMultipartBlobStageRecord(stage.encryptedBytes);
    if (!record) {
      deletedLegacyStages += 1;
      cleanedStageIds.push(stage.id);
      continue;
    }

    try {
      if (record.state === "pending") {
        await runtime.blobObjectStore.abortMultipartUpload({
          key: record.storageKey,
          uploadId: record.uploadId,
        });
        abortedMultipartUploads += 1;
      } else {
        await runtime.blobObjectStore.deleteObject(record.storageKey);
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
    deletedLegacyStages,
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

    await runtime.db.insert(blobStages).values({
      id: stageId,
      ownerUserId: input.userId,
      encryptedBytes: encodeMultipartBlobStageRecord({
        state: "pending",
        storageKey,
        uploadId: upload.uploadId,
      }),
      byteLength: input.byteLength,
      sha256: input.sha256,
      expiresAt,
    });

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
      completed: stage.record.state === "complete",
      expiresAt: stage.expiresAt.toISOString(),
      sha256: stage.sha256,
      stageId: stage.id,
      uploadId: stage.record.uploadId,
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

export async function uploadMultipartBlobPart(
  runtime: ApiServiceRuntime,
  input: AuthenticatedMultipartBlobStageInput &
    UploadMultipartBlobPartRequest & {
      readonly partNumber: number;
    },
): Promise<UploadMultipartBlobPartResponse> {
  return uploadMultipartBlobPartBody(runtime, {
    ...input,
    body: {
      bytes: input.encryptedBytes,
    },
  });
}

export async function uploadMultipartBlobPartStream(
  runtime: ApiServiceRuntime,
  input: UploadMultipartBlobPartStreamInput,
): Promise<UploadMultipartBlobPartResponse> {
  return uploadMultipartBlobPartBody(runtime, {
    ...input,
    body: {
      byteLength: input.byteLength,
      sha256: input.sha256,
      stream: input.stream,
    },
  });
}

async function uploadMultipartBlobPartBody(
  runtime: ApiServiceRuntime,
  input: AuthenticatedMultipartBlobStageInput & {
    readonly body: BlobObjectUploadPartBody;
    readonly partNumber: number;
    readonly uploadId: string;
  },
): Promise<UploadMultipartBlobPartResponse> {
  try {
    const stage = await loadMultipartBlobStage(runtime, input);
    if (stage.record.state === "complete") {
      throw new MultipartBlobStageError(
        "Blob multipart stage is complete",
        409,
      );
    }
    assertUploadIdMatches({
      expectedUploadId: stage.record.uploadId,
      uploadId: input.uploadId,
    });

    const part = await runtime.blobObjectStore.uploadPart({
      body: input.body,
      key: stage.record.storageKey,
      partNumber: input.partNumber,
      uploadId: stage.record.uploadId,
    });

    return {
      part,
      stageId: stage.id,
      uploadId: stage.record.uploadId,
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
  stage: LoadedMultipartBlobStage,
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
  stage: LoadedMultipartBlobStage,
): Promise<void> {
  await runtime.db
    .update(blobStages)
    .set({
      encryptedBytes: encodeMultipartBlobStageRecord({
        state: "complete",
        storageKey: stage.record.storageKey,
        uploadId: stage.record.uploadId,
      }),
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
  stage: LoadedMultipartBlobStage,
  assembled: { readonly byteLength: number; readonly sha256: string },
): Promise<void> {
  if (assembled.byteLength !== stage.byteLength) {
    await runtime.blobObjectStore.deleteObject(stage.record.storageKey);
    throw new MultipartBlobStageError(
      "Blob byteLength does not match multipart upload",
      409,
    );
  }
  if (assembled.sha256 !== stage.sha256) {
    await runtime.blobObjectStore.deleteObject(stage.record.storageKey);
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
  stage: LoadedMultipartBlobStage,
  error: unknown,
): Promise<CompleteMultipartBlobStageResponse> {
  if (!(error instanceof BlobObjectStoreError) || error.code !== "not_found") {
    throw error;
  }
  const existing = await runtime.blobObjectStore.getObjectStream(
    stage.record.storageKey,
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
    if (stage.record.state === "complete") {
      return multipartStageCompleteResponse(stage);
    }
    assertUploadIdMatches({
      expectedUploadId: stage.record.uploadId,
      uploadId: input.uploadId,
    });

    let completed: CompletedBlobObject;
    try {
      completed = await runtime.blobObjectStore.completeMultipartUpload({
        expected: {
          byteLength: stage.byteLength,
          sha256: stage.sha256,
        },
        key: stage.record.storageKey,
        parts: input.parts,
        uploadId: stage.record.uploadId,
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
