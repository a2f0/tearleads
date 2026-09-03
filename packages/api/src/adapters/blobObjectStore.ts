import { MAX_MULTIPART_BLOB_PART_BYTES } from "@tearleads/validators/util";
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

export type BlobObjectReadStream = ReadableStream<Uint8Array>;
export interface BlobObjectUploadPartBody {
  readonly byteLength: number;
  readonly bytes: Uint8Array;
  readonly sha256: string;
}

type BlobObjectStoreErrorCode =
  | "invalid_part"
  | "multipart_upload_not_found"
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
  readonly parts: Map<number, { readonly bytes: Uint8Array } & BlobObjectPart>;
  readonly uploadId: string;
}

const MAX_S3_PART_NUMBER = 10_000;

// Upper bound on a single multipart part buffered in memory before it is sent to
// the object store. Mirrors the nginx `client_max_body_size` so the API enforces
// the same ceiling with or without the proxy in front. The route rejects an
// over-declared part before buffering, the server caps the request body at this
// size (see index.ts maxRequestBodySize), and the S3 store enforces it again on
// the buffered bytes — together they replace the mid-read ceiling the old
// streaming reader enforced, without the Bun native-stream defect.
export const MAX_UPLOAD_PART_BYTES = MAX_MULTIPART_BLOB_PART_BYTES;

export function blobObjectChunkToStream(
  bytes: Uint8Array,
): BlobObjectReadStream {
  return new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(bytes);
      controller.close();
    },
  });
}

function concatenateBytes(
  chunks: readonly Uint8Array[],
  byteLength = chunks.reduce((total, chunk) => total + chunk.byteLength, 0),
): Uint8Array {
  const bytes = new Uint8Array(byteLength);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }

  return bytes;
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
  bytes: Uint8Array,
): Promise<string> {
  return sha256Hex(
    concatenateBytes([new TextEncoder().encode(`${partNumber}\n`), bytes]),
  );
}

function requireUpload(
  uploads: ReadonlyMap<string, MultipartUploadState>,
  input: { readonly key: string; readonly uploadId: string },
): MultipartUploadState {
  const upload = uploads.get(input.uploadId);
  if (!upload || upload.key !== input.key) {
    throw new BlobObjectStoreError(
      "Multipart upload not found",
      "multipart_upload_not_found",
    );
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
  objects: Map<string, Uint8Array>,
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
    const storedParts = [...parts]
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
      });
    const bytes = concatenateBytes(storedParts);

    objects.set(key, bytes);
    uploads.delete(uploadId);
    uploadIdsByKey.delete(key);

    return {
      byteLength: bytes.byteLength,
      sha256: sha256Hex(bytes),
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
    const bytes = body.bytes;
    if (bytes.byteLength === 0) {
      throw new BlobObjectStoreError(
        "Multipart upload part bytes are required",
        "invalid_part",
      );
    }
    if (bytes.byteLength !== body.byteLength) {
      throw new BlobObjectStoreError(
        "Multipart upload part byteLength mismatch",
        "invalid_part",
      );
    }
    if (sha256Hex(bytes) !== body.sha256) {
      throw new BlobObjectStoreError(
        "Multipart upload part sha256 mismatch",
        "invalid_part",
      );
    }

    const upload = requireUpload(uploads, { key, uploadId });
    const part: { readonly bytes: Uint8Array } & BlobObjectPart = {
      byteLength: bytes.byteLength,
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
  const objects = new Map<string, Uint8Array>();
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

      return object === undefined
        ? null
        : blobObjectChunkToStream(object.slice());
    },

    listParts: createListParts(uploads),

    uploadPart: createUploadPart(uploads),
  };
}
