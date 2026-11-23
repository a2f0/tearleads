import type { DatabaseTransaction } from "@tearleads/api-shared/postgres";
import { BLOB_MUTATION_ERROR_CODES } from "@tearleads/validators/response";
import { readProcessedThroughSequence } from "../../../documents/documentProcessedCursor";
import {
  DocumentUpdateReadError,
  type DocumentVersionFrontier,
  hasDocumentOpsBeyondVersion,
  parseDocumentVersionFrontier,
} from "../../../documents/documentUpdateStore";
import { hasUncommittedVersionOps } from "../../../documents/documentVersionCommitted";
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
 *
 * Only updates committed after the client's processed cursor are weighed.
 * The client sends the cursor only with a version holding every update its
 * pull imported up to there, and the rest it voided, so an update whose
 * declared span no version can hold stops refusing once the client judged
 * it. A cursor this document does not hold weighs every update.
 */
export async function assertAttachmentDocumentVersionCurrent(input: {
  readonly documentId: string;
  readonly executor: DatabaseTransaction;
  readonly processedThroughUpdateId: string | undefined;
  readonly version: DocumentVersionFrontier;
}): Promise<void> {
  if (
    await hasDocumentOpsBeyondVersion(input.executor, {
      afterSequence: await readProcessedThroughSequence(input.executor, {
        documentId: input.documentId,
        processedThroughUpdateId: input.processedThroughUpdateId,
      }),
      documentId: input.documentId,
      version: input.version,
    })
  ) {
    throw documentChanged();
  }
}

/**
 * Refuses a detach while the version the binding was bound at names an op
 * the document has not committed. A bind version runs ahead of the committed
 * document only by its uploader's unsent ops, such as a restore whose content
 * update is still on its way: until that op commits, a slot that looks
 * removed may yet ask for these bytes again. Once it commits,
 * `assertAttachmentDocumentVersionCurrent` makes the detaching client hold
 * it, or have voided it, like any other committed op, so the detach version
 * itself need not cover the bind version. A bind version naming an op every
 * reader voided, or one its uploader made up within the committed frontier,
 * therefore never holds the binding. The caller holds the document head
 * lock, so no update commits between this read and the detach.
 */
export async function assertBindVersionCommitted(input: {
  readonly bindVersion: DocumentVersionFrontier;
  readonly documentId: string;
  readonly executor: DatabaseTransaction;
}): Promise<void> {
  if (
    await hasUncommittedVersionOps(input.executor, {
      documentId: input.documentId,
      version: input.bindVersion,
    })
  ) {
    throw documentChanged();
  }
}
