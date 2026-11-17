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
  principalHistoryProgress,
  principalMemberEnvelopes,
  principalMembershipProjection,
  principalPolicyCommits,
  principalPolicyMutationAcknowledgements,
  principalStatePayloads,
  principalStates,
} from "@tearleads/api-shared/schema";
import { and, eq, inArray, type SQL, type SQLWrapper, sql } from "drizzle-orm";
import { forgetTransactionAccessManifestBundles } from "../../access/write/accessManifestStore";
import { forgetPrincipalTransactionMemo } from "../../access/write/principalStateStore";
import {
  lockBlobMutationRows,
  planBlobMutationLockIds,
} from "../blobs/mutations/blobMutationLocks";
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
  groupIds: readonly string[],
): Promise<void> {
  forgetPrincipalTransactionMemo(executor);
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
  for (const groupBatch of organizationPurgeBatches(groupIds)) {
    await executor
      .insert(organizationGroupTombstones)
      .values(groupBatch.map((groupId) => ({ groupId, organizationId })))
      .onConflictDoNothing();
    await executor.delete(groups).where(inArray(groups.id, groupBatch));
  }
  await deleteOrganizationHistoryProgress(executor, organizationId);
}

/** Text columns in byte order, the order the hint publisher writes keys. */
function byteOrder(column: SQLWrapper): SQL {
  return sql`${column} collate "C"`;
}

/** Delete progress rows, locking them first in the publisher's key order. */
async function deleteProgressInKeyOrder(
  executor: DatabaseTransaction,
  where: SQL | undefined,
): Promise<void> {
  const progress = principalHistoryProgress;
  const lockedInKeyOrder = executor
    .select({ id: progress.id })
    .from(progress)
    .where(where)
    .orderBy(
      byteOrder(progress.principalType),
      progress.principalId,
      byteOrder(progress.verificationKind),
      byteOrder(progress.inputHash),
      byteOrder(progress.protectionId),
      progress.version,
    )
    .for("update");
  await executor.delete(progress).where(inArray(progress.id, lockedInKeyOrder));
}

/**
 * Verification hints of the organization and of every group it ever had: the
 * live ones were just tombstoned, and a deleted group kept its hints with its
 * signed states. Purge verifies no history, so it buffers no hint to publish
 * after commit; hash-addressed index nodes and the tombstones stay. Rows are
 * locked in the key order the post-commit publisher upserts in (every group
 * sorts before the organization), so purge and a concurrent publisher of the
 * same hints cannot deadlock. A hint such a publisher inserts after this delete
 * outlives the purge as an unused cache. Each statement is an index lookup.
 */
async function deleteOrganizationHistoryProgress(
  executor: DatabaseTransaction,
  organizationId: string,
): Promise<void> {
  const progress = principalHistoryProgress;
  await deleteProgressInKeyOrder(
    executor,
    and(
      eq(progress.principalType, "group"),
      inArray(
        progress.principalId,
        executor
          .select({ groupId: organizationGroupTombstones.groupId })
          .from(organizationGroupTombstones)
          .where(
            eq(organizationGroupTombstones.organizationId, organizationId),
          ),
      ),
    ),
  );
  await deleteProgressInKeyOrder(
    executor,
    and(
      eq(progress.principalType, "organization"),
      eq(progress.principalId, organizationId),
    ),
  );
}

/**
 * `groupIds` are the organization's groups, read under the organization's
 * principal lock, which every group writer takes first.
 */
export async function deleteOrganizationRemoteRows(input: {
  readonly executor: DatabaseTransaction;
  readonly groupIds: readonly string[];
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
    // Discard genesis payload with remote data, retaining only the binding
    // needed to certify terminal ordinary-create refusal after purge completes.
    .set({ profileDocumentId: null, provisioningResponse: null })
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
  // An update locks its rows in scan order. Lock each batch in UUID order
  // first, over the whole sorted set, so this cannot deadlock with a reclaim
  // chunk that holds some of these rows in the same order.
  for (const blobBatch of organizationPurgeBatches(
    planBlobMutationLockIds(input.scope.blobIds),
  )) {
    await lockBlobMutationRows({
      blobIds: blobBatch,
      executor: input.executor,
    });
    await input.executor
      .update(blobs)
      .set({ dereferencedAt: input.now, reclaimAttemptedAt: null })
      .where(inArray(blobs.id, blobBatch));
  }
  await deleteContainerRows(input);
  await deleteAccessRows(input.executor, input.organizationId);
  await deleteOrganizationPrincipalRows(
    input.executor,
    input.organizationId,
    input.groupIds,
  );
  await input.executor
    .delete(organizationReadModelHeads)
    .where(eq(organizationReadModelHeads.organizationId, input.organizationId));
}
