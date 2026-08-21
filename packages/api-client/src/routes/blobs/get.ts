import {
  BlobBytesResponseHeadersSchema,
  blobWireHeaderKeys,
  blobWireHeaderNames,
  getBlobBytesOperation,
  operationRequestPath,
} from "@symcrypt/validators/operation";
import type { ResponseRequestFn } from "../../types";

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

export const getBlobBytesRoute = {
  method: getBlobBytesOperation.method,
  path(blobId: string) {
    return operationRequestPath(getBlobBytesOperation, { blobId });
  },
  responseHeaders: BlobBytesResponseHeadersSchema,
};

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
    method: getBlobBytesRoute.method,
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
  const path = getBlobBytesRoute.path(blobId);
  const result = await request(path, getBlobBytesRoute.method);
  if (!result.ok) {
    return null;
  }

  const response = result.data;
  const responseBlobId = response.headers.get(blobWireHeaderNames.blobId);
  const blobByteLength = response.headers.get(
    blobWireHeaderNames.blobByteLength,
  );
  const contentLength = response.headers.get(blobWireHeaderNames.contentLength);
  const sha256 = response.headers.get(blobWireHeaderNames.blobSha256);
  const missingHeaders = [
    responseBlobId ? null : blobWireHeaderNames.blobId,
    blobByteLength === null && contentLength === null
      ? `(${blobWireHeaderNames.blobByteLength} or ${blobWireHeaderNames.contentLength})`
      : null,
    sha256 ? null : blobWireHeaderNames.blobSha256,
  ].filter((header): header is string => header !== null);
  if (missingHeaders.length > 0) {
    return reportMalformedBlobBytesResponse(request, {
      message: `Invalid response shape for ${path}: missing ${missingHeaders.join(", ")}`,
      path,
      response,
    });
  }
  const parsedHeaders = getBlobBytesRoute.responseHeaders.safeParse({
    [blobWireHeaderKeys.blobByteLength]: blobByteLength ?? undefined,
    [blobWireHeaderKeys.blobId]: responseBlobId,
    [blobWireHeaderKeys.blobSha256]: sha256,
    [blobWireHeaderKeys.contentLength]:
      blobByteLength === null ? (contentLength ?? undefined) : undefined,
  });
  if (!parsedHeaders.success) {
    const invalidHeader =
      blobByteLength === null
        ? blobWireHeaderNames.contentLength
        : blobWireHeaderNames.blobByteLength;
    return reportMalformedBlobBytesResponse(request, {
      message: `Invalid response shape for ${path}: invalid ${invalidHeader}`,
      path,
      response,
    });
  }
  const headers = parsedHeaders.data;
  const byteLength = Number(
    headers[blobWireHeaderKeys.blobByteLength] ??
      headers[blobWireHeaderKeys.contentLength],
  );

  // On the browser / WKWebView-fetch path the body is streamed, so
  // `response.body` is a live ReadableStream. Under a native HTTP bridge
  // (CapacitorHttp — which the Capacitor iOS/Android builds enable so cross-origin
  // API requests reach the backend at all; the WKWebView's own fetch fails from
  // the app's https://localhost origin) the response is buffered natively and
  // `response.body` is null even for a valid 200. So take the bytes either way:
  // the stream when present, otherwise buffer the response and re-wrap it as a
  // one-shot ReadableStream so callers keep a single streaming interface. This
  // does not weaken validation — a truncated or corrupted body is still caught
  // downstream by the X-SymCrypt-Blob-Sha256 integrity check; it only stops a
  // buffered-but-valid response from being rejected here as malformed.
  const encryptedBytes =
    response.body ?? bufferedResponseBodyStream(await response.arrayBuffer());

  return {
    blobId: headers[blobWireHeaderKeys.blobId],
    byteLength,
    encryptedBytes,
    sha256: headers[blobWireHeaderKeys.blobSha256],
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
