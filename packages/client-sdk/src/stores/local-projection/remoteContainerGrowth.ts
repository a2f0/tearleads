import {
  isReconcilableContainerNode,
  isRemoteBackedContainerNode,
} from "../container-contents";
import type { LocalProjectionSnapshot } from "./types";

/**
 * Whether the tree gained a container the reconciler can list: a new
 * reconcilable one, or the active container becoming remote-backed. Compares
 * membership, not node objects, so metadata and sync-state churn cannot make
 * a reconciliation loop.
 */
export function hasRemoteBackedContainerMembershipGrowth(
  previous: LocalProjectionSnapshot["containers"],
  next: LocalProjectionSnapshot["containers"],
  homeOrganizationId: string | null,
  activeContainerId: string | null,
): boolean {
  const isRemoteReconcilable = (
    container: LocalProjectionSnapshot["containers"][number],
  ) => isReconcilableContainerNode(container, homeOrganizationId);
  const previousIds = new Set(
    previous.flatMap((container) =>
      isRemoteReconcilable(container) ? [container.id] : [],
    ),
  );
  if (
    next.some(
      (container) =>
        isRemoteReconcilable(container) && !previousIds.has(container.id),
    )
  ) {
    return true;
  }
  if (!activeContainerId) {
    return false;
  }
  const wasActiveRemoteBacked = previous.some(
    (container) =>
      container.id === activeContainerId &&
      isRemoteBackedContainerNode(container),
  );
  return (
    !wasActiveRemoteBacked &&
    next.some(
      (container) =>
        container.id === activeContainerId &&
        isRemoteBackedContainerNode(container),
    )
  );
}
