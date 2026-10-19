import {
  emptyVersionVector,
  satisfiesVersionVector,
  versionVectorsEqual,
} from "@tearleads/loro";
import type { DocumentSyncRequest } from "@tearleads/validators/request";
import type { ContainerWriterProjectionResponse } from "@tearleads/validators/response";
import { createPendingUpdateFields } from "../../../data/documents/documentSync";
import { importContentKeyMaterial } from "../../../data/documents/shared/contentRecordKeys";
import { encryptDocumentPendingUpdate } from "../../../data/documents/shared/crypto";
import { containerPathRefs } from "../../../data/documents/shared/projection";
import type {
  DocumentCreateAuthor,
  MaterializedDocumentCreatePlan,
} from "../../../data/documents/shared/types";
import type { PendingUpdateRecord } from "../../../data/sqlite/documentPersistence";
import { signDocumentOutgoingUpdate } from "../syncPlan/syncPlanIdentity";

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
  return buildDocumentCreateSeedRequest({
    ...input,
    pendingUpdate: { id: crypto.randomUUID(), ...pendingFields },
  });
}

/**
 * Builds a create's seed: the one queued update that holds a new document's
 * whole content, signed against the create plan, so the create commits it and
 * no follow-up sync is needed. The update keeps its queue row id.
 */
export async function buildDocumentCreateSeedRequest(input: {
  readonly author: DocumentCreateAuthor;
  readonly containerProjection: ContainerWriterProjectionResponse;
  readonly materializedDocument: MaterializedDocumentCreatePlan;
  readonly pendingUpdate: PendingUpdateRecord;
}): Promise<DocumentSyncRequest> {
  const { pendingUpdate } = input;
  const documentId = input.materializedDocument.plan.documentId;
  const contentKeyBundle =
    input.materializedDocument.plan.request.contentKeyBundle;
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
    authorizingContainerPathRefs: [
      containerPathRefs(input.containerProjection.path),
    ],
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
    // The creating device already holds this exact content, so it does not
    // need the transaction response to echo the update back.
    localVersionVector: pendingUpdate.partialEndVersionVector,
    outgoingUpdates: [outgoingUpdate],
    supportsPullPagination: true,
  };
}

/**
 * The queued row that may seed a create: the only row, a plain update (not a
 * rotation baseline) that holds the document's whole content. Anything else
 * syncs after the create as before.
 */
export function documentCreateSeedCandidate(input: {
  readonly documentVersion: string;
  readonly pendingUpdates: readonly PendingUpdateRecord[];
}): PendingUpdateRecord | null {
  const [row, ...rest] = input.pendingUpdates;
  if (!row || rest.length > 0 || row.sourceVersionVector != null) return null;
  // The start may name peers at counter zero; the server checks it the same way.
  return satisfiesVersionVector(
    emptyVersionVector(),
    row.partialStartVersionVector,
  ) && versionVectorsEqual(row.partialEndVersionVector, input.documentVersion)
    ? row
    : null;
}
