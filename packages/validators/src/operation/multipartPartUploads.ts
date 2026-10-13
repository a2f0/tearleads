import { z } from "zod";
import { ErrorResponseSchema, SessionFailureResponseSchema } from "../response";
import {
  boundedPositiveIntegerSchema,
  nonEmptyStringSchema,
  uuidStringSchema,
} from "../schema";
import { MAX_MULTIPART_BLOB_PART_BYTES } from "../util";
import { MultipartBlobPartPathParamsSchema } from "./blobBytes";
import {
  blobPartContentMd5Schema,
  signedBlobUrlExpirySchema,
  signedBlobUrlSchema,
} from "./blobTransferSchemas";
import { defineJsonOperation } from "./definition";

const partByteLengthSchema = boundedPositiveIntegerSchema(
  MAX_MULTIPART_BLOB_PART_BYTES,
);

export const MultipartBlobPartUploadRequestSchema = z.strictObject({
  byteLength: partByteLengthSchema,
  contentMd5: blobPartContentMd5Schema,
  uploadId: nonEmptyStringSchema,
});

export const MultipartBlobPartUploadResponseSchema = z.strictObject({
  byteLength: partByteLengthSchema,
  contentMd5: blobPartContentMd5Schema,
  partNumber: boundedPositiveIntegerSchema(10_000),
  stageId: uuidStringSchema,
  uploadId: nonEmptyStringSchema,
  source: z.discriminatedUnion("kind", [
    z.strictObject({ kind: z.literal("api") }),
    z.strictObject({
      kind: z.literal("signed-url"),
      url: signedBlobUrlSchema,
      expiresAt: signedBlobUrlExpirySchema,
    }),
  ]),
});

export type MultipartBlobPartUploadRequest = z.infer<
  typeof MultipartBlobPartUploadRequestSchema
>;
export type MultipartBlobPartUploadResponse = z.infer<
  typeof MultipartBlobPartUploadResponseSchema
>;

export const authorizeMultipartBlobPartUploadOperation = defineJsonOperation({
  auth: "session",
  body: MultipartBlobPartUploadRequestSchema,
  failureResponses: {
    400: ErrorResponseSchema,
    401: SessionFailureResponseSchema,
    403: ErrorResponseSchema,
    404: ErrorResponseSchema,
    409: ErrorResponseSchema,
    500: ErrorResponseSchema,
  },
  failureStatuses: [400, 401, 403, 404, 409, 500],
  id: "blobs.multipartStages.parts.authorize",
  method: "POST",
  params: MultipartBlobPartPathParamsSchema,
  path: "/blobs/stages/multipart/{stageId}/parts/{partNumber}/upload",
  responses: { 200: MultipartBlobPartUploadResponseSchema },
});
