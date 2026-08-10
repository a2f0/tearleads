import type { DocumentSyncRequest } from "@tearleads/validators/request";
import type { ContainerWriterProjectionResponse } from "@tearleads/validators/response";
import { createPendingUpdateFields } from "../../data/documents/documentSync";
import { importContentKeyMaterial } from "../../data/documents/shared/contentRecordKeys";
import { encryptDocumentPendingUpdate } from "../../data/documents/shared/crypto";
import { containerPathRefs } from "../../data/documents/shared/projection";
import type {
  DocumentCreateAuthor,
  MaterializedDocumentCreatePlan,
} from "../../data/documents/shared/types";
import type { PendingUpdateRecord } from "../../data/sqlite/documentPersistence";
import { signDocumentOutgoingUpdate } from "./syncPlanIdentity";

/**
 * Builds the single encrypted initial write for a provisioned document. The
 * server commits it with the organization and document manifest transaction.
 */
export async function buildInitialDocumentSyncRequest(input: {
  readonly author: DocumentCreateAuthor;
  readonly containerProjection: ContainerWriterProjectionResponse;
  readonly initialUpdate: Uint8Array;
  readonly materializedDocument: MaterializedDocumentCreatePlan;
}): Promise<DocumentSyncRequest> {
  const pendingFields = createPendingUpdateFields(input.initialUpdate);
  if (!pendingFields) {
    throw new Error("Initial document sync update is empty");
  }

  const documentId = input.materializedDocument.plan.documentId;
  const contentKeyBundle =
    input.materializedDocument.plan.request.contentKeyBundle;
  const pendingUpdate: PendingUpdateRecord = {
    id: crypto.randomUUID(),
    ...pendingFields,
  };
  const encrypted = await encryptDocumentPendingUpdate({
    contentKeyMaterial: await importContentKeyMaterial(
      input.materializedDocument.contentKey,
    ),
    contentKeyEpoch: contentKeyBundle.contentKeyEpoch,
    documentId,
    organizationId: input.containerProjection.organizationId,
    update: pendingUpdate,
  });
  const outgoingUpdate = await signDocumentOutgoingUpdate({
    author: input.author,
    contentKeyEpoch: contentKeyBundle.contentKeyEpoch,
    documentId,
    expectedLinkSetManifestHash: contentKeyBundle.linkSetManifestHash,
    expectedTargetHash: contentKeyBundle.targetHash,
    organizationId: input.containerProjection.organizationId,
    signedAt: new Date().toISOString(),
    update: {
      contentRecordId: encrypted.contentRecordId,
      encryptedData: encrypted.encryptedData,
      id: pendingUpdate.id,
      partialEndVersionVector: pendingUpdate.partialEndVersionVector,
      partialStartVersionVector: pendingUpdate.partialStartVersionVector,
      metadataHash: encrypted.metadataHash,
      ciphertextHash: encrypted.ciphertextHash,
      plaintextHash: encrypted.plaintextHash,
    },
  });

  return {
    authorizingContainerPathRefs: [
      containerPathRefs(input.containerProjection.path),
    ],
    contentKeyBundle,
    contentKeyEpoch: contentKeyBundle.contentKeyEpoch,
    expectedLinkSetManifestHash: contentKeyBundle.linkSetManifestHash,
    expectedTargetHash: contentKeyBundle.targetHash,
    // The provisioning device already holds this exact initialized snapshot,
    // so it does not need the transaction response to echo the update back.
    localVersionVector: pendingUpdate.partialEndVersionVector,
    outgoingUpdates: [outgoingUpdate],
  };
}
