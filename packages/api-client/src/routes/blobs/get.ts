import {
  blobWireHeaderKeys,
  getBlobBytesOperation,
  getBlobDownloadOperation,
} from "@tearleads/validators/operation";
import type { MultipartBlobPartUploadSource } from "@tearleads/validators/util";
import type { BinaryResponseOperationTransport } from "../../binaryResponseOperationTransport";
import { boundedMetadata } from "../../boundedMetadataResponse";
import type { JsonOperationTransport } from "../../operationTransport";
import type { RequestFailure, RequestResultOptions } from "../../types";
import { blobDownloadBody } from "./blobDownloadBody";
import { storageFetchOptions } from "./storageFetchOptions";

export interface BlobDownloadOptions extends RequestResultOptions {
  /** Require a stream and reject oversized declarations before opening the body. Cancel if it streams beyond this limit. */
  readonly maxEncryptedByteLength?: number | undefined;
}

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
  /**
   * An upload source the stage initiation already issued for this part. The
   * first attempt uses it instead of authorizing; a failed attempt still
   * reauthorizes once, exactly as when no source was issued.
   */
  readonly source?: MultipartBlobPartUploadSource | undefined;
  readonly uploadId: string;
}

type BlobDownloadTransport = Pick<JsonOperationTransport, "requestResult"> &
  Pick<BinaryResponseOperationTransport, "requestBinaryResponse">;

type DownloadFetch = (url: string, init: RequestInit) => Promise<Response>;

/** A server without download descriptors (404) still streams the blob. */
function descriptorFailureFallback(
  transport: BlobDownloadTransport,
  blobId: string,
  failure: RequestFailure,
  options: BlobDownloadOptions,
): Promise<BlobBytesResponse | null> | null {
  if (failure.kind === "http" && failure.status === 404) {
    return getBlobStream(transport, blobId, options);
  }
  failure.report();
  return null;
}

function metadataOptions(
  options: BlobDownloadOptions,
  mode: "all" | "errors",
): RequestResultOptions {
  return options.maxEncryptedByteLength === undefined
    ? options
    : { ...options, [boundedMetadata]: mode };
}

export async function getBlobBytes(
  transport: BlobDownloadTransport,
  blobId: string,
  downloadFetch: DownloadFetch = (url, init) => fetch(url, init),
  options: BlobDownloadOptions = {},
): Promise<BlobBytesResponse | null> {
  const limit = options.maxEncryptedByteLength;
  if (limit !== undefined && (!Number.isSafeInteger(limit) || limit < 0))
    return null;
  const blob = await downloadBlob(transport, blobId, downloadFetch, options);
  // A stream opened for a caller that retired meanwhile is never returned.
  if (blob && downloadRetired(options)) {
    void blob.encryptedBytes.cancel().catch(() => {});
    return null;
  }
  return blob;
}

/** The caller cancelled, its sign-in ended, or its scope retired. */
function downloadRetired(options: BlobDownloadOptions): boolean {
  return options.signal?.aborted === true || options.stillCurrent?.() === false;
}

async function downloadBlob(
  transport: BlobDownloadTransport,
  blobId: string,
  downloadFetch: DownloadFetch,
  options: BlobDownloadOptions,
): Promise<BlobBytesResponse | null> {
  const operation = {
    ...getBlobDownloadOperation,
    responses: {
      200: getBlobDownloadOperation.responses[200].refine(
        (descriptor) => descriptor.blobId === blobId,
      ),
    },
  };
  const limit = options.maxEncryptedByteLength ?? Infinity;
  // Refresh at most once. R2 expiration errors can appear as CORS/network
  // failures in browsers, so both rejected fetches and 403s need a fresh URL.
  for (
    let attempt = 0;
    attempt < 2 && !downloadRetired(options);
    attempt += 1
  ) {
    const result = await transport.requestResult(
      operation,
      { params: { blobId } },
      { ...metadataOptions(options, "all"), reportErrors: false },
    );
    if (downloadRetired(options)) return null;
    if (!result.ok) {
      return descriptorFailureFallback(transport, blobId, result, options);
    }
    const descriptor = result.data;
    if (descriptor.byteLength > limit) return null;
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
 * rejected fetch), `"fallback"` to the API stream (any other status), or null
 * once the caller retired.
 */
async function fetchSignedBlob(
  descriptor: Pick<BlobBytesResponse, "blobId" | "byteLength" | "sha256">,
  url: string,
  downloadFetch: DownloadFetch,
  options: BlobDownloadOptions,
): Promise<BlobBytesResponse | "retry" | "fallback" | null> {
  try {
    // Never send the application's session or cookies to the object store.
    // Reject redirects and keep bearer URLs out of referrers and errors.
    const response = await downloadFetch(url, storageFetchOptions(options));
    if (downloadRetired(options)) {
      await response.body?.cancel().catch(() => {});
      return null;
    }
    if (response.status !== 200) {
      await response.body?.cancel().catch(() => {});
      return response.status === 403 ? "retry" : "fallback";
    }
    if (options.maxEncryptedByteLength !== undefined) {
      if (!response.body) return "fallback";
      if (
        Number(response.headers.get("Content-Length")) >
        options.maxEncryptedByteLength
      ) {
        void response.body.cancel().catch(() => {});
        return "fallback";
      }
    }
    return await signedBlobResponse(descriptor, response, options);
  } catch {
    // The downstream SDK still verifies length, hash and authenticated
    // encryption. An error after streaming begins propagates to that reader.
    return "retry";
  }
}

async function signedBlobResponse(
  descriptor: Pick<BlobBytesResponse, "blobId" | "byteLength" | "sha256">,
  response: Response,
  options: BlobDownloadOptions,
): Promise<BlobBytesResponse> {
  return {
    blobId: descriptor.blobId,
    byteLength: descriptor.byteLength,
    sha256: descriptor.sha256,
    encryptedBytes: await blobDownloadBody(response, options, true),
  };
}

async function getBlobStream(
  transport: Pick<BinaryResponseOperationTransport, "requestBinaryResponse">,
  blobId: string,
  options: BlobDownloadOptions,
): Promise<BlobBytesResponse | null> {
  if (downloadRetired(options)) return null;
  const result = await transport.requestBinaryResponse(
    getBlobBytesOperation,
    {
      params: { blobId },
    },
    metadataOptions(options, "errors"),
  );
  if (!result) {
    return null;
  }

  const { headers, response } = result;
  const byteLength = Number(headers[blobWireHeaderKeys.blobByteLength]);

  if (
    options.maxEncryptedByteLength !== undefined &&
    (byteLength > options.maxEncryptedByteLength ||
      Number(response.headers.get("Content-Length")) >
        options.maxEncryptedByteLength ||
      !response.body)
  ) {
    void response.body?.cancel().catch(() => {});
    return null;
  }
  const encryptedBytes = await blobDownloadBody(response, options);
  return {
    blobId: headers[blobWireHeaderKeys.blobId],
    byteLength,
    encryptedBytes,
    sha256: headers[blobWireHeaderKeys.blobSha256],
  };
}
