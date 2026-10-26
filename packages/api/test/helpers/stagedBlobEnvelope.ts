import type { BlobEnvelopeV2Header } from "@tearleads/crypto";
import type { TestUser } from "@tearleads/test-utils";
import {
  initiateMultipartBlobStage,
  uploadMultipartBlobPartBytes,
} from "../../src/services/blobs/multipartStage";
import type { ApiServiceRuntime } from "../../src/services/runtime";
import { sha256Hex } from "../../src/utils/sha256";
import { createBlobEnvelopeFixture } from "./blobEnvelope";
import { firstPartOf } from "./blobStageParts";
import { getDefaultOrganizationId } from "./organizationMembership";

export async function stageBlobEnvelopeFixture(
  runtime: ApiServiceRuntime,
  input: {
    readonly blobId: string;
    readonly organizationId?: string;
    readonly contentKeyEpoch?: number;
    readonly overrides?: Partial<BlobEnvelopeV2Header>;
    readonly owner: TestUser;
    /** Staged verbatim in place of a generated envelope, to test rejection. */
    readonly bytes?: Uint8Array<ArrayBuffer>;
  },
) {
  const organizationId =
    input.organizationId ??
    (await getDefaultOrganizationId(input.owner.userId));
  const bytes =
    input.bytes ??
    (
      await createBlobEnvelopeFixture({
        blobId: input.blobId,
        organizationId,
        ...(input.contentKeyEpoch !== undefined
          ? { contentKeyEpoch: input.contentKeyEpoch }
          : {}),
        ...(input.overrides ? { overrides: input.overrides } : {}),
      })
    ).bytes;
  const byteLength = bytes.byteLength;
  const sha256 = sha256Hex(bytes);
  const staged = await initiateMultipartBlobStage(runtime, {
    organizationId,
    byteLength,
    firstParts: firstPartOf(bytes),
    sha256,
    userId: input.owner.userId,
  });
  // The attachment bind that follows completes the stage.
  await uploadMultipartBlobPartBytes(runtime, {
    byteLength,
    bytes,
    partNumber: 1,
    sha256,
    stageId: staged.stageId,
    uploadId: staged.uploadId,
    userId: input.owner.userId,
  });
  return { ...staged, blobId: input.blobId, bytes, sha256 };
}
