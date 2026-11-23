import type {
  ParsedDocumentEncryptedUpdate,
  WriteHeader,
} from "@tearleads/crypto";
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
 * The writer signs only the envelope's hash, so a reader would otherwise be
 * the first to find an envelope that does not parse or that names another
 * epoch, record, metadata, or nonce domain than its signed header. Every
 * reader refuses such a record; the API refuses it once, before storing it.
 */
export async function assertOutgoingEnvelopeMatchesHeader(input: {
  readonly documentId: string;
  readonly header: WriteHeader;
  readonly update: Pick<DocumentOutgoingUpdate, "encryptedData">;
}): Promise<ParsedDocumentEncryptedUpdate> {
  let envelope: ParsedDocumentEncryptedUpdate;
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
  return envelope;
}

/**
 * A new update's envelope must commit to the content key of the epoch it is
 * written at. Every honest writer encrypts under the key it unwrapped and
 * checked against that commitment, so this refuses only a writer that used
 * another key, whose update every reader of the epoch would fail to judge.
 */
export function assertOutgoingEnvelopeCommitsToEpochKey(
  envelope: Pick<ParsedDocumentEncryptedUpdate, "contentKeyCommitment">,
  contentKeyCommitment: string,
): void {
  if (envelope.contentKeyCommitment !== contentKeyCommitment) {
    throw new DocumentMutationError(
      "Document update envelope does not commit to its epoch's content key",
      400,
    );
  }
}
