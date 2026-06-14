import { blobStages } from "@tearleads/api-shared/schema";
import type { StageBlobRequest } from "@tearleads/validators/request";
import type { StageBlobResponse } from "@tearleads/validators/response";
import { sha256Hex } from "../../utils/sha256";
import type { ApiServiceRuntime } from "../runtime";

interface StageBlobInput extends StageBlobRequest {
  userId: string;
}

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

  const [stage] = await runtime.db
    .insert(blobStages)
    .values({
      ownerUserId: input.userId,
      encryptedBytes: input.encryptedBytes,
      byteLength: input.byteLength,
      sha256: input.sha256,
      expiresAt: new Date(Date.now() + 60 * 60 * 1000),
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
