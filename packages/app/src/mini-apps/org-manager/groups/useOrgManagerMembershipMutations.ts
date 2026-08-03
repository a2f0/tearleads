import type {
  OrganizationDirectory,
  OrganizationGroupMembers,
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
  readonly invalidateSelectedGroupDetails: Refreshers["invalidateSelectedGroupDetails"];
  readonly isOperationActive: (organizationId: string) => boolean;
  readonly memberGroupId: string | null;
  readonly members: OrganizationGroupMembers | null;
  readonly orgManagerActions: ReturnType<typeof useOrgManagerActions>;
  readonly refreshDirectoryAndGroups: Refreshers["refreshDirectoryAndGroups"];
  readonly refreshSelectedGroupDetails: Refreshers["refreshSelectedGroupDetails"];
  readonly selectedGroupId: string | null;
  readonly selectedGroupIsAdminsGroup: boolean;
  readonly selectedGroupIsMembersGroup: boolean;
  readonly setAddUserId: Dispatch<SetStateAction<string>>;
  readonly setError: Dispatch<SetStateAction<string | null>>;
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
      isAdminGroup: params.selectedGroupIsAdminsGroup,
      isOperationActive: params.isOperationActive,
      memberGroupId: params.memberGroupId,
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
      invalidateSelectedGroupDetails: params.invalidateSelectedGroupDetails,
      isOperationActive: params.isOperationActive,
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
    await params.orgManagerActions.removeUserFromGroup(
      params.selectedGroupId,
      removedUserId,
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
      params.invalidateSelectedGroupDetails,
      params.isOperationActive,
      params.memberGroupId,
      params.members,
      params.orgManagerActions,
      params.refreshDirectoryAndGroups,
      params.refreshSelectedGroupDetails,
      params.selectedGroupId,
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
      params.orgManagerActions,
      params.refreshDirectoryAndGroups,
      params.refreshSelectedGroupDetails,
      params.selectedGroupId,
      params.setError,
      params.setMutating,
    ],
  );

  return { addUser, removeMember };
}
