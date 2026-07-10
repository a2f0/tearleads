import type {
  OrganizationContainerGrant,
  OrganizationContainerGrants,
  OrganizationDirectory,
  OrganizationGroupContainers,
  OrganizationGroupMembers,
  OrganizationGroupPolicyHistory,
  OrganizationGroupSummary,
  OrganizationUserDetail,
} from "@tearleads/client-sdk";
import type { Dispatch, SetStateAction } from "react";
import { useCallback } from "react";
import type { useTearleadsRuntime } from "../../../providers/sdk/TearleadsProvider";
import type { useOrgManagerActions } from "../../../stores/org-manager/OrgManagerProvider";
import {
  removeRevokedGrantFromGrantState,
  removeRevokedGrantFromGroupContainers,
  removeRevokedGrantFromUserDetail,
} from "../grants/grantState";
import {
  currentGroupUserRecipients,
  userRecipient,
} from "../grants/recipients";
import { ORG_MANAGER_LABELS } from "../labels";
import { setUnknownError } from "../refresh";
import type { OrgManagerView } from "../routes";
import { useOrgManagerDisableRosterUser } from "./useOrgManagerDisableRosterUser";
import type { useOrgManagerRefreshers } from "./useOrgManagerRefreshers";

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
    setMutating(true);
    setError(null);
    try {
      const createdGroup = await orgManagerActions.createGroup(
        groupNameDraft.trim(),
      );
      setGroupNameDraft("");
      setIsCreateGroupDialogOpen(false);
      await refreshDirectoryAndGroups();
      openGroupRoute(createdGroup.groupId);
    } catch (nextError) {
      setUnknownError(setError, nextError);
    } finally {
      setMutating(false);
    }
  }, [
    appData.auth.organizationId,
    appData.auth.userId,
    appData.crypto.encapsulationKeyPair,
    appData.crypto.signingFingerprint,
    appData.crypto.signingKeyPair,
    groupNameDraft,
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
        await refreshDirectoryAndGroups({
          skipNextGroupDetailsEffect: true,
        });
        await refreshSelectedUserDetail(selectedUserIdRef.current);
      } catch (nextError) {
        setUnknownError(setError, nextError);
      } finally {
        setMutating(false);
      }
    },
    [
      canDeleteGroup,
      groups,
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

    setMutating(true);
    setError(null);
    try {
      const directoryUser =
        directory.users.find((user) => user.userId === targetUserId) ?? null;
      const [targetUser, memberGroupDetails] = await Promise.all([
        directoryUser
          ? Promise.resolve(userRecipient(directoryUser))
          : orgManagerActions.importUserById(targetUserId),
        orgManagerActions.loadGroupDetails(memberGroupId),
      ]);
      if (!targetUser) {
        setError(ORG_MANAGER_LABELS.userNotFound);
        return;
      }
      if (!memberGroupDetails.members) {
        setError(ORG_MANAGER_LABELS.failedLoadGroupMembers);
        return;
      }

      const memberGroupUserIds = new Set(
        memberGroupDetails.members.members
          .filter((member) => member.memberPrincipalType === "user")
          .map((member) => member.memberPrincipalId),
      );
      if (!memberGroupUserIds.has(targetUser.userId)) {
        await orgManagerActions.addUserToGroup(
          memberGroupId,
          targetUser,
          currentGroupUserRecipients({
            directory,
            members: memberGroupDetails.members,
          }),
          directory.currentUser.isOrgAdmin,
        );
      }

      setImportUserIdDraft("");
      setIsImportUserDialogOpen(false);
      await refreshDirectoryAndGroups({
        skipNextGroupDetailsEffect: true,
      });
      setOrgManagerView("directory");
      selectUser(targetUser.userId);
      await refreshSelectedUserDetail(targetUser.userId);
    } catch (nextError) {
      setUnknownError(setError, nextError);
    } finally {
      setMutating(false);
    }
  }, [
    appData.auth.userId,
    appData.crypto.encapsulationKeyPair,
    appData.crypto.signingFingerprint,
    appData.crypto.signingKeyPair,
    canImportRosterUser,
    directory,
    importUserIdDraft,
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
    if (directoryUser?.status === "disabled" && !selectedGroupIsMembersGroup) {
      setError(ORG_MANAGER_LABELS.userNotFound);
      return;
    }

    setMutating(true);
    setError(null);
    try {
      const targetUser = directoryUser
        ? userRecipient(directoryUser)
        : await orgManagerActions.importUserById(targetUserId);
      if (!targetUser) {
        setError(ORG_MANAGER_LABELS.userNotFound);
        return;
      }

      await orgManagerActions.addUserToGroup(
        selectedGroupId,
        targetUser,
        currentGroupUserRecipients({ directory, members }),
        directory.currentUser.isOrgAdmin,
      );
      setAddUserId("");
      const refreshedDirectory = await refreshDirectoryAndGroups({
        skipNextGroupDetailsEffect: true,
      });
      if (refreshedDirectory.didLoad) {
        await refreshSelectedGroupDetails(refreshedDirectory.groupId);
      }
      await refreshSelectedUserDetail(selectedUserIdRef.current);
    } catch (nextError) {
      setUnknownError(setError, nextError);
    } finally {
      setMutating(false);
    }
  }, [
    addUserId,
    appData.auth.userId,
    appData.crypto.encapsulationKeyPair,
    appData.crypto.signingFingerprint,
    appData.crypto.signingKeyPair,
    directory,
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
      setMutating(true);
      setError(null);
      try {
        await orgManagerActions.removeUserFromGroup(
          selectedGroupId,
          removedUserId,
          currentGroupUserRecipients({ directory, members }).filter(
            (user) => user.userId !== removedUserId,
          ),
          directory.currentUser.isOrgAdmin,
        );
        const refreshedDirectory = await refreshDirectoryAndGroups({
          skipNextGroupDetailsEffect: true,
        });
        if (refreshedDirectory.didLoad) {
          await refreshSelectedGroupDetails(refreshedDirectory.groupId);
        }
        await refreshSelectedUserDetail(selectedUserIdRef.current);
      } catch (nextError) {
        setUnknownError(setError, nextError);
      } finally {
        setMutating(false);
      }
    },
    [
      appData.auth.userId,
      appData.crypto.signingFingerprint,
      appData.crypto.signingKeyPair,
      directory,
      members,
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
  });

  const revokeGrant = useCallback(
    async (grant: OrganizationContainerGrant) => {
      if (grant.isBuiltin) {
        return;
      }

      setMutating(true);
      setError(null);
      try {
        await orgManagerActions.revokeGrant(grant);
        setGrants((currentGrants) =>
          removeRevokedGrantFromGrantState(currentGrants, grant),
        );
        setGroupContainers((currentGroupContainers) =>
          removeRevokedGrantFromGroupContainers(currentGroupContainers, grant),
        );
        setUserDetail((currentUserDetail) =>
          removeRevokedGrantFromUserDetail(currentUserDetail, grant),
        );
      } catch (nextError) {
        setUnknownError(setError, nextError);
      } finally {
        setMutating(false);
      }
    },
    [
      orgManagerActions,
      setError,
      setGrants,
      setGroupContainers,
      setMutating,
      setUserDetail,
    ],
  );

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
