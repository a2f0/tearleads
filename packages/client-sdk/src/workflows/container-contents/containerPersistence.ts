import type { SyncWatermark } from "@tearleads/validators/response";
import { createPendingUpdateFields } from "../../data/documentSync";
import type { ContainerContentsPersistence } from "../../data/persistence/container-contents/containerContentsPersistence";
import {
  type ContainerSyncWatermarkLane,
  containerContentsSyncLane,
  containerParentSyncLane,
  sqlContainerSyncWatermarkPersistence,
} from "../../data/persistence/containers/containerSyncWatermarkPersistence";
import type { ExecSql } from "../../data/sqlite/sqlSchema";

export type {
  ContainerContentsPersistence,
  ContainerCreateIntentRecord,
  ContainerMoveIntentRecord,
  LocalRootDescendantReparentInput,
  StoredContainerState,
} from "../../data/persistence/container-contents/containerContentsPersistence";
export { sqlContainerContentsPersistence as defaultContainerContentsPersistence } from "../../data/persistence/container-contents/containerContentsPersistence";
export type { ContainerRecord } from "../../data/persistence/containers/containerPersistence";
export type { ContainerSyncWatermarkLane } from "../../data/persistence/containers/containerSyncWatermarkPersistence";
export type { DocumentRecord as ContainerDocumentRecord } from "../../data/sqlite/documentPersistence";

export async function enqueuePendingContainerUpdate(
  execSql: ExecSql,
  persistence: ContainerContentsPersistence,
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

export function createContainerParentSyncLane(
  parentId: string | null,
): ContainerSyncWatermarkLane {
  return containerParentSyncLane(parentId);
}

export function createContainerContentsSyncLane(
  containerId: string,
): ContainerSyncWatermarkLane {
  return containerContentsSyncLane(containerId);
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
