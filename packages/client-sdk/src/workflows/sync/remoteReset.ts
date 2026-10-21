import { clearRemoteResetPrincipalRows } from "../../data/persistence/principalPolicy/principalPolicyRemoteReset";
import { deleteVerifiedManifestBundlesForOrganization } from "../../data/persistence/verifiedManifestBundlePersistence";
import { clientSqlTables } from "../../data/sqlite/schema";
import {
  type ClientSQLiteTransactionScope,
  getClientSQLitePersistenceRuntime,
} from "../../data/sqlite/sqlitePersistenceRuntime";
import type { ExecSql } from "../../data/sqlite/sqlSchema";
import { ensureSqlTables } from "../../data/sqlite/sqlTableSchema";
import {
  clearContainerRowsForRemoteReset,
  clearDocumentPlacementsForRemoteReset,
  clearDormantContainerMetadataForRemoteReset,
  clearRemoteResetSyncCursors,
  queueContainerCreatesForRemoteReset,
  resetContainerServerIdentity,
} from "../container-contents/remoteReset/containerRemoteReset";
import {
  buildResetPlans,
  clearDocumentDiscoveryEvidenceOnRemoteReset,
  clearDocumentRowsForRemoteReset,
  queueAttachmentReuploadsForRemoteReset,
  queueDocumentRepublishForRemoteReset,
  resetDocumentServerIdentity,
} from "../documents/remoteReset/documentRemoteReset";
import {
  clearOrganizationReadModelsForRemoteReset,
  runOrganizationPresentationReset,
} from "../organizations/readModel/organizationRemoteReset";
import {
  type RemoteResetInput,
  type RemoteSyncStateSnapshot,
  readRemoteSyncStateSnapshot,
} from "./remoteResetScope";

export type {
  RemoteResetInput,
  RemoteResetReplacement,
} from "./remoteResetScope";

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

// Each subsystem resets its own tables; this runs their steps in one
// transaction. Steps on different tables are independent, and each subsystem
// clears its rows before it queues new ones.
async function clearRemoteSyncStateInTransaction(input: {
  plans: Awaited<ReturnType<typeof buildResetPlans>>;
  reset: RemoteResetInput;
  snapshot: RemoteSyncStateSnapshot;
  tx: ClientSQLiteTransactionScope;
}): Promise<ClearRemoteSyncStateResult> {
  const now = new Date().toISOString();
  const { plans, reset, snapshot, tx } = input;
  const { organizationId } = reset;

  // Forget what the server told this device about the organization.
  await clearOrganizationReadModelsForRemoteReset(tx, organizationId);
  await clearDormantContainerMetadataForRemoteReset(tx, organizationId);
  await deleteVerifiedManifestBundlesForOrganization(tx, organizationId);
  await clearDocumentDiscoveryEvidenceOnRemoteReset(tx, {
    containerIds: snapshot.containerIds,
    documentIds: snapshot.oldDocumentIds,
  });
  await clearRemoteResetPrincipalRows({ organizationId, snapshot, tx });
  await clearContainerRowsForRemoteReset({
    containerIds: snapshot.containerIds,
    tx,
  });
  await clearDocumentPlacementsForRemoteReset({
    documentLocalIds: snapshot.documentLocalIds,
    oldDocumentIds: snapshot.oldDocumentIds,
    tx,
  });
  await clearDocumentRowsForRemoteReset({
    attachmentUploads: plans.attachmentUploads,
    documentLocalIds: snapshot.documentLocalIds,
    documentRows: snapshot.documentRows,
    tx,
  });
  await clearRemoteResetSyncCursors({
    containerIds: snapshot.containerIds,
    tx,
  });

  // Strip server identity from the rows the device keeps.
  await resetDocumentServerIdentity({
    documentLocalIds: snapshot.documentLocalIds,
    documentRows: snapshot.documentRows,
    now,
    organizationId: reset.replacement?.organizationId ?? organizationId,
    tx,
  });
  await resetContainerServerIdentity({
    containerIds: snapshot.containerIds,
    containerRows: snapshot.containerRows,
    now,
    reset,
    tx,
  });

  // Queue the local content to be published again.
  await queueDocumentRepublishForRemoteReset({
    documentUpdates: plans.documentUpdates,
    now,
    tx,
  });
  const queuedContainerCreateCount = await queueContainerCreatesForRemoteReset({
    containerRows: snapshot.containerRows,
    now,
    reset,
    tx,
  });
  await queueAttachmentReuploadsForRemoteReset({
    attachmentUploads: plans.attachmentUploads,
    now,
    tx,
  });
  return {
    clearedContainerCreateIntentCount:
      snapshot.clearedContainerCreateIntentCount,
    clearedContainerMoveIntentCount: snapshot.clearedContainerMoveIntentCount,
    clearedDocumentMoveIntentCount: snapshot.clearedDocumentMoveIntentCount,
    clearedPrincipalPolicyCount: snapshot.clearedPrincipalPolicyCount,
    clearedSyncCursorCount: snapshot.clearedSyncCursorCount,
    queuedAttachmentUploadCount: plans.attachmentUploads.length,
    queuedContainerCreateCount,
    queuedDocumentUpdateCount: plans.documentUpdates.length,
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
