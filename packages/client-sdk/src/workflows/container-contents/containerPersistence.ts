import {
  type ContainerContentsPersistence,
  sqlContainerContentsPersistence as defaultContainerContentsPersistence,
} from "../../data/persistence/container-contents/containerContentsPersistence";
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
export type { ContainerMetadataRevalidation } from "../../data/persistence/container-contents/containerMetadataRevalidations";
export type { ContainerRecord } from "../../data/persistence/container-contents/containerPersistence";
export {
  type ContainerSyncWatermarkLane,
  ContainerSyncWatermarkRepository,
} from "../../data/persistence/container-contents/containerSyncWatermarkPersistence";
export type { ExecSql } from "../../data/sqlite/sqlSchema";
export { defaultContainerContentsPersistence };

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

export function resolveAtomicContainerSave(
  persistence: ContainerContentsPersistence,
): NonNullable<
  ContainerContentsPersistence["saveContainerWithPendingUpdate"]
> | null {
  const saveContainerWithPendingUpdate =
    persistence.saveContainerWithPendingUpdate;
  if (!saveContainerWithPendingUpdate) return null;
  const inheritedSqlAtomicSave =
    saveContainerWithPendingUpdate ===
      defaultContainerContentsPersistence.saveContainerWithPendingUpdate &&
    (persistence.saveContainer !==
      defaultContainerContentsPersistence.saveContainer ||
      persistence.enqueuePendingUpdate !==
        defaultContainerContentsPersistence.enqueuePendingUpdate);
  return inheritedSqlAtomicSave
    ? null
    : saveContainerWithPendingUpdate.bind(persistence);
}

export function requireAtomicContainerSave(
  persistence: ContainerContentsPersistence,
) {
  const save = resolveAtomicContainerSave(persistence);
  if (!save)
    throw new Error(
      "Container persistence must implement saveContainerWithPendingUpdate to repair pending metadata",
    );
  return save;
}
