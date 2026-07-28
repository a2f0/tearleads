import type { ContainerSyncTombstone } from "@tearleads/validators/response";
import type { ContainerChildIndex } from "./types";

interface RemovedContainerCollection {
  /**
   * Containers the page tombstoned directly (not reached via cascade). A
   * tombstone names only committed containers, so membership here is proof
   * of remote existence — even when the local record still looks local-only
   * because a create response was lost.
   */
  ownTombstoneContainerIds: ReadonlySet<string>;
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
    ownTombstoneContainerIds: ownReasonContainerIds,
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

/**
 * The removed containers whose metadata survives the cascade: revoked AND
 * remotely committed. Remote existence is proven by a local remote metadata
 * document id OR by the container's own tombstone (the server only
 * tombstones committed containers, so a lost-response create still counts).
 * A genuinely local-only container can never be rediscovered by rehydration
 * — its create intent dies in the same cascade — so retaining its metadata
 * would strand it forever; it keeps the destroy path instead.
 */
export function selectRetainedMetadataContainerIds(input: {
  containersById: ReadonlyMap<
    string,
    { container: { metadataDocumentId: string | null } }
  >;
  ownTombstoneContainerIds: ReadonlySet<string>;
  reasonByContainerId: ReadonlyMap<string, ContainerSyncTombstone["reason"]>;
  removedContainerIds: ReadonlyArray<string>;
}): string[] {
  return input.removedContainerIds.filter(
    (containerId) =>
      input.reasonByContainerId.get(containerId) === "access_revoked" &&
      ((input.containersById.get(containerId)?.container.metadataDocumentId ??
        null) !== null ||
        input.ownTombstoneContainerIds.has(containerId)),
  );
}
