import type { ContainerSyncTombstone } from "@tearleads/validators/response";
import type { ContainerChildIndex } from "./types";

interface RemovedContainerCollection {
  /**
   * Applicable `deleted` tombstones for containers with no local state —
   * typically a container revoked earlier (its rows already cascaded, its
   * metadata retained dormant) and now deleted server-side. They cannot
   * cascade locally, but their dormant metadata must still be purged.
   */
  purgeMetadataContainerIds: string[];
  reasonByContainerId: ReadonlyMap<string, ContainerSyncTombstone["reason"]>;
  removedContainerIds: string[];
}

/**
 * Collect the containers a tombstone page removes — each applicable tombstone
 * root plus its local descendants — and the tombstone reason governing each.
 * A container's own tombstone reason wins over an inherited one, and
 * "deleted" wins over "access_revoked" when two roots reach the same
 * container: a deleted container's local state is moot regardless of any
 * revocation path that also covers it.
 */
export function collectRemovedContainers(input: {
  childIdsByParentId: ContainerChildIndex;
  containersById: ReadonlyMap<string, unknown>;
  preservedContainerIds: ReadonlySet<string>;
  tombstones: ReadonlyArray<ContainerSyncTombstone>;
}): RemovedContainerCollection {
  const {
    childIdsByParentId,
    containersById,
    preservedContainerIds,
    tombstones,
  } = input;
  const reasonByContainerId = new Map<
    string,
    ContainerSyncTombstone["reason"]
  >();
  const ownReasonContainerIds = new Set<string>();
  const removedContainerIds = new Set<string>();
  const pendingContainerIds: string[] = [];

  const assignReason = (
    containerId: string,
    reason: ContainerSyncTombstone["reason"],
    isOwn: boolean,
  ): boolean => {
    if (!isOwn && ownReasonContainerIds.has(containerId)) {
      return false;
    }
    if (isOwn) {
      ownReasonContainerIds.add(containerId);
      const changed = reasonByContainerId.get(containerId) !== reason;
      reasonByContainerId.set(containerId, reason);
      return changed;
    }
    const current = reasonByContainerId.get(containerId);
    if (!current || (current === "access_revoked" && reason === "deleted")) {
      reasonByContainerId.set(containerId, reason);
      return current !== reason;
    }
    return false;
  };

  for (const tombstone of tombstones) {
    assignReason(tombstone.containerId, tombstone.reason, true);
    if (!preservedContainerIds.has(tombstone.containerId)) {
      pendingContainerIds.push(tombstone.containerId);
    }
  }

  while (pendingContainerIds.length > 0) {
    const containerId = pendingContainerIds.pop();
    if (!containerId || removedContainerIds.has(containerId)) {
      continue;
    }

    removedContainerIds.add(containerId);
    const inheritedReason = reasonByContainerId.get(containerId) ?? "deleted";
    for (const childId of childIdsByParentId.get(containerId) ?? []) {
      if (preservedContainerIds.has(childId)) {
        continue;
      }
      // Assign before the visited check so a second root reaching an
      // already-visited child can still upgrade access_revoked to deleted —
      // and requeue the child on an upgrade so its own descendants re-inherit
      // the stronger reason. Upgrades are one-way, so this terminates.
      const upgraded = assignReason(childId, inheritedReason, false);
      if (!removedContainerIds.has(childId)) {
        pendingContainerIds.push(childId);
      } else if (upgraded) {
        removedContainerIds.delete(childId);
        pendingContainerIds.push(childId);
      }
    }
  }

  return {
    purgeMetadataContainerIds: Array.from(reasonByContainerId.entries())
      .filter(
        ([containerId, reason]) =>
          reason === "deleted" &&
          !containersById.has(containerId) &&
          !preservedContainerIds.has(containerId),
      )
      .map(([containerId]) => containerId),
    reasonByContainerId,
    removedContainerIds: Array.from(removedContainerIds).filter((containerId) =>
      containersById.has(containerId),
    ),
  };
}
