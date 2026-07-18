import { z } from "zod";

export const DOCUMENT_SYNC_ERROR_CODES = {
  conflict: "document_sync_conflict",
  stateStale: "document_sync_state_stale",
  updateIdConflict: "document_sync_update_id_conflict",
} as const;

export const DocumentSyncErrorCodeSchema = z.literal([
  DOCUMENT_SYNC_ERROR_CODES.conflict,
  DOCUMENT_SYNC_ERROR_CODES.stateStale,
  DOCUMENT_SYNC_ERROR_CODES.updateIdConflict,
]);

export type DocumentSyncErrorCode = z.infer<typeof DocumentSyncErrorCodeSchema>;

export const DocumentSyncErrorResponseSchema = z.looseObject({
  code: DocumentSyncErrorCodeSchema,
  error: z.string().min(1),
});

export type DocumentSyncErrorResponse = z.infer<
  typeof DocumentSyncErrorResponseSchema
>;

export function isDocumentSyncErrorResponse(
  value: unknown,
): value is DocumentSyncErrorResponse {
  return DocumentSyncErrorResponseSchema.safeParse(value).success;
}

/**
 * Positive server-verified "this document does not exist" signal. Clients run a
 * destructive local teardown when the upstream document is deleted, so that
 * action must never key off a bare HTTP 404 — proxy/tunnel error pages,
 * deploy-skew route misses, and container-level lookups all produce 404s that
 * say nothing about the document. Only the routes' genuine document-existence
 * checks emit this code.
 */
export const DOCUMENT_NOT_FOUND_ERROR_CODE = "document_not_found";

export type DocumentNotFoundErrorCode = typeof DOCUMENT_NOT_FOUND_ERROR_CODE;

export const DocumentNotFoundErrorResponseSchema = z.looseObject({
  code: z.literal(DOCUMENT_NOT_FOUND_ERROR_CODE),
  error: z.string().min(1),
});

export type DocumentNotFoundErrorResponse = z.infer<
  typeof DocumentNotFoundErrorResponseSchema
>;
