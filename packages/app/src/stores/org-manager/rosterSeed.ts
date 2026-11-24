import type {
  OrganizationDirectory,
  OrganizationDirectoryAndGroups,
  OrganizationDirectoryUser,
  OrganizationGroupMembers,
} from "@tearleads/client-sdk";
import { RESERVED_ORGANIZATION_GROUP_NAMES } from "../../utils/organizationGroupNames";
import type { RosterProfileNames } from "./profileDocuments";

// Seeding users onto an organization's roster and into its groups, shared by
// the demo's peer bootstrap and the CLI's `seed --roster`. The server derives
// roster entries from member-group reachability (there is no direct
// add-roster-entry API), so a user reaches the roster only by joining the
// builtin member group, exactly as the org-manager "Import user" action does.
// Each step re-reads state and is idempotent, so a caller retries a bounded
// number of times while server state settles. The caller passes only a user
// whose identity link it verified; the SDK refuses any other.

/** Whether the user is an active entry on the roster. */
export function isUserOnRoster(
  directory: OrganizationDirectory,
  userId: string,
): boolean {
  return directory.users.some(
    (user) => user.userId === userId && user.status === "active",
  );
}

/** Whether the user is already a member, before the roster catches up. */
export function isUserInGroup(
  members: OrganizationGroupMembers | null,
  userId: string,
): boolean {
  return Boolean(members?.members.some((member) => member.userId === userId));
}

type RosterAdmissionPlan =
  | { readonly kind: "idle" }
  | {
      readonly kind: "add-to-member-group";
      readonly memberGroupId: string;
      readonly userId: string;
    };

/**
 * Whether the user still needs a member-group add to reach the roster: `idle`
 * while the directory or member group is unavailable, and once the user is an
 * active roster entry or a member-group member.
 */
export function planRosterAdmission(input: {
  readonly directory: OrganizationDirectory | null;
  readonly memberGroupId: string | null;
  readonly members: OrganizationGroupMembers | null;
  readonly userId: string;
}): RosterAdmissionPlan {
  const { directory, memberGroupId, members, userId } = input;
  if (!directory || !memberGroupId) {
    return { kind: "idle" };
  }
  if (isUserOnRoster(directory, userId) || isUserInGroup(members, userId)) {
    return { kind: "idle" };
  }
  return { kind: "add-to-member-group", memberGroupId, userId };
}

/**
 * The organization actions roster seeding drives, declared structurally so a
 * React provider, a headless SDK host, or a test fake can supply them.
 */
export interface RosterSeedActions {
  readonly addUserToGroup: (
    groupId: string,
    targetUserId: string,
    expectedGroupName: string,
  ) => Promise<unknown>;
  readonly ensureRosterProfileDocument: (
    user: OrganizationDirectoryUser,
    names?: RosterProfileNames | undefined,
  ) => Promise<OrganizationDirectoryUser | null>;
  readonly loadDirectoryAndGroups: () => Promise<
    OrganizationDirectoryAndGroups | null | undefined
  >;
  readonly loadGroupMembers: (
    groupId: string,
  ) => Promise<OrganizationGroupMembers | null>;
}

export interface GroupSeedActions extends RosterSeedActions {
  readonly createGroup: (name: string) => Promise<{ readonly groupId: string }>;
}

/**
 * Drives the two roster writes a user needs, one phase per call:
 *  1. add the user to the member group (surfaces them on the roster), and
 *  2. give their roster entry a profile document carrying `names`.
 *
 * Returns `true` once the user is on the roster with a profile document, and
 * `false` while state has not settled (the add has not synced, the profile
 * cannot be created yet, ...), so the caller retries.
 */
export async function seedRosterEntry(
  actions: RosterSeedActions,
  userId: string,
  names: RosterProfileNames,
): Promise<boolean> {
  const directoryAndGroups = await actions.loadDirectoryAndGroups();
  const directory = directoryAndGroups?.directory ?? null;
  const memberGroupId = directoryAndGroups?.memberGroupId ?? null;
  if (!directory || !memberGroupId) {
    return false;
  }

  if (!isUserOnRoster(directory, userId)) {
    const members = await actions.loadGroupMembers(memberGroupId);
    if (!members) {
      // Wait until membership state is authoritative enough to determine
      // whether the add is still owed.
      return false;
    }
    const plan = planRosterAdmission({
      directory,
      memberGroupId,
      members,
      userId,
    });
    if (plan.kind === "add-to-member-group") {
      await actions.addUserToGroup(
        plan.memberGroupId,
        plan.userId,
        RESERVED_ORGANIZATION_GROUP_NAMES.members,
      );
    }
    // The membership write (or a prior one) has not surfaced in this directory
    // snapshot yet; retry so the next attempt can seed the profile.
    return false;
  }

  const user = directory.users.find((entry) => entry.userId === userId);
  if (!user) {
    return false;
  }
  if (user.profileDocumentId) {
    return true;
  }
  const updated = await actions.ensureRosterProfileDocument(user, names);
  return Boolean(updated?.profileDocumentId);
}

/**
 * A retryable step that creates the named group when the organization has
 * none and adds each user not yet a member. The users must already be on the
 * roster. The step resolves `true` once every user is a member, and `false`
 * while a write has not surfaced yet. It remembers a group it created, so a
 * retry made before that group reaches the read model adds to it instead of
 * creating another group of the same name. Built-in groups and groups whose
 * name does not open never match by name.
 */
export function createGroupMembersSeed(
  actions: GroupSeedActions,
  groupName: string,
  userIds: readonly string[],
): () => Promise<boolean> {
  let createdGroupId: string | null = null;
  const resolveGroupId = async (
    groups: OrganizationDirectoryAndGroups["groups"],
  ): Promise<string> => {
    if (createdGroupId) return createdGroupId;
    const existing = groups.find(
      (group) =>
        !group.isBuiltin && !group.nameUnreadable && group.name === groupName,
    );
    if (existing) return existing.groupId;
    createdGroupId = (await actions.createGroup(groupName)).groupId;
    return createdGroupId;
  };
  return async () => {
    const directoryAndGroups = await actions.loadDirectoryAndGroups();
    if (!directoryAndGroups) {
      return false;
    }
    const groupId = await resolveGroupId(directoryAndGroups.groups);
    const members = await actions.loadGroupMembers(groupId);
    if (!members) {
      return false;
    }
    const missing = userIds.filter((userId) => !isUserInGroup(members, userId));
    for (const userId of missing) {
      await actions.addUserToGroup(groupId, userId, groupName);
    }
    return missing.length === 0;
  };
}
