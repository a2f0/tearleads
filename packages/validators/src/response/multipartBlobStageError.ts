import { z } from "zod";

export const MULTIPART_BLOB_STAGE_ERROR_CODES = {
  expired: "multipart_blob_stage_expired",
  notFound: "multipart_blob_stage_not_found",
} as const;

export type MultipartBlobStageErrorCode =
  (typeof MULTIPART_BLOB_STAGE_ERROR_CODES)[keyof typeof MULTIPART_BLOB_STAGE_ERROR_CODES];

/**
 * A missing stage is safe for resumable upload replacement only when the API
 * positively identifies the missing server-side stage. Proxy and route 404s
 * must remain uncoded.
 */
export const MultipartBlobStageNotFoundErrorResponseSchema = z.looseObject({
  code: z.literal(MULTIPART_BLOB_STAGE_ERROR_CODES.notFound),
  error: z.string().min(1),
});

export type MultipartBlobStageNotFoundErrorResponse = z.infer<
  typeof MultipartBlobStageNotFoundErrorResponseSchema
>;

/**
 * An expired stage is likewise replaceable only with positive server-side
 * proof. Unrelated conflicts must not cause the client to abandon resumable
 * state.
 */
export const MultipartBlobStageExpiredErrorResponseSchema = z.looseObject({
  code: z.literal(MULTIPART_BLOB_STAGE_ERROR_CODES.expired),
  error: z.string().min(1),
});

export type MultipartBlobStageExpiredErrorResponse = z.infer<
  typeof MultipartBlobStageExpiredErrorResponseSchema
>;

/**
 * Integrity failures discovered while recovering a consumed upload are
 * terminal and uncoded. The optional field accepts either no behavior tag or
 * exactly the expiry signal, so unknown codes cannot impersonate replacement
 * proof while OpenAPI retains one required-error object response.
 */
export const MultipartBlobStageConflictErrorResponseSchema = z.looseObject({
  code: z.literal(MULTIPART_BLOB_STAGE_ERROR_CODES.expired).optional(),
  error: z.string().min(1),
});

export type MultipartBlobStageConflictErrorResponse = z.infer<
  typeof MultipartBlobStageConflictErrorResponseSchema
>;
