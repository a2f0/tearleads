import {
  buildOrganizationGroupPolicyHistory,
  type OrganizationDirectory,
  type OrganizationGroupMember,
  type OrganizationGroupMembers,
  type OrganizationGroupPolicyHistory,
  type OrganizationGroupSummary,
} from "@tearleads/client-sdk";
import type {
  PrincipalPolicyBundleResponse,
  PrincipalProjectionMemberResponse,
} from "@tearleads/validators/response";

interface GroupMutationProjection {
  readonly members: OrganizationGroupMembers;
  readonly policyHistory: OrganizationGroupPolicyHistory;
}

function compareProjectionMembers(
  left: PrincipalProjectionMemberResponse,
  right: PrincipalProjectionMemberResponse,
): number {
  return (
    left.memberPrincipalType.localeCompare(right.memberPrincipalType) ||
    left.memberPrincipalId.localeCompare(right.memberPrincipalId)
  );
}

function projectGroupMember(input: {
  readonly directory: OrganizationDirectory;
  readonly groupsById: ReadonlyMap<string, OrganizationGroupSummary>;
  readonly member: PrincipalProjectionMemberResponse;
}): OrganizationGroupMember | null {
  const { member } = input;
  if (member.memberPrincipalType === "user") {
    const user = input.directory.users.find(
      (candidate) => candidate.userId === member.memberPrincipalId,
    );
    if (!user) {
      return null;
    }

    return {
      encapsulationKeyFingerprint: user.encapsulationKeyFingerprint,
      encapsulationPublicKey: user.encapsulationPublicKey,
      groupId: null,
      groupName: null,
      memberPrincipalId: member.memberPrincipalId,
      memberPrincipalType: "user",
      role: member.role,
      signingKeyFingerprint: user.signingKeyFingerprint,
      signingPublicKey: user.signingPublicKey,
      userId: user.userId,
    };
  }

  const group = input.groupsById.get(member.memberPrincipalId);
  if (!group || group.organizationId !== input.directory.organizationId) {
    return null;
  }

  return {
    encapsulationKeyFingerprint: null,
    encapsulationPublicKey: null,
    groupId: group.groupId,
    groupName: group.name,
    memberPrincipalId: member.memberPrincipalId,
    memberPrincipalType: "group",
    role: member.role,
    signingKeyFingerprint: null,
    signingPublicKey: null,
    userId: null,
  };
}

export function projectGroupMutationResult(input: {
  readonly bundle: PrincipalPolicyBundleResponse;
  readonly directory: OrganizationDirectory;
  readonly groupId: string;
  readonly groups: ReadonlyArray<OrganizationGroupSummary>;
}): GroupMutationProjection | null {
  const { bundle, directory, groupId, groups } = input;
  const targetGroup = groups.find((group) => group.groupId === groupId);
  const targetState = targetGroup?.currentState;
  if (
    bundle.currentState.principalType !== "group" ||
    bundle.currentState.principalId !== groupId ||
    !targetGroup ||
    targetGroup.organizationId !== directory.organizationId ||
    !targetState ||
    targetState.keyEpoch !== bundle.currentState.keyEpoch ||
    targetState.memberCount !== bundle.currentState.memberCount ||
    targetState.stateHash !== bundle.currentState.stateHash ||
    targetState.version !== bundle.currentState.version
  ) {
    return null;
  }

  const groupsById = new Map(groups.map((group) => [group.groupId, group]));
  const members: OrganizationGroupMember[] = [];
  for (const member of [...bundle.currentProjection].sort(
    compareProjectionMembers,
  )) {
    const projectedMember = projectGroupMember({
      directory,
      groupsById,
      member,
    });
    if (!projectedMember) {
      return null;
    }
    members.push(projectedMember);
  }

  return {
    members: {
      groupId,
      members,
      organizationId: directory.organizationId,
    },
    policyHistory: buildOrganizationGroupPolicyHistory(bundle),
  };
}
