import { eq } from "drizzle-orm";
import {
  organizationReadModelDirectoryUsers,
  organizationReadModelState,
} from "../../data/sqlite/organizationReadModelSchema";
import {
  containerCreateIntents,
  containerMoveIntents,
  containerSyncLaneChecks,
  containerSyncWatermarks,
  containers,
  documentContainerProjection,
  documentMoveIntents,
  documentProjection,
  documents,
  dormantContainerMetadata,
} from "../../data/sqlite/schema";
import type { ClientSQLiteTransactionScope } from "../../data/sqlite/sqlitePersistenceRuntime";
import { isRemoteResetSyncCursor } from "./remoteResetCursorScope";
import type { ResetDocumentScope } from "./remoteResetPlans";
import {
  loadRemoteResetPrincipalScope,
  type RemoteResetPrincipalKey,
} from "./remoteResetPrincipalScope";

export type { RemoteResetPrincipalKey } from "./remoteResetPrincipalScope";

export interface RemoteResetReplacement {
  readonly organizationId: string;
  readonly rootContainerId: string;
}

export interface RemoteResetInput {
  readonly organizationId: string;
  readonly replacement?: RemoteResetReplacement | undefined;
}

export interface ResetContainerRow {
  readonly id: string;
  readonly parentId: string | null;
}

export interface ResetDocumentRow extends ResetDocumentScope {
  readonly documentId: string | null;
  readonly recoveryDocumentId: string | null;
}

export interface RemoteSyncStateSnapshot {
  readonly clearedContainerCreateIntentCount: number;
  readonly clearedContainerMoveIntentCount: number;
  readonly clearedDocumentMoveIntentCount: number;
  readonly clearedPrincipalPolicyCount: number;
  readonly clearedSyncCursorCount: number;
  readonly containerIds: readonly string[];
  readonly containerRows: readonly ResetContainerRow[];
  readonly documentLocalIds: readonly string[];
  readonly documentRows: readonly ResetDocumentRow[];
  readonly oldDocumentIds: readonly string[];
  readonly principalKeys: readonly RemoteResetPrincipalKey[];
}

function principalKeyOfRow(row: {
  readonly principalId: string;
  readonly principalType: string;
}): string {
  return `${row.principalType}\0${row.principalId}`;
}

function scopeKey(scope: ResetDocumentScope): string {
  return `${scope.appKind}\0${scope.localId}`;
}

async function loadContainerScope(
  tx: ClientSQLiteTransactionScope,
  organizationId: string,
): Promise<{
  containerIds: string[];
  containerRows: ResetContainerRow[];
}> {
  const liveContainerRows = (
    await tx
      .select({ id: containers.id, parentId: containers.parentId })
      .from(containers)
      .where(eq(containers.organizationId, organizationId))
  ).flatMap((row) => (row.id ? [{ id: row.id, parentId: row.parentId }] : []));
  const dormantContainerRows = await tx
    .select({ id: dormantContainerMetadata.containerId })
    .from(dormantContainerMetadata)
    .where(eq(dormantContainerMetadata.organizationId, organizationId));
  const containerRows = liveContainerRows;
  return {
    containerIds: [
      ...new Set([
        ...containerRows.map((row) => row.id),
        ...dormantContainerRows.map((row) => row.id),
      ]),
    ],
    containerRows,
  };
}

async function loadDocumentScope(input: {
  containerIds: readonly string[];
  organizationId: string;
  tx: ClientSQLiteTransactionScope;
}): Promise<{
  documentLocalIds: string[];
  documentRows: ResetDocumentRow[];
  oldDocumentIds: string[];
}> {
  const { organizationId, tx } = input;
  const containerIdSet = new Set(input.containerIds);
  const [allDocuments, projectionRows, linkRows, stateRows, directoryRows] =
    await loadDocumentAssociationRows(tx, organizationId);
  const linkedDocumentIds = new Set(
    linkRows
      .filter((row) => containerIdSet.has(row.containerId))
      .map((row) => row.documentId),
  );
  const profileDocumentIds = new Set(
    [...stateRows, ...directoryRows].flatMap((row) =>
      row.profileDocumentId ? [row.profileDocumentId] : [],
    ),
  );
  const projectedLocalIds = new Set(
    projectionRows
      .filter(
        (row) =>
          (row.containerId !== null && containerIdSet.has(row.containerId)) ||
          row.organizationId === organizationId ||
          (row.documentId !== null && linkedDocumentIds.has(row.documentId)),
      )
      .flatMap((row) => (row.localId ? [row.localId] : [])),
  );
  const documentRows = allDocuments.filter(
    (row) =>
      (row.appKind === "container-metadata" &&
        containerIdSet.has(row.localId)) ||
      (row.appKind === "documents" && projectedLocalIds.has(row.localId)) ||
      (row.documentId !== null &&
        (linkedDocumentIds.has(row.documentId) ||
          profileDocumentIds.has(row.documentId))),
  );
  return {
    documentLocalIds: [
      ...new Set(
        documentRows
          .filter((row) => row.appKind === "documents")
          .map((row) => row.localId),
      ),
    ],
    documentRows,
    oldDocumentIds: [
      ...new Set(
        documentRows.flatMap((row) => (row.documentId ? [row.documentId] : [])),
      ),
    ],
  };
}

function loadDocumentAssociationRows(
  tx: ClientSQLiteTransactionScope,
  organizationId: string,
) {
  return Promise.all([
    tx
      .select({
        appKind: documents.appKind,
        documentId: documents.documentId,
        localId: documents.localId,
        recoveryDocumentId: documents.recoveryDocumentId,
      })
      .from(documents),
    tx.select().from(documentProjection),
    tx.select().from(documentContainerProjection),
    tx
      .select({
        profileDocumentId: organizationReadModelState.profileDocumentId,
      })
      .from(organizationReadModelState)
      .where(eq(organizationReadModelState.organizationId, organizationId)),
    tx
      .select({
        profileDocumentId:
          organizationReadModelDirectoryUsers.profileDocumentId,
      })
      .from(organizationReadModelDirectoryUsers)
      .where(
        eq(organizationReadModelDirectoryUsers.organizationId, organizationId),
      ),
  ]);
}

async function loadSnapshotCounts(input: {
  containerIds: readonly string[];
  documentRows: readonly ResetDocumentRow[];
  organizationId: string;
  tx: ClientSQLiteTransactionScope;
}) {
  const { organizationId, tx } = input;
  const containerIdSet = new Set(input.containerIds);
  const documentScopeKeys = new Set(input.documentRows.map(scopeKey));
  const [principalScope, createRows, moveRows, docMoves] = await Promise.all([
    loadRemoteResetPrincipalScope(tx, organizationId),
    tx.select().from(containerCreateIntents),
    tx.select().from(containerMoveIntents),
    tx.select().from(documentMoveIntents),
  ]);
  const principalKeys = principalScope.principalKeys;
  const principalKeySet = new Set(principalKeys.map(principalKeyOfRow));
  const scopedContainerIds = new Set(input.containerIds);
  const [watermarks, laneChecks] = await Promise.all([
    tx.select().from(containerSyncWatermarks),
    tx.select().from(containerSyncLaneChecks),
  ]);

  return {
    clearedContainerCreateIntentCount: createRows.filter((row) =>
      containerIdSet.has(row.containerId),
    ).length,
    clearedContainerMoveIntentCount: moveRows.filter((row) =>
      containerIdSet.has(row.containerId),
    ).length,
    clearedDocumentMoveIntentCount: docMoves.filter((row) =>
      documentScopeKeys.has(
        scopeKey({ appKind: "documents", localId: row.localId }),
      ),
    ).length,
    clearedPrincipalPolicyCount: principalScope.policyRows.filter((row) =>
      principalKeySet.has(`${row.type}\0${row.id}`),
    ).length,
    clearedSyncCursorCount:
      watermarks.filter((row) =>
        isRemoteResetSyncCursor({
          containerIds: scopedContainerIds,
          row,
        }),
      ).length +
      laneChecks.filter((row) =>
        isRemoteResetSyncCursor({
          containerIds: scopedContainerIds,
          row,
        }),
      ).length,
    principalKeys,
  };
}

export async function readRemoteSyncStateSnapshot(
  tx: ClientSQLiteTransactionScope,
  organizationId: string,
): Promise<RemoteSyncStateSnapshot> {
  const containerScope = await loadContainerScope(tx, organizationId);
  const documentScope = await loadDocumentScope({
    containerIds: containerScope.containerIds,
    organizationId,
    tx,
  });
  const counts = await loadSnapshotCounts({
    containerIds: containerScope.containerIds,
    documentRows: documentScope.documentRows,
    organizationId,
    tx,
  });
  return { ...containerScope, ...documentScope, ...counts };
}
