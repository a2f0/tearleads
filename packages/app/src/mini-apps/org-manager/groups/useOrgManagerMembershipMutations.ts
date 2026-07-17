import type {
  OrganizationDirectory,
  OrganizationGroupMembers,
  OrganizationGroupPolicyHistory,
} from "@tearleads/client-sdk";
import type { Dispatch, SetStateAction } from "react";
import { useCallback } from "react";
import type { useTearleadsRuntime } from "../../../providers/sdk/TearleadsProvider";
import type { useOrgManagerActions } from "../../../stores/org-manager/OrgManagerProvider";
import type { useOrgManagerRefreshers } from "../hooks/useOrgManagerRefreshers";
import { ORG_MANAGER_LABELS } from "../labels";
import { setUnknownError } from "../refresh";
import {
  addRosterUserToGroup,
  refreshAfterGroupMutation,
} from "./orgManagerMutationOperations";

type Refreshers = ReturnType<typeof useOrgManagerRefreshers>;

interface OrgManagerMembershipMutationsParams {
  readonly addUserId: string;
  readonly appData: ReturnType<typeof useTearleadsRuntime>;
  readonly directory: OrganizationDirectory | null;
  readonly isOperationActive: (organizationId: string) => boolean;
  readonly members: OrganizationGroupMembers | null;
  readonly orgManagerActions: ReturnType<typeof useOrgManagerActions>;
  readonly refreshDirectoryAndGroups: Refreshers["refreshDirectoryAndGroups"];
  readonly refreshSelectedGroupDetails: Refreshers["refreshSelectedGroupDetails"];
  readonly selectedGroupId: string | null;
  readonly selectedGroupIsMembersGroup: boolean;
  readonly setAddUserId: Dispatch<SetStateAction<string>>;
  readonly setError: Dispatch<SetStateAction<string | null>>;
  readonly setGroupPolicyHistory: Dispatch<
    SetStateAction<OrganizationGroupPolicyHistory | null>
  >;
  readonly setMembers: Dispatch<
    SetStateAction<OrganizationGroupMembers | null>
  >;
  readonly setMutating: Dispatch<SetStateAction<boolean>>;
}

async function addUserToSelectedGroup(
  params: OrgManagerMembershipMutationsParams,
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

  params.setMutating(true);
  params.setError(null);
  try {
    const policyBundle = await addRosterUserToGroup({
      directoryUser,
      groupId: params.selectedGroupId,
      isOperationActive: params.isOperationActive,
      operationOrganizationId,
      orgManagerActions: params.orgManagerActions,
      setError: params.setError,
      targetUserId,
    });
    if (!policyBundle) {
      return;
    }
    params.setAddUserId("");
    await refreshAfterGroupMutation({
      isOperationActive: params.isOperationActive,
      mutationProjection: {
        bundle: policyBundle,
        groupId: params.selectedGroupId,
        setGroupPolicyHistory: params.setGroupPolicyHistory,
        setMembers: params.setMembers,
      },
      operationOrganizationId,
      refreshDirectoryAndGroups: params.refreshDirectoryAndGroups,
      refreshSelectedGroupDetails: params.refreshSelectedGroupDetails,
    });
  } catch (error) {
    if (params.isOperationActive(operationOrganizationId)) {
      setUnknownError(params.setError, error);
    }
  } finally {
    if (params.isOperationActive(operationOrganizationId)) {
      params.setMutating(false);
    }
  }
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
  const operationOrganizationId = params.directory.organizationId;
  if (!params.isOperationActive(operationOrganizationId)) {
    return;
  }
  params.setMutating(true);
  params.setError(null);
  try {
    const policyBundle = await params.orgManagerActions.removeUserFromGroup(
      params.selectedGroupId,
      removedUserId,
    );
    if (!params.isOperationActive(operationOrganizationId)) {
      return;
    }
    await refreshAfterGroupMutation({
      isOperationActive: params.isOperationActive,
      mutationProjection: {
        bundle: policyBundle,
        groupId: params.selectedGroupId,
        setGroupPolicyHistory: params.setGroupPolicyHistory,
        setMembers: params.setMembers,
      },
      operationOrganizationId,
      refreshDirectoryAndGroups: params.refreshDirectoryAndGroups,
      refreshSelectedGroupDetails: params.refreshSelectedGroupDetails,
    });
  } catch (error) {
    if (params.isOperationActive(operationOrganizationId)) {
      setUnknownError(params.setError, error);
    }
  } finally {
    if (params.isOperationActive(operationOrganizationId)) {
      params.setMutating(false);
    }
  }
}

export function useOrgManagerMembershipMutations(
  params: OrgManagerMembershipMutationsParams,
) {
  const addUser = useCallback(
    () => addUserToSelectedGroup(params),
    [
      params.addUserId,
      params.appData.auth.userId,
      params.appData.crypto.encapsulationKeyPair,
      params.appData.crypto.signingFingerprint,
      params.appData.crypto.signingKeyPair,
      params.directory,
      params.isOperationActive,
      params.members,
      params.orgManagerActions,
      params.refreshDirectoryAndGroups,
      params.refreshSelectedGroupDetails,
      params.selectedGroupId,
      params.selectedGroupIsMembersGroup,
      params.setAddUserId,
      params.setError,
      params.setGroupPolicyHistory,
      params.setMembers,
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
      params.isOperationActive,
      params.orgManagerActions,
      params.refreshDirectoryAndGroups,
      params.refreshSelectedGroupDetails,
      params.selectedGroupId,
      params.setError,
      params.setGroupPolicyHistory,
      params.setMembers,
      params.setMutating,
    ],
  );

  return { addUser, removeMember };
}
