import type { DatabaseSession } from "@tearleads/api-shared/postgres";
import {
  accessEventDependencyProjection,
  accessEvents,
  accessManifestContainerGrantProjection,
  accessManifestDocumentLinkProjection,
  accessManifestHeads,
  accessManifestPrincipalHeadProjection,
  accessManifests,
  attachmentBindings,
  blobAuditObjects,
  blobContentKeyEpochs,
  blobContentKeyTargets,
  blobContentWriteHeaders,
  blobs,
  containerBuiltinGrants,
  containerDocumentSyncTombstones,
  containerKeyEpochs,
  containerKeyWraps,
  containerMetadataDocuments,
  containerSyncTombstones,
  containers,
  documentAttachmentAuditEvents,
  documentAuditCheckpoints,
  documentAuditEntries,
  documentContainerLinks,
  documentContentKeyEpochs,
  documentContentKeyTargets,
  documentContentWriteHeaders,
  documents,
  documentUpdateAuditEvents,
  documentUpdateSpans,
  documentUpdates,
  principalEpochKeys,
  principalMemberEnvelopes,
  principalMembershipProjection,
  principalStatePayloads,
  principalStates,
} from "@tearleads/api-shared/schema";
import { and, eq, inArray } from "drizzle-orm";
import { selectIds } from "./queryHelpers";

export async function deleteDocumentRows(input: {
  executor: DatabaseSession;
  documentIds: readonly string[];
  updateIds: readonly string[];
}): Promise<void> {
  const { documentIds, executor, updateIds } = input;
  if (documentIds.length === 0) {
    return;
  }

  const auditEntryIds = await selectIds(
    executor
      .select({ id: documentAuditEntries.id })
      .from(documentAuditEntries)
      .where(inArray(documentAuditEntries.documentId, documentIds)),
  );
  const contentKeyEpochIds = await selectIds(
    executor
      .select({ id: documentContentKeyEpochs.id })
      .from(documentContentKeyEpochs)
      .where(inArray(documentContentKeyEpochs.documentId, documentIds)),
  );

  if (auditEntryIds.length > 0) {
    await executor
      .delete(documentUpdateAuditEvents)
      .where(inArray(documentUpdateAuditEvents.auditEntryId, auditEntryIds));
    await executor
      .delete(documentAttachmentAuditEvents)
      .where(
        inArray(documentAttachmentAuditEvents.auditEntryId, auditEntryIds),
      );
  }
  await executor
    .delete(documentAuditCheckpoints)
    .where(inArray(documentAuditCheckpoints.documentId, documentIds));
  await executor
    .delete(documentAuditEntries)
    .where(inArray(documentAuditEntries.documentId, documentIds));

  if (contentKeyEpochIds.length > 0) {
    await executor
      .delete(documentContentKeyTargets)
      .where(
        inArray(
          documentContentKeyTargets.documentContentKeyEpochId,
          contentKeyEpochIds,
        ),
      );
  }
  await executor
    .delete(documentContentKeyEpochs)
    .where(inArray(documentContentKeyEpochs.documentId, documentIds));
  await executor
    .delete(documentContentWriteHeaders)
    .where(inArray(documentContentWriteHeaders.documentId, documentIds));

  if (updateIds.length > 0) {
    await executor
      .delete(documentUpdateSpans)
      .where(inArray(documentUpdateSpans.updateId, updateIds));
  }
  await executor
    .delete(documentUpdates)
    .where(inArray(documentUpdates.documentId, documentIds));
  await executor.delete(documents).where(inArray(documents.id, documentIds));
}

export async function deleteBlobRows(input: {
  executor: DatabaseSession;
  blobIds: readonly string[];
}): Promise<void> {
  const { blobIds, executor } = input;
  if (blobIds.length === 0) {
    return;
  }

  const blobContentKeyEpochIds = await selectIds(
    executor
      .select({ id: blobContentKeyEpochs.id })
      .from(blobContentKeyEpochs)
      .where(inArray(blobContentKeyEpochs.blobId, blobIds)),
  );
  if (blobContentKeyEpochIds.length > 0) {
    await executor
      .delete(blobContentKeyTargets)
      .where(
        inArray(
          blobContentKeyTargets.blobContentKeyEpochId,
          blobContentKeyEpochIds,
        ),
      );
  }
  await executor
    .delete(blobContentKeyEpochs)
    .where(inArray(blobContentKeyEpochs.blobId, blobIds));
  await executor
    .delete(blobContentWriteHeaders)
    .where(inArray(blobContentWriteHeaders.blobId, blobIds));
  await executor
    .delete(attachmentBindings)
    .where(inArray(attachmentBindings.blobId, blobIds));
  await executor
    .delete(blobAuditObjects)
    .where(inArray(blobAuditObjects.blobId, blobIds));
  await executor.delete(blobs).where(inArray(blobs.id, blobIds));
}

export async function deleteAccessRows(input: {
  executor: DatabaseSession;
  eventHashes: readonly string[];
  manifestHashes: readonly string[];
  organizationId: string;
}): Promise<void> {
  const { eventHashes, executor, manifestHashes, organizationId } = input;
  if (eventHashes.length > 0) {
    await executor
      .delete(accessEventDependencyProjection)
      .where(inArray(accessEventDependencyProjection.eventHash, eventHashes));
  }
  if (manifestHashes.length > 0) {
    await executor
      .delete(accessManifestContainerGrantProjection)
      .where(
        inArray(
          accessManifestContainerGrantProjection.manifestHash,
          manifestHashes,
        ),
      );
    await executor
      .delete(accessManifestDocumentLinkProjection)
      .where(
        inArray(
          accessManifestDocumentLinkProjection.manifestHash,
          manifestHashes,
        ),
      );
    await executor
      .delete(accessManifestPrincipalHeadProjection)
      .where(
        inArray(
          accessManifestPrincipalHeadProjection.manifestHash,
          manifestHashes,
        ),
      );
    await executor
      .delete(accessManifestHeads)
      .where(inArray(accessManifestHeads.manifestHash, manifestHashes));
  }
  await executor
    .delete(accessManifests)
    .where(eq(accessManifests.organizationId, organizationId));
  await executor
    .delete(accessEvents)
    .where(eq(accessEvents.organizationId, organizationId));
}

async function deleteOrganizationPrincipalRows(input: {
  executor: DatabaseSession;
  organizationId: string;
}): Promise<void> {
  const { executor, organizationId } = input;
  await executor
    .delete(principalMemberEnvelopes)
    .where(
      and(
        eq(principalMemberEnvelopes.principalType, "organization"),
        eq(principalMemberEnvelopes.principalId, organizationId),
      ),
    );
  await executor
    .delete(principalMembershipProjection)
    .where(
      and(
        eq(principalMembershipProjection.principalType, "organization"),
        eq(principalMembershipProjection.principalId, organizationId),
      ),
    );
  await executor
    .delete(principalStatePayloads)
    .where(
      and(
        eq(principalStatePayloads.principalType, "organization"),
        eq(principalStatePayloads.principalId, organizationId),
      ),
    );
  await executor
    .delete(principalEpochKeys)
    .where(
      and(
        eq(principalEpochKeys.principalType, "organization"),
        eq(principalEpochKeys.principalId, organizationId),
      ),
    );
  await executor
    .delete(principalStates)
    .where(
      and(
        eq(principalStates.principalType, "organization"),
        eq(principalStates.principalId, organizationId),
      ),
    );
}

async function deleteGroupPrincipalRows(input: {
  executor: DatabaseSession;
  groupIds: readonly string[];
}): Promise<void> {
  const { executor, groupIds } = input;
  if (groupIds.length === 0) {
    return;
  }

  await executor
    .delete(principalMemberEnvelopes)
    .where(
      and(
        eq(principalMemberEnvelopes.principalType, "group"),
        inArray(principalMemberEnvelopes.principalId, groupIds),
      ),
    );
  await executor
    .delete(principalMembershipProjection)
    .where(
      and(
        eq(principalMembershipProjection.principalType, "group"),
        inArray(principalMembershipProjection.principalId, groupIds),
      ),
    );
  await executor
    .delete(principalStatePayloads)
    .where(
      and(
        eq(principalStatePayloads.principalType, "group"),
        inArray(principalStatePayloads.principalId, groupIds),
      ),
    );
  await executor
    .delete(principalEpochKeys)
    .where(
      and(
        eq(principalEpochKeys.principalType, "group"),
        inArray(principalEpochKeys.principalId, groupIds),
      ),
    );
  await executor
    .delete(principalStates)
    .where(
      and(
        eq(principalStates.principalType, "group"),
        inArray(principalStates.principalId, groupIds),
      ),
    );
}

export async function deletePrincipalRows(input: {
  executor: DatabaseSession;
  groupIds: readonly string[];
  organizationId: string;
}): Promise<void> {
  await deleteOrganizationPrincipalRows(input);
  await deleteGroupPrincipalRows(input);
}

export async function deleteContainerRows(input: {
  containerIds: readonly string[];
  executor: DatabaseSession;
  organizationId: string;
}): Promise<void> {
  const { containerIds, executor, organizationId } = input;
  if (containerIds.length > 0) {
    const containerKeyEpochIds = await selectIds(
      executor
        .select({ id: containerKeyEpochs.id })
        .from(containerKeyEpochs)
        .where(inArray(containerKeyEpochs.containerId, containerIds)),
    );
    if (containerKeyEpochIds.length > 0) {
      await executor
        .delete(containerKeyWraps)
        .where(
          inArray(containerKeyWraps.containerKeyEpochId, containerKeyEpochIds),
        );
    }
    await executor
      .delete(containerKeyEpochs)
      .where(inArray(containerKeyEpochs.containerId, containerIds));
    await executor
      .delete(containerMetadataDocuments)
      .where(inArray(containerMetadataDocuments.containerId, containerIds));
    await executor
      .delete(documentContainerLinks)
      .where(inArray(documentContainerLinks.containerId, containerIds));
    await executor
      .delete(containerDocumentSyncTombstones)
      .where(
        inArray(containerDocumentSyncTombstones.containerId, containerIds),
      );
  }

  await executor
    .delete(containerBuiltinGrants)
    .where(eq(containerBuiltinGrants.organizationId, organizationId));
  await executor
    .delete(containerSyncTombstones)
    .where(eq(containerSyncTombstones.organizationId, organizationId));
  await executor
    .delete(containers)
    .where(eq(containers.organizationId, organizationId));
}
