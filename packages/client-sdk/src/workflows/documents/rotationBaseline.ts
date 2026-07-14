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
import type { DocumentCreateAuthor } from "../../data/documents/shared/types";
import { signDocumentOutgoingUpdate } from "./sync";

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
}): Promise<DocumentOutgoingUpdate> {
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
    throw new Error("Document unlink rotation snapshot is empty");
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
      sourceVersionVector: metadata.partialEndVersionVector,
    },
  });
}
