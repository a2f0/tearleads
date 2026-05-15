import type { SyncWatermark } from "@tearleads/validators/response";
import { createPendingUpdateFields } from "../../data/documentSync";
import type { ContainerRecord } from "../../data/persistence/containers/containerPersistence";
import {
  containerParentSyncLane,
  sqlContainerSyncWatermarkPersistence,
} from "../../data/persistence/containers/containerSyncWatermarkPersistence";
import type {
  ContainerCreateIntentRecord,
  ExplorerPersistence,
  StoredExplorerContainer,
} from "../../data/persistence/explorer/explorerPersistence";
import type {
  DocumentRecord,
  PendingUpdateRecord,
} from "../../data/sqlite/documentPersistence";
import type { ExecSql } from "../../data/sqlite/sqlSchema";
import {
  type ExplorerWorkflowSqlRuntime,
  getExplorerWorkflowRuntimeExecSql,
} from "./runtime";

export type { ContainerRecord } from "../../data/persistence/containers/containerPersistence";
export type {
  ContainerCreateIntentRecord,
  ExplorerPersistence,
  StoredExplorerContainer,
} from "../../data/persistence/explorer/explorerPersistence";
export { sqlExplorerPersistence as defaultExplorerPersistence } from "../../data/persistence/explorer/explorerPersistence";
export type { DocumentRecord as ExplorerDocumentRecord } from "../../data/sqlite/documentPersistence";

interface ExplorerContainerCreateIntentSyncInput {
  containerId: string;
  remoteContainerId: string;
  remoteMetadataAccessStateHash: string;
  remoteMetadataDocumentId: string;
}

type ContainerSyncWatermarkLane = ReturnType<typeof containerParentSyncLane>;

type ExplorerContainerPersistenceRuntime = ExplorerWorkflowSqlRuntime;

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
    localUpdatedAt?: string;
    serverTimestamps?:
      | {
          createdAt?: string | null;
          updatedAt?: string | null;
        }
      | undefined;
    updatedAt?: string;
  },
): Promise<ContainerRecord> {
  return persistence.saveContainer(execSql, container, record, options);
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
): Promise<PendingUpdateRecord[]> {
  return persistence.listPendingUpdates(execSql, containerId);
}

export async function enqueuePendingExplorerContainerUpdate(
  execSql: ExecSql,
  persistence: ExplorerPersistence,
  params: {
    containerId: string;
    sourceVersionVector?: string | null | undefined;
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

export function enqueuePendingExplorerContainerUpdateFromRuntime(input: {
  containerId: string;
  persistence: ExplorerPersistence;
  runtime: ExplorerContainerPersistenceRuntime;
  sourceVersionVector?: string | null | undefined;
  update: Uint8Array;
}): Promise<void> {
  const execSql = getExplorerWorkflowRuntimeExecSql(input.runtime);
  return enqueuePendingExplorerContainerUpdate(execSql, input.persistence, {
    containerId: input.containerId,
    sourceVersionVector: input.sourceVersionVector,
    update: input.update,
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

export function createExplorerContainerParentSyncLane(
  parentId: string | null,
): ContainerSyncWatermarkLane {
  return containerParentSyncLane(parentId);
}

export async function loadContainerParentSyncWatermark(
  execSql: ExecSql,
  syncLane: ContainerSyncWatermarkLane,
): Promise<SyncWatermark | null> {
  return sqlContainerSyncWatermarkPersistence.loadWatermark(execSql, syncLane);
}

export async function saveContainerParentSyncWatermark(
  execSql: ExecSql,
  syncLane: ContainerSyncWatermarkLane,
  watermark: SyncWatermark,
): Promise<void> {
  await sqlContainerSyncWatermarkPersistence.saveWatermark(
    execSql,
    syncLane,
    watermark,
  );
}
