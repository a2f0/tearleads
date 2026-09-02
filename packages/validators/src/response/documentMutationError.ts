import { z } from "zod";
import {
  DOCUMENT_NOT_FOUND_ERROR_CODE,
  DocumentSyncErrorCodeSchema,
} from "./documentSyncError";

export const DOCUMENT_MUTATION_ERROR_CODES = {
  manifestAlreadyExists: "document_manifest_already_exists",
} as const;

export const DocumentMutationBehaviorErrorCodeSchema = z.literal([
  DOCUMENT_MUTATION_ERROR_CODES.manifestAlreadyExists,
]);

export const DocumentMutationErrorCodeSchema = z.union([
  DocumentMutationBehaviorErrorCodeSchema,
  DocumentSyncErrorCodeSchema,
  z.literal(DOCUMENT_NOT_FOUND_ERROR_CODE),
]);

export type DocumentMutationErrorCode = z.infer<
  typeof DocumentMutationErrorCodeSchema
>;

/**
 * Document mutations retain uncoded terminal diagnostics while constraining
 * every behavior-bearing code to the shared registry above.
 */
export const DocumentMutationFailureResponseSchema = z.looseObject({
  code: DocumentMutationErrorCodeSchema.optional(),
  error: z.string().min(1),
});

export type DocumentMutationFailureResponse = z.infer<
  typeof DocumentMutationFailureResponseSchema
>;
