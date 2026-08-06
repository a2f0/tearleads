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

/**
 * Stable codes for document writer-projection failures that surface as 409s.
 * The route deliberately remaps container-level and dependency 404s to 409
 * (a document-route 404 triggers a destructive client wipe), which used to
 * collapse every origin into an uncoded conflict. These codes let a client
 * report WHICH dependency refused without parsing message text.
 */
export const DOCUMENT_PROJECTION_ERROR_CODES = {
  containerConflict: "document_projection_container_conflict",
  containerUnavailable: "document_projection_container_unavailable",
  contentKeyBundleMissing: "document_projection_content_key_bundle_missing",
  headMissing: "document_projection_head_missing",
  kekTargetsUnavailable: "document_projection_kek_targets_unavailable",
  stateInvalid: "document_projection_state_invalid",
} as const;

export const DocumentProjectionErrorCodeSchema = z.literal([
  DOCUMENT_PROJECTION_ERROR_CODES.containerConflict,
  DOCUMENT_PROJECTION_ERROR_CODES.containerUnavailable,
  DOCUMENT_PROJECTION_ERROR_CODES.contentKeyBundleMissing,
  DOCUMENT_PROJECTION_ERROR_CODES.headMissing,
  DOCUMENT_PROJECTION_ERROR_CODES.kekTargetsUnavailable,
  DOCUMENT_PROJECTION_ERROR_CODES.stateInvalid,
]);

export type DocumentProjectionErrorCode = z.infer<
  typeof DocumentProjectionErrorCodeSchema
>;

export const DocumentWriterProjectionErrorResponseSchema = z.looseObject({
  code: z.union([
    DocumentProjectionErrorCodeSchema,
    DocumentSyncErrorCodeSchema,
  ]),
  error: z.string().min(1),
});

export type DocumentWriterProjectionErrorResponse = z.infer<
  typeof DocumentWriterProjectionErrorResponseSchema
>;
