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
