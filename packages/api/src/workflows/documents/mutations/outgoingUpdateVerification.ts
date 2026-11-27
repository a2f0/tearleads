import type {
  ParsedDocumentEncryptedUpdate,
  VerifiedWriteHeader,
  WriteHeader,
} from "@tearleads/crypto";
import {
  computeDocumentContentRecordCiphertextHash,
  computeDocumentContentRecordMetadataHash,
  computeWriteHeaderHash,
  verifyWriteHeader,
} from "@tearleads/crypto";
import type { DocumentOutgoingUpdate } from "@tearleads/validators/request";
import { assertStoredWriteHeaderVerbatim } from "../../../access/write/documentContentKeyStore";
import { canonicalJsonEquals } from "../../../utils/canonicalJson";
import { sha256Hex } from "../../../utils/sha256";
import { DocumentMutationError, documentUpdateIdConflict } from "./errors";
import {
  assertOutgoingDeclaredDependencies,
  assertOutgoingEnvelopeCommitsToEpochKey,
  assertOutgoingEnvelopeMatchesHeader,
  assertOutgoingSpanOrEmptyBaseline,
} from "./outgoingUpdateShape";
import { readWriteHeader } from "./shared/records";
import type { DocumentWriteAuthorizationProof } from "./types";

/**
 * Per-update verification for a sync request's outgoing updates: write-header
 * authorization, payload/header binding, and the byte-exact matching rules
 * for idempotent retries and duplicate ids. The rules that span a rotation
 * baseline's segments are in outgoingBaselineGroup.
 */
export async function verifyOutgoingWriteHeader(input: {
  /** The commitment of the epoch the request writes at. */
  readonly contentKeyCommitment: string;
  readonly documentId: string;
  readonly expectedLinkSetManifestHash: string;
  readonly expectedTargetHash: string;
  readonly organizationId: string;
  readonly requestContentKeyEpoch: number;
  readonly signingPublicKey: Uint8Array;
  readonly update: DocumentOutgoingUpdate;
  readonly userId: string;
  readonly writeAuthorization: DocumentWriteAuthorizationProof | null;
}): Promise<VerifiedWriteHeader> {
  const header = readWriteHeader(
    input.update.writeHeader,
    "Document write header",
  );
  if (
    header.writerUserId !== input.userId ||
    header.contentKeyEpoch !== input.requestContentKeyEpoch
  ) {
    throw new DocumentMutationError("Write header does not match request", 400);
  }
  if (!input.writeAuthorization) {
    throw new DocumentMutationError(
      "Document write authorization proof is required",
      400,
    );
  }

  const verified = await verifyWriteHeader({
    documentAuthorization: input.writeAuthorization,
    expectedAccessManifestHash: input.expectedLinkSetManifestHash,
    expectedObject: {
      objectKind: "document",
      objectId: input.documentId,
      organizationId: input.organizationId,
    },
    expectedTargetHash: input.expectedTargetHash,
    header,
    writerPublicKey: input.signingPublicKey,
  });
  if (!verified.ok) {
    throw verified.error;
  }
  assertOutgoingEnvelopeCommitsToEpochKey(
    await assertOutgoingUpdatePayloadMatchesHeader({
      documentId: input.documentId,
      header: verified.value.header,
      update: input.update,
    }),
    input.contentKeyCommitment,
  );

  return verified.value;
}

/**
 * Verify a segment as it is staged, ahead of the request that commits it.
 * Everything a writer signs is checked here, as for any update: the header's
 * signature under the session's key, the object it names, the epoch, the
 * signed metadata and ciphertext hashes, the envelope, and the commitment of
 * the content key the stage is for. What cannot be checked yet is whether
 * the header's manifest, key-target set and citations authorize the writer:
 * the manifest a rotation writes does not exist until the request that
 * commits the stage. That request verifies its own final segment in full
 * and requires every staged header to name the same ones.
 */
export async function verifyStagedSegmentWriteHeader(input: {
  /** The commitment of the content key the stage is for. */
  readonly contentKeyCommitment: string;
  readonly contentKeyEpoch: number;
  readonly documentId: string;
  readonly organizationId: string;
  readonly signingPublicKey: Uint8Array;
  readonly update: DocumentOutgoingUpdate;
  readonly userId: string;
}): Promise<VerifiedWriteHeader> {
  const verified = await verifyStagedWriteHeaderSignature({
    ...input,
    writeHeader: input.update.writeHeader,
  });
  assertOutgoingEnvelopeCommitsToEpochKey(
    await assertOutgoingUpdatePayloadMatchesHeader({
      documentId: input.documentId,
      header: verified.header,
      update: input.update,
    }),
    input.contentKeyCommitment,
  );
  return verified;
}

/**
 * The checks of a staged header that read the header alone: its writer is
 * the session's user, it is signed at the stage's epoch for this document
 * and organization, and the signature verifies under the session's key.
 */
export async function verifyStagedWriteHeaderSignature(input: {
  readonly contentKeyEpoch: number;
  readonly documentId: string;
  readonly organizationId: string;
  readonly signingPublicKey: Uint8Array;
  readonly userId: string;
  readonly writeHeader: unknown;
}): Promise<VerifiedWriteHeader> {
  const header = readWriteHeader(input.writeHeader, "Document write header");
  if (
    header.writerUserId !== input.userId ||
    header.contentKeyEpoch !== input.contentKeyEpoch
  ) {
    throw new DocumentMutationError("Write header does not match stage", 400);
  }
  const verified = await verifyWriteHeader({
    expectedObject: {
      objectKind: "document",
      objectId: input.documentId,
      organizationId: input.organizationId,
    },
    header,
    writerPublicKey: input.signingPublicKey,
  });
  if (!verified.ok) {
    throw verified.error;
  }
  return verified.value;
}

async function assertOutgoingUpdatePayloadMatchesHeader(input: {
  readonly documentId: string;
  readonly header: WriteHeader;
  readonly update: DocumentOutgoingUpdate;
}): Promise<ParsedDocumentEncryptedUpdate> {
  assertOutgoingSpanOrEmptyBaseline(input.update);
  assertOutgoingDeclaredDependencies(input.update);
  const metadataHash = await computeDocumentContentRecordMetadataHash({
    baselineId: input.update.baselineId,
    baselineSegmentCount: input.update.baselineSegmentCount,
    baselineSegmentIndex: input.update.baselineSegmentIndex,
    baselineSegmentsDigest: input.update.baselineSegmentsDigest,
    coversThroughUpdateId: input.update.coversThroughUpdateId,
    dependencyVersionVector: input.update.dependencyVersionVector,
    documentId: input.documentId,
    partialEndVersionVector: input.update.partialEndVersionVector,
    partialStartVersionVector: input.update.partialStartVersionVector,
    plaintextHash: input.update.plaintextHash,
    updateId: input.update.id,
  });
  if (metadataHash !== input.header.metadataHash) {
    throw new DocumentMutationError(
      "Document update metadata hash mismatch",
      400,
    );
  }

  const ciphertextHash = await computeDocumentContentRecordCiphertextHash(
    input.update.encryptedData,
  );
  if (ciphertextHash !== input.header.ciphertextHash) {
    throw new DocumentMutationError(
      "Document update ciphertext hash mismatch",
      400,
    );
  }
  return assertOutgoingEnvelopeMatchesHeader(input);
}

async function assertRetryWriteHeaderMatches(input: {
  readonly accepted: {
    readonly header: WriteHeader;
    readonly headerHash: string;
  };
  readonly update: DocumentOutgoingUpdate;
}): Promise<void> {
  const header = readWriteHeader(
    input.update.writeHeader,
    "Document write header",
  );
  const headerHash = await computeWriteHeaderHash(header);
  if (headerHash !== input.accepted.headerHash) {
    throw new DocumentMutationError("Document write header conflict", 409);
  }
  // The retry is acknowledged from the stored row, which other devices read.
  assertStoredWriteHeaderVerbatim(input.accepted, { header, headerHash });
}

/**
 * SHA-256 (hex) of a stored update's content columns, as UTF-8. Postgres
 * computes them, so matching a retried id never loads stored ciphertext into
 * the isolate.
 */
export interface StoredDocumentUpdateContentDigests {
  readonly dependencyVersionVectorSha256: string;
  readonly encryptedDataSha256: string;
  readonly partialEndVersionVectorSha256: string;
  readonly partialStartVersionVectorSha256: string;
  readonly plaintextHashSha256: string;
}

export function storedDocumentUpdateMatchesOutgoingContent(
  existing: StoredDocumentUpdateContentDigests | undefined,
  update: Pick<
    DocumentOutgoingUpdate,
    | "dependencyVersionVector"
    | "encryptedData"
    | "partialEndVersionVector"
    | "partialStartVersionVector"
    | "plaintextHash"
  >,
): boolean {
  return (
    existing !== undefined &&
    existing.encryptedDataSha256 === sha256Hex(update.encryptedData) &&
    existing.dependencyVersionVectorSha256 ===
      sha256Hex(update.dependencyVersionVector) &&
    existing.partialStartVersionVectorSha256 ===
      sha256Hex(update.partialStartVersionVector) &&
    existing.partialEndVersionVectorSha256 ===
      sha256Hex(update.partialEndVersionVector) &&
    existing.plaintextHashSha256 === sha256Hex(update.plaintextHash)
  );
}

export async function assertRetryUpdateMatchesAcceptedContent(input: {
  readonly acceptedHeader:
    | { readonly header: WriteHeader; readonly headerHash: string }
    | undefined;
  readonly documentId: string;
  readonly existingRow: StoredDocumentUpdateContentDigests | undefined;
  readonly update: DocumentOutgoingUpdate;
}): Promise<void> {
  if (
    !storedDocumentUpdateMatchesOutgoingContent(input.existingRow, input.update)
  ) {
    throw documentUpdateIdConflict();
  }
  if (!input.acceptedHeader) {
    throw new DocumentMutationError("Document write header conflict", 409);
  }
  await assertRetryWriteHeaderMatches({
    accepted: input.acceptedHeader,
    update: input.update,
  });
  await assertOutgoingUpdatePayloadMatchesHeader({
    documentId: input.documentId,
    header: readWriteHeader(input.update.writeHeader, "Document write header"),
    update: input.update,
  });
}

const BASELINE_SEGMENT_FIELDS = [
  "baselineId",
  "baselineSegmentCount",
  "baselineSegmentIndex",
  "baselineSegmentsDigest",
  "coversThroughUpdateId",
] as const satisfies readonly (keyof DocumentOutgoingUpdate)[];

function assertDuplicateOutgoingUpdateMatches(
  first: DocumentOutgoingUpdate,
  next: DocumentOutgoingUpdate,
): void {
  if (
    first.encryptedData === next.encryptedData &&
    first.dependencyVersionVector === next.dependencyVersionVector &&
    first.partialStartVersionVector === next.partialStartVersionVector &&
    first.partialEndVersionVector === next.partialEndVersionVector &&
    first.plaintextHash === next.plaintextHash &&
    BASELINE_SEGMENT_FIELDS.every((field) => first[field] === next[field]) &&
    canonicalJsonEquals(first.writeHeader, next.writeHeader)
  ) {
    return;
  }

  throw documentUpdateIdConflict();
}

export function uniqueOutgoingUpdates(
  updates: readonly DocumentOutgoingUpdate[],
): DocumentOutgoingUpdate[] {
  const uniqueUpdates: DocumentOutgoingUpdate[] = [];
  const updateById = new Map<string, DocumentOutgoingUpdate>();

  for (const update of updates) {
    const existing = updateById.get(update.id);
    if (!existing) {
      updateById.set(update.id, update);
      uniqueUpdates.push(update);
      continue;
    }

    assertDuplicateOutgoingUpdateMatches(existing, update);
  }

  return uniqueUpdates;
}
