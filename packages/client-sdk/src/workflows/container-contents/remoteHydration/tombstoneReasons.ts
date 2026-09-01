import type { ContainerSyncTombstone } from "@tearleads/validators/response";
import type { ContainerChildIndex } from "./types";

interface RemovedContainerCollection {
  /** Absent revoked roots that still need a durable anti-resurrection fence. */
  fenceOnlyContainerIds: string[];
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
  removalByContainerId: ReadonlyMap<
    string,
    Pick<ContainerSyncTombstone, "reason" | "updatedAt">
  >;
  reasonByContainerId: ReadonlyMap<string, ContainerSyncTombstone["reason"]>;
  removedContainerIds: string[];
}

type ContainerRemoval = Pick<ContainerSyncTombstone, "reason" | "updatedAt">;

function shouldReplaceInheritedRemoval(
  current: ContainerRemoval | undefined,
  next: ContainerRemoval,
): boolean {
  return (
    !current ||
    (current.reason === "access_revoked" && next.reason === "deleted") ||
    (current.reason === next.reason && current.updatedAt < next.updatedAt)
  );
}

function assignContainerRemoval(input: {
  containerId: string;
  isOwn: boolean;
  ownReasonContainerIds: Set<string>;
  removal: ContainerRemoval;
  removalByContainerId: Map<string, ContainerRemoval>;
}): boolean {
  if (!input.isOwn && input.ownReasonContainerIds.has(input.containerId)) {
    return false;
  }
  const current = input.removalByContainerId.get(input.containerId);
  if (input.isOwn) {
    input.ownReasonContainerIds.add(input.containerId);
    const changed =
      current?.reason !== input.removal.reason ||
      current.updatedAt !== input.removal.updatedAt;
    input.removalByContainerId.set(input.containerId, input.removal);
    return changed;
  }
  if (!shouldReplaceInheritedRemoval(current, input.removal)) return false;
  input.removalByContainerId.set(input.containerId, input.removal);
  return true;
}

function collectCascadedContainerIds(input: {
  childIdsByParentId: ContainerChildIndex;
  ownReasonContainerIds: Set<string>;
  pendingContainerIds: string[];
  preservedContainerIds: ReadonlySet<string>;
  removalByContainerId: Map<string, ContainerRemoval>;
}): Set<string> {
  const removedContainerIds = new Set<string>();
  while (input.pendingContainerIds.length > 0) {
    const containerId = input.pendingContainerIds.pop();
    if (!containerId || removedContainerIds.has(containerId)) continue;

    removedContainerIds.add(containerId);
    const inheritedRemoval = input.removalByContainerId.get(containerId);
    if (!inheritedRemoval) continue;
    for (const childId of input.childIdsByParentId.get(containerId) ?? []) {
      if (input.preservedContainerIds.has(childId)) continue;
      // A second root can upgrade an already-visited child to deleted; requeue
      // it so its descendants inherit the stronger removal too.
      const upgraded = assignContainerRemoval({
        containerId: childId,
        isOwn: false,
        ownReasonContainerIds: input.ownReasonContainerIds,
        removal: inheritedRemoval,
        removalByContainerId: input.removalByContainerId,
      });
      if (!removedContainerIds.has(childId)) {
        input.pendingContainerIds.push(childId);
      } else if (upgraded) {
        removedContainerIds.delete(childId);
        input.pendingContainerIds.push(childId);
      }
    }
  }
  return removedContainerIds;
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
  const removalByContainerId = new Map<string, ContainerRemoval>();
  const ownReasonContainerIds = new Set<string>();
  const pendingContainerIds: string[] = [];

  for (const tombstone of tombstones) {
    assignContainerRemoval({
      containerId: tombstone.containerId,
      isOwn: true,
      ownReasonContainerIds,
      removal: { reason: tombstone.reason, updatedAt: tombstone.updatedAt },
      removalByContainerId,
    });
    if (!preservedContainerIds.has(tombstone.containerId)) {
      pendingContainerIds.push(tombstone.containerId);
    }
  }

  const removedContainerIds = collectCascadedContainerIds({
    childIdsByParentId,
    ownReasonContainerIds,
    pendingContainerIds,
    preservedContainerIds,
    removalByContainerId,
  });

  const reasonByContainerId = new Map(
    Array.from(removalByContainerId, ([containerId, removal]) => [
      containerId,
      removal.reason,
    ]),
  );
  return {
    fenceOnlyContainerIds: Array.from(reasonByContainerId.entries())
      .filter(
        ([containerId, reason]) =>
          reason === "access_revoked" &&
          !containersById.has(containerId) &&
          !preservedContainerIds.has(containerId),
      )
      .map(([containerId]) => containerId),
    ownTombstoneContainerIds: ownReasonContainerIds,
    purgeMetadataContainerIds: Array.from(reasonByContainerId.entries())
      .filter(
        ([containerId, reason]) =>
          reason === "deleted" &&
          !containersById.has(containerId) &&
          !preservedContainerIds.has(containerId),
      )
      .map(([containerId]) => containerId),
    removalByContainerId,
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
