import {
  AbortMultipartUploadCommand,
  CompleteMultipartUploadCommand,
  CreateMultipartUploadCommand,
  DeleteObjectCommand,
  GetObjectCommand,
  ListPartsCommand,
  PutObjectCommand,
  type S3Client,
  UploadPartCommand,
} from "@aws-sdk/client-s3";
import { isSha256HexString } from "@tearleads/validators/util";
import { sha256Hex } from "../utils/sha256";
import {
  type BlobObjectPart,
  type BlobObjectReadStream,
  type BlobObjectStore,
  BlobObjectStoreError,
  blobObjectChunkToStream,
  type CompleteMultipartUploadPart,
  isStringUploadPartBody,
} from "./blobObjectStore";
import {
  nodeReadableFromBlobObjectStream,
  responseBodyToStream,
} from "./s3BlobObjectStreams";

type S3BlobObjectStoreClient = Pick<S3Client, "send">;

interface S3BlobObjectStoreInput {
  readonly bucket: string;
  readonly client: S3BlobObjectStoreClient;
}

const MAX_S3_PART_NUMBER = 10_000;

function byteLength(value: string): number {
  return Buffer.byteLength(value, "utf8");
}

function sha256HexToBase64(value: string): string {
  if (!isSha256HexString(value)) {
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

function logRawS3Error(operationName: string, error: unknown): void {
  // Domain errors we constructed ourselves carry no extra diagnostic value.
  if (error instanceof BlobObjectStoreError) {
    return;
  }

  // The object store may be Garage or another S3 clone whose error names/codes
  // differ from AWS. Surface the raw fields so the underlying rejection is
  // visible instead of the lossy "Multipart upload part not found" mapping.
  console.error(`S3 blob object store ${operationName} failed`, {
    name: errorName(error),
    code: recordValue(error, "Code"),
    httpStatusCode: errorStatusCode(error),
    message: recordValue(error, "message"),
  });
}

async function mapS3Errors<T>(
  operationName: string,
  operation: () => Promise<T>,
): Promise<T> {
  try {
    return await operation();
  } catch (error) {
    logRawS3Error(operationName, error);
    const mappedError = toBlobObjectStoreError(error);
    if (mappedError) {
      throw mappedError;
    }

    throw error;
  }
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

    // Complete by part ETag only. Garage (and AWS for SHA-256) do not accept
    // FULL_OBJECT whole-object checksums for multipart uploads, and MpuObjectSize
    // is part of that same proprietary flexible-checksum flow. Per-part integrity
    // is still validated at upload time via each part's ChecksumSHA256, and the
    // payload is AES-GCM encrypted with a client-side sha256 check on download.
    await mapS3Errors("completeMultipartUpload", () =>
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

    return expected;
  };
}

function createMultipartUpload({
  bucket,
  client,
}: S3BlobObjectStoreInput): BlobObjectStore["createMultipartUpload"] {
  return ({ key }) =>
    mapS3Errors("createMultipartUpload", async () => {
      // Do not declare a checksum algorithm at create time. Doing so (with
      // SHA-256) makes S3/Garage require every part's checksum to be echoed in
      // CompleteMultipartUpload, which we don't carry there. Parts still send
      // their own ChecksumSHA256 on UploadPart for in-transit validation, and
      // completion is by ETag.
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
    mapS3Errors("listParts", () =>
      listS3Parts({ bucket, client, key: input.key, uploadId: input.uploadId }),
    );
}

function createPutObject({
  bucket,
  client,
}: S3BlobObjectStoreInput): BlobObjectStore["putObject"] {
  return ({ bytes, key, sha256 }) =>
    mapS3Errors("putObject", async () => {
      const objectByteLength = byteLength(bytes);
      await client.send(
        new PutObjectCommand({
          Body: bytes,
          Bucket: bucket,
          ChecksumAlgorithm: "SHA256",
          ChecksumSHA256: sha256HexToBase64(sha256),
          ContentLength: objectByteLength,
          Key: key,
        }),
      );

      return { byteLength: objectByteLength, sha256 };
    });
}

function createUploadPart({
  bucket,
  client,
}: S3BlobObjectStoreInput): BlobObjectStore["uploadPart"] {
  return (input) =>
    mapS3Errors("uploadPart", async () => {
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
    putObject: createPutObject(input),
    uploadPart: createUploadPart(input),
  };
}
