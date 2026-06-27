import type {
  ContainerContentsContextValue,
  ContainerNode,
} from "@tearleads/client-sdk";
import type { ContainerSystemSlot } from "@tearleads/validators/containerSystemSlot";
import { useEffect, useState } from "react";
import {
  deriveUserSystemContainers,
  findUserSystemContainer,
  isUnderForeignSharedRoot,
  SHARED_VISIBLE_SYSTEM_CONTAINER_NAMES,
  USER_SYSTEM_CONTAINER_DEFINITIONS,
  type UserSystemContainer,
} from "../systemContainers";

const USER_SYSTEM_CONTAINER_NAMES = new Set(
  USER_SYSTEM_CONTAINER_DEFINITIONS.map((definition) => definition.name),
);

const SYSTEM_NODE_SYNC_STATUS_RANK = {
  synced: 3,
  pending: 2,
  error: 1,
  "local-only": 0,
} as const satisfies Record<ContainerNode["syncState"]["status"], number>;

function shouldShowExplorerSystemSlot(
  node: ContainerNode,
  visibleSystemSlots?: ReadonlySet<ContainerSystemSlot>,
  currentOrganizationId?: string | null,
): boolean {
  const systemSlot = node.systemSlot ?? null;
  if (!systemSlot) {
    return true;
  }

  if (visibleSystemSlots !== undefined && visibleSystemSlots.size > 0) {
    if (visibleSystemSlots.has(systemSlot)) {
      return true;
    }

    // A system folder under another user's shared root carries an opaque
    // per-owner HMAC slot that never matches the viewer's derived set, so it
    // is classified by name and kept only if it is shareable. The shared-root
    // test (a different, valid organization) is what distinguishes a legitimate
    // peer folder from a same-org spoof reusing a system name with a foreign
    // slot. A missing organizationId must not pass as "shared" — this gate
    // controls whether another user's system folder is shown.
    return (
      isUnderForeignSharedRoot({
        currentOrganizationId,
        organizationId: node.organizationId,
      }) && SHARED_VISIBLE_SYSTEM_CONTAINER_NAMES.has(node.name)
    );
  }

  return USER_SYSTEM_CONTAINER_NAMES.has(node.name);
}

function shouldPreferExplorerSystemNode(
  currentNode: ContainerNode,
  candidateNode: ContainerNode,
): boolean {
  const currentRank =
    SYSTEM_NODE_SYNC_STATUS_RANK[currentNode.syncState.status];
  const candidateRank =
    SYSTEM_NODE_SYNC_STATUS_RANK[candidateNode.syncState.status];
  if (candidateRank !== currentRank) {
    return candidateRank > currentRank;
  }

  const currentTime = currentNode.updatedAt ?? currentNode.createdAt ?? "";
  const candidateTime =
    candidateNode.updatedAt ?? candidateNode.createdAt ?? "";
  if (candidateTime !== currentTime) {
    return candidateTime > currentTime;
  }

  return candidateNode.id < currentNode.id;
}

export function getVisibleExplorerNodes(
  nodes: ContainerContentsContextValue["nodes"] | null | undefined,
  visibleSystemSlots?: ReadonlySet<ContainerSystemSlot>,
  currentOrganizationId?: string | null,
): ContainerContentsContextValue["nodes"] {
  const visibleNodes: ContainerNode[] = [];
  const systemSlotIndexes = new Map<ContainerSystemSlot, number>();

  for (const node of nodes ?? []) {
    const systemSlot = node.systemSlot ?? null;
    if (
      !shouldShowExplorerSystemSlot(
        node,
        visibleSystemSlots,
        currentOrganizationId,
      )
    ) {
      continue;
    }

    if (!systemSlot) {
      visibleNodes.push(node);
      continue;
    }

    const existingIndex = systemSlotIndexes.get(systemSlot);
    if (existingIndex === undefined) {
      systemSlotIndexes.set(systemSlot, visibleNodes.length);
      visibleNodes.push(node);
      continue;
    }

    const existingNode = visibleNodes[existingIndex];
    if (existingNode && shouldPreferExplorerSystemNode(existingNode, node)) {
      visibleNodes[existingIndex] = node;
    }
  }

  return visibleNodes;
}

export function findExplorerSystemNode(
  nodes: ReadonlyArray<ContainerNode> | null | undefined,
  systemSlot: ContainerSystemSlot | null,
): ContainerNode | null {
  if (!systemSlot || !nodes) {
    return null;
  }

  return nodes.find((node) => node.systemSlot === systemSlot) ?? null;
}

export function getExplorerSystemContainerId(
  nodes: ReadonlyArray<ContainerNode> | null | undefined,
  systemSlot: ContainerSystemSlot | null,
): string | null {
  return findExplorerSystemNode(nodes, systemSlot)?.id ?? null;
}

export function getExplorerTrashContainerId(
  nodes: ReadonlyArray<ContainerNode> | null | undefined,
  trashSystemSlot: ContainerSystemSlot | null,
): string | null {
  return getExplorerSystemContainerId(nodes, trashSystemSlot);
}

export function getExplorerTrashDeleteTargetId(
  nodes: ReadonlyArray<ContainerNode> | null | undefined,
  trashSystemSlot: ContainerSystemSlot | null,
): string | null {
  return getExplorerTrashContainerId(nodes, trashSystemSlot);
}

export function canResolveExplorerTrashContainer(
  trashSystemSlot: ContainerSystemSlot | null,
): boolean {
  return trashSystemSlot !== null;
}

// Whether `containerId` is the trash root itself or any descendant of it. The
// trash system slot only ever lands on the root trash node, so a document or
// folder nested in a user-created subfolder of trash is still "in trash" even
// though its immediate container id never equals `trashContainerId`. Walking
// `parentId` up to the root (guarding against a cyclic chain) is what lets the
// purge UI treat the whole trash subtree as purgeable, not just the root.
export function isExplorerContainerUnderTrash(
  nodes: ReadonlyArray<ContainerNode> | null | undefined,
  containerId: string | null,
  trashContainerId: string | null,
): boolean {
  if (!containerId || !trashContainerId || !nodes) {
    return false;
  }

  const nodesById = new Map(nodes.map((node) => [node.id, node]));
  const visited = new Set<string>();
  let currentId: string | null = containerId;
  while (currentId !== null) {
    if (currentId === trashContainerId) {
      return true;
    }
    if (visited.has(currentId)) {
      return false;
    }
    visited.add(currentId);
    currentId = nodesById.get(currentId)?.parentId ?? null;
  }

  return false;
}

function findExplorerSystemContainerSlot(
  systemContainers: ReadonlyArray<UserSystemContainer>,
  kind: UserSystemContainer["kind"],
): ContainerSystemSlot | null {
  return findUserSystemContainer(systemContainers, kind)?.systemSlot ?? null;
}

export function findContactsSystemContainerSlot(
  systemContainers: ReadonlyArray<UserSystemContainer>,
): ContainerSystemSlot | null {
  return findExplorerSystemContainerSlot(systemContainers, "contacts");
}

export function findTrashSystemContainerSlot(
  systemContainers: ReadonlyArray<UserSystemContainer>,
): ContainerSystemSlot | null {
  return findExplorerSystemContainerSlot(systemContainers, "trash");
}

export function getExplorerVisibleSystemSlots(
  systemContainers: ReadonlyArray<UserSystemContainer>,
): ReadonlySet<ContainerSystemSlot> {
  return new Set(
    systemContainers.map((systemContainer) => systemContainer.systemSlot),
  );
}

export function useExplorerSystemContainerSlots(input: {
  logError: (message: string | Error, cause?: unknown) => void;
  signingPrivateKey: Uint8Array | null;
}): ReadonlyArray<UserSystemContainer> {
  const [systemContainers, setSystemContainers] = useState<
    ReadonlyArray<UserSystemContainer>
  >([]);

  useEffect(() => {
    if (!input.signingPrivateKey) {
      setSystemContainers([]);
      return;
    }

    const signingPrivateKey = input.signingPrivateKey;
    let cancelled = false;
    void deriveUserSystemContainers(signingPrivateKey)
      .then((nextSystemContainers) => {
        if (!cancelled) {
          setSystemContainers(nextSystemContainers);
        }
      })
      .catch((error) => {
        if (!cancelled) {
          setSystemContainers([]);
          input.logError("Failed to derive explorer system slots", error);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [input.logError, input.signingPrivateKey]);

  return systemContainers;
}

export function canProvisionExplorerSystemContainers(input: {
  isAuthenticated: boolean;
  nodes: ReadonlyArray<ContainerNode> | null | undefined;
  organizationId: string | null;
  rootContainerId: string | null;
}): boolean {
  if (!input.isAuthenticated) {
    return true;
  }

  if (!input.organizationId || !input.rootContainerId) {
    return false;
  }

  return (
    input.nodes?.some(
      (node) =>
        node.id === input.rootContainerId &&
        node.parentId === null &&
        node.organizationId === input.organizationId,
    ) ?? false
  );
}
