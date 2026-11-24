import {
  emptyVersionVector,
  satisfiesVersionVector,
  versionVectorsEqual,
} from "@tearleads/loro";
import {
  type DocumentCreateRequest,
  type DocumentCreateSeedRequest,
  type DocumentSyncRequest,
  documentCreateSeedSyncRequest,
} from "@tearleads/validators/request";
import type { ContainerWriterProjectionResponse } from "@tearleads/validators/response";
import { MAX_DOCUMENT_SYNC_REQUEST_BYTES } from "@tearleads/validators/util";
import { createPendingUpdateFields } from "../../../data/documents/documentSync";
import { encryptDocumentPendingUpdate } from "../../../data/documents/shared/crypto";
import { containerPathRefs } from "../../../data/documents/shared/projection";
import { openDocumentContentKey } from "../../../data/documents/shared/sync/contentKeyCommitment";
import type {
  DocumentCreateAuthor,
  MaterializedDocumentCreatePlan,
} from "../../../data/documents/shared/types";
import type { PendingUpdateRecord } from "../../../data/persistence/documents/records";
import { signDocumentOutgoingUpdate } from "../syncPlan/syncPlanIdentity";

/**
 * The seed a create carries: the signed update alone. The API rebuilds the
 * sync it stands for from the create (`documentCreateSeedSyncRequest`), which
 * names the same bundle, hashes and path the update's write header signs.
 */
export function documentCreateSeed(
  sync: DocumentSyncRequest,
): DocumentCreateSeedRequest {
  return { outgoingUpdates: [...sync.outgoingUpdates] };
}

/**
 * Builds the seed of a provisioned document: its single encrypted initial
 * write, which the server commits in the organization and document manifest
 * transaction.
 */
export async function buildInitialDocumentCreateSeed(input: {
  readonly author: DocumentCreateAuthor;
  readonly containerProjection: ContainerWriterProjectionResponse;
  readonly initialUpdate: Uint8Array;
  readonly materializedDocument: MaterializedDocumentCreatePlan;
}): Promise<DocumentCreateSeedRequest> {
  const pendingFields = createPendingUpdateFields(input.initialUpdate);
  if (!pendingFields) {
    throw new Error("Initial document sync update is empty");
  }
  return documentCreateSeed(
    await buildDocumentCreateSeedRequest({
      ...input,
      pendingUpdate: { id: crypto.randomUUID(), ...pendingFields },
    }),
  );
}

/**
 * Builds the sync a create's seed stands for: the one queued update that
 * holds a new document's whole content, signed against the create plan, so
 * the create commits it and no follow-up sync is needed. The update keeps its
 * queue row id. A create sends only `documentCreateSeed` of it; an attachment
 * bind carries it whole.
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
    contentKey: await openDocumentContentKey({
      contentKey: input.materializedDocument.contentKey,
      contentKeyEpoch: contentKeyBundle.contentKeyEpoch,
      documentId,
    }),
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

const TEXT_ENCODER = new TextEncoder();

/**
 * A document sync is held to the sync request limit (the API refuses a larger
 * one), so a first update that does not fit is left out and the row syncs in
 * ordinary batches.
 */
export function documentSyncFits(sync: DocumentSyncRequest): boolean {
  return (
    TEXT_ENCODER.encode(JSON.stringify(sync)).byteLength <=
    MAX_DOCUMENT_SYNC_REQUEST_BYTES
  );
}

/**
 * Whether the sync a create's seed stands for, as the API rebuilds it from
 * `create`, fits the sync request limit.
 */
export function documentCreateSeedFits(
  create: Pick<
    DocumentCreateRequest,
    "contentKeyBundle" | "targetContainerPathRefs"
  >,
  sync: DocumentSyncRequest,
): boolean {
  return documentSyncFits(
    documentCreateSeedSyncRequest(create, documentCreateSeed(sync)),
  );
}
