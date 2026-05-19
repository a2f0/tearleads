import { sha256Hex } from "../utils/sha256";

export interface BlobObjectPart {
  readonly byteLength: number;
  readonly etag: string;
  readonly partNumber: number;
}

export interface CompleteMultipartUploadPart {
  readonly etag: string;
  readonly partNumber: number;
}

export interface CompletedBlobObject {
  readonly byteLength: number;
  readonly sha256: string;
}

export type BlobObjectReadChunk = string | Uint8Array;
export type BlobObjectReadStream = ReadableStream<Uint8Array>;
export type BlobObjectUploadPartBody =
  | { readonly bytes: string }
  | {
      readonly byteLength: number;
      readonly sha256: string;
      readonly stream: BlobObjectReadStream;
    };

type BlobObjectStoreErrorCode =
  | "invalid_part"
  | "not_found"
  | "unsupported_body"
  | "upload_conflict";

export class BlobObjectStoreError extends Error {
  constructor(
    message: string,
    readonly code: BlobObjectStoreErrorCode,
  ) {
    super(message);
    this.name = "BlobObjectStoreError";
  }
}

export interface BlobObjectStore {
  abortMultipartUpload(input: {
    readonly key: string;
    readonly uploadId: string;
  }): Promise<void>;
  completeMultipartUpload(input: {
    readonly expected: CompletedBlobObject;
    readonly key: string;
    readonly parts: readonly CompleteMultipartUploadPart[];
    readonly uploadId: string;
  }): Promise<CompletedBlobObject>;
  createMultipartUpload(input: {
    readonly key: string;
  }): Promise<{ readonly uploadId: string }>;
  deleteObject(key: string): Promise<void>;
  getObjectStream(key: string): Promise<BlobObjectReadStream | null>;
  listParts(input: {
    readonly key: string;
    readonly uploadId: string;
  }): Promise<readonly BlobObjectPart[]>;
  uploadPart(input: {
    readonly key: string;
    readonly partNumber: number;
    readonly body: BlobObjectUploadPartBody;
    readonly uploadId: string;
  }): Promise<BlobObjectPart>;
}

interface MultipartUploadState {
  readonly key: string;
  readonly parts: Map<number, { readonly bytes: string } & BlobObjectPart>;
  readonly uploadId: string;
}

const MAX_S3_PART_NUMBER = 10_000;

function byteLength(value: string): number {
  return Buffer.byteLength(value, "utf8");
}

function isStringUploadPartBody(
  body: BlobObjectUploadPartBody,
): body is { readonly bytes: string } {
  return "bytes" in body;
}

export function blobObjectChunkToUint8Array(
  chunk: BlobObjectReadChunk,
): Uint8Array {
  return typeof chunk === "string" ? new TextEncoder().encode(chunk) : chunk;
}

export function blobObjectChunkToStream(
  chunk: BlobObjectReadChunk,
): BlobObjectReadStream {
  const bytes = blobObjectChunkToUint8Array(chunk);

  return new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(bytes);
      controller.close();
    },
  });
}

function blobObjectStringToStream(value: string): BlobObjectReadStream {
  return blobObjectChunkToStream(value);
}

async function blobObjectStreamToString(
  stream: BlobObjectReadStream,
): Promise<string> {
  const decoder = new TextDecoder();
  const reader = stream.getReader();
  let value = "";

  try {
    while (true) {
      const { done, value: chunk } = await reader.read();
      if (done) {
        return value + decoder.decode();
      }

      value += decoder.decode(chunk, { stream: true });
    }
  } catch (error) {
    try {
      await reader.cancel(error);
    } catch {
      // Preserve the original stream error.
    }

    throw error;
  } finally {
    reader.releaseLock();
  }
}

function requireValidPartNumber(partNumber: number): void {
  if (
    !Number.isInteger(partNumber) ||
    partNumber < 1 ||
    partNumber > MAX_S3_PART_NUMBER
  ) {
    throw new BlobObjectStoreError(
      "Invalid multipart part number",
      "invalid_part",
    );
  }
}

async function computePartEtag(
  partNumber: number,
  bytes: string,
): Promise<string> {
  return sha256Hex(`${partNumber}\n${bytes}`);
}

function requireUpload(
  uploads: ReadonlyMap<string, MultipartUploadState>,
  input: { readonly key: string; readonly uploadId: string },
): MultipartUploadState {
  const upload = uploads.get(input.uploadId);
  if (!upload || upload.key !== input.key) {
    throw new BlobObjectStoreError("Multipart upload not found", "not_found");
  }

  return upload;
}

function createAbortMultipartUpload(
  uploadIdsByKey: Map<string, string>,
  uploads: Map<string, MultipartUploadState>,
): BlobObjectStore["abortMultipartUpload"] {
  return async ({ key, uploadId }) => {
    const upload = uploads.get(uploadId);
    if (upload?.key === key) {
      uploads.delete(uploadId);
      uploadIdsByKey.delete(key);
    }
  };
}

function createCompleteMultipartUpload(
  objects: Map<string, string>,
  uploadIdsByKey: Map<string, string>,
  uploads: Map<string, MultipartUploadState>,
): BlobObjectStore["completeMultipartUpload"] {
  return async ({ key, parts, uploadId }) => {
    const upload = requireUpload(uploads, { key, uploadId });
    if (parts.length === 0) {
      throw new BlobObjectStoreError(
        "Multipart upload requires at least one part",
        "invalid_part",
      );
    }

    const seenPartNumbers = new Set<number>();
    const bytes = [...parts]
      .sort((a, b) => a.partNumber - b.partNumber)
      .map((part) => {
        requireValidPartNumber(part.partNumber);
        if (seenPartNumbers.has(part.partNumber)) {
          throw new BlobObjectStoreError(
            "Multipart upload contains duplicate parts",
            "invalid_part",
          );
        }
        seenPartNumbers.add(part.partNumber);

        const storedPart = upload.parts.get(part.partNumber);
        if (!storedPart || storedPart.etag !== part.etag) {
          throw new BlobObjectStoreError(
            "Multipart upload part not found",
            "invalid_part",
          );
        }

        return storedPart.bytes;
      })
      .join("");

    objects.set(key, bytes);
    uploads.delete(uploadId);
    uploadIdsByKey.delete(key);

    return {
      byteLength: byteLength(bytes),
      sha256: await sha256Hex(bytes),
    };
  };
}

function createMultipartUpload(
  uploadIdsByKey: Map<string, string>,
  uploads: Map<string, MultipartUploadState>,
): BlobObjectStore["createMultipartUpload"] {
  return async ({ key }) => {
    if (uploadIdsByKey.has(key)) {
      throw new BlobObjectStoreError(
        "Multipart upload already exists",
        "upload_conflict",
      );
    }

    const uploadId = crypto.randomUUID();
    uploadIdsByKey.set(key, uploadId);
    uploads.set(uploadId, {
      key,
      parts: new Map(),
      uploadId,
    });

    return { uploadId };
  };
}

function createListParts(
  uploads: Map<string, MultipartUploadState>,
): BlobObjectStore["listParts"] {
  return async (input) => {
    const upload = requireUpload(uploads, input);

    return [...upload.parts.values()]
      .map(({ byteLength, etag, partNumber }) => ({
        byteLength,
        etag,
        partNumber,
      }))
      .sort((a, b) => a.partNumber - b.partNumber);
  };
}

function createUploadPart(
  uploads: Map<string, MultipartUploadState>,
): BlobObjectStore["uploadPart"] {
  return async ({ body, key, partNumber, uploadId }) => {
    requireValidPartNumber(partNumber);
    const bytes = isStringUploadPartBody(body)
      ? body.bytes
      : await blobObjectStreamToString(body.stream);
    if (bytes.length === 0) {
      throw new BlobObjectStoreError(
        "Multipart upload part bytes are required",
        "invalid_part",
      );
    }
    if (!isStringUploadPartBody(body)) {
      if (byteLength(bytes) !== body.byteLength) {
        throw new BlobObjectStoreError(
          "Multipart upload part byteLength mismatch",
          "invalid_part",
        );
      }
      if ((await sha256Hex(bytes)) !== body.sha256) {
        throw new BlobObjectStoreError(
          "Multipart upload part sha256 mismatch",
          "invalid_part",
        );
      }
    }

    const upload = requireUpload(uploads, { key, uploadId });
    const part: { readonly bytes: string } & BlobObjectPart = {
      byteLength: byteLength(bytes),
      bytes,
      etag: await computePartEtag(partNumber, bytes),
      partNumber,
    };
    upload.parts.set(partNumber, part);

    return {
      byteLength: part.byteLength,
      etag: part.etag,
      partNumber: part.partNumber,
    };
  };
}

export function createMemoryBlobObjectStore(): BlobObjectStore {
  const objects = new Map<string, string>();
  const uploadIdsByKey = new Map<string, string>();
  const uploads = new Map<string, MultipartUploadState>();

  return {
    abortMultipartUpload: createAbortMultipartUpload(uploadIdsByKey, uploads),
    completeMultipartUpload: createCompleteMultipartUpload(
      objects,
      uploadIdsByKey,
      uploads,
    ),
    createMultipartUpload: createMultipartUpload(uploadIdsByKey, uploads),

    async deleteObject(key) {
      objects.delete(key);
    },
    async getObjectStream(key) {
      const object = objects.get(key);

      return object === undefined ? null : blobObjectStringToStream(object);
    },

    listParts: createListParts(uploads),
    uploadPart: createUploadPart(uploads),
  };
}
