import type { BlobResponse } from "@tearleads/validators/response";
import type { ResponseRequestFn } from "../../types";

const BLOB_BYTES_BLOB_ID_HEADER = "x-tearleads-blob-id";
const BLOB_BYTES_SHA256_HEADER = "x-tearleads-blob-sha256";

export async function getBlob(
  request: ResponseRequestFn,
  blobId: string,
): Promise<BlobResponse | null> {
  const result = await request(`/blobs/${blobId}/bytes`, "GET");
  if (!result.ok) {
    return null;
  }

  const response = result.data;
  const responseBlobId = response.headers.get(BLOB_BYTES_BLOB_ID_HEADER);
  const sha256 = response.headers.get(BLOB_BYTES_SHA256_HEADER);
  if (!responseBlobId || !sha256) {
    return null;
  }

  let encryptedBytes: string;
  try {
    encryptedBytes = await response.text();
  } catch {
    return null;
  }

  return {
    blobId: responseBlobId,
    encryptedBytes,
    sha256,
  };
}
