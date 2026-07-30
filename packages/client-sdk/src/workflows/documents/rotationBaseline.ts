import {
  emptyVersionVector,
  getImportBlobMetadata,
  versionVectorsEqual,
} from "@tearleads/loro";
import type { DocumentOutgoingUpdate } from "@tearleads/validators/request";
import { createPendingUpdateFields } from "../../data/documentSync";
import {
  encryptDocumentPendingUpdate,
  importDocumentContentKeyMaterial,
} from "../../data/documents/shared/crypto";
import type {
  DocumentCreateAuthor,
  DocumentLinkSetMutationOperation,
  MaterializedDocumentLinkSetMutationPlan,
} from "../../data/documents/shared/types";
import { signDocumentOutgoingUpdate } from "./sync";

// A zero-span snapshot (empty document) yields no baseline; the unlink is
// sent without one and the server verifies the committed frontier is empty.
export async function completeLinkSetMutationRequest(input: {
  author: DocumentCreateAuthor;
  materializedPlan: MaterializedDocumentLinkSetMutationPlan;
  operation: DocumentLinkSetMutationOperation;
  rotationSnapshot: Uint8Array | undefined;
  signedAt: string;
}) {
  const rotationBaseline =
    input.operation === "unlink" && input.rotationSnapshot
      ? await buildDocumentRotationBaseline({
          author: input.author,
          contentKey: input.materializedPlan.contentKey,
          contentKeyEpoch: input.materializedPlan.plan.contentKeyEpoch,
          documentId: input.materializedPlan.plan.documentId,
          expectedLinkSetManifestHash: input.materializedPlan.plan.manifestHash,
          expectedTargetHash: input.materializedPlan.plan.targetHash,
          organizationId: input.materializedPlan.plan.state.organizationId,
          signedAt: input.signedAt,
          snapshot: input.rotationSnapshot,
        })
      : null;
  return rotationBaseline
    ? { ...input.materializedPlan.plan.request, rotationBaseline }
    : input.materializedPlan.plan.request;
}

export async function buildDocumentRotationBaseline(input: {
  readonly author: DocumentCreateAuthor;
  readonly contentKey: Uint8Array;
  readonly contentKeyEpoch: number;
  readonly documentId: string;
  readonly expectedLinkSetManifestHash: string;
  readonly expectedTargetHash: string;
  readonly organizationId: string;
  readonly signedAt: string;
  readonly snapshot: Uint8Array;
}): Promise<DocumentOutgoingUpdate | null> {
  const metadata = getImportBlobMetadata(input.snapshot);
  if (
    metadata.mode !== "snapshot" ||
    !versionVectorsEqual(
      metadata.partialStartVersionVector,
      emptyVersionVector(),
    )
  ) {
    throw new Error(
      "Document unlink requires a full-history rotation snapshot",
    );
  }
  const pendingFields = createPendingUpdateFields(
    input.snapshot,
    metadata.partialEndVersionVector,
  );
  if (!pendingFields) {
    // A document with no history serializes to a zero-span full-history
    // snapshot. There is nothing for a rotation baseline to cover, so the
    // unlink is submitted without one; the server independently proves the
    // committed frontier is empty before accepting it.
    return null;
  }
  const pendingUpdate = {
    id: crypto.randomUUID(),
    ...pendingFields,
  };
  const encrypted = await encryptDocumentPendingUpdate({
    contentKeyMaterial: await importDocumentContentKeyMaterial(
      input.contentKey,
    ),
    contentKeyEpoch: input.contentKeyEpoch,
    documentId: input.documentId,
    organizationId: input.organizationId,
    update: pendingUpdate,
  });

  return signDocumentOutgoingUpdate({
    author: input.author,
    contentKeyEpoch: input.contentKeyEpoch,
    documentId: input.documentId,
    expectedLinkSetManifestHash: input.expectedLinkSetManifestHash,
    expectedTargetHash: input.expectedTargetHash,
    organizationId: input.organizationId,
    signedAt: input.signedAt,
    update: {
      checkpointKind: "rotate_baseline",
      checkpointPayloadKind: "full_history_snapshot",
      ciphertextHash: encrypted.ciphertextHash,
      contentRecordId: encrypted.contentRecordId,
      encryptedData: encrypted.encryptedData,
      id: pendingUpdate.id,
      metadataHash: encrypted.metadataHash,
      partialEndVersionVector: pendingFields.partialEndVersionVector,
      partialStartVersionVector: pendingFields.partialStartVersionVector,
      plaintextHash: encrypted.plaintextHash,
      sourceVersionVector: metadata.partialEndVersionVector,
    },
  });
}
