import { blobStages } from "@tearleads/api-shared/schema";
import type { StageBlobRequest } from "@tearleads/validators/request";
import type { StageBlobResponse } from "@tearleads/validators/response";
import { encodeMultipartBlobStageRecord } from "../../utils/blobStageRecords";
import { sha256Hex } from "../../utils/sha256";
import type { ApiServiceRuntime } from "../runtime";
import { storageKeyForStage } from "./multipartStage";

interface StageBlobInput extends StageBlobRequest {
  userId: string;
}

// Single-shot stages that offload to the object store have no real multipart
// upload, but reuse the completed-multipart stage record so the rest of the
// blob lifecycle (prevalidation, promotion to an external pointer, and expiry
// cleanup of the object) treats them identically to multipart stages.
const DIRECT_UPLOAD_ID = "direct";

export class StageBlobError extends Error {
  constructor(
    message: string,
    readonly status: 400 | 500,
  ) {
    super(message);
  }
}

export async function stageBlob(
  runtime: ApiServiceRuntime,
  input: StageBlobInput,
): Promise<StageBlobResponse> {
  const encodedBytes = new TextEncoder().encode(input.encryptedBytes);

  if (encodedBytes.byteLength !== input.byteLength) {
    throw new StageBlobError(
      "Blob byteLength does not match encryptedBytes",
      400,
    );
  }

  if ((await sha256Hex(input.encryptedBytes)) !== input.sha256) {
    throw new StageBlobError("Blob sha256 does not match encryptedBytes", 400);
  }

  const stageId = crypto.randomUUID();
  const expiresAt = new Date(Date.now() + 60 * 60 * 1000);

  // When an object store is configured, offload the bytes to it so every blob
  // lives in object storage (Garage/S3). The memory store keeps bytes inline in
  // Postgres, which is only used for tests and local development.
  let encryptedBytes = input.encryptedBytes;
  if (runtime.blobObjectStoreKind === "s3") {
    const storageKey = storageKeyForStage(stageId);
    await runtime.blobObjectStore.putObject({
      bytes: input.encryptedBytes,
      key: storageKey,
      sha256: input.sha256,
    });
    encryptedBytes = encodeMultipartBlobStageRecord({
      state: "complete",
      storageKey,
      uploadId: DIRECT_UPLOAD_ID,
    });
  }

  const [stage] = await runtime.db
    .insert(blobStages)
    .values({
      id: stageId,
      ownerUserId: input.userId,
      encryptedBytes,
      byteLength: input.byteLength,
      sha256: input.sha256,
      expiresAt,
    })
    .returning({ id: blobStages.id, expiresAt: blobStages.expiresAt });

  if (!stage) {
    throw new StageBlobError("Failed to stage blob", 500);
  }

  return {
    stageId: stage.id,
    expiresAt: stage.expiresAt.toISOString(),
  };
}
