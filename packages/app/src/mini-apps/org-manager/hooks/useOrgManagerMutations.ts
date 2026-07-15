import type {
  OrganizationContainerGrants,
  OrganizationDirectory,
  OrganizationGroupContainers,
  OrganizationGroupMembers,
  OrganizationGroupPolicyHistory,
  OrganizationGroupSummary,
  OrganizationUserDetail,
} from "@tearleads/client-sdk";
import type { Dispatch, SetStateAction } from "react";
import { useCallback, useMemo } from "react";
import type { useTearleadsRuntime } from "../../../providers/sdk/TearleadsProvider";
import type { useOrgManagerActions } from "../../../stores/org-manager/OrgManagerProvider";
import {
  addRosterUserToGroup,
  prepareRosterImport,
  refreshAfterGroupMutation,
} from "../groups/orgManagerMutationOperations";
import { ORG_MANAGER_LABELS } from "../labels";
import { setUnknownError } from "../refresh";
import type { OrgManagerView } from "../routes";
import { useOrgManagerDisableRosterUser } from "./useOrgManagerDisableRosterUser";
import type { useOrgManagerRefreshers } from "./useOrgManagerRefreshers";
import { useOrgManagerRevokeGrant } from "./useOrgManagerRevokeGrant";

type Refreshers = ReturnType<typeof useOrgManagerRefreshers>;

interface OrgManagerMutationsParams {
  addUserId: string;
  appData: ReturnType<typeof useTearleadsRuntime>;
  canDeleteGroup: (group: OrganizationGroupSummary) => boolean;
  canDisableRosterUsers: boolean;
  canImportRosterUser: boolean;
  directory: OrganizationDirectory | null;
  groupNameDraft: string;
  groups: ReadonlyArray<OrganizationGroupSummary>;
  importUserIdDraft: string;
  memberGroupId: string | null;
  members: OrganizationGroupMembers | null;
  openGroupRoute: (groupId: string) => void;
  orgManagerActions: ReturnType<typeof useOrgManagerActions>;
  refreshDirectoryAndGroups: Refreshers["refreshDirectoryAndGroups"];
  refreshSelectedGroupDetails: Refreshers["refreshSelectedGroupDetails"];
  refreshSelectedUserDetail: Refreshers["refreshSelectedUserDetail"];
  selectGroup: (groupId: string | null) => void;
  selectUser: (userId: string | null) => void;
  selectedGroupId: string | null;
  selectedGroupIdRef: { current: string | null };
  selectedGroupIsMembersGroup: boolean;
  selectedUserIdRef: { current: string | null };
  setAddUserId: Dispatch<SetStateAction<string>>;
  setError: Dispatch<SetStateAction<string | null>>;
  setGrants: Dispatch<SetStateAction<OrganizationContainerGrants | null>>;
  setGroupContainers: Dispatch<
    SetStateAction<OrganizationGroupContainers | null>
  >;
  setGroupPolicyHistory: Dispatch<
    SetStateAction<OrganizationGroupPolicyHistory | null>
  >;
  setGroupNameDraft: Dispatch<SetStateAction<string>>;
  setImportUserIdDraft: Dispatch<SetStateAction<string>>;
  setIsCreateGroupDialogOpen: Dispatch<SetStateAction<boolean>>;
  setIsImportUserDialogOpen: Dispatch<SetStateAction<boolean>>;
  setMembers: Dispatch<SetStateAction<OrganizationGroupMembers | null>>;
  setMutating: Dispatch<SetStateAction<boolean>>;
  setOrgManagerView: (nextView: OrgManagerView) => void;
  setUserDetail: Dispatch<SetStateAction<OrganizationUserDetail | null>>;
}

// biome-ignore lint/complexity/noExcessiveLinesPerFunction: Colocates org-manager write actions that share setters and refresh sequencing.
export function useOrgManagerMutations(params: OrgManagerMutationsParams) {
  const {
    addUserId,
    appData,
    canDeleteGroup,
    canDisableRosterUsers,
    canImportRosterUser,
    directory,
    groupNameDraft,
    groups,
    importUserIdDraft,
    memberGroupId,
    members,
    openGroupRoute,
    orgManagerActions,
    refreshDirectoryAndGroups,
    refreshSelectedGroupDetails,
    refreshSelectedUserDetail,
    selectGroup,
    selectUser,
    selectedGroupId,
    selectedGroupIdRef,
    selectedGroupIsMembersGroup,
    selectedUserIdRef,
    setAddUserId,
    setError,
    setGrants,
    setGroupContainers,
    setGroupPolicyHistory,
    setGroupNameDraft,
    setImportUserIdDraft,
    setIsCreateGroupDialogOpen,
    setIsImportUserDialogOpen,
    setMembers,
    setMutating,
    setOrgManagerView,
    setUserDetail,
  } = params;
  const operationScope = useMemo(
    () => orgManagerActions.captureOperationScope(),
    [orgManagerActions.captureOperationScope],
  );
  const isOperationActive = useCallback(
    (organizationId: string) =>
      operationScope?.organizationId === organizationId &&
      orgManagerActions.isOperationScopeActive(operationScope),
    [operationScope, orgManagerActions],
  );

  const createGroup = useCallback(async () => {
    if (
      !appData.auth.organizationId ||
      !appData.auth.userId ||
      !appData.crypto.signingFingerprint ||
      !appData.crypto.signingKeyPair ||
      !appData.crypto.encapsulationKeyPair ||
      groupNameDraft.trim().length === 0
    ) {
      return;
    }
    const operationOrganizationId = appData.auth.organizationId;
    if (!isOperationActive(operationOrganizationId)) {
      return;
    }
    setMutating(true);
    setError(null);
    try {
      const createdGroup = await orgManagerActions.createGroup(
        groupNameDraft.trim(),
      );
      if (!isOperationActive(operationOrganizationId)) {
        return;
      }
      setGroupNameDraft("");
      setIsCreateGroupDialogOpen(false);
      await refreshDirectoryAndGroups();
      if (!isOperationActive(operationOrganizationId)) {
        return;
      }
      openGroupRoute(createdGroup.groupId);
    } catch (nextError) {
      if (isOperationActive(operationOrganizationId)) {
        setUnknownError(setError, nextError);
      }
    } finally {
      if (isOperationActive(operationOrganizationId)) {
        setMutating(false);
      }
    }
  }, [
    appData.auth.organizationId,
    appData.auth.userId,
    appData.crypto.encapsulationKeyPair,
    appData.crypto.signingFingerprint,
    appData.crypto.signingKeyPair,
    groupNameDraft,
    isOperationActive,
    openGroupRoute,
    orgManagerActions,
    refreshDirectoryAndGroups,
    setError,
    setGroupNameDraft,
    setIsCreateGroupDialogOpen,
    setMutating,
  ]);

  const deleteGroup = useCallback(
    async (groupId: string) => {
      const targetGroup =
        groups.find((group) => group.groupId === groupId) ?? null;
      if (!targetGroup || !canDeleteGroup(targetGroup)) {
        return;
      }
      const operationOrganizationId = targetGroup.organizationId;
      if (!isOperationActive(operationOrganizationId)) {
        return;
      }

      setMutating(true);
      setError(null);
      try {
        const wasSelectedGroup = selectedGroupIdRef.current === groupId;
        if (wasSelectedGroup) {
          selectGroup(null);
          setMembers(null);
          setGroupContainers(null);
          setGroupPolicyHistory(null);
        }

        await orgManagerActions.deleteGroup(groupId);
        if (!isOperationActive(operationOrganizationId)) {
          return;
        }
        await refreshDirectoryAndGroups({
          skipNextGroupDetailsEffect: true,
        });
        if (!isOperationActive(operationOrganizationId)) {
          return;
        }
        await refreshSelectedUserDetail(selectedUserIdRef.current);
      } catch (nextError) {
        if (isOperationActive(operationOrganizationId)) {
          setUnknownError(setError, nextError);
        }
      } finally {
        if (isOperationActive(operationOrganizationId)) {
          setMutating(false);
        }
      }
    },
    [
      canDeleteGroup,
      groups,
      isOperationActive,
      orgManagerActions,
      refreshDirectoryAndGroups,
      refreshSelectedUserDetail,
      selectGroup,
      selectedGroupIdRef,
      selectedUserIdRef,
      setError,
      setGroupContainers,
      setGroupPolicyHistory,
      setMembers,
      setMutating,
    ],
  );

  const importRosterUser = useCallback(async () => {
    const targetUserId = importUserIdDraft.trim();
    if (
      !canImportRosterUser ||
      !directory ||
      !memberGroupId ||
      targetUserId.length === 0 ||
      !appData.auth.userId ||
      !appData.crypto.signingFingerprint ||
      !appData.crypto.signingKeyPair ||
      !appData.crypto.encapsulationKeyPair
    ) {
      return;
    }
    const operationOrganizationId = directory.organizationId;
    if (!isOperationActive(operationOrganizationId)) {
      return;
    }

    setMutating(true);
    setError(null);
    try {
      const targetUser = await prepareRosterImport({
        directory,
        isOperationActive,
        memberGroupId,
        operationOrganizationId,
        orgManagerActions,
        setError,
        targetUserId,
      });
      if (!targetUser) {
        return;
      }

      setImportUserIdDraft("");
      setIsImportUserDialogOpen(false);
      await refreshDirectoryAndGroups({
        skipNextGroupDetailsEffect: true,
      });
      if (!isOperationActive(operationOrganizationId)) {
        return;
      }
      setOrgManagerView("directory");
      selectUser(targetUser.userId);
      await refreshSelectedUserDetail(targetUser.userId);
    } catch (nextError) {
      if (isOperationActive(operationOrganizationId)) {
        setUnknownError(setError, nextError);
      }
    } finally {
      if (isOperationActive(operationOrganizationId)) {
        setMutating(false);
      }
    }
  }, [
    appData.auth.userId,
    appData.crypto.encapsulationKeyPair,
    appData.crypto.signingFingerprint,
    appData.crypto.signingKeyPair,
    canImportRosterUser,
    directory,
    importUserIdDraft,
    isOperationActive,
    memberGroupId,
    orgManagerActions,
    refreshDirectoryAndGroups,
    refreshSelectedUserDetail,
    selectUser,
    setOrgManagerView,
    setError,
    setImportUserIdDraft,
    setIsImportUserDialogOpen,
    setMutating,
  ]);

  const addUser = useCallback(async () => {
    const targetUserId = addUserId.trim();
    const directoryUser = directory?.users.find(
      (user) => user.userId === targetUserId,
    );
    if (
      !directory ||
      !members ||
      targetUserId.length === 0 ||
      !selectedGroupId ||
      !appData.auth.userId ||
      !appData.crypto.signingFingerprint ||
      !appData.crypto.signingKeyPair ||
      !appData.crypto.encapsulationKeyPair
    ) {
      return;
    }
    const operationOrganizationId = directory.organizationId;
    if (!isOperationActive(operationOrganizationId)) {
      return;
    }
    if (directoryUser?.status === "disabled" && !selectedGroupIsMembersGroup) {
      setError(ORG_MANAGER_LABELS.userNotFound);
      return;
    }

    setMutating(true);
    setError(null);
    try {
      const didAdd = await addRosterUserToGroup({
        directory,
        directoryUser,
        groupId: selectedGroupId,
        isOperationActive,
        operationOrganizationId,
        orgManagerActions,
        setError,
        targetUserId,
      });
      if (!didAdd) {
        return;
      }
      setAddUserId("");
      await refreshAfterGroupMutation({
        isOperationActive,
        operationOrganizationId,
        refreshDirectoryAndGroups,
        refreshSelectedGroupDetails,
        refreshSelectedUserDetail,
        selectedUserIdRef,
      });
    } catch (nextError) {
      if (isOperationActive(operationOrganizationId)) {
        setUnknownError(setError, nextError);
      }
    } finally {
      if (isOperationActive(operationOrganizationId)) {
        setMutating(false);
      }
    }
  }, [
    addUserId,
    appData.auth.userId,
    appData.crypto.encapsulationKeyPair,
    appData.crypto.signingFingerprint,
    appData.crypto.signingKeyPair,
    directory,
    isOperationActive,
    members,
    orgManagerActions,
    refreshDirectoryAndGroups,
    refreshSelectedGroupDetails,
    refreshSelectedUserDetail,
    selectedGroupIsMembersGroup,
    selectedGroupId,
    selectedUserIdRef,
    setAddUserId,
    setError,
    setMutating,
  ]);

  const removeMember = useCallback(
    async (removedUserId: string) => {
      if (
        !selectedGroupId ||
        !appData.auth.userId ||
        !appData.crypto.signingFingerprint ||
        !appData.crypto.signingKeyPair ||
        !directory
      ) {
        return;
      }
      const operationOrganizationId = directory.organizationId;
      if (!isOperationActive(operationOrganizationId)) {
        return;
      }
      setMutating(true);
      setError(null);
      try {
        await orgManagerActions.removeUserFromGroup(
          selectedGroupId,
          removedUserId,
          directory.currentUser.isOrgAdmin,
        );
        if (!isOperationActive(operationOrganizationId)) {
          return;
        }
        await refreshAfterGroupMutation({
          isOperationActive,
          operationOrganizationId,
          refreshDirectoryAndGroups,
          refreshSelectedGroupDetails,
          refreshSelectedUserDetail,
          selectedUserIdRef,
        });
      } catch (nextError) {
        if (isOperationActive(operationOrganizationId)) {
          setUnknownError(setError, nextError);
        }
      } finally {
        if (isOperationActive(operationOrganizationId)) {
          setMutating(false);
        }
      }
    },
    [
      appData.auth.userId,
      appData.crypto.signingFingerprint,
      appData.crypto.signingKeyPair,
      directory,
      isOperationActive,
      orgManagerActions,
      refreshDirectoryAndGroups,
      refreshSelectedGroupDetails,
      refreshSelectedUserDetail,
      selectedGroupId,
      selectedUserIdRef,
      setError,
      setMutating,
    ],
  );

  const disableRosterUser = useOrgManagerDisableRosterUser({
    appData,
    canDisableRosterUsers,
    directory,
    groups,
    memberGroupId,
    orgManagerActions,
    refreshDirectoryAndGroups,
    refreshSelectedGroupDetails,
    refreshSelectedUserDetail,
    selectedUserIdRef,
    setError,
    setMutating,
    isOperationActive,
  });
  const revokeGrant = useOrgManagerRevokeGrant({
    isOperationActive,
    organizationId: appData.auth.organizationId,
    orgManagerActions,
    setError,
    setGrants,
    setGroupContainers,
    setMutating,
    setUserDetail,
  });

  return {
    addUser,
    createGroup,
    deleteGroup,
    disableRosterUser,
    importRosterUser,
    removeMember,
    revokeGrant,
  };
}
