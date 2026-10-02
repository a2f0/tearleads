import type { OrganizationGroupSummary } from "@tearleads/client-sdk";
import type { useOrgManagerActions } from "../../../stores/org-manager/OrgManagerProvider";
import { RESERVED_ORGANIZATION_GROUP_NAMES } from "../../../utils/organizationGroupNames";
import { groupSignedName, ORG_MANAGER_LABELS } from "../labels";

export interface RosterDisableMembershipTarget {
  readonly groupId: string;
  readonly name: string;
}

/** Remove every other signed group membership before disabling the roster. */
export async function loadRosterDisableMembershipTargets(input: {
  disabledUserId: string;
  groups: ReadonlyArray<OrganizationGroupSummary>;
  isOperationActive: (organizationId: string) => boolean;
  memberGroupId: string;
  organizationId: string;
  orgManagerActions: Pick<
    ReturnType<typeof useOrgManagerActions>,
    "loadGroupMembers"
  >;
  setError: (error: string) => void;
}): Promise<RosterDisableMembershipTarget[] | null> {
  const groups = [
    ...input.groups.filter((group) => group.groupId !== input.memberGroupId),
    {
      groupId: input.memberGroupId,
      name: RESERVED_ORGANIZATION_GROUP_NAMES.members,
      nameUnreadable: false,
    },
  ];
  const targets: RosterDisableMembershipTarget[] = [];
  for (const group of groups) {
    const members = await input.orgManagerActions.loadGroupMembers(
      group.groupId,
    );
    if (!input.isOperationActive(input.organizationId)) return null;
    if (!members) {
      input.setError(ORG_MANAGER_LABELS.failedLoadGroupMembers);
      return null;
    }
    if (!members.members.some(({ userId }) => userId === input.disabledUserId))
      continue;
    // A removal binds to the group's signed name, so a membership in a group
    // without a readable name refuses the disable before anything changes.
    const name = groupSignedName(group);
    if (name === null) {
      input.setError(ORG_MANAGER_LABELS.groupNameUnavailable);
      return null;
    }
    targets.push({ groupId: group.groupId, name });
  }
  if (targets.length === 0) {
    input.setError(ORG_MANAGER_LABELS.userNotFound);
    return null;
  }
  return targets;
}
