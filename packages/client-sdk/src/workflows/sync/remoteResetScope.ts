import {
  loadRemoteResetPrincipalScope,
  type RemoteResetPrincipalKey,
} from "../../data/persistence/principalPolicy/principalPolicyRemoteReset";
import type { ClientSQLiteTransactionScope } from "../../data/sqlite/sqlitePersistenceRuntime";
import {
  countContainerResetIntents,
  countRemoteResetSyncCursors,
  listDocumentPlacementRows,
  loadContainerResetScope,
  type ResetContainerRow,
} from "../container-contents/remoteReset/containerRemoteReset";
import {
  loadDocumentResetScope,
  type ResetDocumentRow,
} from "../documents/remoteReset/documentRemoteReset";

export interface RemoteResetReplacement {
  readonly organizationId: string;
  readonly rootContainerId: string;
}

export interface RemoteResetInput {
  readonly organizationId: string;
  readonly replacement?: RemoteResetReplacement | undefined;
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

/**
 * Reads what a reset of the organization covers, from each subsystem that owns
 * part of it: folders, then the documents in them, then principal policies.
 */
export async function readRemoteSyncStateSnapshot(
  tx: ClientSQLiteTransactionScope,
  organizationId: string,
): Promise<RemoteSyncStateSnapshot> {
  const containerScope = await loadContainerResetScope(tx, organizationId);
  const documentScope = await loadDocumentResetScope({
    containerIds: containerScope.containerIds,
    organizationId,
    placementRows: await listDocumentPlacementRows(tx),
    tx,
  });
  const principalScope = await loadRemoteResetPrincipalScope(
    tx,
    organizationId,
  );
  const intentCounts = await countContainerResetIntents({
    containerIds: containerScope.containerIds,
    documentLocalIds: documentScope.documentLocalIds,
    tx,
  });
  const principalKeys = principalScope.principalKeys;
  const principalKeySet = new Set(principalKeys.map(principalKeyOfRow));
  return {
    ...containerScope,
    ...documentScope,
    ...intentCounts,
    clearedPrincipalPolicyCount: principalScope.policyRows.filter((row) =>
      principalKeySet.has(`${row.type}\0${row.id}`),
    ).length,
    clearedSyncCursorCount: await countRemoteResetSyncCursors({
      containerIds: containerScope.containerIds,
      tx,
    }),
    principalKeys,
  };
}
