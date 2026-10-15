import { useCallback, useMemo } from "react";
import { useLog } from "../../../providers/logging/LogProvider";
import { useImportRosterIdentityLink } from "../directory/useImportRosterIdentityLink";
import { useOrgManagerDisableRosterUser } from "../directory/useOrgManagerDisableRosterUser";
import { useOrgManagerMembershipMutations } from "../groups/useOrgManagerMembershipMutations";
import { groupSignedName } from "../labels";
import type { OrgManagerMutationsParams } from "./orgManagerMutationsTypes";
import { runScopedOrgMutation } from "./runScopedOrgMutation";
import { useOrgManagerRevokeGrant } from "./useOrgManagerRevokeGrant";

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
    invalidateSelectedGroupDetails,
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
    selectedGroupIsAdminsGroup,
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
  const { logError } = useLog();
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
    await runScopedOrgMutation({
      isOperationActive,
      logError,
      operationOrganizationId,
      run: async () => {
        const createdGroup = await orgManagerActions.createGroup(
          groupNameDraft.trim(),
        );
        if (!isOperationActive(operationOrganizationId)) {
          return;
        }
        setGroupNameDraft("");
        setIsCreateGroupDialogOpen(false);
        await refreshDirectoryAndGroups({ afterMutation: true });
        if (!isOperationActive(operationOrganizationId)) {
          return;
        }
        openGroupRoute(createdGroup.groupId);
      },
      setError,
      setMutating,
    });
  }, [
    appData.auth.organizationId,
    appData.auth.userId,
    appData.crypto.encapsulationKeyPair,
    appData.crypto.signingFingerprint,
    appData.crypto.signingKeyPair,
    groupNameDraft,
    isOperationActive,
    logError,
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
      await runScopedOrgMutation({
        isOperationActive,
        logError,
        operationOrganizationId,
        run: async () => {
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
            afterMutation: true,
            skipNextGroupDetailsEffect: true,
          });
        },
        setError,
        setMutating,
      });
    },
    [
      canDeleteGroup,
      groups,
      isOperationActive,
      logError,
      orgManagerActions,
      refreshDirectoryAndGroups,
      selectGroup,
      selectedGroupIdRef,
      setError,
      setGroupContainers,
      setGroupPolicyHistory,
      setMembers,
      setMutating,
    ],
  );

  const importRosterUser = useImportRosterIdentityLink({
    appData,
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
    isOperationActive,
    logError,
  });

  const { addUser, removeMember } = useOrgManagerMembershipMutations({
    addUserId,
    appData,
    directory,
    invalidateSelectedGroupDetails,
    isOperationActive,
    logError,
    memberGroupId,
    members,
    orgManagerActions,
    refreshDirectoryAndGroups,
    refreshSelectedGroupDetails,
    selectedGroupId,
    // A group without a readable signed name cannot be acted on by name.
    selectedGroupName: groupSignedName(
      groups.find((group) => group.groupId === selectedGroupId),
    ),
    selectedGroupIsAdminsGroup,
    selectedGroupIsMembersGroup,
    setAddUserId,
    setError,
    setMutating,
  });

  const disableRosterUser = useOrgManagerDisableRosterUser({
    appData,
    canDisableRosterUsers,
    directory,
    groups,
    invalidateSelectedGroupDetails,
    logError,
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
