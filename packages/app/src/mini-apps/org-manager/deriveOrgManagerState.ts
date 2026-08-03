import type {
  OrganizationContainerGrants,
  OrganizationDataUsage,
  OrganizationDirectory,
  OrganizationGroupContainers,
  OrganizationGroupMembers,
  OrganizationGroupPolicyHistory,
  OrganizationGroupSummary,
  OrganizationPolicyHistory,
  OrganizationUserDetail,
} from "@tearleads/client-sdk";
import {
  scopeOrganizationValue,
  scopeSelectedGroupPolicyHistory,
  scopeSelectedGroupValue,
  scopeSelectedUserDetail,
} from "./hooks/orgManagerStateScope";
import { ORG_MANAGER_LABELS } from "./labels";
import { canCurrentUserMutateSelectedGroup } from "./permissions";
import type { OrgManagerGrantRouteRef } from "./routes";

interface DeriveOrgManagerStateInput {
  readonly activeDirectory: OrganizationDirectory | null;
  readonly activeGroups: ReadonlyArray<OrganizationGroupSummary>;
  readonly canLoadAuthenticatedOrgData: boolean;
  readonly crypto: {
    readonly hasEncapsulationKeyPair: boolean;
    readonly hasSigningFingerprint: boolean;
    readonly hasSigningKeyPair: boolean;
  };
  readonly dataUsage: OrganizationDataUsage | null;
  readonly databaseReady: boolean;
  readonly grants: OrganizationContainerGrants | null;
  readonly groupContainers: OrganizationGroupContainers | null;
  readonly groupPolicyHistory: OrganizationGroupPolicyHistory | null;
  readonly memberGroupId: string | null;
  readonly members: OrganizationGroupMembers | null;
  readonly organizationId: string | null;
  readonly organizationPolicyHistory: OrganizationPolicyHistory | null;
  readonly selectedGrantRef: OrgManagerGrantRouteRef | null;
  readonly selectedGroupId: string | null;
  readonly selectedUserId: string | null;
  readonly userDetail: OrganizationUserDetail | null;
  readonly userId: string | null;
}

function deriveScopedState(input: DeriveOrgManagerStateInput) {
  const activeMembers = scopeSelectedGroupValue(
    input.members,
    input.organizationId,
    input.selectedGroupId,
  );
  const activeGroupContainers = scopeSelectedGroupValue(
    input.groupContainers,
    input.organizationId,
    input.selectedGroupId,
  );
  const activeGroupPolicyHistory = scopeSelectedGroupPolicyHistory(
    input.groupPolicyHistory,
    input.organizationId,
    input.selectedGroupId,
  );
  const activeOrganizationPolicyHistory = scopeOrganizationValue(
    input.organizationPolicyHistory,
    input.organizationId,
  );
  const activeGrants = scopeOrganizationValue(
    input.grants,
    input.organizationId,
  );
  const activeDataUsage = scopeOrganizationValue(
    input.dataUsage,
    input.organizationId,
  );
  const activeUserDetail = scopeSelectedUserDetail(
    input.userDetail,
    input.organizationId,
    input.selectedUserId,
  );

  return {
    activeDataUsage,
    activeGrants,
    activeGroupContainers,
    activeGroupPolicyHistory,
    activeMemberGroupId: input.activeDirectory ? input.memberGroupId : null,
    activeMembers,
    activeOrganizationPolicyHistory,
    activeUserDetail,
  };
}

function findSelectedGrant(
  grants: OrganizationContainerGrants | null,
  selectedGrantRef: OrgManagerGrantRouteRef | null,
) {
  if (!selectedGrantRef) {
    return null;
  }

  return (
    grants?.grants.find(
      (grant) =>
        grant.containerId === selectedGrantRef.containerId &&
        grant.subjectId === selectedGrantRef.subjectId &&
        grant.subjectType === selectedGrantRef.subjectType,
    ) ?? null
  );
}

function deriveMutationPermissions(input: {
  readonly canCreateGroup: boolean;
  readonly canLoadAuthenticatedOrgData: boolean;
  readonly crypto: DeriveOrgManagerStateInput["crypto"];
  readonly databaseReady: boolean;
  readonly hasMemberGroup: boolean;
  readonly userId: string | null;
}) {
  const hasMutationIdentity = Boolean(
    input.userId &&
      input.crypto.hasSigningFingerprint &&
      input.crypto.hasSigningKeyPair,
  );

  return {
    canDisableRosterUsers: Boolean(
      input.canLoadAuthenticatedOrgData &&
        input.canCreateGroup &&
        input.hasMemberGroup &&
        hasMutationIdentity &&
        input.databaseReady,
    ),
    canImportRosterUser: Boolean(
      input.canLoadAuthenticatedOrgData &&
        input.canCreateGroup &&
        input.hasMemberGroup &&
        hasMutationIdentity &&
        input.crypto.hasEncapsulationKeyPair,
    ),
  };
}

export function deriveOrgManagerState(input: DeriveOrgManagerStateInput) {
  const scoped = deriveScopedState(input);
  const selectedGroup =
    input.activeGroups.find(
      (group) => group.groupId === input.selectedGroupId,
    ) ?? null;
  const selectedGrant = findSelectedGrant(
    scoped.activeGrants,
    input.selectedGrantRef,
  );
  const selectedGroupIsMembersGroup =
    selectedGroup?.name === ORG_MANAGER_LABELS.members;
  const selectedGroupIsAdminsGroup =
    selectedGroup?.name === ORG_MANAGER_LABELS.admins;
  const canCreateGroup = Boolean(
    input.databaseReady && input.activeDirectory?.currentUser.isOrgAdmin,
  );
  const mutationPermissions = deriveMutationPermissions({
    canCreateGroup,
    canLoadAuthenticatedOrgData: input.canLoadAuthenticatedOrgData,
    crypto: input.crypto,
    databaseReady: input.databaseReady,
    hasMemberGroup: Boolean(scoped.activeMemberGroupId),
    userId: input.userId,
  });
  const canMutateSelectedGroup =
    input.databaseReady &&
    canCurrentUserMutateSelectedGroup({
      directory: input.activeDirectory,
      members: scoped.activeMembers,
      userId: input.userId,
    });
  const selectedRosterUser =
    scoped.activeUserDetail?.user ??
    input.activeDirectory?.users.find(
      (user) => user.userId === input.selectedUserId,
    ) ??
    null;
  const memberUserIds = new Set(
    scoped.activeMembers?.members.map((member) => member.userId) ?? [],
  );
  const addableUsers =
    input.activeDirectory?.users.filter(
      (user) =>
        (user.status === "active" || selectedGroupIsMembersGroup) &&
        !memberUserIds.has(user.userId),
    ) ?? [];

  return {
    ...scoped,
    addableUsers,
    canCreateGroup,
    ...mutationPermissions,
    canMutateSelectedGroup,
    canRevokeGrants: canCreateGroup,
    memberUserIds,
    selectedGrant,
    selectedGroup,
    selectedGroupIsAdminsGroup,
    selectedGroupIsMembersGroup,
    selectedRosterUser,
  };
}
