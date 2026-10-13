import {
  blobWireHeaderKeys,
  getBlobBytesOperation,
  getBlobDownloadOperation,
} from "@tearleads/validators/operation";
import type { BinaryResponseOperationTransport } from "../../binaryResponseOperationTransport";
import type { JsonOperationTransport } from "../../operationTransport";
import type { OperationResponseRequestFn } from "../../types";

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

type BlobDownloadTransport = Pick<JsonOperationTransport, "request"> &
  Pick<BinaryResponseOperationTransport, "requestBinaryResponse"> &
  Pick<OperationResponseRequestFn, "reportFailure">;

type DownloadFetch = (url: string, init: RequestInit) => Promise<Response>;

export async function getBlobBytes(
  transport: BlobDownloadTransport,
  blobId: string,
  downloadFetch: DownloadFetch = (url, init) => fetch(url, init),
): Promise<BlobBytesResponse | null> {
  let failedStatus: number | null = null;
  // Refresh at most once. R2 expiration errors can appear as CORS/network
  // failures in browsers, so both rejected fetches and 403s need a fresh URL.
  for (let attempt = 0; attempt < 2; attempt += 1) {
    const descriptor = await transport.request(getBlobDownloadOperation, {
      params: { blobId },
    });
    if (!descriptor) {
      return null;
    }
    if (descriptor.blobId !== blobId) {
      transport.reportFailure({
        kind: "shape",
        method: "GET",
        path: `/blobs/${blobId}/download`,
        status: 200,
        statusText: "",
        message: `Blob ${blobId} download descriptor has the wrong identity`,
      });
      return null;
    }
    if (descriptor.source.kind === "api") {
      return getBlobStream(transport, blobId);
    }
    try {
      // Never send the application's session or cookies to the object store.
      // Reject redirects and keep bearer URLs out of referrers and errors.
      const response = await downloadFetch(descriptor.source.url, {
        cache: "no-store",
        credentials: "omit",
        redirect: "error",
        referrerPolicy: "no-referrer",
      });
      if (response.status !== 200) {
        failedStatus = response.status;
        await response.body?.cancel();
        if (response.status === 403) {
          continue;
        }
        break;
      }
      return {
        blobId: descriptor.blobId,
        byteLength: descriptor.byteLength,
        sha256: descriptor.sha256,
        encryptedBytes: response.body
          ? signedDownloadBodyStream(response.body)
          : bufferedResponseBodyStream(await response.arrayBuffer()),
      };
    } catch {
      failedStatus = null;
      // The downstream SDK still verifies length, hash and authenticated
      // encryption. An error after streaming begins propagates to that reader.
    }
  }
  transport.reportFailure({
    kind: failedStatus === null ? "network" : "http",
    method: "GET",
    path: `/blobs/${blobId}/download`,
    status: failedStatus,
    statusText: "",
    message: `Blob ${blobId} download failed${failedStatus === null ? " (network error)" : ` (HTTP ${failedStatus})`}`,
  });
  return null;
}

function signedDownloadBodyStream(
  stream: ReadableStream<Uint8Array>,
): ReadableStream<Uint8Array> {
  const reader = stream.getReader();
  // Native network errors may contain the bearer URL. Keep failures generic
  // before downstream readers log them, without buffering or eager reads.
  return new ReadableStream<Uint8Array>(
    {
      async pull(controller) {
        try {
          const { done, value } = await reader.read();
          if (done) {
            controller.close();
            reader.releaseLock();
          } else {
            controller.enqueue(value);
          }
        } catch {
          controller.error(new Error("Blob download interrupted"));
          reader.releaseLock();
        }
      },
      async cancel(reason) {
        try {
          await reader.cancel(reason);
        } catch {
          throw new Error("Blob download cancellation failed");
        } finally {
          reader.releaseLock();
        }
      },
    },
    { highWaterMark: 0 },
  );
}

async function getBlobStream(
  transport: Pick<BinaryResponseOperationTransport, "requestBinaryResponse">,
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
