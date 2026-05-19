import type { BlobResponse } from "@tearleads/validators/response";
import type { ResponseRequestFn } from "../../types";

const BLOB_BYTES_BLOB_ID_HEADER = "x-tearleads-blob-id";
const BLOB_BYTES_SHA256_HEADER = "x-tearleads-blob-sha256";

export async function getBlob(
  request: ResponseRequestFn,
  blobId: string,
): Promise<BlobResponse | null> {
  const path = `/blobs/${blobId}/bytes`;
  const method = "GET";
  const result = await request(path, method);
  if (!result.ok) {
    return null;
  }

  const response = result.data;
  const responseBlobId = response.headers.get(BLOB_BYTES_BLOB_ID_HEADER);
  const sha256 = response.headers.get(BLOB_BYTES_SHA256_HEADER);
  const missingHeaders = [
    responseBlobId ? null : BLOB_BYTES_BLOB_ID_HEADER,
    sha256 ? null : BLOB_BYTES_SHA256_HEADER,
  ].filter((header): header is string => header !== null);
  if (!responseBlobId || !sha256) {
    request.reportFailure({
      kind: "shape",
      message: `Invalid response shape for ${path}: missing ${missingHeaders.join(", ")}`,
      method,
      path,
      status: response.status,
      statusText: response.statusText,
    });
    return null;
  }

  let encryptedBytes: string;
  try {
    encryptedBytes = await response.text();
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    request.reportFailure({
      kind: "shape",
      message: `${method} ${path}: failed to read response body: ${message}`,
      method,
      path,
      status: response.status,
      statusText: response.statusText,
    });
    return null;
  }

  return {
    blobId: responseBlobId,
    encryptedBytes,
    sha256,
  };
}
