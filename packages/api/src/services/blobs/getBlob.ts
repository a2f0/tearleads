import { blobs } from "@tearleads/api-shared/schema";
import { eq } from "drizzle-orm";
import type { BlobObjectReadStream } from "../../adapters/blobObjectStore";
import {
  KeyingReadAccessError,
  resolveReadableBlobAccess,
} from "../../workflows/keyingReadAccess";
import type { ApiServiceRuntime } from "../runtime";

interface GetBlobInput {
  blobId: string;
  userId: string;
}

interface BlobRow {
  readonly byteLength: number;
  readonly blobId: string;
  readonly sha256: string;
  readonly storageKey: string;
}

interface BlobBytesResponse {
  readonly byteLength: number;
  readonly blobId: string;
  readonly encryptedBytes: BlobObjectReadStream;
  readonly sha256: string;
}

export class GetBlobError extends Error {
  constructor(
    message: string,
    readonly status: 403 | 404 | 409,
  ) {
    super(message);
  }
}

async function loadReadableBlobRow(
  runtime: ApiServiceRuntime,
  input: GetBlobInput,
): Promise<BlobRow> {
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
      byteLength: blobs.byteLength,
      blobId: blobs.id,
      sha256: blobs.sha256,
      storageKey: blobs.storageKey,
    })
    .from(blobs)
    .where(eq(blobs.id, input.blobId))
    .limit(1);

  if (!row) {
    throw new GetBlobError("Blob not found", 404);
  }

  return row;
}

export async function getBlobBytes(
  runtime: ApiServiceRuntime,
  input: GetBlobInput,
): Promise<BlobBytesResponse> {
  const row = await loadReadableBlobRow(runtime, input);
  const encryptedBytes = await runtime.blobObjectStore.getObjectStream(
    row.storageKey,
  );
  if (encryptedBytes === null) {
    throw new GetBlobError("Blob bytes not found", 409);
  }

  return {
    byteLength: row.byteLength,
    blobId: row.blobId,
    encryptedBytes,
    sha256: row.sha256,
  };
}
