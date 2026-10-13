import {
  MULTIPART_BLOB_STAGE_ERROR_CODES,
  type MultipartBlobStageErrorCode,
} from "@tearleads/validators/response";
import { BlobObjectStoreError } from "../../adapters/blobObjectStore";
import {
  loadOwnedActiveBlobStage,
  type OwnedActiveBlobStage,
} from "../../workflows/blobs/stageAccess";
import type { ApiServiceRuntime } from "../runtime";

type MultipartBlobStageStatus = 400 | 403 | 404 | 409 | 500;

export interface AuthenticatedMultipartBlobStageInput {
  readonly stageId: string;
  readonly userId: string;
}

export class MultipartBlobStageError extends Error {
  constructor(
    message: string,
    readonly status: MultipartBlobStageStatus,
    readonly code?: MultipartBlobStageErrorCode,
  ) {
    super(message);
    this.name = "MultipartBlobStageError";
  }
}

export function toMultipartBlobStageError(
  error: unknown,
): MultipartBlobStageError | null {
  if (!(error instanceof BlobObjectStoreError)) {
    return null;
  }

  if (error.code === "multipart_upload_not_found") {
    return new MultipartBlobStageError(
      error.message,
      404,
      MULTIPART_BLOB_STAGE_ERROR_CODES.notFound,
    );
  }
  if (error.code === "not_found") {
    return new MultipartBlobStageError(error.message, 500);
  }
  if (error.code === "upload_conflict") {
    return new MultipartBlobStageError(error.message, 409);
  }

  return new MultipartBlobStageError(error.message, 400);
}

export function assertUploadIdMatches(input: {
  readonly expectedUploadId: string;
  readonly uploadId: string;
}): void {
  if (input.uploadId !== input.expectedUploadId) {
    throw new MultipartBlobStageError("Multipart upload id mismatch", 409);
  }
}

export async function loadMultipartBlobStage(
  runtime: ApiServiceRuntime,
  input: AuthenticatedMultipartBlobStageInput,
): Promise<OwnedActiveBlobStage> {
  return loadOwnedActiveBlobStage(runtime.db, {
    error: (message, status) =>
      new MultipartBlobStageError(
        message,
        status,
        status === 404
          ? MULTIPART_BLOB_STAGE_ERROR_CODES.notFound
          : status === 409
            ? MULTIPART_BLOB_STAGE_ERROR_CODES.expired
            : undefined,
      ),
    stageId: input.stageId,
    userId: input.userId,
  });
}
