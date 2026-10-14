import { md5 } from "@noble/hashes/legacy.js";
import { bytesToHex } from "@tearleads/crypto";
import {
  authorizeMultipartBlobPartUploadOperation,
  blobWireHeaderKeys,
  operationRequestPath,
  uploadMultipartBlobPartBytesOperation,
} from "@tearleads/validators/operation";
import type { UploadMultipartBlobPartResponse } from "@tearleads/validators/response";
import {
  MAX_MULTIPART_BLOB_PART_BYTES,
  type MultipartBlobPartDescriptor,
  type MultipartBlobPartUploadSource,
} from "@tearleads/validators/util";
import type { OperationTransport } from "../../operationTransportFactory";
import type { RequestResultOptions } from "../../types";
import type { UploadMultipartBlobPartBytesRequest } from "./get";
import { storageFetchOptions } from "./storageFetchOptions";

type UploadFetch = (url: string, init: RequestInit) => Promise<Response>;

function invalidPart(transport: OperationTransport, path: string) {
  transport.reportFailure({
    kind: "shape",
    method: authorizeMultipartBlobPartUploadOperation.method,
    path,
    status: null,
    statusText: "",
    message: "Multipart part bytes do not match the declared length or SHA-256",
  });
  return null;
}

async function retryStorageStatus(status: number, attempt: number) {
  if (status === 403) return true;
  const transient = status === 429 || (status >= 500 && status <= 599);
  if (transient && attempt === 0) {
    await new Promise<void>((resolve) => setTimeout(resolve, 250));
  }
  return transient;
}

function contentMd5Base64(bytes: Uint8Array): string {
  return btoa(String.fromCharCode(...md5(bytes)));
}

/**
 * Describe an encrypted part the way a stage initiation lists the parts it
 * will send first: number, exact length, and the Content-MD5 a signed upload
 * URL binds.
 */
export function describeMultipartBlobPart(
  partNumber: number,
  encryptedBytes: Uint8Array,
): MultipartBlobPartDescriptor {
  return {
    byteLength: encryptedBytes.byteLength,
    contentMd5: contentMd5Base64(encryptedBytes),
    partNumber,
  };
}

async function preparePart(input: UploadMultipartBlobPartBytesRequest) {
  // File snapshots mutable buffers and preserves ciphertext across Capacitor's
  // native HTTP bridge. Uint8Array is UTF-8 decoded there; a plain Blob becomes
  // JSON. File's base64 bridge path is byte-for-byte, including non-UTF-8 data.
  const file =
    input.encryptedBytes instanceof File
      ? input.encryptedBytes
      : new File([input.encryptedBytes], "encrypted-blob-part", {
          type: "application/octet-stream",
        });
  if (
    file.size !== input.byteLength ||
    file.size < 1 ||
    file.size > MAX_MULTIPART_BLOB_PART_BYTES
  ) {
    throw new TypeError("Invalid multipart part byte length");
  }
  const bytes = await file.arrayBuffer();
  if (
    bytesToHex(new Uint8Array(await crypto.subtle.digest("SHA-256", bytes))) !==
    input.sha256
  ) {
    throw new TypeError("Multipart part SHA-256 does not match its bytes");
  }
  return { file, contentMd5: contentMd5Base64(new Uint8Array(bytes)) };
}

interface PartUploadContext {
  readonly contentMd5: string;
  readonly input: UploadMultipartBlobPartBytesRequest;
  readonly options: RequestResultOptions;
  readonly partNumber: number;
  readonly path: string;
  readonly stageId: string;
  readonly transport: OperationTransport;
}

// Sign just in time for this part. The returned descriptor must name exactly
// the part, upload, length, and checksum that were requested.
async function authorizePart(
  context: PartUploadContext,
): Promise<MultipartBlobPartUploadSource | null> {
  const operation = authorizeMultipartBlobPartUploadOperation;
  const { input, partNumber, stageId } = context;
  const result = await context.transport.requestResult(
    operation,
    {
      params: { stageId, partNumber },
      body: {
        byteLength: input.byteLength,
        contentMd5: context.contentMd5,
        uploadId: input.uploadId,
      },
    },
    context.options,
  );
  if (!result.ok) return null;
  const descriptor = result.data;
  if (
    descriptor.stageId !== stageId ||
    descriptor.uploadId !== input.uploadId ||
    descriptor.partNumber !== partNumber ||
    descriptor.byteLength !== input.byteLength ||
    descriptor.contentMd5 !== context.contentMd5
  ) {
    context.transport.reportFailure({
      kind: "shape",
      method: operation.method,
      path: context.path,
      status: 200,
      statusText: "",
      message: "Multipart upload descriptor does not match its part",
    });
    return null;
  }
  return descriptor.source;
}

// Parts can wait behind other transfers in the shared pool. An issued URL that
// is about to lapse would only spend this part's retry on a certain 403, so
// authorize afresh instead; a skewed clock errs toward authorizing.
const ISSUED_URL_MIN_REMAINING_MS = 30_000;

function isUsableIssuedSource(
  source: MultipartBlobPartUploadSource | undefined,
): source is MultipartBlobPartUploadSource {
  return (
    source !== undefined &&
    (source.kind === "api" ||
      Date.parse(source.expiresAt) - Date.now() > ISSUED_URL_MIN_REMAINING_MS)
  );
}

// A capability path for memory/custom stores; S3/R2 never proxy parts.
function uploadThroughApi(context: PartUploadContext, file: File) {
  const { input } = context;
  return context.transport.requestBinaryRequest(
    uploadMultipartBlobPartBytesOperation,
    {
      params: { stageId: context.stageId, partNumber: context.partNumber },
      body: input.encryptedBytes,
      headers: {
        [blobWireHeaderKeys.partByteLength]: input.byteLength.toString(),
        [blobWireHeaderKeys.partSha256]: input.sha256,
        [blobWireHeaderKeys.partUploadId]: input.uploadId,
      },
    },
    { ...context.options, encodeBody: () => file },
  );
}

export async function uploadMultipartBlobPartBytes(
  transport: OperationTransport,
  stageId: string,
  partNumber: number,
  input: UploadMultipartBlobPartBytesRequest,
  uploadFetch: UploadFetch = (url, init) => fetch(url, init),
  options: RequestResultOptions = {},
): Promise<UploadMultipartBlobPartResponse | null> {
  if (options.signal?.aborted) return null;
  const path = operationRequestPath(authorizeMultipartBlobPartUploadOperation, {
    stageId,
    partNumber,
  });
  const prepared = await preparePart(input).catch(() =>
    invalidPart(transport, path),
  );
  if (!prepared) return null;
  const { file, contentMd5 } = prepared;
  const context: PartUploadContext = {
    contentMd5,
    input,
    options,
    partNumber,
    path,
    stageId,
    transport,
  };
  let status: number | null = null;
  // The first attempt uses the source the stage initiation issued, if any. A
  // network failure may be an expired URL hidden by R2 CORS, or a lost success
  // response; reauthorize once and send the same immutable bytes to the same
  // part number.
  for (let attempt = 0; attempt < 2; attempt += 1) {
    if (options.signal?.aborted) return null;
    const source =
      attempt === 0 && isUsableIssuedSource(input.source)
        ? input.source
        : await authorizePart(context);
    if (!source) return null;
    if (source.kind === "api") return uploadThroughApi(context, file);
    try {
      const response = await uploadFetch(source.url, {
        method: "PUT",
        body: file,
        headers: {
          "Content-Type": "application/octet-stream",
          "Content-MD5": contentMd5,
        },
        ...storageFetchOptions(options),
      });
      status = response.status;
      const etag = response.headers.get("ETag")?.trim();
      await response.body?.cancel().catch(() => {});
      if (status === 200 && etag) {
        return {
          stageId,
          uploadId: input.uploadId,
          part: { byteLength: input.byteLength, partNumber, etag },
        };
      }
      if (!(await retryStorageStatus(status, attempt))) break;
    } catch {
      // Never expose a provider exception or body: it may contain the bearer URL.
      status = null;
    }
  }
  if (options.signal?.aborted) return null;
  reportStorageFailure(transport, path, partNumber, status);
  return null;
}

function reportStorageFailure(
  transport: OperationTransport,
  path: string,
  partNumber: number,
  status: number | null,
) {
  transport.reportFailure({
    kind: "storage",
    method: authorizeMultipartBlobPartUploadOperation.method,
    path,
    status,
    statusText: "",
    message:
      status === 200
        ? `Multipart part ${partNumber} storage response is missing ETag; check storage CORS exposure`
        : `Multipart part ${partNumber} storage upload failed${status === null ? "" : ` (HTTP ${status})`}`,
  });
}
