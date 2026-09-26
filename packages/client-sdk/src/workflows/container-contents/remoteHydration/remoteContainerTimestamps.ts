import type { ContainerRecord } from "../containerPersistence";
import type { RemoteContainer, SaveContainerOptions } from "./types";

export function applyRemoteContainerTimestamps(
  container: ContainerRecord,
  remoteContainer: RemoteContainer,
): ContainerRecord {
  return {
    ...container,
    createdAt: remoteContainer.createdAt,
    effectiveAccessLevel: remoteContainer.effectiveAccessLevel,
    serverCreatedAt: remoteContainer.createdAt,
    serverUpdatedAt: remoteContainer.updatedAt,
    updatedAt: remoteContainer.updatedAt,
  };
}

export function remoteContainerHydrationSaveOptions(input: {
  localUpdatedAt?: string | null | undefined;
  remoteContainer: RemoteContainer;
}): NonNullable<SaveContainerOptions> {
  return {
    localUpdatedAt: input.localUpdatedAt ?? input.remoteContainer.updatedAt,
    serverTimestamps: {
      createdAt: input.remoteContainer.createdAt,
      updatedAt: input.remoteContainer.updatedAt,
    },
  };
}

export function resolveRemoteContainerHydrationLocalUpdatedAt(input: {
  containerIdsWithPendingMetadataUpdates: ReadonlySet<string>;
  hasPendingStructuralIntent: boolean;
  previousLocalUpdatedAt: string | null | undefined;
  remoteContainer: RemoteContainer;
}): string {
  const {
    containerIdsWithPendingMetadataUpdates,
    hasPendingStructuralIntent,
    previousLocalUpdatedAt,
    remoteContainer,
  } = input;
  if (
    !previousLocalUpdatedAt ||
    previousLocalUpdatedAt.localeCompare(remoteContainer.updatedAt) <= 0
  ) {
    return remoteContainer.updatedAt;
  }

  return containerIdsWithPendingMetadataUpdates.has(remoteContainer.id) ||
    hasPendingStructuralIntent
    ? previousLocalUpdatedAt
    : remoteContainer.updatedAt;
}
