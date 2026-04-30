import type { BlobResponse } from "@tearleads/validators/response";
import { eq } from "drizzle-orm";
import { blobs } from "../../schema";
import {
  KeyingReadAccessError,
  resolveReadableBlobAccess,
} from "../keyingReadAccess";
import type { ApiServiceRuntime } from "../runtime";

interface GetBlobInput {
  blobId: string;
  userId: string;
}

export class GetBlobError extends Error {
  constructor(
    message: string,
    readonly status: 403 | 404 | 409,
  ) {
    super(message);
  }
}

export async function getBlob(
  runtime: ApiServiceRuntime,
  input: GetBlobInput,
): Promise<BlobResponse> {
  try {
    await resolveReadableBlobAccess({
      blobId: input.blobId,
      executor: runtime.db,
      userId: input.userId,
    });
  } catch (error) {
    if (error instanceof KeyingReadAccessError) {
      throw new GetBlobError(error.message, error.status);
    }
    throw error;
  }

  const [row] = await runtime.db
    .select({
      blobId: blobs.id,
      encryptedBytes: blobs.encryptedBytes,
      sha256: blobs.sha256,
    })
    .from(blobs)
    .where(eq(blobs.id, input.blobId))
    .limit(1);

  if (!row) {
    throw new GetBlobError("Blob not found", 404);
  }

  return {
    blobId: row.blobId,
    encryptedBytes: row.encryptedBytes,
    sha256: row.sha256,
  };
}
