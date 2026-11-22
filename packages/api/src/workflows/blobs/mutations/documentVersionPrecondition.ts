import type { DatabaseTransaction } from "@tearleads/api-shared/postgres";
import { BLOB_MUTATION_ERROR_CODES } from "@tearleads/validators/response";
import {
  DocumentUpdateReadError,
  type DocumentVersionFrontier,
  documentVersionCovers,
  hasDocumentOpsBeyondVersion,
  parseDocumentVersionFrontier,
} from "../../../documents/documentUpdateStore";
import { BlobMutationError } from "./types";

/**
 * Decodes the version a bind or detach checked its slot against before the
 * transaction locks anything, so a malformed vector never holds a lock.
 */
export function parseAttachmentDocumentVersion(
  versionVector: string,
): DocumentVersionFrontier {
  try {
    return parseDocumentVersionFrontier(versionVector);
  } catch (error) {
    if (error instanceof DocumentUpdateReadError) {
      throw new BlobMutationError("Invalid document version vector", 400);
    }
    throw error;
  }
}

function documentChanged(): BlobMutationError {
  return new BlobMutationError(
    "Document changed after the attachment slot was checked",
    409,
    BLOB_MUTATION_ERROR_CODES.attachmentDocumentChanged,
  );
}

/**
 * Refuses a bind or detach while the document holds a committed op that the
 * version its client checked the slot against lacks: another device may have
 * added, removed, or changed that slot since. The caller already holds the
 * document head lock, and every update insert takes that head `FOR UPDATE`
 * first, so no update can commit between this read and the binding write.
 * The client recovers on its own: it pulls, checks the slot again, and
 * retries against the newer version.
 */
export async function assertAttachmentDocumentVersionCurrent(input: {
  readonly documentId: string;
  readonly executor: DatabaseTransaction;
  readonly version: DocumentVersionFrontier;
}): Promise<void> {
  if (
    await hasDocumentOpsBeyondVersion(input.executor, {
      documentId: input.documentId,
      version: input.version,
    })
  ) {
    throw documentChanged();
  }
}

/**
 * Refuses a detach whose version lacks an op of the version the binding was
 * bound at. A bind version can hold its uploader's unsent ops, such as a
 * restore whose content update is still on its way: until that op commits
 * and the detaching client reads it, a slot that looks removed may yet ask
 * for these bytes again.
 */
export function assertDetachCoversBindVersion(input: {
  readonly bindVersion: DocumentVersionFrontier;
  readonly version: DocumentVersionFrontier;
}): void {
  if (!documentVersionCovers(input.version, input.bindVersion)) {
    throw documentChanged();
  }
}
