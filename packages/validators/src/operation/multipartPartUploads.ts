import type { z } from "zod";
import { ErrorResponseSchema, SessionFailureResponseSchema } from "../response";
import { nonEmptyStringSchema, uuidStringSchema } from "../schema";
import {
  MultipartBlobPartDescriptorSchema,
  MultipartBlobPartUploadSchema,
} from "../util/blobTransferSchemas";
import { MultipartBlobPartPathParamsSchema } from "./blobBytes";
import { defineJsonOperation } from "./definition";

// Initiation already returns sources for the first parts. This route covers
// later parts and renews a part whose URL expired or failed.
export const MultipartBlobPartUploadRequestSchema =
  MultipartBlobPartDescriptorSchema.omit({ partNumber: true }).extend({
    uploadId: nonEmptyStringSchema,
  });

export const MultipartBlobPartUploadResponseSchema =
  MultipartBlobPartUploadSchema.extend({
    stageId: uuidStringSchema,
    uploadId: nonEmptyStringSchema,
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
  summary: "Authorize a direct multipart blob part upload",
  description:
    "Returns a short-lived signed URL for uploading one part of a blob stage directly to object storage, for parts after the first batch or to renew an expired URL. Only the stage's owner may call it. The URL is scoped to the exact part number, byte length, and Content-MD5, and expiry never invalidates parts already uploaded.",
  method: "POST",
  params: MultipartBlobPartPathParamsSchema,
  path: "/blobs/stages/multipart/{stageId}/parts/{partNumber}/upload",
  responses: { 200: MultipartBlobPartUploadResponseSchema },
});
