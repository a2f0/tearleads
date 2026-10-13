import { z } from "zod";
import { ErrorResponseSchema, SessionFailureResponseSchema } from "../response";
import {
  safeNonNegativeIntegerSchema,
  sha256HexStringSchema,
  uuidStringSchema,
} from "../schema";
import { BlobBytesPathParamsSchema } from "./blobBytes";
import {
  signedBlobUrlExpirySchema,
  signedBlobUrlSchema,
} from "./blobTransferSchemas";
import { defineJsonOperation } from "./definition";

export const BlobDownloadResponseSchema = z.strictObject({
  blobId: uuidStringSchema,
  byteLength: safeNonNegativeIntegerSchema,
  sha256: sha256HexStringSchema,
  source: z.discriminatedUnion("kind", [
    z.strictObject({ kind: z.literal("api") }),
    z.strictObject({
      kind: z.literal("signed-url"),
      url: signedBlobUrlSchema,
      expiresAt: signedBlobUrlExpirySchema,
    }),
  ]),
});

export type BlobDownloadResponse = z.infer<typeof BlobDownloadResponseSchema>;

export const getBlobDownloadOperation = defineJsonOperation({
  auth: "session",
  failureResponses: {
    400: ErrorResponseSchema,
    401: SessionFailureResponseSchema,
    403: ErrorResponseSchema,
    404: ErrorResponseSchema,
    409: ErrorResponseSchema,
    500: ErrorResponseSchema,
  },
  failureStatuses: [400, 401, 403, 404, 409, 500],
  id: "blobs.download.get",
  method: "GET",
  params: BlobBytesPathParamsSchema,
  path: "/blobs/{blobId}/download",
  responses: { 200: BlobDownloadResponseSchema },
});
