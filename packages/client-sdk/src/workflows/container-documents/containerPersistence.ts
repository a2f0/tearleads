import type { SyncWatermark } from "@tearleads/validators/response";
import { createPendingUpdateFields } from "../../data/documentSync";
import type {
  ContainerCreateIntentRecord,
  ContainerDocumentsPersistence,
  LocalRootDescendantReparentInput,
  StoredContainerState,
} from "../../data/persistence/container-documents/containerDocumentsPersistence";
import type { ContainerRecord } from "../../data/persistence/containers/containerPersistence";
import {
  type ContainerSyncWatermarkLane,
  containerDocumentsSyncLane,
  containerParentSyncLane,
  sqlContainerSyncWatermarkPersistence,
} from "../../data/persistence/containers/containerSyncWatermarkPersistence";
import type {
  DocumentRecord,
  PendingUpdateRecord,
} from "../../data/sqlite/documentPersistence";
import type { ExecSql } from "../../data/sqlite/sqlSchema";
import {
  type ContainerDocumentsWorkflowSqlRuntime,
  getContainerDocumentsWorkflowRuntimeExecSql,
} from "./runtime";

export type {
  ContainerCreateIntentRecord,
  ContainerDocumentsPersistence,
  LocalRootDescendantReparentInput,
  StoredContainerState,
} from "../../data/persistence/container-documents/containerDocumentsPersistence";
export { sqlContainerDocumentsPersistence as defaultContainerDocumentsPersistence } from "../../data/persistence/container-documents/containerDocumentsPersistence";
export type { ContainerRecord } from "../../data/persistence/containers/containerPersistence";
export type { ContainerSyncWatermarkLane } from "../../data/persistence/containers/containerSyncWatermarkPersistence";
export type { DocumentRecord as ContainerDocumentRecord } from "../../data/sqlite/documentPersistence";

interface ContainerCreateIntentSyncInput {
  containerId: string;
  remoteContainerId: string;
  remoteMetadataAccessStateHash: string;
  remoteMetadataDocumentId: string;
}

type ContainerPersistenceRuntime = ContainerDocumentsWorkflowSqlRuntime;

export async function initializeContainerDocumentsSchema(
  execSql: ExecSql,
  persistence: ContainerDocumentsPersistence,
): Promise<void> {
  await persistence.ensureSchema(execSql);
}

export async function loadStoredContainerStates(
  execSql: ExecSql,
  persistence: ContainerDocumentsPersistence,
): Promise<ReadonlyArray<StoredContainerState>> {
  return persistence.loadContainers(execSql);
}

export async function saveContainer(
  execSql: ExecSql,
  persistence: ContainerDocumentsPersistence,
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

export async function deleteContainers(
  execSql: ExecSql,
  persistence: ContainerDocumentsPersistence,
  containerIds: ReadonlyArray<string>,
  options?: { updatedAt?: string },
): Promise<void> {
  await persistence.deleteContainers(execSql, containerIds, options);
}

export async function deleteSingleContainer(
  execSql: ExecSql,
  persistence: ContainerDocumentsPersistence,
  containerId: string,
  options?: { updatedAt?: string },
): Promise<void> {
  await persistence.deleteContainer(execSql, containerId, options);
}

export async function listPendingContainerUpdates(
  execSql: ExecSql,
  persistence: ContainerDocumentsPersistence,
  containerId: string,
): Promise<PendingUpdateRecord[]> {
  return persistence.listPendingUpdates(execSql, containerId);
}

export async function enqueuePendingContainerUpdate(
  execSql: ExecSql,
  persistence: ContainerDocumentsPersistence,
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

export function enqueuePendingContainerUpdateFromRuntime(input: {
  containerId: string;
  persistence: ContainerDocumentsPersistence;
  runtime: ContainerPersistenceRuntime;
  sourceVersionVector?: string | null | undefined;
  update: Uint8Array;
}): Promise<void> {
  const execSql = getContainerDocumentsWorkflowRuntimeExecSql(input.runtime);
  return enqueuePendingContainerUpdate(execSql, input.persistence, {
    containerId: input.containerId,
    sourceVersionVector: input.sourceVersionVector,
    update: input.update,
  });
}

export async function listPendingContainerCreateIntents(
  execSql: ExecSql,
  persistence: ContainerDocumentsPersistence,
): Promise<ContainerCreateIntentRecord[]> {
  return persistence.listPendingCreateIntents(execSql);
}

export async function markContainerCreateIntentSynced(
  execSql: ExecSql,
  persistence: ContainerDocumentsPersistence,
  input: ContainerCreateIntentSyncInput,
): Promise<void> {
  await persistence.markCreateIntentSynced(execSql, input);
}

export async function recordContainerCreateIntentError(
  execSql: ExecSql,
  persistence: ContainerDocumentsPersistence,
  containerId: string,
  message: string,
): Promise<void> {
  await persistence.recordCreateIntentError(execSql, containerId, message);
}

export async function reassignContainerDocuments(
  execSql: ExecSql,
  persistence: ContainerDocumentsPersistence,
  input: {
    fromContainerId: string;
    toContainerId: string;
    updatedAt?: string | undefined;
  },
): Promise<void> {
  await persistence.reassignContainerDocuments(execSql, input);
}

export async function reconcileLocalRootContainer(
  execSql: ExecSql,
  persistence: ContainerDocumentsPersistence,
  input: {
    descendantReparents: ReadonlyArray<LocalRootDescendantReparentInput>;
    localRootContainerId: string;
    remoteOrganizationId: string;
    remoteRootContainerId: string;
    updatedAt?: string | undefined;
  },
): Promise<void> {
  await persistence.reconcileLocalRootContainer(execSql, input);
}

export function createContainerParentSyncLane(
  parentId: string | null,
): ContainerSyncWatermarkLane {
  return containerParentSyncLane(parentId);
}

export function createContainerDocumentsSyncLane(
  containerId: string,
): ContainerSyncWatermarkLane {
  return containerDocumentsSyncLane(containerId);
}

export async function loadContainerSyncWatermark(
  execSql: ExecSql,
  syncLane: ContainerSyncWatermarkLane,
): Promise<SyncWatermark | null> {
  return sqlContainerSyncWatermarkPersistence.loadWatermark(execSql, syncLane);
}

export async function saveContainerSyncWatermark(
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

export async function loadContainerParentSyncWatermark(
  execSql: ExecSql,
  syncLane: ContainerSyncWatermarkLane,
): Promise<SyncWatermark | null> {
  return loadContainerSyncWatermark(execSql, syncLane);
}

export async function saveContainerParentSyncWatermark(
  execSql: ExecSql,
  syncLane: ContainerSyncWatermarkLane,
  watermark: SyncWatermark,
): Promise<void> {
  await saveContainerSyncWatermark(execSql, syncLane, watermark);
}
