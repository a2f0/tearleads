import type { DatabaseTransaction } from "@tearleads/api-shared/postgres";
import { BLOB_MUTATION_ERROR_CODES } from "@tearleads/validators/response";
import {
  DocumentUpdateReadError,
  type DocumentVersionFrontier,
  hasDocumentOpsBeyondVersion,
  parseDocumentVersionFrontier,
} from "../../../documents/documentUpdateStore";
import { BlobMutationError } from "./types";

/**
 * Decodes the version the uploader checked its slot against before the bind
 * transaction locks anything, so a malformed vector never holds a lock.
 */
export function parseBindDocumentVersion(
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

/**
 * Refuses a bind while the document holds a committed op that the version the
 * uploader checked its slot against lacks: another device may have removed or
 * changed that slot since. The bind already holds the document head lock, and
 * every update insert takes that head `FOR UPDATE` first, so no update can
 * commit between this read and the binding row. The uploader recovers on its
 * own: it pulls, checks the slot still asks for these bytes, and binds again
 * against the newer version.
 */
export async function assertBindDocumentVersionCurrent(input: {
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
    throw new BlobMutationError(
      "Document changed after the attachment slot was checked",
      409,
      BLOB_MUTATION_ERROR_CODES.attachmentDocumentChanged,
    );
  }
}
