import { z } from "zod";
import { CONTAINER_UNAVAILABLE_ERROR_CODE } from "./containerUnavailableError";

/**
 * Attachment bind/detach resolve their `authorizingContainerPathRefs` through
 * the same live-row check as document and container mutations, so they emit
 * the shared `container_unavailable` code. Both also refuse with
 * `attachment_document_changed` when the document has a committed update
 * their `documentVersionVector` lacks, and a detach does when the binding was
 * bound at a version holding an op that version lacks; the client pulls,
 * checks the slot again, and retries. Every other blob failure stays an
 * uncoded terminal diagnostic.
 */
export const BLOB_MUTATION_ERROR_CODES = {
  attachmentDocumentChanged: "attachment_document_changed",
  containerUnavailable: CONTAINER_UNAVAILABLE_ERROR_CODE,
} as const;

export type BlobMutationErrorCode =
  (typeof BLOB_MUTATION_ERROR_CODES)[keyof typeof BLOB_MUTATION_ERROR_CODES];

export const BlobMutationFailureResponseSchema = z.looseObject({
  code: z
    .literal([
      BLOB_MUTATION_ERROR_CODES.attachmentDocumentChanged,
      BLOB_MUTATION_ERROR_CODES.containerUnavailable,
    ])
    .optional(),
  error: z.string().min(1),
});

export type BlobMutationFailureResponse = z.infer<
  typeof BlobMutationFailureResponseSchema
>;
