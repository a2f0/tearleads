import { Readable } from "node:stream";
import {
  AbortMultipartUploadCommand,
  CompleteMultipartUploadCommand,
  CreateMultipartUploadCommand,
  DeleteObjectCommand,
  GetObjectCommand,
  type GetObjectCommandOutput,
  ListPartsCommand,
  type S3Client,
  UploadPartCommand,
} from "@aws-sdk/client-s3";
import { sha256Hex } from "../utils/sha256";
import {
  type BlobObjectPart,
  type BlobObjectReadChunk,
  type BlobObjectReadStream,
  type BlobObjectStore,
  BlobObjectStoreError,
  blobObjectChunkToStream,
  blobObjectChunkToUint8Array,
  type CompleteMultipartUploadPart,
  isStringUploadPartBody,
} from "./blobObjectStore";

type S3BlobObjectStoreClient = Pick<S3Client, "send">;

interface S3BlobObjectStoreInput {
  readonly bucket: string;
  readonly client: S3BlobObjectStoreClient;
}

const MAX_S3_PART_NUMBER = 10_000;

function byteLength(value: string): number {
  return Buffer.byteLength(value, "utf8");
}

async function* readBlobObjectStream(
  stream: BlobObjectReadStream,
): AsyncGenerator<Uint8Array> {
  const reader = stream.getReader();
  try {
    for (;;) {
      const chunk = await reader.read();
      if (chunk.done) {
        return;
      }
      yield chunk.value;
    }
  } finally {
    reader.releaseLock();
  }
}

function nodeReadableFromBlobObjectStream(
  stream: BlobObjectReadStream,
): Readable {
  return Readable.from(readBlobObjectStream(stream));
}

function sha256HexToBase64(value: string): string {
  if (!/^[0-9a-f]{64}$/u.test(value)) {
    throw new BlobObjectStoreError("Invalid SHA-256 digest", "invalid_part");
  }

  return Buffer.from(value, "hex").toString("base64");
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object";
}

function recordValue(value: unknown, key: string): unknown {
  return isRecord(value) ? value[key] : undefined;
}

function errorName(error: unknown): string | undefined {
  const name = recordValue(error, "name");
  return typeof name === "string" ? name : undefined;
}

function errorStatusCode(error: unknown): number | undefined {
  const statusCode = recordValue(
    recordValue(error, "$metadata"),
    "httpStatusCode",
  );
  return typeof statusCode === "number" ? statusCode : undefined;
}

function isS3NotFoundError(error: unknown): boolean {
  return (
    errorStatusCode(error) === 404 ||
    errorName(error) === "NoSuchKey" ||
    errorName(error) === "NoSuchUpload" ||
    errorName(error) === "NotFound"
  );
}

function requireString(value: string | undefined, message: string): string {
  if (!value) {
    throw new BlobObjectStoreError(message, "not_found");
  }

  return value;
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

function sortedParts(
  parts: readonly CompleteMultipartUploadPart[],
): readonly CompleteMultipartUploadPart[] {
  const seenPartNumbers = new Set<number>();
  for (const part of parts) {
    requireValidPartNumber(part.partNumber);
    if (seenPartNumbers.has(part.partNumber)) {
      throw new BlobObjectStoreError(
        "Multipart upload contains duplicate parts",
        "invalid_part",
      );
    }
    seenPartNumbers.add(part.partNumber);
  }

  return [...parts].sort((left, right) => left.partNumber - right.partNumber);
}

function isS3InvalidPartError(error: unknown): boolean {
  return (
    errorName(error) === "InvalidPart" ||
    errorName(error) === "EntityTooSmall" ||
    errorName(error) === "BadDigest" ||
    errorName(error) === "InvalidRequest"
  );
}

function toBlobObjectStoreError(error: unknown): BlobObjectStoreError | null {
  if (error instanceof BlobObjectStoreError) {
    return error;
  }
  if (isS3NotFoundError(error)) {
    return new BlobObjectStoreError("Multipart upload not found", "not_found");
  }
  if (isS3InvalidPartError(error)) {
    return new BlobObjectStoreError(
      "Multipart upload part not found",
      "invalid_part",
    );
  }

  return null;
}

async function mapS3Errors<T>(operation: () => Promise<T>): Promise<T> {
  try {
    return await operation();
  } catch (error) {
    const mappedError = toBlobObjectStoreError(error);
    if (mappedError) {
      throw mappedError;
    }

    throw error;
  }
}

function isAsyncIterable(
  value: unknown,
): value is AsyncIterable<string | Uint8Array> {
  return (
    isRecord(value) &&
    Symbol.asyncIterator in value &&
    typeof value[Symbol.asyncIterator] === "function"
  );
}

function hasTransformToWebStream(
  value: unknown,
): value is { readonly transformToWebStream: () => ReadableStream<unknown> } {
  return typeof recordValue(value, "transformToWebStream") === "function";
}

function readableStreamToBlobObjectStream(
  stream: ReadableStream<unknown>,
): BlobObjectReadStream {
  const reader = stream.getReader();

  return new ReadableStream<Uint8Array>({
    async pull(controller) {
      try {
        const { done, value } = await reader.read();
        if (done) {
          controller.close();
          return;
        }

        if (typeof value === "string" || value instanceof Uint8Array) {
          controller.enqueue(blobObjectChunkToUint8Array(value));
          return;
        }

        throw new BlobObjectStoreError(
          "Unsupported S3 object body chunk type",
          "unsupported_body",
        );
      } catch (error) {
        await cancelReader(reader, error);
        controller.error(error);
      }
    },

    cancel(reason) {
      return reader.cancel(reason);
    },
  });
}

async function cancelReader(
  reader: ReadableStreamDefaultReader<unknown>,
  reason: unknown,
): Promise<void> {
  try {
    await reader.cancel(reason);
  } catch {
    // Preserve the original stream error.
  }
}

async function closeAsyncIterator(
  iterator: AsyncIterator<BlobObjectReadChunk>,
): Promise<void> {
  if (typeof iterator.return !== "function") {
    return;
  }

  try {
    await iterator.return();
  } catch {
    // Preserve the original iterator error.
  }
}

function asyncIterableToStream(
  value: AsyncIterable<BlobObjectReadChunk>,
): BlobObjectReadStream {
  const iterator = value[Symbol.asyncIterator]();

  return new ReadableStream<Uint8Array>({
    async pull(controller) {
      try {
        const { done, value: chunk } = await iterator.next();
        if (done) {
          controller.close();
          return;
        }

        controller.enqueue(blobObjectChunkToUint8Array(chunk));
      } catch (error) {
        await closeAsyncIterator(iterator);
        controller.error(error);
      }
    },

    async cancel() {
      await closeAsyncIterator(iterator);
    },
  });
}

async function responseBodyToStream(
  body: NonNullable<GetObjectCommandOutput["Body"]>,
): Promise<BlobObjectReadStream> {
  const value: unknown = body;
  if (typeof value === "string" || value instanceof Uint8Array) {
    return blobObjectChunkToStream(value);
  }
  if (hasTransformToWebStream(value)) {
    return readableStreamToBlobObjectStream(value.transformToWebStream());
  }
  if (value instanceof Blob) {
    return readableStreamToBlobObjectStream(value.stream());
  }
  if (value instanceof ReadableStream) {
    return readableStreamToBlobObjectStream(value);
  }
  if (isAsyncIterable(value)) {
    return asyncIterableToStream(value);
  }

  throw new BlobObjectStoreError(
    "Unsupported S3 object body type",
    "unsupported_body",
  );
}

async function getS3ObjectStream(input: {
  readonly bucket: string;
  readonly client: S3BlobObjectStoreClient;
  readonly key: string;
}): Promise<BlobObjectReadStream | null> {
  try {
    const object = await input.client.send(
      new GetObjectCommand({
        Bucket: input.bucket,
        Key: input.key,
      }),
    );
    if (!object.Body) {
      return blobObjectChunkToStream("");
    }

    return responseBodyToStream(object.Body);
  } catch (error) {
    if (isS3NotFoundError(error)) {
      return null;
    }

    throw error;
  }
}

async function listS3Parts(input: {
  readonly bucket: string;
  readonly client: S3BlobObjectStoreClient;
  readonly key: string;
  readonly uploadId: string;
}): Promise<readonly BlobObjectPart[]> {
  const parts: BlobObjectPart[] = [];
  let partNumberMarker: string | undefined;

  do {
    const response = await input.client.send(
      new ListPartsCommand({
        Bucket: input.bucket,
        Key: input.key,
        PartNumberMarker: partNumberMarker,
        UploadId: input.uploadId,
      }),
    );

    for (const part of response.Parts ?? []) {
      const partNumber = part.PartNumber ?? 0;
      requireValidPartNumber(partNumber);
      parts.push({
        byteLength: part.Size ?? 0,
        etag: requireString(part.ETag, "S3 multipart part ETag is missing"),
        partNumber,
      });
    }

    partNumberMarker = response.IsTruncated
      ? response.NextPartNumberMarker
      : undefined;
    if (response.IsTruncated && partNumberMarker === undefined) {
      throw new BlobObjectStoreError(
        "S3 multipart part marker is missing",
        "not_found",
      );
    }
  } while (partNumberMarker !== undefined);

  return parts.sort((left, right) => left.partNumber - right.partNumber);
}

function createAbortMultipartUpload({
  bucket,
  client,
}: S3BlobObjectStoreInput): BlobObjectStore["abortMultipartUpload"] {
  return async ({ key, uploadId }) => {
    try {
      await client.send(
        new AbortMultipartUploadCommand({
          Bucket: bucket,
          Key: key,
          UploadId: uploadId,
        }),
      );
    } catch (error) {
      if (!isS3NotFoundError(error)) {
        throw error;
      }
    }
  };
}

function createCompleteMultipartUpload({
  bucket,
  client,
}: S3BlobObjectStoreInput): BlobObjectStore["completeMultipartUpload"] {
  return async ({ expected, key, parts, uploadId }) => {
    if (parts.length === 0) {
      throw new BlobObjectStoreError(
        "Multipart upload requires at least one part",
        "invalid_part",
      );
    }

    await mapS3Errors(() =>
      client.send(
        new CompleteMultipartUploadCommand({
          Bucket: bucket,
          ChecksumSHA256: sha256HexToBase64(expected.sha256),
          ChecksumType: "FULL_OBJECT",
          Key: key,
          MultipartUpload: {
            Parts: sortedParts(parts).map((part) => ({
              ETag: part.etag,
              PartNumber: part.partNumber,
            })),
          },
          MpuObjectSize: expected.byteLength,
          UploadId: uploadId,
        }),
      ),
    );

    return expected;
  };
}

function createMultipartUpload({
  bucket,
  client,
}: S3BlobObjectStoreInput): BlobObjectStore["createMultipartUpload"] {
  return ({ key }) =>
    mapS3Errors(async () => {
      const upload = await client.send(
        new CreateMultipartUploadCommand({
          Bucket: bucket,
          ChecksumAlgorithm: "SHA256",
          ChecksumType: "FULL_OBJECT",
          Key: key,
        }),
      );

      return {
        uploadId: requireString(
          upload.UploadId,
          "S3 multipart upload id is missing",
        ),
      };
    });
}

function createDeleteObject({
  bucket,
  client,
}: S3BlobObjectStoreInput): BlobObjectStore["deleteObject"] {
  return async (key) => {
    await client.send(
      new DeleteObjectCommand({
        Bucket: bucket,
        Key: key,
      }),
    );
  };
}

function createGetObjectStream({
  bucket,
  client,
}: S3BlobObjectStoreInput): BlobObjectStore["getObjectStream"] {
  return (key) => getS3ObjectStream({ bucket, client, key });
}

function createListParts({
  bucket,
  client,
}: S3BlobObjectStoreInput): BlobObjectStore["listParts"] {
  return (input) =>
    mapS3Errors(() =>
      listS3Parts({ bucket, client, key: input.key, uploadId: input.uploadId }),
    );
}

function createUploadPart({
  bucket,
  client,
}: S3BlobObjectStoreInput): BlobObjectStore["uploadPart"] {
  return (input) =>
    mapS3Errors(async () => {
      const uploadBody = isStringUploadPartBody(input.body)
        ? {
            body: input.body.bytes,
            byteLength: byteLength(input.body.bytes),
            sha256: await sha256Hex(input.body.bytes),
          }
        : {
            body: nodeReadableFromBlobObjectStream(input.body.stream),
            byteLength: input.body.byteLength,
            sha256: input.body.sha256,
          };
      if (uploadBody.byteLength <= 0) {
        throw new BlobObjectStoreError(
          "Multipart upload part bytes are required",
          "invalid_part",
        );
      }
      requireValidPartNumber(input.partNumber);

      const part = await client.send(
        new UploadPartCommand({
          Body: uploadBody.body,
          Bucket: bucket,
          ChecksumAlgorithm: "SHA256",
          ChecksumSHA256: sha256HexToBase64(uploadBody.sha256),
          ContentLength: uploadBody.byteLength,
          Key: input.key,
          PartNumber: input.partNumber,
          UploadId: input.uploadId,
        }),
      );

      return {
        byteLength: uploadBody.byteLength,
        etag: requireString(part.ETag, "S3 multipart part ETag is missing"),
        partNumber: input.partNumber,
      };
    });
}

export function createS3BlobObjectStore(
  input: S3BlobObjectStoreInput,
): BlobObjectStore {
  return {
    abortMultipartUpload: createAbortMultipartUpload(input),
    completeMultipartUpload: createCompleteMultipartUpload(input),
    createMultipartUpload: createMultipartUpload(input),
    deleteObject: createDeleteObject(input),
    getObjectStream: createGetObjectStream(input),
    listParts: createListParts(input),
    uploadPart: createUploadPart(input),
  };
}
