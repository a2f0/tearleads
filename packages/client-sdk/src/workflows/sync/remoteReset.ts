import { and, eq, inArray, or } from "drizzle-orm";
import {
  organizationDataUsageCategories,
  organizationDataUsageSnapshots,
} from "../../data/sqlite/organizationDataUsageSchema";
import {
  organizationPresentationDenials,
  organizationReadModelContainerGrants,
  organizationReadModelDirectoryUsers,
  organizationReadModelGroupMembers,
  organizationReadModelGroupMemberships,
  organizationReadModelGroups,
  organizationReadModelPolicyHeads,
  organizationReadModelRequesters,
  organizationReadModelState,
} from "../../data/sqlite/organizationReadModelSchema";
import {
  accessManifestCheckpoints,
  clientSqlTables,
  containerCreateIntents,
  containerHydrationTombstones,
  containerMoveIntents,
  containers,
  documentAttachmentBlobProjection,
  documentContainerProjection,
  documentMoveIntents,
  documentPendingAttachments,
  documentPendingUpdates,
  documentProjection,
  documentSyncFailures,
  documents,
  dormantContainerMetadata,
  dormantMetadataSweepRequests,
  principalPolicies,
  principalPolicyBundleHistory,
  principalPolicyBundleReferences,
  principalPolicyCheckpoints,
  principalPolicyOrganizations,
} from "../../data/sqlite/schema";
import {
  type ClientSQLiteTransactionScope,
  getClientSQLitePersistenceRuntime,
} from "../../data/sqlite/sqlitePersistenceRuntime";
import type { ExecSql } from "../../data/sqlite/sqlSchema";
import { ensureSqlTables } from "../../data/sqlite/sqlTableSchema";
import { runOrganizationPresentationReset } from "../organizations/organizationPresentationAccessState";
import { clearResetPendingAttachments } from "./remoteResetAttachments";
import { remoteResetBatches } from "./remoteResetBatches";
import { clearRemoteResetSyncCursors } from "./remoteResetCursorScope";
import {
  buildResetPlans,
  type ResetAttachmentUpload,
  type ResetDocumentUpdate,
} from "./remoteResetPlans";
import {
  type RemoteResetInput,
  type RemoteSyncStateSnapshot,
  readRemoteSyncStateSnapshot,
} from "./remoteResetScope";

export type {
  RemoteResetInput,
  RemoteResetReplacement,
} from "./remoteResetScope";

const CONTAINER_CREATE_INTENT_TYPE = "container.create";

export interface ClearRemoteSyncStateResult {
  readonly clearedContainerCreateIntentCount: number;
  readonly clearedContainerMoveIntentCount: number;
  readonly clearedDocumentMoveIntentCount: number;
  readonly clearedPrincipalPolicyCount: number;
  readonly clearedSyncCursorCount: number;
  readonly queuedAttachmentUploadCount: number;
  readonly queuedContainerCreateCount: number;
  readonly queuedDocumentUpdateCount: number;
  readonly resetContainerCount: number;
  readonly resetDocumentCount: number;
}

async function clearOrganizationPresentationRows(
  tx: ClientSQLiteTransactionScope,
  organizationId: string,
): Promise<void> {
  for (const table of [
    organizationDataUsageCategories,
    organizationDataUsageSnapshots,
    organizationReadModelContainerGrants,
    organizationReadModelGroupMembers,
    organizationReadModelGroupMemberships,
    organizationReadModelDirectoryUsers,
    organizationReadModelGroups,
    organizationReadModelPolicyHeads,
    organizationReadModelRequesters,
    organizationReadModelState,
    organizationPresentationDenials,
  ] as const) {
    await tx
      .delete(table)
      .where(eq(table.organizationId, organizationId))
      .run();
  }
}

interface ScopedRemoteRowsInput {
  attachmentUploads: readonly ResetAttachmentUpload[];
  organizationId: string;
  snapshot: RemoteSyncStateSnapshot;
  tx: ClientSQLiteTransactionScope;
}

async function clearScopedPrincipalRows(
  input: ScopedRemoteRowsInput,
): Promise<void> {
  for (const principalBatch of remoteResetBatches(
    input.snapshot.principalKeys,
  )) {
    for (const table of [
      principalPolicies,
      principalPolicyBundleHistory,
      principalPolicyBundleReferences,
      principalPolicyCheckpoints,
      principalPolicyOrganizations,
    ] as const) {
      await input.tx
        .delete(table)
        .where(
          or(
            ...principalBatch.map((principal) =>
              and(
                eq(table.principalType, principal.principalType),
                eq(table.principalId, principal.principalId),
              ),
            ),
          ),
        )
        .run();
    }
  }
}

async function clearScopedContainerRows(
  input: ScopedRemoteRowsInput,
): Promise<void> {
  for (const containerBatch of remoteResetBatches(
    input.snapshot.containerIds,
  )) {
    await input.tx
      .delete(documentContainerProjection)
      .where(inArray(documentContainerProjection.containerId, containerBatch))
      .run();
    await input.tx
      .delete(containerMoveIntents)
      .where(inArray(containerMoveIntents.containerId, containerBatch))
      .run();
    await input.tx
      .delete(containerCreateIntents)
      .where(inArray(containerCreateIntents.containerId, containerBatch))
      .run();
    await input.tx
      .delete(containerHydrationTombstones)
      .where(inArray(containerHydrationTombstones.containerId, containerBatch))
      .run();
  }
}

async function clearScopedDocumentRows(
  input: ScopedRemoteRowsInput,
): Promise<void> {
  const { snapshot, tx } = input;
  for (const documentIdBatch of remoteResetBatches(snapshot.oldDocumentIds)) {
    await tx
      .delete(documentContainerProjection)
      .where(inArray(documentContainerProjection.documentId, documentIdBatch))
      .run();
  }
  await clearResetPendingAttachments({
    attachmentUploads: input.attachmentUploads,
    documentLocalIds: snapshot.documentLocalIds,
    tx,
  });
  for (const localIdBatch of remoteResetBatches(snapshot.documentLocalIds)) {
    await tx
      .delete(documentMoveIntents)
      .where(inArray(documentMoveIntents.localId, localIdBatch))
      .run();
  }
  for (const documentBatch of remoteResetBatches(snapshot.documentRows)) {
    await tx
      .delete(documentPendingUpdates)
      .where(
        or(
          ...documentBatch.map((row) =>
            and(
              eq(documentPendingUpdates.appKind, row.appKind),
              eq(documentPendingUpdates.localId, row.localId),
            ),
          ),
        ),
      )
      .run();
    await tx
      .delete(documentSyncFailures)
      .where(
        or(
          ...documentBatch.map((row) =>
            and(
              eq(documentSyncFailures.appKind, row.appKind),
              eq(documentSyncFailures.localId, row.localId),
            ),
          ),
        ),
      )
      .run();
  }
}

async function clearScopedRemoteRows(
  input: ScopedRemoteRowsInput,
): Promise<void> {
  const { organizationId, tx } = input;
  await clearOrganizationPresentationRows(tx, organizationId);
  for (const table of [
    accessManifestCheckpoints,
    dormantContainerMetadata,
    dormantMetadataSweepRequests,
  ] as const) {
    await tx
      .delete(table)
      .where(eq(table.organizationId, organizationId))
      .run();
  }
  await clearScopedPrincipalRows(input);
  await clearScopedContainerRows(input);
  await clearScopedDocumentRows(input);
  await clearRemoteResetSyncCursors({
    containerIds: input.snapshot.containerIds,
    tx,
  });
}

async function resetRemoteColumns(input: {
  now: string;
  reset: RemoteResetInput;
  snapshot: RemoteSyncStateSnapshot;
  tx: ClientSQLiteTransactionScope;
}): Promise<void> {
  const { now, reset, snapshot, tx } = input;
  for (const row of snapshot.documentRows) {
    await tx
      .update(documents)
      .set({
        accessEpoch: 1,
        accessStateHash: null,
        contentKeyBundle: null,
        documentId: null,
        documentKekTargets: null,
        documentManifestBundle: null,
        lastCommitLsn: null,
        pullContinuation: null,
        recoveryDocumentId: row.documentId ?? row.recoveryDocumentId,
        updatedAt: now,
      })
      .where(
        and(
          eq(documents.appKind, row.appKind),
          eq(documents.localId, row.localId),
        ),
      )
      .run();
  }
  for (const localIdBatch of remoteResetBatches(snapshot.documentLocalIds)) {
    await tx
      .update(documentProjection)
      .set({
        documentId: null,
        organizationId:
          reset.replacement?.organizationId ?? reset.organizationId,
      })
      .where(inArray(documentProjection.localId, localIdBatch))
      .run();
  }
  for (const row of snapshot.containerRows) {
    await tx
      .update(containers)
      .set({
        metadataDocumentId: null,
        organizationId:
          reset.replacement?.organizationId ?? reset.organizationId,
        parentId:
          reset.replacement && row.parentId === null
            ? reset.replacement.rootContainerId
            : row.parentId,
        serverCreatedAt: null,
        serverUpdatedAt: null,
        ...(reset.replacement ? { systemSlot: null } : {}),
        localUpdatedAt: now,
      })
      .where(eq(containers.id, row.id))
      .run();
  }
}

async function queueResetDocumentUpdates(input: {
  documentUpdates: readonly ResetDocumentUpdate[];
  now: string;
  tx: ClientSQLiteTransactionScope;
}): Promise<void> {
  for (const updateBatch of remoteResetBatches(input.documentUpdates)) {
    await input.tx
      .insert(documentPendingUpdates)
      .values(
        updateBatch.map((update) => ({
          ...update,
          id: crypto.randomUUID(),
          createdAt: input.now,
        })),
      )
      .run();
  }
}

async function queueResetContainerCreates(input: {
  now: string;
  reset: RemoteResetInput;
  snapshot: RemoteSyncStateSnapshot;
  tx: ClientSQLiteTransactionScope;
}): Promise<number> {
  const rows = input.snapshot.containerRows.flatMap((row) => {
    const parentId =
      row.parentId ?? input.reset.replacement?.rootContainerId ?? null;
    return parentId ? [{ id: row.id, parentId }] : [];
  });
  if (rows.length === 0) return 0;
  for (const rowBatch of remoteResetBatches(rows)) {
    await input.tx
      .insert(containerCreateIntents)
      .values(
        rowBatch.map((row) => ({
          id: crypto.randomUUID(),
          containerId: row.id,
          parentContainerId: row.parentId,
          intentType: CONTAINER_CREATE_INTENT_TYPE,
          syncStatus: "pending" as const,
          remoteContainerId: null,
          remoteMetadataAccessStateHash: null,
          remoteMetadataDocumentId: null,
          lastError: null,
          createdAt: input.now,
          updatedAt: input.now,
        })),
      )
      .run();
  }
  return rows.length;
}

async function queueResetAttachmentUploads(input: {
  attachmentUploads: readonly ResetAttachmentUpload[];
  now: string;
  tx: ClientSQLiteTransactionScope;
}): Promise<void> {
  for (const attachmentBatch of remoteResetBatches(input.attachmentUploads)) {
    await input.tx
      .insert(documentPendingAttachments)
      .values(
        attachmentBatch.map((attachment) => ({
          ...attachment,
          createdAt: input.now,
        })),
      )
      .run();
    await input.tx
      .delete(documentAttachmentBlobProjection)
      .where(
        or(
          ...attachmentBatch.map((attachment) =>
            and(
              eq(documentAttachmentBlobProjection.localId, attachment.localId),
              eq(documentAttachmentBlobProjection.slotId, attachment.slotId),
            ),
          ),
        ),
      )
      .run();
  }
}

async function clearRemoteSyncStateInTransaction(input: {
  plans: Awaited<ReturnType<typeof buildResetPlans>>;
  reset: RemoteResetInput;
  snapshot: RemoteSyncStateSnapshot;
  tx: ClientSQLiteTransactionScope;
}): Promise<ClearRemoteSyncStateResult> {
  const now = new Date().toISOString();
  const { snapshot } = input;
  await clearScopedRemoteRows({
    attachmentUploads: input.plans.attachmentUploads,
    organizationId: input.reset.organizationId,
    snapshot,
    tx: input.tx,
  });
  await resetRemoteColumns({ now, reset: input.reset, snapshot, tx: input.tx });
  await queueResetDocumentUpdates({
    documentUpdates: input.plans.documentUpdates,
    now,
    tx: input.tx,
  });
  const queuedContainerCreateCount = await queueResetContainerCreates({
    now,
    reset: input.reset,
    snapshot,
    tx: input.tx,
  });
  await queueResetAttachmentUploads({
    attachmentUploads: input.plans.attachmentUploads,
    now,
    tx: input.tx,
  });
  return {
    clearedContainerCreateIntentCount:
      snapshot.clearedContainerCreateIntentCount,
    clearedContainerMoveIntentCount: snapshot.clearedContainerMoveIntentCount,
    clearedDocumentMoveIntentCount: snapshot.clearedDocumentMoveIntentCount,
    clearedPrincipalPolicyCount: snapshot.clearedPrincipalPolicyCount,
    clearedSyncCursorCount: snapshot.clearedSyncCursorCount,
    queuedAttachmentUploadCount: input.plans.attachmentUploads.length,
    queuedContainerCreateCount,
    queuedDocumentUpdateCount: input.plans.documentUpdates.length,
    resetContainerCount: snapshot.containerRows.length,
    resetDocumentCount: snapshot.documentRows.length,
  };
}

export async function clearRemoteSyncState(
  execSql: ExecSql,
  reset: RemoteResetInput,
  canCommit?: (() => boolean) | undefined,
): Promise<ClearRemoteSyncStateResult> {
  return runOrganizationPresentationReset(
    execSql,
    reset.organizationId,
    async () => {
      await ensureSqlTables(execSql, clientSqlTables);
      const runtime = getClientSQLitePersistenceRuntime(execSql);
      const resetInTransaction = async (tx: ClientSQLiteTransactionScope) => {
        if (canCommit && !canCommit()) {
          throw new Error(
            "Remote sync reset aborted: session identity changed",
          );
        }
        const snapshot = await readRemoteSyncStateSnapshot(
          tx,
          reset.organizationId,
        );
        const plans = await buildResetPlans(tx, snapshot.documentRows);
        return clearRemoteSyncStateInTransaction({
          plans,
          reset,
          snapshot,
          tx,
        });
      };
      if (!canCommit) {
        return runtime.transaction(resetInTransaction);
      }
      const outcome = await runtime.guardedTransaction(
        resetInTransaction,
        canCommit,
      );
      if (!outcome.committed || !outcome.result) {
        throw new Error("Remote sync reset aborted: session identity changed");
      }
      return outcome.result;
    },
  );
}
