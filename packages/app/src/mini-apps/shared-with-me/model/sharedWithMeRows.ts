import type {
  ContainerNode,
  ContainerShareAccessLevel,
} from "@tearleads/client-sdk";
import { deriveOrganizationTrashSystemSlot } from "@tearleads/validators/containerSystemSlot";
import { CONTACTS_CONTAINER_NAME } from "../../../stores/systemContainers";

/** A container this user can reach whose parent they cannot. */
export interface SharedFolder {
  /** The user's effective permission on the folder, as last synced here. */
  readonly accessLevel: ContainerShareAccessLevel;
  readonly id: string;
  readonly name: string;
  /** The organization's own root rather than a folder shared from beneath it. */
  readonly workspaceRoot: boolean;
}

/** The organization a row belongs to, and the user's own choices for it. */
export interface SharedOrganization {
  /**
   * The user can ask this organization's administrators to remove them. A
   * personal organization cannot be left, and an organization the server has
   * not yet listed as a membership offers nothing.
   */
  readonly canAskToLeave: boolean;
  /** The user asked to leave and an administrator has not acted on it yet. */
  readonly leaveRequested: boolean;
  readonly name: string | null;
  readonly organizationId: string;
  /**
   * Sync is paused here: this device keeps the organization's content and
   * neither uploads nor downloads it until the user resumes.
   */
  readonly syncPaused: boolean;
}

/**
 * One entry in the Shared with Me list: a folder the user can reach, or an
 * organization this device knows but has listed no folder of, so its sync and
 * leave choices stay reachable.
 */
export type SharedWithMeRow =
  | {
      readonly folder: SharedFolder;
      readonly key: string;
      readonly kind: "folder";
      readonly organization: SharedOrganization;
    }
  | {
      readonly key: string;
      readonly kind: "organization";
      readonly organization: SharedOrganization;
    };

interface OrganizationEntry {
  readonly active: boolean;
  readonly folders: ReadonlyArray<SharedFolder>;
  readonly organization: SharedOrganization;
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

function toFolder(node: ContainerNode): SharedFolder {
  return {
    // An unknown level fails closed to read, as the SDK's own default does.
    accessLevel: node.effectiveAccessLevel ?? "read",
    id: node.id,
    name: node.name,
    workspaceRoot: node.parentId === null,
  };
}

function compareFolders(left: SharedFolder, right: SharedFolder): number {
  return (
    Number(right.workspaceRoot) - Number(left.workspaceRoot) ||
    compareNames(left.name, right.name) ||
    left.id.localeCompare(right.id)
  );
}

/** The active organization, then other workspaces, then the rest. */
function entryRank(entry: OrganizationEntry): number {
  if (entry.active) return 0;
  return entry.folders.some((folder) => folder.workspaceRoot) ? 1 : 2;
}

function compareEntries(
  left: OrganizationEntry,
  right: OrganizationEntry,
): number {
  const rank = entryRank(left) - entryRank(right);
  if (rank !== 0) return rank;
  const leftName = left.organization.name;
  const rightName = right.organization.name;
  if (leftName !== null && rightName !== null) {
    const byName = compareNames(leftName, rightName);
    if (byName !== 0) return byName;
  } else if (leftName !== rightName) {
    // Named organizations first; an unnamed one is still syncing its profile.
    return leftName === null ? 1 : -1;
  }
  return left.organization.organizationId.localeCompare(
    right.organization.organizationId,
  );
}

function entryRows(entry: OrganizationEntry): SharedWithMeRow[] {
  const { organization } = entry;
  if (entry.folders.length === 0) {
    return [
      {
        key: `organization:${organization.organizationId}`,
        kind: "organization",
        organization,
      },
    ];
  }
  return entry.folders.map((folder) => ({
    folder,
    key: `folder:${folder.id}`,
    kind: "folder",
    organization,
  }));
}

function foldersByOrganizationId(
  nodes: ReadonlyArray<ContainerNode>,
): Map<string, SharedFolder[]> {
  const nodeIds = new Set(nodes.map((node) => node.id));
  const folders = new Map<string, SharedFolder[]>();
  for (const node of nodes) {
    // The device root and its local children have no organization until sync.
    if (!node.organizationId) continue;
    let organizationFolders = folders.get(node.organizationId);
    if (!organizationFolders) {
      organizationFolders = [];
      folders.set(node.organizationId, organizationFolders);
    }
    const reachableParent =
      node.parentId !== null && nodeIds.has(node.parentId);
    if (isFolderNode(node) && !reachableParent) {
      organizationFolders.push(toFolder(node));
    }
  }
  return folders;
}

/**
 * Builds the Shared with Me rows from the local container tree, grouped by
 * organization.
 *
 * An organization's folders are its entry points: the containers this user
 * can reach whose parent they cannot. For a workspace that is the
 * organization's root; otherwise it is each topmost folder shared with the
 * user or one of their groups, including a shared Contacts or Trash. The
 * metadata root and roster profiles are never entry points, so an
 * organization known only through the metadata root that every Members
 * recipient can read gets one organization row instead of folder rows.
 */
export function buildSharedWithMeRows(input: {
  activeOrganizationId: string | null;
  /** Memberships the server listed that are not the user's personal one. */
  leavableOrganizationIds: ReadonlySet<string>;
  leaveRequestedOrganizationIds: ReadonlySet<string>;
  namesById: ReadonlyMap<string, string>;
  nodes: ReadonlyArray<ContainerNode>;
  pausedOrganizationIds: ReadonlySet<string>;
}): SharedWithMeRow[] {
  return [...foldersByOrganizationId(input.nodes)]
    .map(
      ([organizationId, folders]): OrganizationEntry => ({
        active: organizationId === input.activeOrganizationId,
        folders: folders.sort(compareFolders),
        organization: {
          canAskToLeave: input.leavableOrganizationIds.has(organizationId),
          leaveRequested:
            input.leaveRequestedOrganizationIds.has(organizationId),
          name: input.namesById.get(organizationId) ?? null,
          organizationId,
          syncPaused: input.pausedOrganizationIds.has(organizationId),
        },
      }),
    )
    .sort(compareEntries)
    .flatMap(entryRows);
}
