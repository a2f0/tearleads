import type { OrganizationGroupSummary } from "@tearleads/client-sdk";
import type { useOrgManagerActions } from "../../../stores/org-manager/OrgManagerProvider";
import { RESERVED_ORGANIZATION_GROUP_NAMES } from "../../../utils/organizationGroupNames";
import { ORG_MANAGER_LABELS } from "../labels";

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
    },
  ];
  const memberships = await Promise.all(
    groups.map(async (group) => ({
      group,
      members: await input.orgManagerActions.loadGroupMembers(group.groupId),
    })),
  );
  if (!input.isOperationActive(input.organizationId)) return null;
  const targets: RosterDisableMembershipTarget[] = [];
  for (const { group, members } of memberships) {
    if (!members) {
      input.setError(ORG_MANAGER_LABELS.failedLoadGroupMembers);
      return null;
    }
    if (!members.members.some(({ userId }) => userId === input.disabledUserId))
      continue;
    targets.push({ groupId: group.groupId, name: group.name });
  }
  if (targets.length === 0) {
    input.setError(ORG_MANAGER_LABELS.userNotFound);
    return null;
  }
  return targets;
}
