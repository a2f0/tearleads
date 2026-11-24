import type { WriteHeader } from "@tearleads/crypto";
import {
  CONTENT_RECORD_ENCRYPTION_SUITE,
  computeContentRecordNonceDomainHash,
  parseDocumentEncryptedUpdate,
} from "@tearleads/crypto";
import { listVersionVectorSpans } from "@tearleads/loro";
import type { DocumentOutgoingUpdate } from "@tearleads/validators/request";
import { DocumentMutationError } from "./errors";

/**
 * An update's declared span must name at least one operation, and its end
 * must cover its start. Every honest writer derives both vectors from the
 * exact bytes it sends and never queues an update with no operations, so
 * this refuses only output no honest client produces.
 */
export function assertOutgoingDeclaredSpan(
  update: Pick<
    DocumentOutgoingUpdate,
    "partialEndVersionVector" | "partialStartVersionVector"
  >,
): void {
  let spanCount: number;
  try {
    spanCount = listVersionVectorSpans(update).length;
  } catch {
    throw new DocumentMutationError(
      "Document update version vectors are invalid",
      400,
    );
  }
  if (spanCount === 0) {
    throw new DocumentMutationError(
      "Document update declares no operations",
      400,
    );
  }
}

/**
 * A rotation baseline that signs a processed cursor may declare no
 * operations: its author voided every update through the cursor, so its
 * snapshot is empty, and the coverage gate weighs only the updates after
 * the cursor. The checkpoint consistency check still requires its vectors to
 * be valid, start empty, and end at its source. Every other update, a
 * baseline with no cursor included, must name at least one operation.
 */
export function assertOutgoingSpanOrCursoredEmptyBaseline(
  update: Pick<
    DocumentOutgoingUpdate,
    | "checkpointKind"
    | "coversThroughUpdateId"
    | "partialEndVersionVector"
    | "partialStartVersionVector"
  >,
): void {
  if (
    update.checkpointKind !== "rotate_baseline" ||
    update.coversThroughUpdateId === undefined
  ) {
    assertOutgoingDeclaredSpan(update);
  }
}

/**
 * The writer signs only the envelope's hash, so a reader would otherwise be
 * the first to find an envelope that does not parse or that names another
 * epoch, record, metadata, or nonce domain than its signed header. Every
 * reader refuses such a record; the API refuses it once, before storing it.
 */
export async function assertOutgoingEnvelopeMatchesHeader(input: {
  readonly documentId: string;
  readonly header: WriteHeader;
  readonly update: Pick<DocumentOutgoingUpdate, "encryptedData">;
}): Promise<void> {
  let envelope: ReturnType<typeof parseDocumentEncryptedUpdate>;
  try {
    envelope = parseDocumentEncryptedUpdate(input.update.encryptedData);
  } catch (error) {
    throw new DocumentMutationError(
      `Document update envelope is invalid: ${error instanceof Error ? error.message : String(error)}`,
      400,
    );
  }
  const { header } = input;
  const nonceDomainHash = await computeContentRecordNonceDomainHash({
    version: 1,
    organizationId: header.organizationId,
    objectKind: "document",
    objectId: input.documentId,
    contentKeyEpoch: header.contentKeyEpoch,
    encryptionSuite: CONTENT_RECORD_ENCRYPTION_SUITE,
    contentRecordId: header.contentRecordId,
  });
  if (
    envelope.contentKeyEpoch !== header.contentKeyEpoch ||
    envelope.contentRecordId !== header.contentRecordId ||
    envelope.metadataHash !== header.metadataHash ||
    envelope.nonceDomainHash !== header.nonceDomainHash ||
    header.nonceDomainHash !== nonceDomainHash
  ) {
    throw new DocumentMutationError(
      "Document update envelope does not match its write header",
      400,
    );
  }
}
