import { z } from "zod";
import {
  registerJsonSchemaFragment,
  registerJsonSchemaRuntimeRefinements,
  registerJsonSchemaView,
} from "../jsonSchema";
import {
  ErrorResponseSchema,
  isUploadMultipartBlobPartResponse,
  UploadMultipartBlobPartResponseSchema,
} from "../response";
import {
  nonEmptyStringSchema,
  sha256HexStringSchema,
  uuidStringSchema,
} from "../schema";
import { MAX_MULTIPART_BLOB_PART_BYTES } from "../util";
import { defineHttpOperation } from "./definition";

export const blobWireHeaderNames = {
  blobByteLength: "X-SymCrypt-Blob-Byte-Length",
  blobId: "X-SymCrypt-Blob-Id",
  blobSha256: "X-SymCrypt-Blob-Sha256",
  contentLength: "Content-Length",
  partByteLength: "X-SymCrypt-Blob-Part-Byte-Length",
  partSha256: "X-SymCrypt-Blob-Part-Sha256",
  partUploadId: "X-SymCrypt-Blob-Upload-Id",
} as const;

export const blobWireHeaderKeys = {
  blobByteLength: "x-symcrypt-blob-byte-length",
  blobId: "x-symcrypt-blob-id",
  blobSha256: "x-symcrypt-blob-sha256",
  contentLength: "content-length",
  partByteLength: "x-symcrypt-blob-part-byte-length",
  partSha256: "x-symcrypt-blob-part-sha256",
  partUploadId: "x-symcrypt-blob-upload-id",
} as const;

export const BlobBytesPathParamsSchema = z.strictObject({
  blobId: uuidStringSchema,
});

const multipartPartNumberSchema = registerJsonSchemaFragment(
  z.custom<number | string>((value) => {
    if (typeof value === "number") {
      return Number.isSafeInteger(value) && value > 0;
    }
    if (typeof value !== "string" || !/^\d+$/u.test(value)) {
      return false;
    }
    const parsed = Number(value);
    return Number.isSafeInteger(parsed) && parsed > 0;
  }),
  {
    maximum: Number.MAX_SAFE_INTEGER,
    minimum: 1,
    type: "integer",
  },
);

export const MultipartBlobPartPathParamsSchema = z.strictObject({
  partNumber: multipartPartNumberSchema,
  stageId: uuidStringSchema,
});

export type BlobBytesPathParams = z.infer<typeof BlobBytesPathParamsSchema>;
export type MultipartBlobPartPathParams = z.infer<
  typeof MultipartBlobPartPathParamsSchema
>;

const binaryBodySchema = registerJsonSchemaFragment(
  z.custom<Uint8Array>((value) => value instanceof Uint8Array),
  { format: "binary", type: "string" },
);

const NonNegativeIntegerHeaderViewSchema = registerJsonSchemaFragment(
  z.custom<string>((value) => {
    return typeof value === "string" && /^\d+$/u.test(value);
  }),
  { maxLength: 16, pattern: "^[0-9]+$", type: "string" },
);

const safeIntegerHeaderRuntimeRefinement = {
  description: "Blob byte length headers decode to JavaScript safe integers",
  id: "blobs.bytes.safeIntegerHeader",
} as const;

const nonNegativeIntegerHeaderSchema = registerJsonSchemaRuntimeRefinements(
  registerJsonSchemaView(
    NonNegativeIntegerHeaderViewSchema.refine((value) =>
      Number.isSafeInteger(Number(value)),
    ),
    NonNegativeIntegerHeaderViewSchema,
  ),
  [safeIntegerHeaderRuntimeRefinement],
);

const multipartPartByteLengthRuntimeRefinement = {
  description: `Declared multipart part byte length is at most ${MAX_MULTIPART_BLOB_PART_BYTES}`,
  id: "blobs.multipartPart.declaredByteLengthMax",
} as const;

const MultipartPartByteLengthHeaderViewSchema = registerJsonSchemaFragment(
  z.custom<string>((value) => {
    if (typeof value !== "string" || !/^\d+$/u.test(value)) {
      return false;
    }
    const parsed = Number(value);
    return Number.isSafeInteger(parsed) && parsed > 0;
  }),
  { maxLength: 9, minLength: 1, pattern: "^[0-9]+$", type: "string" },
);

const multipartPartByteLengthHeaderSchema =
  registerJsonSchemaRuntimeRefinements(
    registerJsonSchemaView(
      MultipartPartByteLengthHeaderViewSchema.refine(
        (value) => Number(value) <= MAX_MULTIPART_BLOB_PART_BYTES,
      ),
      MultipartPartByteLengthHeaderViewSchema,
    ),
    [multipartPartByteLengthRuntimeRefinement],
  );

export const MultipartBlobPartHeadersSchema = z.looseObject({
  [blobWireHeaderKeys.partByteLength]: multipartPartByteLengthHeaderSchema,
  [blobWireHeaderKeys.partSha256]: sha256HexStringSchema,
  [blobWireHeaderKeys.partUploadId]: nonEmptyStringSchema,
});

const BlobBytesResponseHeadersViewSchema = z.strictObject({
  [blobWireHeaderKeys.blobByteLength]:
    nonNegativeIntegerHeaderSchema.optional(),
  [blobWireHeaderKeys.blobId]: nonEmptyStringSchema,
  [blobWireHeaderKeys.blobSha256]: nonEmptyStringSchema,
  [blobWireHeaderKeys.contentLength]: nonNegativeIntegerHeaderSchema.optional(),
});

const blobByteLengthHeaderRuntimeRefinement = {
  description:
    "Blob byte responses include X-SymCrypt-Blob-Byte-Length or Content-Length",
  id: "blobs.bytes.byteLengthHeader",
} as const;

export const BlobBytesResponseHeadersSchema =
  registerJsonSchemaRuntimeRefinements(
    registerJsonSchemaView(
      BlobBytesResponseHeadersViewSchema.refine(
        (headers) =>
          headers[blobWireHeaderKeys.blobByteLength] !== undefined ||
          headers[blobWireHeaderKeys.contentLength] !== undefined,
      ),
      BlobBytesResponseHeadersViewSchema,
    ),
    [blobByteLengthHeaderRuntimeRefinement],
  );

export type MultipartBlobPartHeaders = z.infer<
  typeof MultipartBlobPartHeadersSchema
>;
export type BlobBytesResponseHeaders = z.infer<
  typeof BlobBytesResponseHeadersSchema
>;

export const getBlobBytesOperation = defineHttpOperation({
  auth: "session",
  failureResponses: {
    400: ErrorResponseSchema,
    401: ErrorResponseSchema,
    403: ErrorResponseSchema,
    404: ErrorResponseSchema,
    409: ErrorResponseSchema,
    500: ErrorResponseSchema,
  },
  failureStatuses: [400, 401, 403, 404, 409, 500],
  id: "blobs.bytes.get",
  method: "GET",
  params: BlobBytesPathParamsSchema,
  path: "/blobs/{blobId}/bytes",
  responseHeaders: { 200: BlobBytesResponseHeadersSchema },
  responseMediaTypes: { 200: "application/octet-stream" },
  responses: { 200: binaryBodySchema },
  runtimeRefinements: [
    blobByteLengthHeaderRuntimeRefinement,
    safeIntegerHeaderRuntimeRefinement,
  ],
});

export const uploadMultipartBlobPartBytesOperation = defineHttpOperation({
  auth: "session",
  body: binaryBodySchema,
  failureResponses: {
    400: ErrorResponseSchema,
    401: ErrorResponseSchema,
    403: ErrorResponseSchema,
    404: ErrorResponseSchema,
    409: ErrorResponseSchema,
    500: ErrorResponseSchema,
  },
  failureStatuses: [400, 401, 403, 404, 409, 500],
  headers: MultipartBlobPartHeadersSchema,
  id: "blobs.multipartStages.parts.upload",
  method: "PUT",
  params: MultipartBlobPartPathParamsSchema,
  path: "/blobs/stages/multipart/{stageId}/parts/{partNumber}/bytes",
  requestMediaType: "application/octet-stream",
  responses: { 200: UploadMultipartBlobPartResponseSchema },
  runtimeRefinements: [multipartPartByteLengthRuntimeRefinement],
});

export const isUploadMultipartBlobPartBytesOperationResponse =
  isUploadMultipartBlobPartResponse;
