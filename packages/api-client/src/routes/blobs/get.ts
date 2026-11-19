import {
  blobWireHeaderKeys,
  getBlobBytesOperation,
  getBlobDownloadOperation,
} from "@tearleads/validators/operation";
import type { MultipartBlobPartUploadSource } from "@tearleads/validators/util";
import type { BinaryResponseOperationTransport } from "../../binaryResponseOperationTransport";
import type { JsonOperationTransport } from "../../operationTransport";
import type {
  OperationResponseRequestFn,
  RequestFailure,
  RequestResultOptions,
} from "../../types";
import { blobDownloadBody } from "./blobDownloadBody";
import { storageFetchOptions } from "./storageFetchOptions";

export interface BlobBytesResponse {
  readonly blobId: string;
  readonly byteLength: number;
  readonly encryptedBytes: ReadableStream<Uint8Array>;
  readonly sha256: string;
}

export interface UploadMultipartBlobPartBytesRequest {
  /** Local writer-lifetime check before authorization and byte transfer. */
  readonly assertCurrent?: (() => void) | undefined;
  readonly byteLength: number;
  readonly encryptedBytes: Blob | BufferSource;
  readonly sha256: string;
  /**
   * An upload source the stage initiation already issued for this part. The
   * first attempt uses it instead of authorizing; a failed attempt still
   * reauthorizes once, exactly as when no source was issued.
   */
  readonly source?: MultipartBlobPartUploadSource | undefined;
  readonly uploadId: string;
}

type BlobDownloadTransport = Pick<JsonOperationTransport, "requestResult"> &
  Pick<BinaryResponseOperationTransport, "requestBinaryResponse"> &
  Pick<OperationResponseRequestFn, "reportFailure">;

type DownloadFetch = (url: string, init: RequestInit) => Promise<Response>;

/** A server without download descriptors (404) still streams the blob. */
function descriptorFailureFallback(
  transport: BlobDownloadTransport,
  blobId: string,
  failure: RequestFailure,
  options: RequestResultOptions,
): Promise<BlobBytesResponse | null> | null {
  if (failure.kind === "http" && failure.status === 404) {
    return getBlobStream(transport, blobId, options);
  }
  failure.report();
  return null;
}

export async function getBlobBytes(
  transport: BlobDownloadTransport,
  blobId: string,
  downloadFetch: DownloadFetch = (url, init) => fetch(url, init),
  options: RequestResultOptions = {},
): Promise<BlobBytesResponse | null> {
  // Refresh at most once. R2 expiration errors can appear as CORS/network
  // failures in browsers, so both rejected fetches and 403s need a fresh URL.
  for (let attempt = 0; attempt < 2; attempt += 1) {
    if (options.signal?.aborted) return null;
    const result = await transport.requestResult(
      getBlobDownloadOperation,
      { params: { blobId } },
      { ...options, reportErrors: false },
    );
    if (options.signal?.aborted) return null;
    if (!result.ok) {
      return descriptorFailureFallback(transport, blobId, result, options);
    }
    const descriptor = result.data;
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
      return getBlobStream(transport, blobId, options);
    }
    const outcome = await fetchSignedBlob(
      descriptor,
      descriptor.source.url,
      downloadFetch,
      options,
    );
    if (outcome === "fallback") break;
    if (outcome !== "retry") return outcome;
  }
  // Preserve downloads when storage is unreachable or a native HTTP bridge
  // cannot use the signed URL. This endpoint checks current access again.
  // A storage failure alone must not signal that the API is offline.
  return getBlobStream(transport, blobId, options);
}

/**
 * One signed-URL attempt: the bytes, `"retry"` with a fresh URL (403 or a
 * rejected fetch), or `"fallback"` to the API stream (any other status).
 */
async function fetchSignedBlob(
  descriptor: Pick<BlobBytesResponse, "blobId" | "byteLength" | "sha256">,
  url: string,
  downloadFetch: DownloadFetch,
  options: RequestResultOptions,
): Promise<BlobBytesResponse | "retry" | "fallback"> {
  try {
    // Never send the application's session or cookies to the object store.
    // Reject redirects and keep bearer URLs out of referrers and errors.
    const response = await downloadFetch(url, storageFetchOptions(options));
    if (response.status !== 200) {
      await response.body?.cancel().catch(() => {});
      return response.status === 403 ? "retry" : "fallback";
    }
    return await signedBlobResponse(descriptor, response, options.signal);
  } catch {
    // The downstream SDK still verifies length, hash and authenticated
    // encryption. An error after streaming begins propagates to that reader.
    return "retry";
  }
}

async function signedBlobResponse(
  descriptor: Pick<BlobBytesResponse, "blobId" | "byteLength" | "sha256">,
  response: Response,
  signal: AbortSignal | undefined,
): Promise<BlobBytesResponse> {
  return {
    blobId: descriptor.blobId,
    byteLength: descriptor.byteLength,
    sha256: descriptor.sha256,
    encryptedBytes: await blobDownloadBody(response, signal, true),
  };
}

async function getBlobStream(
  transport: Pick<BinaryResponseOperationTransport, "requestBinaryResponse">,
  blobId: string,
  options: RequestResultOptions,
): Promise<BlobBytesResponse | null> {
  if (options.signal?.aborted) return null;
  const result = await transport.requestBinaryResponse(
    getBlobBytesOperation,
    {
      params: { blobId },
    },
    options,
  );
  if (!result) {
    return null;
  }

  const { headers, response } = result;
  const byteLength = Number(headers[blobWireHeaderKeys.blobByteLength]);

  const encryptedBytes = await blobDownloadBody(response, options.signal);

  if (options.signal?.aborted) return null;
  return {
    blobId: headers[blobWireHeaderKeys.blobId],
    byteLength,
    encryptedBytes,
    sha256: headers[blobWireHeaderKeys.blobSha256],
  };
}
