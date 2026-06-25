import type {
  ContainerContentsContextValue,
  ContainerContentsStore,
  ContainerNode,
} from "@tearleads/client-sdk";
import { deriveContainerSystemSlot } from "@tearleads/client-sdk";
import type { ContainerSystemSlot } from "@tearleads/validators/containerSystemSlot";
import { useEffect, useRef, useState } from "react";
import {
  isUnderForeignSharedRoot,
  SHARED_VISIBLE_SYSTEM_CONTAINER_NAMES,
  USER_SYSTEM_CONTAINER_DEFINITIONS,
  type UserSystemContainerKind,
} from "../systemContainers";

interface ExplorerSystemContainer {
  kind: UserSystemContainerKind;
  name: string;
  systemSlot: ContainerSystemSlot;
}

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
  systemContainers: ReadonlyArray<ExplorerSystemContainer>,
  kind: UserSystemContainerKind,
): ContainerSystemSlot | null {
  return (
    systemContainers.find((systemContainer) => systemContainer.kind === kind)
      ?.systemSlot ?? null
  );
}

export function findContactsSystemContainerSlot(
  systemContainers: ReadonlyArray<ExplorerSystemContainer>,
): ContainerSystemSlot | null {
  return findExplorerSystemContainerSlot(systemContainers, "contacts");
}

export function findTrashSystemContainerSlot(
  systemContainers: ReadonlyArray<ExplorerSystemContainer>,
): ContainerSystemSlot | null {
  return findExplorerSystemContainerSlot(systemContainers, "trash");
}

export function getExplorerVisibleSystemSlots(
  systemContainers: ReadonlyArray<ExplorerSystemContainer>,
): ReadonlySet<ContainerSystemSlot> {
  return new Set(
    systemContainers.map((systemContainer) => systemContainer.systemSlot),
  );
}

export function getExplorerOwnedSystemContainers(
  systemContainers: ReadonlyArray<ExplorerSystemContainer>,
): ReadonlyArray<ExplorerSystemContainer> {
  return systemContainers.filter(
    (systemContainer) => systemContainer.kind !== "contacts",
  );
}

export function useExplorerSystemContainerSlots(input: {
  logError: (message: string | Error, cause?: unknown) => void;
  signingPrivateKey: Uint8Array | null;
}): ReadonlyArray<ExplorerSystemContainer> {
  const [systemContainers, setSystemContainers] = useState<
    ReadonlyArray<ExplorerSystemContainer>
  >([]);

  useEffect(() => {
    if (!input.signingPrivateKey) {
      setSystemContainers([]);
      return;
    }

    const signingPrivateKey = input.signingPrivateKey;
    let cancelled = false;
    void Promise.all(
      USER_SYSTEM_CONTAINER_DEFINITIONS.map(async (definition) => ({
        kind: definition.kind,
        name: definition.name,
        systemSlot: await deriveContainerSystemSlot({
          definition: definition.slotDefinition,
          secretKey: signingPrivateKey,
        }),
      })),
    )
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

export function useEnsureExplorerSystemContainers(input: {
  containerContentsReady: boolean;
  containerContentsStore: Pick<ContainerContentsStore, "ensureSystemContainer">;
  logError: (message: string | Error, cause?: unknown) => void;
  nodes: ReadonlyArray<ContainerNode>;
  shouldProvisionSystemContainers: boolean;
  systemContainers: ReadonlyArray<ExplorerSystemContainer>;
}): void {
  const inFlightSystemSlotsRef = useRef(new Set<ContainerSystemSlot>());

  useEffect(() => {
    if (
      !input.containerContentsReady ||
      !input.shouldProvisionSystemContainers ||
      input.systemContainers.length === 0
    ) {
      return;
    }

    const existingSystemSlots = new Set(
      input.nodes.flatMap((node) => {
        const systemSlot = node.systemSlot ?? null;
        return systemSlot ? [systemSlot] : [];
      }),
    );
    const missingSystemContainers = input.systemContainers.filter(
      (systemContainer) =>
        !existingSystemSlots.has(systemContainer.systemSlot) &&
        !inFlightSystemSlotsRef.current.has(systemContainer.systemSlot),
    );
    if (missingSystemContainers.length === 0) {
      return;
    }

    let cancelled = false;
    const provisionMissingSystemContainers = () => {
      for (const systemContainer of missingSystemContainers) {
        inFlightSystemSlotsRef.current.add(systemContainer.systemSlot);
        void input.containerContentsStore
          .ensureSystemContainer(
            systemContainer.systemSlot,
            systemContainer.name,
            { skipAdvancedManagedRoot: true },
          )
          .catch((error) => {
            if (!cancelled) {
              input.logError(
                `Failed to provision explorer ${systemContainer.name} system container`,
                error,
              );
            }
          })
          .finally(() => {
            inFlightSystemSlotsRef.current.delete(systemContainer.systemSlot);
          });
      }
    };
    const provisionTimer = window.setTimeout(
      provisionMissingSystemContainers,
      100,
    );

    return () => {
      cancelled = true;
      window.clearTimeout(provisionTimer);
    };
  }, [
    input.containerContentsReady,
    input.containerContentsStore,
    input.logError,
    input.nodes,
    input.shouldProvisionSystemContainers,
    input.systemContainers,
  ]);
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
