import type { BlobResponse } from "@tearleads/validators/response";
import { eq } from "drizzle-orm";
import {
  type BlobObjectReadStream,
  blobObjectChunkToStream,
} from "../../adapters/blobObjectStore";
import { blobs } from "../../schema";
import { readExternalBlobBytesRef } from "../../utils/blobStageRecords";
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
  readonly blobId: string;
  readonly encryptedBytes: string;
  readonly sha256: string;
}

interface BlobBytesResponse {
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

  return row;
}

export async function getBlob(
  runtime: ApiServiceRuntime,
  input: GetBlobInput,
): Promise<BlobResponse> {
  const row = await loadReadableBlobRow(runtime, input);
  const externalRef = readExternalBlobBytesRef(row.encryptedBytes);
  const encryptedBytes = externalRef
    ? await runtime.blobObjectStore.getObject(externalRef.storageKey)
    : row.encryptedBytes;
  if (encryptedBytes === null) {
    throw new GetBlobError("Blob bytes not found", 409);
  }

  return {
    blobId: row.blobId,
    encryptedBytes,
    sha256: row.sha256,
  };
}

export async function getBlobBytes(
  runtime: ApiServiceRuntime,
  input: GetBlobInput,
): Promise<BlobBytesResponse> {
  const row = await loadReadableBlobRow(runtime, input);
  const externalRef = readExternalBlobBytesRef(row.encryptedBytes);
  const encryptedBytes = externalRef
    ? await runtime.blobObjectStore.getObjectStream(externalRef.storageKey)
    : blobObjectChunkToStream(row.encryptedBytes);
  if (encryptedBytes === null) {
    throw new GetBlobError("Blob bytes not found", 409);
  }

  return {
    blobId: row.blobId,
    encryptedBytes,
    sha256: row.sha256,
  };
}
