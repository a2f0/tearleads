import type { DatabaseTransaction } from "@tearleads/api-shared/postgres";
import {
  accessEvents,
  accessManifestContainerGrantProjection,
  accessManifestDocumentLinkProjection,
  accessManifestHeads,
  accessManifestPrincipalHeadProjection,
  accessManifests,
  blobStages,
  blobs,
  containerDocumentSyncTombstones,
  containerKeyEpochs,
  containerKeyWraps,
  containerMetadataDocuments,
  containerSyncTombstones,
  containers,
  groups,
  organizationGroupTombstones,
  organizationReadModelHeads,
  organizationRosterEntries,
  organizations,
  principalDirectoryBindings,
  principalMemberEnvelopes,
  principalMembershipProjection,
  principalPolicyCommits,
  principalPolicyMutationAcknowledgements,
  principalStatePayloads,
  principalStates,
} from "@tearleads/api-shared/schema";
import { and, eq, inArray } from "drizzle-orm";
import { forgetTransactionAccessManifestBundles } from "../../access/write/accessManifestStore";
import { deleteDocumentRows } from "../documents/mutations/purgeDocumentRows";
import { organizationPurgeBatches } from "./organizationPurgeBatches";
import type { OrganizationRemotePurgeScope } from "./organizationPurgeScope";

async function deleteContainerRows(input: {
  readonly executor: DatabaseTransaction;
  readonly organizationId: string;
  readonly scope: OrganizationRemotePurgeScope;
}): Promise<void> {
  const { containerIds } = input.scope;
  for (const containerBatch of organizationPurgeBatches(containerIds)) {
    await input.executor
      .delete(principalPolicyMutationAcknowledgements)
      .where(
        inArray(
          principalPolicyMutationAcknowledgements.containerId,
          containerBatch,
        ),
      );
    const epochs = await input.executor
      .select({ id: containerKeyEpochs.id })
      .from(containerKeyEpochs)
      .where(inArray(containerKeyEpochs.containerId, containerBatch));
    const epochIds = epochs.map((row) => row.id);
    for (const epochBatch of organizationPurgeBatches(epochIds)) {
      await input.executor
        .delete(containerKeyWraps)
        .where(inArray(containerKeyWraps.containerKeyEpochId, epochBatch));
    }
    await input.executor
      .delete(containerKeyEpochs)
      .where(inArray(containerKeyEpochs.containerId, containerBatch));
    await input.executor
      .delete(containerMetadataDocuments)
      .where(inArray(containerMetadataDocuments.containerId, containerBatch));
    await input.executor
      .delete(containerDocumentSyncTombstones)
      .where(
        inArray(containerDocumentSyncTombstones.containerId, containerBatch),
      );
  }
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
  forgetTransactionAccessManifestBundles(executor);
  const manifests = await executor
    .select({ hash: accessManifests.manifestHash })
    .from(accessManifests)
    .where(eq(accessManifests.organizationId, organizationId));
  const manifestHashes = manifests.map((row) => row.hash);
  for (const manifestBatch of organizationPurgeBatches(manifestHashes)) {
    await executor
      .delete(accessManifestContainerGrantProjection)
      .where(
        inArray(
          accessManifestContainerGrantProjection.manifestHash,
          manifestBatch,
        ),
      );
    await executor
      .delete(accessManifestDocumentLinkProjection)
      .where(
        inArray(
          accessManifestDocumentLinkProjection.manifestHash,
          manifestBatch,
        ),
      );
    await executor
      .delete(accessManifestPrincipalHeadProjection)
      .where(
        inArray(
          accessManifestPrincipalHeadProjection.manifestHash,
          manifestBatch,
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
  for (const principalScope of [
    { principalIds: [organizationId], principalType: "organization" },
    { principalIds: groupIds, principalType: "group" },
  ] as const) {
    for (const principalBatch of organizationPurgeBatches(
      principalScope.principalIds,
    )) {
      for (const table of [
        principalPolicyMutationAcknowledgements,
        principalMemberEnvelopes,
        principalStatePayloads,
        principalMembershipProjection,
        principalStates,
      ] as const) {
        await executor
          .delete(table)
          .where(
            and(
              eq(table.principalType, principalScope.principalType),
              inArray(table.principalId, principalBatch),
            ),
          );
      }
    }
  }
  if (groupIds.length === 0) return;
  for (const groupBatch of organizationPurgeBatches(groupIds)) {
    await executor
      .insert(organizationGroupTombstones)
      .values(groupBatch.map((groupId) => ({ groupId, organizationId })))
      .onConflictDoNothing();
    await executor.delete(groups).where(inArray(groups.id, groupBatch));
  }
}

export async function deleteOrganizationRemoteRows(input: {
  readonly executor: DatabaseTransaction;
  readonly now: Date;
  readonly organizationId: string;
  readonly scope: OrganizationRemotePurgeScope;
}): Promise<void> {
  await input.executor
    .delete(principalDirectoryBindings)
    .where(eq(principalDirectoryBindings.organizationId, input.organizationId));
  await input.executor
    .delete(principalPolicyCommits)
    .where(eq(principalPolicyCommits.organizationId, input.organizationId));
  await input.executor
    .update(organizations)
    .set({ profileDocumentId: null })
    .where(eq(organizations.id, input.organizationId));
  await input.executor
    .update(organizationRosterEntries)
    .set({ profileDocumentId: null, updatedAt: input.now })
    .where(eq(organizationRosterEntries.organizationId, input.organizationId));
  for (const documentBatch of organizationPurgeBatches(
    input.scope.documentIds,
  )) {
    await deleteDocumentRows({
      documentIds: documentBatch,
      executor: input.executor,
      orphanedBlobIds: [],
      retainAccessHistory: false,
    });
  }
  await input.executor
    .update(blobStages)
    .set({ expiresAt: input.now })
    .where(eq(blobStages.organizationId, input.organizationId));
  for (const blobBatch of organizationPurgeBatches(input.scope.blobIds)) {
    await input.executor
      .update(blobs)
      .set({ dereferencedAt: input.now, reclaimAttemptedAt: null })
      .where(inArray(blobs.id, blobBatch));
  }
  await deleteContainerRows(input);
  await deleteAccessRows(input.executor, input.organizationId);
  await deleteOrganizationPrincipalRows(input.executor, input.organizationId);
  await input.executor
    .delete(organizationReadModelHeads)
    .where(eq(organizationReadModelHeads.organizationId, input.organizationId));
}
