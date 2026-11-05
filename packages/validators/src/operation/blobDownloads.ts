import { z } from "zod";
import { ErrorResponseSchema, SessionFailureResponseSchema } from "../response";
import {
  safeNonNegativeIntegerSchema,
  sha256HexStringSchema,
  uuidStringSchema,
} from "../schema";
import {
  signedBlobUrlExpirySchema,
  signedBlobUrlSchema,
} from "../util/blobTransferSchemas";
import { BlobBytesPathParamsSchema } from "./blobBytes";
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
  summary: "Get a blob download source",
  description:
    "Returns a committed blob's byte length, SHA-256 digest, and where to fetch its encrypted bytes: a five-minute signed object-store URL, or this API's `/bytes` route when the store cannot sign. Requires read access through at least one active attachment binding's document. Key material comes from the attachment listing, never from this response.",
  method: "GET",
  params: BlobBytesPathParamsSchema,
  path: "/blobs/{blobId}/download",
  responses: { 200: BlobDownloadResponseSchema },
});
