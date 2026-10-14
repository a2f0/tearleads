import { createHash } from "node:crypto";
import type { MultipartBlobPartDescriptor } from "@tearleads/validators/util";
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

/** Complete a stage the way an attachment bind does. */
export async function completeStageAsBind(
  runtime: ApiServiceRuntime,
  input: { readonly stageId: string; readonly userId: string },
): Promise<void> {
  const stage = await loadMultipartBlobStage(runtime, input);
  await completeOwnedMultipartStage(runtime, stage);
}
