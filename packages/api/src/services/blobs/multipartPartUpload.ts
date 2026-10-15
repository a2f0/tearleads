import {
  type MultipartBlobPartUploadRequest,
  MultipartBlobPartUploadRequestSchema,
  type MultipartBlobPartUploadResponse,
} from "@tearleads/validators/operation";
import {
  MAX_MULTIPART_BLOB_PART_NUMBER,
  type MultipartBlobPartDescriptor,
  type MultipartBlobPartUpload,
} from "@tearleads/validators/util";
import type { OwnedActiveBlobStage } from "../../workflows/blobs/stageAccess";
import type { ApiServiceRuntime } from "../runtime";
import {
  type AuthenticatedMultipartBlobStageInput,
  assertUploadIdMatches,
  loadMultipartBlobStage,
  MultipartBlobStageError,
} from "./multipartStageAccess";

const MIN_S3_MULTIPART_PART_BYTES = 5 * 1024 * 1024;
const MAX_PART_UPLOAD_URL_SECONDS = 300;

/** Refuse a part the stage cannot hold before any capability is issued. */
export function assertMultipartPartFitsStage(
  runtime: ApiServiceRuntime,
  stageByteLength: number,
  part: Pick<MultipartBlobPartDescriptor, "byteLength" | "partNumber">,
): void {
  if (
    !Number.isInteger(part.partNumber) ||
    part.partNumber < 1 ||
    part.partNumber > MAX_MULTIPART_BLOB_PART_NUMBER ||
    part.byteLength > stageByteLength
  ) {
    throw new MultipartBlobStageError("Invalid multipart part", 400);
  }
  // Every nonfinal S3/R2 part must be at least 5 MiB. Do not let a small
  // declared object authorize thousands of otherwise individually valid parts.
  if (
    runtime.blobObjectStore.createUploadPartUrl &&
    part.partNumber > Math.ceil(stageByteLength / MIN_S3_MULTIPART_PART_BYTES)
  ) {
    throw new MultipartBlobStageError("Part number exceeds staged size", 400);
  }
}

/**
 * The upload source for one part: the API byte route for stores that cannot
 * sign, or a URL signing exactly this part of this upload, its length, and its
 * Content-MD5. A URL lasts at most five minutes and never outlives the stage;
 * issuing one never changes the stage or upload identity or earlier parts.
 */
export async function issueMultipartPartUpload(
  runtime: ApiServiceRuntime,
  stage: Pick<OwnedActiveBlobStage, "expiresAt" | "storageKey" | "uploadId">,
  part: MultipartBlobPartDescriptor,
): Promise<MultipartBlobPartUpload> {
  const expiresIn = Math.min(
    MAX_PART_UPLOAD_URL_SECONDS,
    Math.floor((stage.expiresAt.getTime() - Date.now()) / 1000),
  );
  if (expiresIn < 1) {
    throw new MultipartBlobStageError("Blob stage has expired", 409);
  }
  const createUploadPartUrl = runtime.blobObjectStore.createUploadPartUrl;
  if (!createUploadPartUrl) {
    return { ...part, source: { kind: "api" } };
  }
  return {
    ...part,
    source: {
      kind: "signed-url",
      ...(await createUploadPartUrl.call(runtime.blobObjectStore, {
        key: stage.storageKey,
        uploadId: stage.uploadId,
        partNumber: part.partNumber,
        byteLength: part.byteLength,
        contentMd5: part.contentMd5,
        expiresIn,
      })),
    },
  };
}

/**
 * A part the stage initiation did not describe, or a renewal after a URL
 * expired or failed: authorize it just before it is sent.
 */
export async function authorizeMultipartBlobPartUpload(
  runtime: ApiServiceRuntime,
  input: AuthenticatedMultipartBlobStageInput &
    MultipartBlobPartUploadRequest & {
      readonly partNumber: number;
    },
): Promise<MultipartBlobPartUploadResponse> {
  const stage = await loadMultipartBlobStage(runtime, input);
  if (stage.completedAt !== null) {
    throw new MultipartBlobStageError("Blob multipart stage is complete", 409);
  }
  assertUploadIdMatches({
    expectedUploadId: stage.uploadId,
    uploadId: input.uploadId,
  });
  const metadata = MultipartBlobPartUploadRequestSchema.safeParse({
    byteLength: input.byteLength,
    contentMd5: input.contentMd5,
    uploadId: input.uploadId,
  });
  if (!metadata.success) {
    throw new MultipartBlobStageError("Invalid multipart part", 400);
  }
  const part = {
    byteLength: metadata.data.byteLength,
    contentMd5: metadata.data.contentMd5,
    partNumber: input.partNumber,
  };
  assertMultipartPartFitsStage(runtime, stage.byteLength, part);
  return {
    ...(await issueMultipartPartUpload(runtime, stage, part)),
    stageId: stage.id,
    uploadId: stage.uploadId,
  };
}
