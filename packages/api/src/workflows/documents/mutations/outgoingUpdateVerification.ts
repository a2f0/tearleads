import type { VerifiedWriteHeader, WriteHeader } from "@tearleads/crypto";
import {
  computeDocumentContentRecordCiphertextHash,
  computeDocumentContentRecordMetadataHash,
  computeWriteHeaderHash,
  verifyWriteHeader,
} from "@tearleads/crypto";
import {
  emptyVersionVector,
  listVersionVectorSpans,
  versionVectorsEqual,
} from "@tearleads/loro";
import type { DocumentOutgoingUpdate } from "@tearleads/validators/request";
import { canonicalJsonEquals } from "../../../utils/canonicalJson";
import { DocumentMutationError, documentUpdateIdConflict } from "./errors";
import { readWriteHeader } from "./shared/records";
import type { DocumentWriteAuthorizationProof } from "./types";

/**
 * Per-update verification for a sync request's outgoing updates: write-header
 * authorization, payload/header binding, rotation-checkpoint consistency, and
 * the byte-exact matching rules for idempotent retries and duplicate ids.
 */
export async function verifyOutgoingWriteHeader(input: {
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
  await assertOutgoingUpdatePayloadMatchesHeader({
    documentId: input.documentId,
    header: verified.value.header,
    update: input.update,
  });

  return verified.value;
}

async function assertOutgoingUpdatePayloadMatchesHeader(input: {
  readonly documentId: string;
  readonly header: WriteHeader;
  readonly update: DocumentOutgoingUpdate;
}): Promise<void> {
  assertOutgoingCheckpointConsistency(input.update);
  const metadataHash = await computeDocumentContentRecordMetadataHash({
    ...(input.update.checkpointKind === undefined
      ? {}
      : { checkpointKind: input.update.checkpointKind }),
    ...(input.update.checkpointPayloadKind === undefined
      ? {}
      : { checkpointPayloadKind: input.update.checkpointPayloadKind }),
    documentId: input.documentId,
    partialEndVersionVector: input.update.partialEndVersionVector,
    partialStartVersionVector: input.update.partialStartVersionVector,
    plaintextHash: input.update.plaintextHash,
    ...(input.update.sourceVersionVector === undefined
      ? {}
      : { sourceVersionVector: input.update.sourceVersionVector }),
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
}

function assertOutgoingCheckpointConsistency(
  update: DocumentOutgoingUpdate,
): void {
  const isCheckpoint =
    update.checkpointKind !== undefined ||
    update.checkpointPayloadKind !== undefined ||
    update.sourceVersionVector !== undefined;
  if (!isCheckpoint) {
    return;
  }
  if (
    update.checkpointKind !== "rotate_baseline" ||
    update.checkpointPayloadKind !== "full_history_snapshot" ||
    !update.sourceVersionVector
  ) {
    throw new DocumentMutationError(
      "Document rotation checkpoint metadata is incomplete",
      400,
    );
  }

  try {
    listVersionVectorSpans({
      partialStartVersionVector: update.partialStartVersionVector,
      partialEndVersionVector: update.partialEndVersionVector,
    });
  } catch {
    throw new DocumentMutationError(
      "Document rotation checkpoint version vectors are invalid",
      400,
    );
  }
  if (
    !versionVectorsEqual(
      update.sourceVersionVector,
      update.partialEndVersionVector,
    ) ||
    !versionVectorsEqual(update.partialStartVersionVector, emptyVersionVector())
  ) {
    throw new DocumentMutationError(
      "Document rotation checkpoint must start empty and end at its source vector",
      400,
    );
  }
}

async function assertRetryWriteHeaderMatches(input: {
  readonly expectedHeaderHash: string;
  readonly update: DocumentOutgoingUpdate;
}): Promise<void> {
  const headerHash = await computeWriteHeaderHash(
    readWriteHeader(input.update.writeHeader, "Document write header"),
  );
  if (headerHash !== input.expectedHeaderHash) {
    throw new DocumentMutationError("Document write header conflict", 409);
  }
}

interface StoredDocumentUpdateContent {
  readonly encryptedData: string;
  readonly partialEndVersionVector: string;
  readonly partialStartVersionVector: string;
  readonly plaintextHash: string;
}

export function storedDocumentUpdateMatchesOutgoingContent(
  existing: StoredDocumentUpdateContent | undefined,
  update: Pick<
    DocumentOutgoingUpdate,
    | "encryptedData"
    | "partialEndVersionVector"
    | "partialStartVersionVector"
    | "plaintextHash"
  >,
): boolean {
  return (
    existing !== undefined &&
    existing.encryptedData === update.encryptedData &&
    existing.partialStartVersionVector === update.partialStartVersionVector &&
    existing.partialEndVersionVector === update.partialEndVersionVector &&
    existing.plaintextHash === update.plaintextHash
  );
}

export async function assertRetryUpdateMatchesAcceptedContent(input: {
  readonly acceptedHeaderHash: string | undefined;
  readonly documentId: string;
  readonly existingRow: StoredDocumentUpdateContent | undefined;
  readonly update: DocumentOutgoingUpdate;
}): Promise<void> {
  if (
    !storedDocumentUpdateMatchesOutgoingContent(input.existingRow, input.update)
  ) {
    throw documentUpdateIdConflict();
  }
  if (!input.acceptedHeaderHash) {
    throw new DocumentMutationError("Document write header conflict", 409);
  }
  await assertRetryWriteHeaderMatches({
    expectedHeaderHash: input.acceptedHeaderHash,
    update: input.update,
  });
  await assertOutgoingUpdatePayloadMatchesHeader({
    documentId: input.documentId,
    header: readWriteHeader(input.update.writeHeader, "Document write header"),
    update: input.update,
  });
}

function assertDuplicateOutgoingUpdateMatches(
  first: DocumentOutgoingUpdate,
  next: DocumentOutgoingUpdate,
): void {
  if (
    first.encryptedData === next.encryptedData &&
    first.partialStartVersionVector === next.partialStartVersionVector &&
    first.partialEndVersionVector === next.partialEndVersionVector &&
    first.plaintextHash === next.plaintextHash &&
    (first.sourceVersionVector ?? null) ===
      (next.sourceVersionVector ?? null) &&
    (first.checkpointKind ?? null) === (next.checkpointKind ?? null) &&
    (first.checkpointPayloadKind ?? null) ===
      (next.checkpointPayloadKind ?? null) &&
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
