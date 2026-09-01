import type { SyncWatermark } from "@tearleads/validators/response";
import { createPendingUpdateFields } from "../../data/documents/documentSync";
import type { ContainerContentsPersistence } from "../../data/persistence/container-contents/containerContentsPersistence";
import {
  type ContainerSyncLaneCheckRecord,
  type ContainerSyncWatermarkLane,
  containerContentsSyncLane,
  containerParentSyncLane,
  sqlContainerSyncWatermarkPersistence,
} from "../../data/persistence/containers/containerSyncWatermarkPersistence";
import type { ExecSql } from "../../data/sqlite/sqlSchema";

export type {
  ContainerContentsPersistence,
  ContainerCreateIntentRecord,
  ContainerHydrationTombstone,
  ContainerMetadataRecord,
  ContainerMetadataRecord as ContainerDocumentRecord,
  ContainerMoveIntentRecord,
  LocalRootDescendantReparentInput,
  StoredContainerState,
} from "../../data/persistence/container-contents/containerContentsPersistence";
export { sqlContainerContentsPersistence as defaultContainerContentsPersistence } from "../../data/persistence/container-contents/containerContentsPersistence";
export type { ContainerRecord } from "../../data/persistence/containers/containerPersistence";
export type { ContainerSyncWatermarkLane } from "../../data/persistence/containers/containerSyncWatermarkPersistence";

export async function enqueuePendingContainerUpdate(
  execSql: ExecSql,
  persistence: ContainerContentsPersistence,
  params: {
    containerId: string;
    sourceVersionVector?: string | null | undefined;
    update: Uint8Array;
  },
): Promise<string | null> {
  const pendingUpdateFields = createPendingUpdateFields(
    params.update,
    params.sourceVersionVector,
  );
  if (!pendingUpdateFields) {
    return null;
  }

  return persistence.enqueuePendingUpdate(execSql, {
    containerId: params.containerId,
    ...pendingUpdateFields,
  });
}

export function createContainerParentSyncLane(
  parentId: string | null,
  organizationId?: string,
): ContainerSyncWatermarkLane {
  return containerParentSyncLane(parentId, organizationId);
}

export function createContainerContentsSyncLane(
  containerId: string,
  organizationId?: string,
): ContainerSyncWatermarkLane {
  return containerContentsSyncLane(containerId, organizationId);
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

export async function loadContainerSyncLaneCheckRecords(
  execSql: ExecSql,
  syncLanes: ReadonlyArray<ContainerSyncWatermarkLane>,
): Promise<Array<ContainerSyncLaneCheckRecord | null>> {
  return sqlContainerSyncWatermarkPersistence.loadCheckRecords(
    execSql,
    syncLanes,
  );
}

export async function markContainerSyncLaneChecked(
  execSql: ExecSql,
  syncLane: ContainerSyncWatermarkLane,
): Promise<void> {
  await sqlContainerSyncWatermarkPersistence.markChecked(execSql, syncLane);
}
