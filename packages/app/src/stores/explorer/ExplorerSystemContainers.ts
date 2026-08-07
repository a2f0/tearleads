import type {
  ContainerContentsContextValue,
  ContainerNode,
} from "@tearleads/client-sdk";
import type { ContainerSystemSlot } from "@tearleads/validators/containerSystemSlot";
import {
  EXPLORER_TRASH_CONTAINER_NAME,
  findUserSystemContainer,
  isTrashSystemContainerNode,
  isUnderForeignSharedRoot,
  SHARED_VISIBLE_SYSTEM_CONTAINER_NAMES,
  USER_SYSTEM_CONTAINER_DEFINITIONS,
  type UserSystemContainer,
} from "../systemContainers";

type TrashLookupNode = Pick<
  ContainerNode,
  "id" | "name" | "organizationId" | "parentId" | "systemSlot"
>;

const USER_SYSTEM_CONTAINER_NAMES = new Set(
  USER_SYSTEM_CONTAINER_DEFINITIONS.map((definition) => definition.name),
);

const SYSTEM_NODE_SYNC_STATUS_RANK = {
  synced: 3,
  pending: 2,
  error: 1,
  "local-only": 0,
} as const satisfies Record<ContainerNode["syncState"]["status"], number>;

function explorerSystemNodeKey(
  node: ContainerNode,
  systemSlot: ContainerSystemSlot,
): string {
  return `${node.organizationId ?? node.parentId ?? ""}\u0000${systemSlot}`;
}

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
  const systemNodeIndexes = new Map<string, number>();

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

    const systemNodeKey = explorerSystemNodeKey(node, systemSlot);
    const existingIndex = systemNodeIndexes.get(systemNodeKey);
    if (existingIndex === undefined) {
      systemNodeIndexes.set(systemNodeKey, visibleNodes.length);
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

// The minimal node shape this slot lookup reads. Generic over it so the narrow
// Contacts lookup nodes (a Pick) can reuse the same resolver while Explorer
// callers, passing full ContainerNodes, keep the full-node return.
type SystemContainerLookupNode = Pick<
  ContainerNode,
  "id" | "organizationId" | "parentId" | "systemSlot"
>;

export function findExplorerSystemNode<T extends SystemContainerLookupNode>(
  nodes: ReadonlyArray<T> | null | undefined,
  systemSlot: ContainerSystemSlot | null,
  organizationId?: string | null | undefined,
  rootContainerId?: string | null | undefined,
): T | null {
  if (!systemSlot || !nodes) {
    return null;
  }

  let fallback: T | null = null;
  for (const node of nodes) {
    if (node.systemSlot !== systemSlot) {
      continue;
    }
    if (rootContainerId != null && node.parentId === rootContainerId) {
      return node;
    }
    if (
      rootContainerId != null
        ? organizationId != null && node.organizationId === organizationId
        : organizationId == null || node.organizationId === organizationId
    ) {
      fallback ??= node;
    }
  }

  return fallback;
}

export function getExplorerSystemContainerId<
  T extends SystemContainerLookupNode,
>(
  nodes: ReadonlyArray<T> | null | undefined,
  systemSlot: ContainerSystemSlot | null,
  organizationId?: string | null | undefined,
  rootContainerId?: string | null | undefined,
): string | null {
  return (
    findExplorerSystemNode(nodes, systemSlot, organizationId, rootContainerId)
      ?.id ?? null
  );
}

export function getExplorerTrashContainerId(
  nodes: ReadonlyArray<ContainerNode> | null | undefined,
  trashSystemSlot: ContainerSystemSlot | null,
  organizationId?: string | null | undefined,
  rootContainerId?: string | null | undefined,
): string | null {
  return getExplorerSystemContainerId(
    nodes,
    trashSystemSlot,
    organizationId,
    rootContainerId,
  );
}

export function getExplorerTrashDeleteTargetId(
  nodes: ReadonlyArray<ContainerNode> | null | undefined,
  trashSystemSlot: ContainerSystemSlot | null,
  organizationId?: string | null | undefined,
  rootContainerId?: string | null | undefined,
): string | null {
  return getExplorerTrashContainerId(
    nodes,
    trashSystemSlot,
    organizationId,
    rootContainerId,
  );
}

// Find the "Trash" system folder that belongs to another organization's shared
// root. The owner's trash carries an opaque per-owner HMAC systemSlot the viewer
// cannot derive, so — exactly like the shared-folder visibility classifier — it
// is matched by name plus the presence of *some* systemSlot. Requiring the node
// to be a direct child of that org's root (parentId === the org root) keeps a
// same-name user folder nested elsewhere in the tree from being mistaken for the
// org Trash.
function findForeignOrgTrashContainerId(
  nodes: ReadonlyArray<ContainerNode> | null | undefined,
  organizationId: string,
): string | null {
  if (!nodes) {
    return null;
  }

  const orgRoot = nodes.find(
    (node) => node.parentId === null && node.organizationId === organizationId,
  );
  if (!orgRoot) {
    return null;
  }

  return (
    nodes.find(
      (node) =>
        node.parentId === orgRoot.id &&
        node.organizationId === organizationId &&
        node.name === EXPLORER_TRASH_CONTAINER_NAME &&
        (node.systemSlot ?? null) !== null,
    )?.id ?? null
  );
}

interface ExplorerDeleteTrashResolution {
  // Whether the caller may lazily create the viewer's OWN Trash when none is
  // resolved. Only true for the viewer's own organization: a foreign org's Trash
  // is never substituted with the viewer's personal Trash (that cross-org
  // mis-homing is the bug this resolution fixes), so an absent foreign Trash must
  // abort the delete rather than fall back.
  canFallBackToOwnTrash: boolean;
  trashContainerId: string | null;
}

// Resolve the Trash a document/folder living in `containerId` should be deleted
// into, making delete/purge org-aware. The viewer only ever holds one derived
// trash slot (their own), so without this a document under another org's shared
// root would be moved into the viewer's PERSONAL Trash — a cross-org re-home.
// When `containerId` sits under a foreign shared root we instead target the
// "Trash" system folder under THAT org's root; otherwise we resolve the viewer's
// own Trash by slot (precise and spoof-proof, since the viewer can derive it).
export function resolveExplorerDeleteTrashTarget(input: {
  containerId: string | null;
  currentOrganizationId: string | null | undefined;
  nodes: ReadonlyArray<ContainerNode> | null | undefined;
  trashSystemSlot: ContainerSystemSlot | null;
}): ExplorerDeleteTrashResolution {
  const { containerId, currentOrganizationId, nodes, trashSystemSlot } = input;
  const containerNode =
    containerId != null
      ? (nodes?.find((node) => node.id === containerId) ?? null)
      : null;

  if (
    containerNode &&
    isUnderForeignSharedRoot({
      currentOrganizationId,
      organizationId: containerNode.organizationId,
    })
  ) {
    return {
      canFallBackToOwnTrash: false,
      trashContainerId: findForeignOrgTrashContainerId(
        nodes,
        containerNode.organizationId,
      ),
    };
  }

  return {
    canFallBackToOwnTrash: true,
    trashContainerId: getExplorerTrashDeleteTargetId(
      nodes,
      trashSystemSlot,
      currentOrganizationId,
      containerNode?.parentId ?? null,
    ),
  };
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

interface TrashLookupInput {
  currentOrganizationId: string | null | undefined;
  trashSystemSlot: ContainerSystemSlot | null;
}

// Whether `containerId` is a Trash system folder or lives anywhere beneath one,
// classifying each ancestor by its rules rather than by a single resolved Trash
// id. This is the org-aware sibling of isExplorerContainerUnderTrash: because it
// asks isTrashSystemContainerNode per node, it catches the viewer's OWN Trash
// (matched by slot) AND a peer's shared Trash under a foreign org's root (matched
// by name), whereas the id-based walk only knows the viewer's own Trash. Walks
// parentId up to the root, guarding a cyclic chain; an unknown container or a
// null containerId is treated as not trashed.
export function isContainerUnderTrash(
  nodes: ReadonlyArray<TrashLookupNode> | null | undefined,
  containerId: string | null | undefined,
  input: TrashLookupInput,
): boolean {
  if (!nodes) {
    return false;
  }

  return isContainerUnderTrashByLookup(
    new Map(nodes.map((node) => [node.id, node])),
    containerId,
    input,
  );
}

// Map-taking variant of isContainerUnderTrash: a hot caller (e.g. the notes app,
// which checks on every render) memoizes the id→node lookup once and passes it in
// rather than rebuilding it on each call.
export function isContainerUnderTrashByLookup(
  nodesById: ReadonlyMap<string, TrashLookupNode> | null | undefined,
  containerId: string | null | undefined,
  input: TrashLookupInput,
): boolean {
  if (!containerId || !nodesById) {
    return false;
  }

  const visited = new Set<string>();
  let currentId: string | null = containerId;
  while (currentId !== null) {
    if (visited.has(currentId)) {
      return false;
    }
    visited.add(currentId);
    const node = nodesById.get(currentId);
    if (!node) {
      return false;
    }
    if (isTrashSystemContainerNode(node, input)) {
      return true;
    }
    currentId = node.parentId ?? null;
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
  extraSystemSlots: ReadonlyArray<ContainerSystemSlot> = [],
): ReadonlySet<ContainerSystemSlot> {
  if (systemContainers.length === 0) {
    return new Set();
  }

  const visibleSlots = new Set<ContainerSystemSlot>();
  for (const systemContainer of systemContainers) {
    visibleSlots.add(systemContainer.systemSlot);
  }
  for (const systemSlot of extraSystemSlots) {
    visibleSlots.add(systemSlot);
  }
  return visibleSlots;
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
      (node) => node.id === input.rootContainerId && node.parentId === null,
    ) ?? false
  );
}
