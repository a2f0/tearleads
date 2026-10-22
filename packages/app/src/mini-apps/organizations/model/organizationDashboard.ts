import type { ContainerNode } from "@tearleads/client-sdk";

/** A container this user can reach whose parent they cannot. */
export interface OrganizationDashboardFolder {
  readonly id: string;
  readonly name: string;
  readonly readOnly: boolean;
  /** The organization's own root rather than a folder shared from beneath it. */
  readonly workspaceRoot: boolean;
}

export interface OrganizationDashboardCard {
  /** The organization the session is currently working in. */
  readonly active: boolean;
  /**
   * Sync can be paused or resumed here. A personal organization never can,
   * and the active organization, whose root the session writes to, can only
   * be resumed if another device paused it.
   */
  readonly canChangeSync: boolean;
  readonly folders: ReadonlyArray<OrganizationDashboardFolder>;
  readonly name: string | null;
  readonly organizationId: string;
  /** The user paused this organization's content syncing to their devices. */
  readonly syncPaused: boolean;
  /** The user can reach the organization's root, so it can be made active. */
  readonly workspace: boolean;
}

function compareNames(left: string, right: string): number {
  return left.localeCompare(right, undefined, { sensitivity: "base" });
}

function toFolder(node: ContainerNode): OrganizationDashboardFolder {
  return {
    id: node.id,
    name: node.name,
    readOnly: node.effectiveAccessLevel === "read",
    workspaceRoot: node.parentId === null,
  };
}

function cardRank(card: OrganizationDashboardCard): number {
  if (card.active) return 0;
  return card.workspace ? 1 : 2;
}

function compareCards(
  left: OrganizationDashboardCard,
  right: OrganizationDashboardCard,
): number {
  const rank = cardRank(left) - cardRank(right);
  if (rank !== 0) return rank;
  if (left.name !== null && right.name !== null) {
    const byName = compareNames(left.name, right.name);
    if (byName !== 0) return byName;
  } else if (left.name !== right.name) {
    // Named organizations first; an unnamed one is still syncing its profile.
    return left.name === null ? 1 : -1;
  }
  return left.organizationId.localeCompare(right.organizationId);
}

/**
 * Builds one card per organization present in the local container tree.
 *
 * A card's folders are its entry points: the containers this user can reach
 * whose parent they cannot. For a workspace that is the organization's root;
 * otherwise it is each topmost folder shared with the user or one of their
 * groups. System containers (the metadata root, Contacts, Trash, roster
 * profiles) are never entry points, so an organization known only through the
 * metadata root that every Members recipient can read still gets a card, with
 * no folders.
 */
export function buildOrganizationDashboardCards(input: {
  activeOrganizationId: string | null;
  namesById: ReadonlyMap<string, string>;
  nodes: ReadonlyArray<ContainerNode>;
  pausedOrganizationIds: ReadonlySet<string>;
  personalOrganizationIds: ReadonlySet<string>;
}): OrganizationDashboardCard[] {
  const nodeIds = new Set(input.nodes.map((node) => node.id));
  const foldersByOrganizationId = new Map<
    string,
    OrganizationDashboardFolder[]
  >();
  for (const node of input.nodes) {
    let folders = foldersByOrganizationId.get(node.organizationId);
    if (!folders) {
      folders = [];
      foldersByOrganizationId.set(node.organizationId, folders);
    }
    const reachableParent =
      node.parentId !== null && nodeIds.has(node.parentId);
    if (!node.systemSlot && !reachableParent) {
      folders.push(toFolder(node));
    }
  }

  return [...foldersByOrganizationId]
    .map(([organizationId, folders]) => ({
      active: organizationId === input.activeOrganizationId,
      canChangeSync:
        !input.personalOrganizationIds.has(organizationId) &&
        (organizationId !== input.activeOrganizationId ||
          input.pausedOrganizationIds.has(organizationId)),
      folders: folders.sort(
        (left, right) =>
          Number(right.workspaceRoot) - Number(left.workspaceRoot) ||
          compareNames(left.name, right.name) ||
          left.id.localeCompare(right.id),
      ),
      name: input.namesById.get(organizationId) ?? null,
      organizationId,
      syncPaused: input.pausedOrganizationIds.has(organizationId),
      workspace: folders.some((folder) => folder.workspaceRoot),
    }))
    .sort(compareCards);
}
