import {
  blobWireHeaderKeys,
  getBlobBytesOperation,
} from "@tearleads/validators/operation";
import type { BinaryResponseOperationTransport } from "../../binaryResponseOperationTransport";

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

export async function getBlobBytes(
  transport: BinaryResponseOperationTransport,
  blobId: string,
): Promise<BlobBytesResponse | null> {
  const result = await transport.requestBinaryResponse(getBlobBytesOperation, {
    params: { blobId },
  });
  if (!result) {
    return null;
  }

  const { headers, response } = result;
  const byteLength = Number(headers[blobWireHeaderKeys.blobByteLength]);

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
