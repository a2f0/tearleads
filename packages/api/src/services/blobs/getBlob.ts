import type { BlobResponse } from "@tearleads/validators/response";
import { eq } from "drizzle-orm";
import {
  canReadBlobAccess,
  resolveBlobAccessState,
} from "../../access/blobAccess";
import { blobs } from "../../schema";
import type { ApiServiceRuntime } from "../runtime";

interface GetBlobInput {
  blobId: string;
  userId: string;
}

export class GetBlobError extends Error {
  constructor(
    message: string,
    readonly status: 403 | 404,
  ) {
    super(message);
  }
}

export async function getBlob(
  runtime: ApiServiceRuntime,
  input: GetBlobInput,
): Promise<BlobResponse> {
  const access = await resolveBlobAccessState(input.blobId, runtime.db);
  if (!access) {
    throw new GetBlobError("Blob not found", 404);
  }

  if (!canReadBlobAccess(access, input.userId)) {
    throw new GetBlobError("Forbidden", 403);
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
