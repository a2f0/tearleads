import { createHash } from "node:crypto";
import type { MultipartBlobPartDescriptor } from "@tearleads/validators/util";
import { authorizeMultipartBlobPartUpload } from "../../src/services/blobs/multipartPartUpload";
import { loadMultipartBlobStage } from "../../src/services/blobs/multipartStageAccess";
import { completeOwnedMultipartStage } from "../../src/services/blobs/multipartStageCompletion";
import type { ApiServiceRuntime } from "../../src/services/runtime";

const MULTIPART_PART_BYTES = 5 * 1024 * 1024;

/** The first part of an object whose bytes the test holds, as a client sends it. */
export function firstPartOf(bytes: Uint8Array): MultipartBlobPartDescriptor[] {
  return [
    {
      byteLength: Math.min(bytes.byteLength, MULTIPART_PART_BYTES),
      contentMd5: createHash("md5")
        .update(bytes.subarray(0, MULTIPART_PART_BYTES))
        .digest("base64"),
      partNumber: 1,
    },
  ];
}

/**
 * A first-part description for a stage whose bytes the test never uploads
 * through a signed URL: a non-signing store ignores the checksum.
 */
export function declaredFirstPart(
  byteLength: number,
): MultipartBlobPartDescriptor[] {
  return [
    {
      byteLength: Math.min(byteLength, MULTIPART_PART_BYTES),
      contentMd5: "AAAAAAAAAAAAAAAAAAAAAA==",
      partNumber: 1,
    },
  ];
}

/**
 * Upload one stage part the way a client does against a signing store:
 * authorize it, then send the bytes to the signed URL, never to the API.
 */
export async function uploadSignedStagePart(
  runtime: ApiServiceRuntime,
  putSignedPart: (url: string, bytes: Uint8Array) => Promise<unknown>,
  input: {
    readonly bytes: Uint8Array;
    readonly partNumber: number;
    readonly stageId: string;
    readonly uploadId: string;
    readonly userId: string;
  },
): Promise<void> {
  const { source } = await authorizeMultipartBlobPartUpload(runtime, {
    byteLength: input.bytes.byteLength,
    contentMd5: createHash("md5").update(input.bytes).digest("base64"),
    partNumber: input.partNumber,
    stageId: input.stageId,
    uploadId: input.uploadId,
    userId: input.userId,
  });
  if (source.kind !== "signed-url") {
    throw new Error("Expected a signed part upload");
  }
  await putSignedPart(source.url, input.bytes);
}

/** Complete a stage the way an attachment bind does. */
export async function completeStageAsBind(
  runtime: ApiServiceRuntime,
  input: { readonly stageId: string; readonly userId: string },
): ReturnType<typeof completeOwnedMultipartStage> {
  const stage = await loadMultipartBlobStage(runtime, input);
  return completeOwnedMultipartStage(runtime, stage);
}
