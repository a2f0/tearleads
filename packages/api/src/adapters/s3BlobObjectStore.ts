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
  type BlobObjectStore,
  BlobObjectStoreError,
  type CompleteMultipartUploadPart,
} from "./blobObjectStore";

type S3BlobObjectStoreClient = Pick<S3Client, "send">;

interface S3BlobObjectStoreInput {
  readonly bucket: string;
  readonly client: S3BlobObjectStoreClient;
}

const TEXT_ENCODER = new TextEncoder();
const MAX_S3_PART_NUMBER = 10_000;

function byteLength(value: string): number {
  return TEXT_ENCODER.encode(value).byteLength;
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
    errorName(error) === "InvalidPart" || errorName(error) === "EntityTooSmall"
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

function hasTransformToString(
  value: unknown,
): value is { readonly transformToString: () => Promise<string> } {
  return typeof recordValue(value, "transformToString") === "function";
}

async function asyncIterableToString(
  value: AsyncIterable<string | Uint8Array>,
): Promise<string> {
  const decoder = new TextDecoder();
  let output = "";
  for await (const chunk of value) {
    output +=
      typeof chunk === "string"
        ? chunk
        : decoder.decode(chunk, { stream: true });
  }

  return output + decoder.decode();
}

async function responseBodyToString(
  body: NonNullable<GetObjectCommandOutput["Body"]>,
): Promise<string> {
  if (typeof body === "string") {
    return body;
  }
  if (body instanceof Uint8Array) {
    return new TextDecoder().decode(body);
  }
  if (body instanceof Blob) {
    return body.text();
  }
  if (body instanceof ReadableStream) {
    return new Response(body).text();
  }
  if (hasTransformToString(body)) {
    return body.transformToString();
  }
  if (isAsyncIterable(body)) {
    return asyncIterableToString(body);
  }

  throw new BlobObjectStoreError("Unsupported S3 object body", "not_found");
}

async function getS3Object(input: {
  readonly bucket: string;
  readonly client: S3BlobObjectStoreClient;
  readonly key: string;
}): Promise<string | null> {
  try {
    const object = await input.client.send(
      new GetObjectCommand({
        Bucket: input.bucket,
        Key: input.key,
      }),
    );
    if (!object.Body) {
      return "";
    }

    return responseBodyToString(object.Body);
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
  return async ({ key, parts, uploadId }) => {
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
          Key: key,
          MultipartUpload: {
            Parts: sortedParts(parts).map((part) => ({
              ETag: part.etag,
              PartNumber: part.partNumber,
            })),
          },
          UploadId: uploadId,
        }),
      ),
    );
    const bytes = await getS3Object({ bucket, client, key });
    if (bytes === null) {
      throw new BlobObjectStoreError(
        "Completed multipart object not found",
        "not_found",
      );
    }

    return {
      byteLength: byteLength(bytes),
      sha256: await sha256Hex(bytes),
    };
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

function createGetObject({
  bucket,
  client,
}: S3BlobObjectStoreInput): BlobObjectStore["getObject"] {
  return (key) => getS3Object({ bucket, client, key });
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
      if (input.bytes.length === 0) {
        throw new BlobObjectStoreError(
          "Multipart upload part bytes are required",
          "invalid_part",
        );
      }
      requireValidPartNumber(input.partNumber);

      const part = await client.send(
        new UploadPartCommand({
          Body: input.bytes,
          Bucket: bucket,
          ContentLength: byteLength(input.bytes),
          Key: input.key,
          PartNumber: input.partNumber,
          UploadId: input.uploadId,
        }),
      );

      return {
        byteLength: byteLength(input.bytes),
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
    getObject: createGetObject(input),
    listParts: createListParts(input),
    uploadPart: createUploadPart(input),
  };
}
