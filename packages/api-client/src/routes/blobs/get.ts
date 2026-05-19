import type { BlobResponse } from "@tearleads/validators/response";
import type { ResponseRequestFn } from "../../types";

const BLOB_BYTES_BLOB_ID_HEADER = "x-tearleads-blob-id";
const BLOB_BYTES_CONTENT_LENGTH_HEADER = "content-length";
const BLOB_BYTES_SHA256_HEADER = "x-tearleads-blob-sha256";

export interface BlobBytesResponse {
  readonly blobId: string;
  readonly byteLength: number;
  readonly encryptedBytes: ReadableStream<Uint8Array>;
  readonly sha256: string;
}

interface LoadedBlobBytesResponse {
  readonly blobId: string;
  readonly byteLength: number;
  readonly response: Response;
  readonly sha256: string;
}

const BLOB_BYTES_PATH_METHOD = "GET";

function parseContentLength(value: string | null): number | null {
  if (value === null || !/^\d+$/.test(value)) {
    return null;
  }

  const byteLength = Number(value);
  return Number.isSafeInteger(byteLength) ? byteLength : null;
}

function reportMalformedBlobBytesResponse(
  request: ResponseRequestFn,
  input: {
    readonly message: string;
    readonly path: string;
    readonly response: Response;
  },
): null {
  request.reportFailure({
    kind: "shape",
    message: input.message,
    method: BLOB_BYTES_PATH_METHOD,
    path: input.path,
    status: input.response.status,
    statusText: input.response.statusText,
  });

  return null;
}

async function loadBlobBytesResponse(
  request: ResponseRequestFn,
  blobId: string,
): Promise<LoadedBlobBytesResponse | null> {
  const path = `/blobs/${blobId}/bytes`;
  const result = await request(path, BLOB_BYTES_PATH_METHOD);
  if (!result.ok) {
    return null;
  }

  const response = result.data;
  const responseBlobId = response.headers.get(BLOB_BYTES_BLOB_ID_HEADER);
  const contentLength = response.headers.get(BLOB_BYTES_CONTENT_LENGTH_HEADER);
  const sha256 = response.headers.get(BLOB_BYTES_SHA256_HEADER);
  const missingHeaders = [
    responseBlobId ? null : BLOB_BYTES_BLOB_ID_HEADER,
    contentLength ? null : BLOB_BYTES_CONTENT_LENGTH_HEADER,
    sha256 ? null : BLOB_BYTES_SHA256_HEADER,
  ].filter((header): header is string => header !== null);
  if (missingHeaders.length > 0 || !responseBlobId || !sha256) {
    return reportMalformedBlobBytesResponse(request, {
      message: `Invalid response shape for ${path}: missing ${missingHeaders.join(", ")}`,
      path,
      response,
    });
  }

  const byteLength = parseContentLength(contentLength);
  if (byteLength === null) {
    return reportMalformedBlobBytesResponse(request, {
      message: `Invalid response shape for ${path}: invalid ${BLOB_BYTES_CONTENT_LENGTH_HEADER}`,
      path,
      response,
    });
  }

  if (response.body === null) {
    return reportMalformedBlobBytesResponse(request, {
      message: `Invalid response shape for ${path}: missing response body`,
      path,
      response,
    });
  }

  return {
    blobId: responseBlobId,
    byteLength,
    response,
    sha256,
  };
}

export async function getBlobBytes(
  request: ResponseRequestFn,
  blobId: string,
): Promise<BlobBytesResponse | null> {
  const loaded = await loadBlobBytesResponse(request, blobId);
  if (!loaded) {
    return null;
  }

  const { response, ...metadata } = loaded;
  if (response.body === null) {
    return null;
  }

  return {
    ...metadata,
    encryptedBytes: response.body,
  };
}

export async function getBlob(
  request: ResponseRequestFn,
  blobId: string,
): Promise<BlobResponse | null> {
  const path = `/blobs/${blobId}/bytes`;
  const loaded = await loadBlobBytesResponse(request, blobId);
  if (!loaded) {
    return null;
  }

  let encryptedBytes: string;
  try {
    encryptedBytes = await loaded.response.text();
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    request.reportFailure({
      kind: "shape",
      message: `${BLOB_BYTES_PATH_METHOD} ${path}: failed to read response body: ${message}`,
      method: BLOB_BYTES_PATH_METHOD,
      path,
      status: loaded.response.status,
      statusText: loaded.response.statusText,
    });
    return null;
  }

  return {
    blobId: loaded.blobId,
    encryptedBytes,
    sha256: loaded.sha256,
  };
}
