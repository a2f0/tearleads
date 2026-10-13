import { md5 } from "@noble/hashes/legacy.js";
import { bytesToHex } from "@tearleads/crypto";
import {
  authorizeMultipartBlobPartUploadOperation,
  blobWireHeaderKeys,
  operationRequestPath,
  uploadMultipartBlobPartBytesOperation,
} from "@tearleads/validators/operation";
import type { UploadMultipartBlobPartResponse } from "@tearleads/validators/response";
import { MAX_MULTIPART_BLOB_PART_BYTES } from "@tearleads/validators/util";
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
  const contentMd5 = btoa(String.fromCharCode(...md5(new Uint8Array(bytes))));
  return { file, contentMd5 };
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
  const operation = authorizeMultipartBlobPartUploadOperation;
  const params = { stageId, partNumber };
  const path = operationRequestPath(operation, params);
  const prepared = await preparePart(input).catch(() =>
    invalidPart(transport, path),
  );
  if (!prepared) return null;
  const { file, contentMd5 } = prepared;
  const body = {
    byteLength: input.byteLength,
    contentMd5,
    uploadId: input.uploadId,
  };
  let status: number | null = null;
  // Sign just in time for each part, not once for the entire file. A network
  // failure may be an expired URL hidden by R2 CORS, or a lost success response;
  // reauthorize once and send the same immutable bytes to the same part number.
  for (let attempt = 0; attempt < 2; attempt += 1) {
    if (options.signal?.aborted) return null;
    const result = await transport.requestResult(
      operation,
      { params, body },
      options,
    );
    if (!result.ok) return null;
    const descriptor = result.data;
    if (
      descriptor.stageId !== stageId ||
      descriptor.uploadId !== input.uploadId ||
      descriptor.partNumber !== partNumber ||
      descriptor.byteLength !== input.byteLength ||
      descriptor.contentMd5 !== contentMd5
    ) {
      transport.reportFailure({
        kind: "shape",
        method: operation.method,
        path,
        status: 200,
        statusText: "",
        message: "Multipart upload descriptor does not match its part",
      });
      return null;
    }
    if (descriptor.source.kind === "api") {
      // A capability path for memory/custom stores; S3/R2 never proxy parts.
      return transport.requestBinaryRequest(
        uploadMultipartBlobPartBytesOperation,
        {
          params,
          body: input.encryptedBytes,
          headers: {
            [blobWireHeaderKeys.partByteLength]: input.byteLength.toString(),
            [blobWireHeaderKeys.partSha256]: input.sha256,
            [blobWireHeaderKeys.partUploadId]: input.uploadId,
          },
        },
        { ...options, encodeBody: () => file },
      );
    }
    try {
      const response = await uploadFetch(descriptor.source.url, {
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
