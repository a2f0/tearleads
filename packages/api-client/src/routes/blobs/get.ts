import type { ResponseRequestFn } from "../../types";
import { pathSegment } from "../path";

const BLOB_BYTES_BLOB_ID_HEADER = "X-Tearleads-Blob-Id";
const BLOB_BYTES_BYTE_LENGTH_HEADER = "X-Tearleads-Blob-Byte-Length";
const BLOB_BYTES_CONTENT_LENGTH_HEADER = "Content-Length";
const BLOB_BYTES_SHA256_HEADER = "X-Tearleads-Blob-Sha256";

export interface BlobBytesResponse {
  readonly blobId: string;
  readonly byteLength: number;
  readonly encryptedBytes: ReadableStream<Uint8Array>;
  readonly sha256: string;
}

export interface UploadMultipartBlobPartBytesRequest {
  readonly byteLength: number;
  readonly encryptedBytes: Blob | BufferSource;
  readonly sha256: string;
  readonly uploadId: string;
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
): Promise<BlobBytesResponse | null> {
  const path = `/blobs/${pathSegment(blobId)}/bytes`;
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

  // On the browser / WKWebView-fetch path the body is streamed, so
  // `response.body` is a live ReadableStream. Under a native HTTP bridge
  // (CapacitorHttp — which the Capacitor iOS/Android builds enable so cross-origin
  // API requests reach the backend at all; the WKWebView's own fetch fails from
  // the app's https://localhost origin) the response is buffered natively and
  // `response.body` is null even for a valid 200. So take the bytes either way:
  // the stream when present, otherwise buffer the response and re-wrap it as a
  // one-shot ReadableStream so callers keep a single streaming interface. This
  // does not weaken validation — a truncated or corrupted body is still caught
  // downstream by the X-Tearleads-Blob-Sha256 integrity check; it only stops a
  // buffered-but-valid response from being rejected here as malformed.
  const encryptedBytes =
    response.body ?? bufferedResponseBodyStream(await response.arrayBuffer());

  return {
    blobId: responseBlobId,
    byteLength,
    encryptedBytes,
    sha256,
  };
}

// Wraps a fully-buffered response body as a single-chunk ReadableStream, so a
// native HTTP bridge that only exposes the buffered bytes (no WHATWG
// `response.body` stream) can still satisfy the streaming
// `BlobBytesResponse.encryptedBytes` contract. An empty buffer yields an
// immediately-closed, zero-chunk stream.
function bufferedResponseBodyStream(
  buffer: ArrayBuffer,
): ReadableStream<Uint8Array> {
  const bytes = new Uint8Array(buffer);
  return new ReadableStream<Uint8Array>({
    start(controller) {
      if (bytes.byteLength > 0) {
        controller.enqueue(bytes);
      }
      controller.close();
    },
  });
}

export function getBlobBytes(
  request: ResponseRequestFn,
  blobId: string,
): Promise<BlobBytesResponse | null> {
  return loadBlobBytesResponse(request, blobId);
}
