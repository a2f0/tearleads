import { z } from "zod";
import { CONTAINER_UNAVAILABLE_ERROR_CODE } from "./containerUnavailableError";

/**
 * Attachment bind/detach resolve their `authorizingContainerPathRefs` through
 * the same live-row check as document and container mutations, so they emit
 * the shared `container_unavailable` code. A bind also refuses with
 * `attachment_document_changed` when the document has a committed update its
 * `documentVersionVector` lacks; the uploader pulls, checks the slot again,
 * and retries. Every other blob failure stays an uncoded terminal diagnostic.
 */
export const BLOB_MUTATION_ERROR_CODES = {
  attachmentDocumentChanged: "attachment_document_changed",
  containerUnavailable: CONTAINER_UNAVAILABLE_ERROR_CODE,
} as const;

export type BlobMutationErrorCode =
  (typeof BLOB_MUTATION_ERROR_CODES)[keyof typeof BLOB_MUTATION_ERROR_CODES];

export const BlobMutationFailureResponseSchema = z.looseObject({
  code: z.literal(BLOB_MUTATION_ERROR_CODES.containerUnavailable).optional(),
  error: z.string().min(1),
});

export type BlobMutationFailureResponse = z.infer<
  typeof BlobMutationFailureResponseSchema
>;

/** A bind's 409 may also name a document that advanced past its version. */
export const BlobAttachmentBindFailureResponseSchema = z.looseObject({
  code: z
    .literal([
      BLOB_MUTATION_ERROR_CODES.attachmentDocumentChanged,
      BLOB_MUTATION_ERROR_CODES.containerUnavailable,
    ])
    .optional(),
  error: z.string().min(1),
});

export type BlobAttachmentBindFailureResponse = z.infer<
  typeof BlobAttachmentBindFailureResponseSchema
>;
