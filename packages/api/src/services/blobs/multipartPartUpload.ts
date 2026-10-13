import {
  type MultipartBlobPartUploadRequest,
  MultipartBlobPartUploadRequestSchema,
  type MultipartBlobPartUploadResponse,
} from "@tearleads/validators/operation";
import type { ApiServiceRuntime } from "../runtime";
import {
  type AuthenticatedMultipartBlobStageInput,
  assertUploadIdMatches,
  loadMultipartBlobStage,
  MultipartBlobStageError,
} from "./multipartStageAccess";

const MIN_S3_MULTIPART_PART_BYTES = 5 * 1024 * 1024;

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
  if (
    !metadata.success ||
    !Number.isInteger(input.partNumber) ||
    input.partNumber < 1 ||
    input.partNumber > 10_000 ||
    input.byteLength > stage.byteLength
  ) {
    throw new MultipartBlobStageError("Invalid multipart part", 400);
  }
  // Every nonfinal S3/R2 part must be at least 5 MiB. Do not let a small
  // declared object authorize thousands of otherwise individually valid parts.
  if (
    runtime.blobObjectStore.createUploadPartUrl &&
    input.partNumber > Math.ceil(stage.byteLength / MIN_S3_MULTIPART_PART_BYTES)
  ) {
    throw new MultipartBlobStageError("Part number exceeds staged size", 400);
  }
  // Issue one capability just before each part. Renewing it never changes the
  // stage/upload identity or invalidates earlier parts. Stage expiry still wins.
  const expiresIn = Math.min(
    300,
    Math.floor((stage.expiresAt.getTime() - Date.now()) / 1000),
  );
  if (expiresIn < 1) {
    throw new MultipartBlobStageError("Blob stage has expired", 409);
  }
  const createUploadPartUrl = runtime.blobObjectStore.createUploadPartUrl;
  const source = createUploadPartUrl
    ? {
        kind: "signed-url" as const,
        ...(await createUploadPartUrl.call(runtime.blobObjectStore, {
          key: stage.storageKey,
          uploadId: stage.uploadId,
          partNumber: input.partNumber,
          byteLength: input.byteLength,
          contentMd5: input.contentMd5,
          expiresIn,
        })),
      }
    : { kind: "api" as const };
  return {
    ...metadata.data,
    partNumber: input.partNumber,
    stageId: stage.id,
    source,
  };
}
