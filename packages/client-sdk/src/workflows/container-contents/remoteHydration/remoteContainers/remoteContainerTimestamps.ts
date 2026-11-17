import type { ContainerRecord } from "../../containerPersistence";
import type { RemoteContainer, SaveContainerOptions } from "../types";

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

/** UTC server timestamp at microsecond precision, or null if malformed. */
function serverTimestampMicros(value: string): string | null {
  const match =
    /^(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2})(?:\.(\d{1,6}))?Z$/u.exec(value);
  return match ? `${match[1]}.${(match[2] ?? "").padEnd(6, "0")}` : null;
}

/**
 * Whether a listing shows the container changed since the server timestamp
 * this client last recorded for it. Listings carry 3 or 6 fractional digits and
 * mutation responses 3, so both are compared at microseconds. An unknown or
 * unreadable timestamp counts as changed.
 */
export function remoteContainerChangedSince(
  remoteContainer: RemoteContainer,
  recordedServerUpdatedAt: string | null | undefined,
): boolean {
  const listed = serverTimestampMicros(remoteContainer.updatedAt);
  const recorded =
    recordedServerUpdatedAt == null
      ? null
      : serverTimestampMicros(recordedServerUpdatedAt);
  return listed === null || recorded === null || listed > recorded;
}
