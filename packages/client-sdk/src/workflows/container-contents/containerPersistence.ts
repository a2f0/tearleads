import { createPendingUpdateFields } from "../../data/documents/documentSync";
import type { ContainerContentsPersistence } from "../../data/persistence/container-contents/containerContentsPersistence";
import {
  type ContainerSyncWatermarkLane,
  containerContentsSyncLane,
  containerParentSyncLane,
} from "../../data/persistence/container-contents/containerSyncWatermarkPersistence";
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
export type { ContainerRecord } from "../../data/persistence/container-contents/containerPersistence";
export {
  type ContainerSyncWatermarkLane,
  ContainerSyncWatermarkRepository,
} from "../../data/persistence/container-contents/containerSyncWatermarkPersistence";
export type { ExecSql } from "../../data/sqlite/sqlSchema";

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
): ContainerSyncWatermarkLane {
  return containerParentSyncLane(parentId);
}

export function createContainerContentsSyncLane(
  containerId: string,
): ContainerSyncWatermarkLane {
  return containerContentsSyncLane(containerId);
}
