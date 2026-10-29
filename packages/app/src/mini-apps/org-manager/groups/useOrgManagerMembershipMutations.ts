import type {
  OrganizationDirectory,
  OrganizationGroupMembers,
  UserIdentities,
} from "@tearleads/client-sdk";
import type { Dispatch, SetStateAction } from "react";
import { useCallback } from "react";
import { useIdentityLinks } from "../../../providers/identity-links/useIdentityLinks";
import type { useTearleadsRuntime } from "../../../providers/sdk/TearleadsProvider";
import type { useOrgManagerActions } from "../../../stores/org-manager/OrgManagerProvider";
import { runScopedOrgMutation } from "../hooks/runScopedOrgMutation";
import { ORG_MANAGER_LABELS } from "../labels";
import type { useOrgManagerRefreshers } from "../refreshers/useOrgManagerRefreshers";
import {
  addRosterUserToGroup,
  refreshAfterGroupMutation,
} from "./orgManagerMutationOperations";
import { resolveGroupIdentity } from "./resolveGroupIdentity";

type Refreshers = ReturnType<typeof useOrgManagerRefreshers>;

interface OrgManagerMembershipMutationsParams {
  readonly addUserId: string;
  readonly appData: ReturnType<typeof useTearleadsRuntime>;
  readonly directory: OrganizationDirectory | null;
  readonly invalidateSelectedGroupDetails: Refreshers["invalidateSelectedGroupDetails"];
  readonly isOperationActive: (organizationId: string) => boolean;
  readonly logError: (message: string | Error, cause?: unknown) => void;
  readonly memberGroupId: string | null;
  readonly members: OrganizationGroupMembers | null;
  readonly orgManagerActions: ReturnType<typeof useOrgManagerActions>;
  readonly refreshDirectoryAndGroups: Refreshers["refreshDirectoryAndGroups"];
  readonly refreshSelectedGroupDetails: Refreshers["refreshSelectedGroupDetails"];
  readonly selectedGroupId: string | null;
  readonly selectedGroupName: string | null;
  readonly selectedGroupIsAdminsGroup: boolean;
  readonly selectedGroupIsMembersGroup: boolean;
  readonly setAddUserId: Dispatch<SetStateAction<string>>;
  readonly setError: Dispatch<SetStateAction<string | null>>;
  readonly setMutating: Dispatch<SetStateAction<boolean>>;
}

async function addUserToSelectedGroup(
  params: OrgManagerMembershipMutationsParams,
  identities: Pick<UserIdentities, "verifyLink" | "resolveVerified">,
): Promise<void> {
  const targetUserId = params.addUserId.trim();
  const directoryUser = params.directory?.users.find(
    (user) => user.userId === targetUserId,
  );
  if (
    !params.directory ||
    !params.members ||
    targetUserId.length === 0 ||
    !params.selectedGroupId ||
    !params.appData.auth.userId ||
    !params.appData.crypto.signingFingerprint ||
    !params.appData.crypto.signingKeyPair ||
    !params.appData.crypto.encapsulationKeyPair
  ) {
    return;
  }
  if (params.selectedGroupName === null) {
    params.setError(ORG_MANAGER_LABELS.groupNameUnavailable);
    return;
  }
  const selectedGroupId = params.selectedGroupId;
  const groupName = params.selectedGroupName;
  const operationOrganizationId = params.directory.organizationId;
  if (!params.isOperationActive(operationOrganizationId)) {
    return;
  }
  if (
    directoryUser?.status === "disabled" &&
    !params.selectedGroupIsMembersGroup
  ) {
    params.setError(ORG_MANAGER_LABELS.userNotFound);
    return;
  }

  await runScopedOrgMutation({
    isOperationActive: params.isOperationActive,
    logError: params.logError,
    operationOrganizationId,
    run: async () => {
      // A directory selection must already be link-verified; anyone else
      // needs an identity link. The SDK refuses an unverified member too.
      const verifiedUser = await resolveGroupIdentity({
        directoryUser,
        value: targetUserId,
        ...identities,
      });
      if (!params.isOperationActive(operationOrganizationId)) return;
      const verifiedDirectoryUser = params.directory?.users.find(
        (user) => user.userId === verifiedUser.userId,
      );
      if (
        verifiedDirectoryUser?.status === "disabled" &&
        !params.selectedGroupIsMembersGroup
      ) {
        params.setError(ORG_MANAGER_LABELS.userNotFound);
        return;
      }
      const policyBundle = await addRosterUserToGroup({
        groupId: selectedGroupId,
        groupName,
        isOperationActive: params.isOperationActive,
        operationOrganizationId,
        orgManagerActions: params.orgManagerActions,
        targetUserId: verifiedUser.userId,
      });
      if (!policyBundle) {
        return;
      }
      params.setAddUserId("");
      await refreshAfterGroupMutation({
        invalidateSelectedGroupDetails: params.invalidateSelectedGroupDetails,
        isOperationActive: params.isOperationActive,
        operationOrganizationId,
        refreshDirectoryAndGroups: params.refreshDirectoryAndGroups,
        refreshSelectedGroupDetails: params.refreshSelectedGroupDetails,
      });
    },
    setError: params.setError,
    setMutating: params.setMutating,
  });
}

async function removeUserFromSelectedGroup(
  params: OrgManagerMembershipMutationsParams,
  removedUserId: string,
): Promise<void> {
  if (
    !params.selectedGroupId ||
    !params.appData.auth.userId ||
    !params.appData.crypto.signingFingerprint ||
    !params.appData.crypto.signingKeyPair ||
    !params.directory
  ) {
    return;
  }
  if (
    (params.selectedGroupIsAdminsGroup ||
      params.selectedGroupId === params.memberGroupId) &&
    params.directory.users.some(
      (user) =>
        user.userId === removedUserId && user.isPersonalOrganizationOwner,
    )
  ) {
    params.setError(ORG_MANAGER_LABELS.personalOrganizationOwnerProtection);
    return;
  }
  if (params.selectedGroupName === null) {
    params.setError(ORG_MANAGER_LABELS.groupNameUnavailable);
    return;
  }
  const selectedGroupId = params.selectedGroupId;
  const groupName = params.selectedGroupName;
  const operationOrganizationId = params.directory.organizationId;
  await runScopedOrgMutation({
    isOperationActive: params.isOperationActive,
    logError: params.logError,
    operationOrganizationId,
    run: async () => {
      await params.orgManagerActions.removeUserFromGroup(
        selectedGroupId,
        removedUserId,
        groupName,
      );
      if (!params.isOperationActive(operationOrganizationId)) {
        return;
      }
      await refreshAfterGroupMutation({
        invalidateSelectedGroupDetails: params.invalidateSelectedGroupDetails,
        isOperationActive: params.isOperationActive,
        operationOrganizationId,
        refreshDirectoryAndGroups: params.refreshDirectoryAndGroups,
        refreshSelectedGroupDetails: params.refreshSelectedGroupDetails,
      });
    },
    setError: params.setError,
    setMutating: params.setMutating,
  });
}

export function useOrgManagerMembershipMutations(
  params: OrgManagerMembershipMutationsParams,
) {
  const { verifyLink, resolveVerified } = useIdentityLinks();
  const addUser = useCallback(
    () => addUserToSelectedGroup(params, { verifyLink, resolveVerified }),
    [
      verifyLink,
      resolveVerified,
      params.addUserId,
      params.appData.auth.userId,
      params.appData.crypto.encapsulationKeyPair,
      params.appData.crypto.signingFingerprint,
      params.appData.crypto.signingKeyPair,
      params.directory,
      params.invalidateSelectedGroupDetails,
      params.isOperationActive,
      params.logError,
      params.memberGroupId,
      params.members,
      params.orgManagerActions,
      params.refreshDirectoryAndGroups,
      params.refreshSelectedGroupDetails,
      params.selectedGroupId,
      params.selectedGroupName,
      params.selectedGroupIsAdminsGroup,
      params.selectedGroupIsMembersGroup,
      params.setAddUserId,
      params.setError,
      params.setMutating,
    ],
  );
  const removeMember = useCallback(
    (removedUserId: string) =>
      removeUserFromSelectedGroup(params, removedUserId),
    [
      params.appData.auth.userId,
      params.appData.crypto.signingFingerprint,
      params.appData.crypto.signingKeyPair,
      params.directory,
      params.invalidateSelectedGroupDetails,
      params.isOperationActive,
      params.logError,
      params.memberGroupId,
      params.orgManagerActions,
      params.refreshDirectoryAndGroups,
      params.refreshSelectedGroupDetails,
      params.selectedGroupId,
      params.selectedGroupIsAdminsGroup,
      params.selectedGroupName,
      params.setError,
      params.setMutating,
    ],
  );

  return { addUser, removeMember };
}
