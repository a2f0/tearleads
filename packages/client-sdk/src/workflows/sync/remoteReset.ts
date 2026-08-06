import { and, eq, or } from "drizzle-orm";
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
  clientSqlTables,
  containerCreateIntents,
  containerMoveIntents,
  containerSyncLaneChecks,
  containerSyncWatermarks,
  containers,
  documentAttachmentBlobProjection,
  documentContainerProjection,
  documentMoveIntents,
  documentPendingAttachments,
  documentPendingUpdates,
  documentProjection,
  documentSyncFailures,
  documents,
  principalPolicies,
} from "../../data/sqlite/schema";
import {
  type ClientSQLiteTransactionScope,
  getClientSQLitePersistenceRuntime,
} from "../../data/sqlite/sqlitePersistenceRuntime";
import type { ExecSql } from "../../data/sqlite/sqlSchema";
import { ensureSqlTables } from "../../data/sqlite/sqlTableSchema";
import { runOrganizationPresentationReset } from "../organizations/organizationPresentationAccessState";
import {
  buildResetPlans,
  type ResetAttachmentUpload,
  type ResetDocumentUpdate,
} from "./remoteResetPlans";

const CONTAINER_CREATE_INTENT_TYPE = "container.create";

interface ResetContainerRow {
  readonly id: string | null;
  readonly parentId: string | null;
}

interface RemoteSyncStateSnapshot {
  readonly clearedContainerCreateIntentCount: number;
  readonly clearedContainerMoveIntentCount: number;
  readonly clearedDocumentMoveIntentCount: number;
  readonly clearedPrincipalPolicyCount: number;
  readonly clearedSyncCursorCount: number;
  readonly containerRows: ResetContainerRow[];
  readonly resetDocumentCount: number;
}

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

async function readRemoteSyncStateSnapshot(
  tx: ClientSQLiteTransactionScope,
): Promise<RemoteSyncStateSnapshot> {
  const containerRows = await tx
    .select({ id: containers.id, parentId: containers.parentId })
    .from(containers);
  const principalPolicyRows = await tx
    .select({ principalId: principalPolicies.principalId })
    .from(principalPolicies);
  const documentMoveIntentRows = await tx
    .select({ id: documentMoveIntents.id })
    .from(documentMoveIntents);
  const containerMoveIntentRows = await tx
    .select({ id: containerMoveIntents.id })
    .from(containerMoveIntents);
  const containerCreateIntentRows = await tx
    .select({ id: containerCreateIntents.id })
    .from(containerCreateIntents);
  const syncWatermarkRows = await tx
    .select({ laneId: containerSyncWatermarks.laneId })
    .from(containerSyncWatermarks);
  const syncLaneCheckRows = await tx
    .select({ laneId: containerSyncLaneChecks.laneId })
    .from(containerSyncLaneChecks);
  const documentRows = await tx
    .select({ appKind: documents.appKind, localId: documents.localId })
    .from(documents);

  return {
    clearedContainerCreateIntentCount: containerCreateIntentRows.length,
    clearedContainerMoveIntentCount: containerMoveIntentRows.length,
    clearedDocumentMoveIntentCount: documentMoveIntentRows.length,
    clearedPrincipalPolicyCount: principalPolicyRows.length,
    clearedSyncCursorCount: syncWatermarkRows.length + syncLaneCheckRows.length,
    containerRows,
    resetDocumentCount: documentRows.length,
  };
}

async function clearRemoteDerivedRows(
  tx: ClientSQLiteTransactionScope,
): Promise<void> {
  await tx.delete(organizationDataUsageCategories).run();
  await tx.delete(organizationDataUsageSnapshots).run();
  await tx.delete(organizationReadModelContainerGrants).run();
  await tx.delete(organizationReadModelGroupMembers).run();
  await tx.delete(organizationReadModelGroupMemberships).run();
  await tx.delete(organizationReadModelDirectoryUsers).run();
  await tx.delete(organizationReadModelGroups).run();
  await tx.delete(organizationReadModelPolicyHeads).run();
  await tx.delete(organizationReadModelRequesters).run();
  await tx.delete(organizationReadModelState).run();
  // A reset denial is a local lifecycle event, not a server verdict: the next
  // session re-derives access, so durable denial markers must not survive.
  await tx.delete(organizationPresentationDenials).run();
  await tx.delete(principalPolicies).run();
  await tx.delete(documentContainerProjection).run();
  await tx.delete(documentMoveIntents).run();
  await tx.delete(containerMoveIntents).run();
  await tx.delete(containerSyncWatermarks).run();
  await tx.delete(containerSyncLaneChecks).run();
  await tx.delete(containerCreateIntents).run();
  await tx.delete(documentPendingUpdates).run();
  // documentHistoryCheckpoints / documentHistoryUpdates are deliberately
  // PRESERVED: they hold purely local Loro op history keyed by localId, which
  // a remote reset does not invalidate — and they are the only durable content
  // source, so deleting them would destroy every retained document's content.
  // Recorded terminal failures describe pre-reset attempts; the rebuilt queue
  // must not inherit them (nor keep the restore re-arm evidence gate armed).
  await tx.delete(documentSyncFailures).run();
}

async function resetRemoteColumns(
  tx: ClientSQLiteTransactionScope,
  now: string,
): Promise<void> {
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
      updatedAt: now,
    })
    .run();
  // `organizationId` is the retained attribution for documents detached from a
  // removed shared container; a reset clears every org binding, so it resets
  // with them.
  await tx
    .update(documentProjection)
    .set({ documentId: null, organizationId: null })
    .run();
  await tx
    .update(containers)
    .set({
      metadataDocumentId: null,
      organizationId: "",
      serverCreatedAt: null,
      serverUpdatedAt: null,
      localUpdatedAt: now,
    })
    .run();
}

async function queueResetDocumentUpdates(input: {
  documentUpdates: readonly ResetDocumentUpdate[];
  now: string;
  tx: ClientSQLiteTransactionScope;
}): Promise<void> {
  if (input.documentUpdates.length === 0) {
    return;
  }

  await input.tx
    .insert(documentPendingUpdates)
    .values(
      input.documentUpdates.map((update) => ({
        id: crypto.randomUUID(),
        appKind: update.appKind,
        localId: update.localId,
        updateData: update.updateData,
        partialStartVersionVector: update.partialStartVersionVector,
        partialEndVersionVector: update.partialEndVersionVector,
        sourceVersionVector: update.sourceVersionVector,
        createdAt: input.now,
      })),
    )
    .run();
}

async function queueResetContainerCreates(input: {
  containerRows: readonly ResetContainerRow[];
  now: string;
  tx: ClientSQLiteTransactionScope;
}): Promise<number> {
  const containerRows = input.containerRows.filter(
    (
      container,
    ): container is ResetContainerRow & {
      readonly id: string;
      readonly parentId: string;
    } => container.id !== null && container.parentId !== null,
  );
  if (containerRows.length === 0) {
    return 0;
  }

  await input.tx
    .insert(containerCreateIntents)
    .values(
      containerRows.map((container) => ({
        id: crypto.randomUUID(),
        containerId: container.id,
        parentContainerId: container.parentId,
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

  return containerRows.length;
}

async function queueResetAttachmentUploads(input: {
  attachmentUploads: readonly ResetAttachmentUpload[];
  now: string;
  tx: ClientSQLiteTransactionScope;
}): Promise<void> {
  if (input.attachmentUploads.length > 0) {
    await input.tx
      .insert(documentPendingAttachments)
      .values(
        input.attachmentUploads.map((attachment) => ({
          byteLength: attachment.byteLength,
          createdAt: input.now,
          localId: attachment.localId,
          mimeType: attachment.mimeType,
          name: attachment.name,
          slotId: attachment.slotId,
          storageKey: attachment.storageKey,
        })),
      )
      .onConflictDoNothing({
        target: [
          documentPendingAttachments.localId,
          documentPendingAttachments.slotId,
        ],
      })
      .run();
  }

  // Drop only the rows this requeued. What is left belongs to slots the
  // document no longer advertises: those rows are not remote-derived state but
  // the markers that still own an unlinked slot's local bytes, and this
  // workflow has no blob store to delete those bytes itself. Keeping them lets
  // the document lane's usual detach cleanup delete the row and the bytes
  // together, instead of stranding bytes nothing references.
  if (input.attachmentUploads.length > 0) {
    await input.tx
      .delete(documentAttachmentBlobProjection)
      .where(
        or(
          ...input.attachmentUploads.map((attachment) =>
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
  tx: ClientSQLiteTransactionScope;
}): Promise<ClearRemoteSyncStateResult> {
  const now = new Date().toISOString();
  const snapshot = await readRemoteSyncStateSnapshot(input.tx);
  await clearRemoteDerivedRows(input.tx);
  await resetRemoteColumns(input.tx, now);
  await queueResetDocumentUpdates({
    documentUpdates: input.plans.documentUpdates,
    now,
    tx: input.tx,
  });
  const queuedContainerCreateCount = await queueResetContainerCreates({
    containerRows: snapshot.containerRows,
    now,
    tx: input.tx,
  });
  await queueResetAttachmentUploads({
    attachmentUploads: input.plans.attachmentUploads,
    now,
    tx: input.tx,
  });
  const { containerRows, ...counts } = snapshot;

  return {
    ...counts,
    queuedAttachmentUploadCount: input.plans.attachmentUploads.length,
    queuedContainerCreateCount,
    queuedDocumentUpdateCount: input.plans.documentUpdates.length,
    resetContainerCount: containerRows.length,
  };
}

export async function clearRemoteSyncState(
  execSql: ExecSql,
): Promise<ClearRemoteSyncStateResult> {
  return runOrganizationPresentationReset(execSql, async () => {
    await ensureSqlTables(execSql, clientSqlTables);
    const plans = await buildResetPlans(execSql);

    return getClientSQLitePersistenceRuntime(execSql).transaction((tx) =>
      clearRemoteSyncStateInTransaction({ plans, tx }),
    );
  });
}
