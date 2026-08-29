import type { DatabaseTransaction } from "@symcrypt/api-shared/postgres";
import {
  accessEventDependencyProjection,
  accessEvents,
  accessManifestContainerGrantProjection,
  accessManifestDocumentLinkProjection,
  accessManifestHeads,
  accessManifestPrincipalHeadProjection,
  accessManifests,
  blobs,
  containerBuiltinGrants,
  containerDocumentSyncTombstones,
  containerKeyEpochs,
  containerKeyWraps,
  containerMetadataDocuments,
  containerSyncTombstones,
  containers,
  groups,
  organizationGroupTombstones,
  organizationReadModelChanges,
  organizationReadModelHeads,
  organizationRosterEntries,
  organizations,
  principalContainerGrantProjection,
  principalEpochKeys,
  principalMemberEnvelopes,
  principalMembershipProjection,
  principalPolicyMutationAcknowledgements,
  principalStatePayloads,
  principalStates,
} from "@symcrypt/api-shared/schema";
import { eq, inArray } from "drizzle-orm";
import { deleteDocumentRows } from "../documents/mutations/purgeDocumentRows";
import type { OrganizationRemotePurgeScope } from "./organizationPurgeScope";

async function deleteContainerRows(input: {
  readonly executor: DatabaseTransaction;
  readonly organizationId: string;
  readonly scope: OrganizationRemotePurgeScope;
}): Promise<void> {
  const { containerIds } = input.scope;
  if (containerIds.length > 0) {
    await input.executor
      .delete(principalPolicyMutationAcknowledgements)
      .where(
        inArray(
          principalPolicyMutationAcknowledgements.containerId,
          containerIds,
        ),
      );
    await input.executor
      .delete(principalContainerGrantProjection)
      .where(
        inArray(principalContainerGrantProjection.containerId, containerIds),
      );
    const epochs = await input.executor
      .select({ id: containerKeyEpochs.id })
      .from(containerKeyEpochs)
      .where(inArray(containerKeyEpochs.containerId, containerIds));
    const epochIds = epochs.map((row) => row.id);
    if (epochIds.length > 0) {
      await input.executor
        .delete(containerKeyWraps)
        .where(inArray(containerKeyWraps.containerKeyEpochId, epochIds));
    }
    await input.executor
      .delete(containerKeyEpochs)
      .where(inArray(containerKeyEpochs.containerId, containerIds));
    await input.executor
      .delete(containerMetadataDocuments)
      .where(inArray(containerMetadataDocuments.containerId, containerIds));
    await input.executor
      .delete(containerDocumentSyncTombstones)
      .where(
        inArray(containerDocumentSyncTombstones.containerId, containerIds),
      );
  }
  await input.executor
    .delete(containerBuiltinGrants)
    .where(eq(containerBuiltinGrants.organizationId, input.organizationId));
  await input.executor
    .delete(containerSyncTombstones)
    .where(eq(containerSyncTombstones.organizationId, input.organizationId));
  await input.executor
    .delete(containers)
    .where(eq(containers.organizationId, input.organizationId));
}

async function deleteAccessRows(
  executor: DatabaseTransaction,
  organizationId: string,
): Promise<void> {
  const [events, manifests] = await Promise.all([
    executor
      .select({ hash: accessEvents.eventHash })
      .from(accessEvents)
      .where(eq(accessEvents.organizationId, organizationId)),
    executor
      .select({ hash: accessManifests.manifestHash })
      .from(accessManifests)
      .where(eq(accessManifests.organizationId, organizationId)),
  ]);
  const eventHashes = events.map((row) => row.hash);
  const manifestHashes = manifests.map((row) => row.hash);
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
  }
  await executor
    .delete(accessManifestHeads)
    .where(eq(accessManifestHeads.organizationId, organizationId));
  await executor
    .delete(accessManifests)
    .where(eq(accessManifests.organizationId, organizationId));
  await executor
    .delete(accessEvents)
    .where(eq(accessEvents.organizationId, organizationId));
}

async function deleteOrganizationPrincipalRows(
  executor: DatabaseTransaction,
  organizationId: string,
): Promise<void> {
  const groupRows = await executor
    .select({ id: groups.id })
    .from(groups)
    .where(eq(groups.organizationId, organizationId));
  const groupIds = groupRows.map((row) => row.id);
  const principalIds = [organizationId, ...groupIds];

  for (const table of [
    principalPolicyMutationAcknowledgements,
    principalMemberEnvelopes,
    principalStatePayloads,
    principalEpochKeys,
    principalContainerGrantProjection,
    principalMembershipProjection,
    principalStates,
  ] as const) {
    await executor
      .delete(table)
      .where(inArray(table.principalId, principalIds));
  }
  if (groupIds.length === 0) return;
  await executor
    .insert(organizationGroupTombstones)
    .values(groupIds.map((groupId) => ({ groupId, organizationId })))
    .onConflictDoNothing();
  await executor.delete(groups).where(inArray(groups.id, groupIds));
}

export async function deleteOrganizationRemoteRows(input: {
  readonly executor: DatabaseTransaction;
  readonly now: Date;
  readonly organizationId: string;
  readonly scope: OrganizationRemotePurgeScope;
}): Promise<void> {
  await input.executor
    .update(organizations)
    .set({ profileDocumentId: null })
    .where(eq(organizations.id, input.organizationId));
  await input.executor
    .update(organizationRosterEntries)
    .set({ profileDocumentId: null, updatedAt: input.now })
    .where(eq(organizationRosterEntries.organizationId, input.organizationId));
  for (const documentId of input.scope.documentIds) {
    await deleteDocumentRows({
      documentId,
      executor: input.executor,
      orphanedBlobIds: [],
      retainAccessHistory: false,
    });
  }
  if (input.scope.blobIds.length > 0) {
    await input.executor
      .update(blobs)
      .set({ dereferencedAt: input.now, reclaimAttemptedAt: null })
      .where(inArray(blobs.id, input.scope.blobIds));
  }
  await deleteContainerRows(input);
  await deleteAccessRows(input.executor, input.organizationId);
  await deleteOrganizationPrincipalRows(input.executor, input.organizationId);
  await input.executor
    .delete(organizationReadModelChanges)
    .where(
      eq(organizationReadModelChanges.organizationId, input.organizationId),
    );
  await input.executor
    .delete(organizationReadModelHeads)
    .where(eq(organizationReadModelHeads.organizationId, input.organizationId));
}
