import type { DatabaseTransaction } from "@tearleads/api-shared/postgres";
import { BLOB_MUTATION_ERROR_CODES } from "@tearleads/validators/response";
import {
  DocumentUpdateReadError,
  hasDocumentOpsBeyondVersion,
} from "../../../documents/documentUpdateStore";
import { BlobMutationError } from "./types";

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
  readonly versionVector: string;
}): Promise<void> {
  let changed: boolean;
  try {
    changed = await hasDocumentOpsBeyondVersion(input.executor, {
      documentId: input.documentId,
      versionVector: input.versionVector,
    });
  } catch (error) {
    if (error instanceof DocumentUpdateReadError) {
      throw new BlobMutationError("Invalid document version vector", 400);
    }
    throw error;
  }
  if (changed) {
    throw new BlobMutationError(
      "Document changed after the attachment slot was checked",
      409,
      BLOB_MUTATION_ERROR_CODES.attachmentDocumentChanged,
    );
  }
}
