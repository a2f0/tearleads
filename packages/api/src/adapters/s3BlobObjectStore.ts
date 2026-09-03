import {
  AbortMultipartUploadCommand,
  CompleteMultipartUploadCommand,
  CreateMultipartUploadCommand,
  DeleteObjectCommand,
  GetObjectCommand,
  ListPartsCommand,
  type S3Client,
  UploadPartCommand,
} from "@aws-sdk/client-s3";
import { isSha256HexString } from "@tearleads/validators/util";
import { summarizeSha256Stream } from "../utils/sha256";
import {
  type BlobObjectPart,
  type BlobObjectReadStream,
  type BlobObjectStore,
  BlobObjectStoreError,
  blobObjectChunkToStream,
  type CompleteMultipartUploadPart,
  MAX_UPLOAD_PART_BYTES,
} from "./blobObjectStore";
import { recordValue, responseBodyToStream } from "./s3BlobObjectStreams";

type S3BlobObjectStoreClient = Pick<S3Client, "send">;

interface S3BlobObjectStoreInput {
  readonly bucket: string;
  readonly client: S3BlobObjectStoreClient;
}

const MAX_S3_PART_NUMBER = 10_000;

function sha256HexToBase64(value: string): string {
  if (!isSha256HexString(value)) {
    throw new BlobObjectStoreError("Invalid SHA-256 digest", "invalid_part");
  }

  return Buffer.from(value, "hex").toString("base64");
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

function errorCode(error: unknown): string | undefined {
  const code = recordValue(error, "Code");
  return typeof code === "string" ? code : undefined;
}

function hasS3ErrorIdentity(error: unknown, identity: string): boolean {
  return errorName(error) === identity || errorCode(error) === identity;
}

function isS3ObjectNotFoundError(error: unknown): boolean {
  return hasS3ErrorIdentity(error, "NoSuchKey");
}

function isS3MultipartUploadNotFoundError(error: unknown): boolean {
  return hasS3ErrorIdentity(error, "NoSuchUpload");
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
  if (isS3MultipartUploadNotFoundError(error)) {
    return new BlobObjectStoreError(
      "Multipart upload not found",
      "multipart_upload_not_found",
    );
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
    code: errorCode(error),
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
      return blobObjectChunkToStream(new Uint8Array());
    }

    return responseBodyToStream(object.Body);
  } catch (error) {
    if (isS3ObjectNotFoundError(error)) {
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
      if (!isS3MultipartUploadNotFoundError(error)) {
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

    // Complete by part ETag only. Garage (and AWS for SHA-256) do not accept
    // FULL_OBJECT whole-object checksums for multipart uploads, and MpuObjectSize
    // is part of that same proprietary flexible-checksum flow. Per-part integrity
    // is still validated at upload time via each part's ChecksumSHA256; after
    // assembly, the exact object is streamed and summarized below.
    return mapS3Errors("completeMultipartUpload", async () => {
      await client.send(
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
      );

      // S3 completion only confirms the submitted ETags; it does not return an
      // exact whole-object SHA-256. Read the newly assembled object as a stream
      // so the service can compare actual bytes with the stage's signed length
      // and digest without buffering the object in API memory.
      const completedObject = await getS3ObjectStream({ bucket, client, key });
      if (!completedObject) {
        throw new BlobObjectStoreError(
          "Completed multipart object not found",
          "not_found",
        );
      }

      return summarizeSha256Stream(completedObject);
    });
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

function createUploadPart({
  bucket,
  client,
}: S3BlobObjectStoreInput): BlobObjectStore["uploadPart"] {
  return (input) =>
    mapS3Errors("uploadPart", async () => {
      requireValidPartNumber(input.partNumber);

      // The part body is already read into memory at the route via Bun's native
      // body consumption (c.req.arrayBuffer), not a hand-rolled ReadableStream
      // reader — that reader is a Bun native-stream defect that fails a fraction
      // of part reads behind the ingress tunnel (and segfaulted before the body
      // was buffered). Send the in-memory bytes straight to the object store;
      // they are rewindable, so the SDK can retry a reset part.
      const partBytes = input.body.bytes;
      if (partBytes.byteLength <= 0) {
        throw new BlobObjectStoreError(
          "Multipart upload part bytes are required",
          "invalid_part",
        );
      }
      // Reject an oversized declaration before comparing it to the buffered
      // bytes, so an absurd Content-Length header fails on the ceiling rather
      // than the mismatch. The strict equality below then bounds the actual
      // bytes to the same ceiling.
      if (input.body.byteLength > MAX_UPLOAD_PART_BYTES) {
        throw new BlobObjectStoreError(
          `Multipart upload part exceeds the maximum of ${MAX_UPLOAD_PART_BYTES} bytes`,
          "invalid_part",
        );
      }
      if (partBytes.byteLength !== input.body.byteLength) {
        throw new BlobObjectStoreError(
          "Multipart upload part byteLength mismatch",
          "invalid_part",
        );
      }
      const uploadBody = {
        body: partBytes,
        byteLength: partBytes.byteLength,
        sha256: input.body.sha256,
      };

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
