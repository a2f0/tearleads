import { bytesToBase64 } from "@tearleads/encoding";
import { getUpdateVersionVectors } from "@tearleads/loro";
import type { ContainerRecord } from "../../data/persistence/containers/containerPersistence";
import {
  type containerParentSyncLane,
  sqlContainerSyncWatermarkPersistence,
} from "../../data/persistence/containers/containerSyncWatermarkPersistence";
import type {
  ContainerCreateIntentRecord,
  ExplorerPersistence,
  StoredExplorerContainer,
} from "../../data/persistence/explorer/explorerPersistence";
import type {
  DocumentRecord,
  PendingUpdateFields,
} from "../../data/sqlite/documentPersistence";
import type { ExecSql } from "../../data/sqlite/sqlSchema";

interface ExplorerContainerCreateIntentSyncInput {
  containerId: string;
  remoteContainerId: string;
  remoteMetadataAccessStateHash: string;
  remoteMetadataDocumentId: string;
}

type ContainerSyncWatermarkLane = ReturnType<typeof containerParentSyncLane>;

function createPendingUpdateFields(
  update: Uint8Array,
  sourceVersionVector?: string | null,
): PendingUpdateFields | null {
  if (update.byteLength === 0) {
    return null;
  }

  const { partialEndVersionVector, partialStartVersionVector } =
    getUpdateVersionVectors(update);

  return {
    updateData: bytesToBase64(update),
    partialStartVersionVector,
    partialEndVersionVector,
    sourceVersionVector: sourceVersionVector ?? null,
  };
}

export async function initializeExplorerSchema(
  execSql: ExecSql,
  persistence: ExplorerPersistence,
): Promise<void> {
  await persistence.ensureSchema(execSql);
}

export async function loadStoredExplorerContainers(
  execSql: ExecSql,
  persistence: ExplorerPersistence,
): Promise<ReadonlyArray<StoredExplorerContainer>> {
  return persistence.loadContainers(execSql);
}

export async function saveExplorerContainer(
  execSql: ExecSql,
  persistence: ExplorerPersistence,
  container: ContainerRecord,
  record: DocumentRecord | null,
  options?: {
    createIntent?: { parentContainerId: string };
  },
): Promise<void> {
  await persistence.saveContainer(execSql, container, record, options);
}

export async function deleteExplorerContainers(
  execSql: ExecSql,
  persistence: ExplorerPersistence,
  containerIds: ReadonlyArray<string>,
  options?: { updatedAt?: string },
): Promise<void> {
  await persistence.deleteContainers(execSql, containerIds, options);
}

export async function deleteSingleExplorerContainer(
  execSql: ExecSql,
  persistence: ExplorerPersistence,
  containerId: string,
  options?: { updatedAt?: string },
): Promise<void> {
  await persistence.deleteContainer(execSql, containerId, options);
}

export async function listPendingExplorerContainerUpdates(
  execSql: ExecSql,
  persistence: ExplorerPersistence,
  containerId: string,
) {
  return persistence.listPendingUpdates(execSql, containerId);
}

export async function enqueuePendingExplorerContainerUpdate(
  execSql: ExecSql,
  persistence: ExplorerPersistence,
  params: {
    containerId: string;
    sourceVersionVector?: string | null;
    update: Uint8Array;
  },
): Promise<void> {
  const pendingUpdateFields = createPendingUpdateFields(
    params.update,
    params.sourceVersionVector,
  );
  if (!pendingUpdateFields) {
    return;
  }

  await persistence.enqueuePendingUpdate(execSql, {
    containerId: params.containerId,
    ...pendingUpdateFields,
  });
}

export async function listPendingExplorerContainerCreateIntents(
  execSql: ExecSql,
  persistence: ExplorerPersistence,
): Promise<ContainerCreateIntentRecord[]> {
  return persistence.listPendingCreateIntents(execSql);
}

export async function markExplorerContainerCreateIntentSynced(
  execSql: ExecSql,
  persistence: ExplorerPersistence,
  input: ExplorerContainerCreateIntentSyncInput,
): Promise<void> {
  await persistence.markCreateIntentSynced(execSql, input);
}

export async function recordExplorerContainerCreateIntentError(
  execSql: ExecSql,
  persistence: ExplorerPersistence,
  containerId: string,
  message: string,
): Promise<void> {
  await persistence.recordCreateIntentError(execSql, containerId, message);
}

export async function loadContainerParentSyncWatermark(
  execSql: ExecSql,
  syncLane: ContainerSyncWatermarkLane,
) {
  return sqlContainerSyncWatermarkPersistence.loadWatermark(execSql, syncLane);
}

export async function saveContainerParentSyncWatermark(
  execSql: ExecSql,
  syncLane: ContainerSyncWatermarkLane,
  watermark: { id: string; updatedAt: string },
): Promise<void> {
  await sqlContainerSyncWatermarkPersistence.saveWatermark(
    execSql,
    syncLane,
    watermark,
  );
}
