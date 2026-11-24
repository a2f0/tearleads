import { bytesToBase64 } from "@tearleads/encoding";
import {
  emptyVersionVector,
  getImportBlobMetadata,
  versionVectorsEqual,
} from "@tearleads/loro";
import type {
  ContainerManifestRef,
  DocumentOutgoingUpdate,
} from "@tearleads/validators/request";
import { createPendingUpdateFields } from "../../data/documents/documentSync";
import { encryptDocumentPendingUpdate } from "../../data/documents/shared/crypto";
import { openDocumentContentKey } from "../../data/documents/shared/sync/contentKeyCommitment";
import type {
  DocumentCreateAuthor,
  DocumentLinkSetMutationOperation,
  MaterializedDocumentLinkSetMutationPlan,
} from "../../data/documents/shared/types";
import type { ExecSql } from "../../data/sqlite/sqlSchema";
import { readProcessedCursorForVersion } from "./sync/processedCursor";
import { signDocumentOutgoingUpdate } from "./syncPlan/syncPlanIdentity";

// A zero-span snapshot (empty document) with no processed cursor yields no
// baseline; the unlink is sent without one and the server verifies the
// committed frontier is empty.
export async function completeLinkSetMutationRequest(input: {
  author: DocumentCreateAuthor;
  /** Reads the processed cursor the unlink baseline signs. */
  execSql: ExecSql;
  materializedPlan: MaterializedDocumentLinkSetMutationPlan;
  operation: DocumentLinkSetMutationOperation;
  rotationSnapshot: Uint8Array | undefined;
  signedAt: string;
}) {
  const rotationBaseline =
    input.operation === "unlink" && input.rotationSnapshot
      ? await buildDocumentRotationBaseline({
          authorizingContainerPathRefs:
            input.materializedPlan.plan.request.authorizingContainerPathRefs,
          author: input.author,
          contentKey: input.materializedPlan.contentKey,
          contentKeyEpoch: input.materializedPlan.plan.contentKeyEpoch,
          documentId: input.materializedPlan.plan.documentId,
          execSql: input.execSql,
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
  readonly authorizingContainerPathRefs: readonly (readonly ContainerManifestRef[])[];
  readonly author: DocumentCreateAuthor;
  readonly contentKey: Uint8Array;
  readonly contentKeyEpoch: number;
  readonly documentId: string;
  readonly execSql: ExecSql;
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
  // Updates the snapshot's author voided need no coverage past its cursor.
  const coversThroughUpdateId = await readProcessedCursorForVersion(
    input.execSql,
    {
      documentId: input.documentId,
      version: metadata.partialEndVersionVector,
    },
  );
  const pendingFields =
    createPendingUpdateFields(
      input.snapshot,
      metadata.partialEndVersionVector,
    ) ??
    (coversThroughUpdateId === undefined
      ? null
      : {
          // Every update through the cursor was void, so the document is
          // empty. The empty snapshot still signs the cursor, and the API
          // asks it to cover only the updates after it.
          partialEndVersionVector: metadata.partialEndVersionVector,
          partialStartVersionVector: metadata.partialStartVersionVector,
          sourceVersionVector: metadata.partialEndVersionVector,
          updateData: bytesToBase64(input.snapshot),
        });
  if (!pendingFields) {
    // A document never written serializes to a zero-span full-history
    // snapshot and has no cursor. There is nothing for a rotation baseline to
    // cover, so the unlink is submitted without one; the server independently
    // proves the committed frontier is empty before accepting it.
    return null;
  }
  const pendingUpdate = {
    id: crypto.randomUUID(),
    ...pendingFields,
  };
  const encrypted = await encryptDocumentPendingUpdate({
    contentKey: await openDocumentContentKey(input),
    contentKeyEpoch: input.contentKeyEpoch,
    coversThroughUpdateId,
    documentId: input.documentId,
    organizationId: input.organizationId,
    update: pendingUpdate,
  });

  return signDocumentOutgoingUpdate({
    authorizingContainerPathRefs: input.authorizingContainerPathRefs,
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
      ...(coversThroughUpdateId === undefined ? {} : { coversThroughUpdateId }),
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
