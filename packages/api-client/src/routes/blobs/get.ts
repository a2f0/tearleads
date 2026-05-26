import type { BlobResponse } from "@tearleads/validators/response";
import type { ResponseRequestFn } from "../../types";

const BLOB_BYTES_BLOB_ID_HEADER = "x-tearleads-blob-id";
const BLOB_BYTES_BYTE_LENGTH_HEADER = "x-tearleads-blob-byte-length";
const BLOB_BYTES_CONTENT_LENGTH_HEADER = "content-length";
const BLOB_BYTES_SHA256_HEADER = "x-tearleads-blob-sha256";

export interface BlobBytesResponse {
  readonly blobId: string;
  readonly byteLength: number;
  readonly encryptedBytes: ReadableStream<Uint8Array>;
  readonly sha256: string;
}

interface LoadedBlobBytesResponse extends BlobBytesResponse {
  readonly response: Response;
}

const BLOB_BYTES_PATH_METHOD = "GET";

function parseContentLength(value: string | null): number | null {
  if (value === null || !/^\d+$/.test(value)) {
    return null;
  }

  const byteLength = Number(value);
  return Number.isSafeInteger(byteLength) ? byteLength : null;
}

function readBlobByteLength(response: Response): {
  byteLength: number | null;
  headerName: string;
  missing: boolean;
} {
  const blobByteLength = response.headers.get(BLOB_BYTES_BYTE_LENGTH_HEADER);
  if (blobByteLength !== null) {
    return {
      byteLength: parseContentLength(blobByteLength),
      headerName: BLOB_BYTES_BYTE_LENGTH_HEADER,
      missing: false,
    };
  }

  const contentLength = response.headers.get(BLOB_BYTES_CONTENT_LENGTH_HEADER);
  return {
    byteLength: parseContentLength(contentLength),
    headerName: BLOB_BYTES_CONTENT_LENGTH_HEADER,
    missing: contentLength === null,
  };
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
  const byteLengthHeader = readBlobByteLength(response);
  const sha256 = response.headers.get(BLOB_BYTES_SHA256_HEADER);
  const missingHeaders = [
    responseBlobId ? null : BLOB_BYTES_BLOB_ID_HEADER,
    byteLengthHeader.missing
      ? `(${BLOB_BYTES_BYTE_LENGTH_HEADER} or ${BLOB_BYTES_CONTENT_LENGTH_HEADER})`
      : null,
    sha256 ? null : BLOB_BYTES_SHA256_HEADER,
  ].filter((header): header is string => header !== null);
  if (missingHeaders.length > 0) {
    return reportMalformedBlobBytesResponse(request, {
      message: `Invalid response shape for ${path}: missing ${missingHeaders.join(", ")}`,
      path,
      response,
    });
  }
  if (responseBlobId === null || sha256 === null) {
    return reportMalformedBlobBytesResponse(request, {
      message: `Invalid response shape for ${path}: missing response metadata`,
      path,
      response,
    });
  }

  const byteLength = byteLengthHeader.byteLength;
  if (byteLength === null) {
    return reportMalformedBlobBytesResponse(request, {
      message: `Invalid response shape for ${path}: invalid ${byteLengthHeader.headerName}`,
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
    encryptedBytes: response.body,
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
  return metadata;
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
