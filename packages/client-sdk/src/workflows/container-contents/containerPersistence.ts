import {
  type ContainerSyncWatermarkLane,
  containerContentsSyncLane,
  containerParentSyncLane,
} from "../../data/persistence/container-contents/containerSyncWatermarkPersistence";

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
export type { ContainerMetadataRevalidation } from "../../data/persistence/container-contents/containerMetadataRevalidations";
export type { ContainerRecord } from "../../data/persistence/container-contents/containerPersistence";
export {
  type ContainerSyncWatermarkLane,
  ContainerSyncWatermarkRepository,
} from "../../data/persistence/container-contents/containerSyncWatermarkPersistence";
export type { ExecSql } from "../../data/sqlite/sqlSchema";

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
