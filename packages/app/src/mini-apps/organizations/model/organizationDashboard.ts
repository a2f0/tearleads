import type {
  ContainerNode,
  ContainerShareAccessLevel,
} from "@tearleads/client-sdk";
import { deriveOrganizationTrashSystemSlot } from "@tearleads/validators/containerSystemSlot";
import { CONTACTS_CONTAINER_NAME } from "../../../stores/systemContainers";

/** A container this user can reach whose parent they cannot. */
export interface OrganizationDashboardFolder {
  /** The user's effective permission on the folder, as last synced here. */
  readonly accessLevel: ContainerShareAccessLevel;
  readonly id: string;
  readonly name: string;
  /** The organization's own root rather than a folder shared from beneath it. */
  readonly workspaceRoot: boolean;
}

export interface OrganizationDashboardCard {
  /** The organization the session is currently working in. */
  readonly active: boolean;
  /**
   * The user can ask this organization's administrators to remove them. A
   * personal organization cannot be left, and an organization the server has
   * not yet listed as a membership offers nothing.
   */
  readonly canAskToLeave: boolean;
  readonly folders: ReadonlyArray<OrganizationDashboardFolder>;
  /** The user asked to leave and an administrator has not acted on it yet. */
  readonly leaveRequested: boolean;
  readonly name: string | null;
  readonly organizationId: string;
  /**
   * Sync is paused here: this device keeps the organization's content and
   * neither uploads nor downloads it until the user resumes.
   */
  readonly syncPaused: boolean;
  /** The user can reach the organization's root, so it can be made active. */
  readonly workspace: boolean;
}

function compareNames(left: string, right: string): number {
  return left.localeCompare(right, undefined, { sensitivity: "base" });
}

function isFolderNode(node: ContainerNode): boolean {
  return (
    !node.systemSlot ||
    node.name === CONTACTS_CONTAINER_NAME ||
    node.systemSlot === deriveOrganizationTrashSystemSlot(node.organizationId)
  );
}

function toFolder(node: ContainerNode): OrganizationDashboardFolder {
  return {
    // An unknown level fails closed to read, as the SDK's own default does.
    accessLevel: node.effectiveAccessLevel ?? "read",
    id: node.id,
    name: node.name,
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
 * groups, including a shared Contacts or Trash. The metadata root and roster
 * profiles are never entry points, so an organization known only through the
 * metadata root that every Members recipient can read still gets a card, with
 * no folders.
 */
export function buildOrganizationDashboardCards(input: {
  activeOrganizationId: string | null;
  /** Memberships the server listed that are not the user's personal one. */
  leavableOrganizationIds: ReadonlySet<string>;
  leaveRequestedOrganizationIds: ReadonlySet<string>;
  namesById: ReadonlyMap<string, string>;
  nodes: ReadonlyArray<ContainerNode>;
  pausedOrganizationIds: ReadonlySet<string>;
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
    if (isFolderNode(node) && !reachableParent) {
      folders.push(toFolder(node));
    }
  }

  return [...foldersByOrganizationId]
    .map(([organizationId, folders]) => ({
      active: organizationId === input.activeOrganizationId,
      canAskToLeave: input.leavableOrganizationIds.has(organizationId),
      folders: folders.sort(
        (left, right) =>
          Number(right.workspaceRoot) - Number(left.workspaceRoot) ||
          compareNames(left.name, right.name) ||
          left.id.localeCompare(right.id),
      ),
      leaveRequested: input.leaveRequestedOrganizationIds.has(organizationId),
      name: input.namesById.get(organizationId) ?? null,
      organizationId,
      syncPaused: input.pausedOrganizationIds.has(organizationId),
      workspace: folders.some((folder) => folder.workspaceRoot),
    }))
    .sort(compareCards);
}
