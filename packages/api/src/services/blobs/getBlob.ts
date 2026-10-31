import type { BlobDownloadResponse } from "@tearleads/validators/operation";
import type { BlobObjectReadStream } from "../../adapters/blobObjectStore";
import {
  KeyingReadAccessError,
  type ReadableBlobRow,
  resolveReadableBlobAccess,
} from "../../workflows/keyingReadAccess";
import type { ApiServiceRuntime } from "../runtime";

interface GetBlobInput {
  blobId: string;
  userId: string;
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
): Promise<ReadableBlobRow> {
  let row: ReadableBlobRow | null;
  try {
    // The blob row is read with its bindings, before access resolves.
    row = await resolveReadableBlobAccess({
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

export async function getBlobDownload(
  runtime: ApiServiceRuntime,
  input: GetBlobInput,
): Promise<BlobDownloadResponse> {
  // Resolve access before signing, and take the object key only from storage.
  const row = await loadReadableBlobRow(runtime, input);
  const createDownloadUrl = runtime.blobObjectStore.createDownloadUrl;
  const source: BlobDownloadResponse["source"] = createDownloadUrl
    ? {
        kind: "signed-url",
        ...(await createDownloadUrl({ key: row.storageKey, expiresIn: 300 })),
      }
    : { kind: "api" };
  return {
    blobId: row.blobId,
    byteLength: row.byteLength,
    sha256: row.sha256,
    source,
  };
}
