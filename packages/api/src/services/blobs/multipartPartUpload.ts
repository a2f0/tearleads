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
