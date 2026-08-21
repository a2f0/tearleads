import type {
  OrganizationContainerGrants,
  OrganizationDirectory,
  OrganizationGroupContainers,
  OrganizationGroupMembers,
  OrganizationGroupPolicyHistory,
  OrganizationGroupSummary,
  OrganizationUserDetail,
} from "@symcrypt/client-sdk";
import type { Dispatch, SetStateAction } from "react";
import { useCallback, useMemo } from "react";
import type { useSymCryptRuntime } from "../../../providers/sdk/SymCryptProvider";
import type { useOrgManagerActions } from "../../../stores/org-manager/OrgManagerProvider";
import { prepareRosterImport } from "../groups/orgManagerMutationOperations";
import { useOrgManagerMembershipMutations } from "../groups/useOrgManagerMembershipMutations";
import type { useOrgManagerRefreshers } from "../refreshers/useOrgManagerRefreshers";
import type { OrgManagerView } from "../routes";
import { runScopedOrgMutation } from "./runScopedOrgMutation";
import { useOrgManagerDisableRosterUser } from "./useOrgManagerDisableRosterUser";
import { useOrgManagerRevokeGrant } from "./useOrgManagerRevokeGrant";

type Refreshers = ReturnType<typeof useOrgManagerRefreshers>;

interface OrgManagerMutationsParams {
  addUserId: string;
  appData: ReturnType<typeof useSymCryptRuntime>;
  canDeleteGroup: (group: OrganizationGroupSummary) => boolean;
  canDisableRosterUsers: boolean;
  canImportRosterUser: boolean;
  directory: OrganizationDirectory | null;
  groupNameDraft: string;
  groups: ReadonlyArray<OrganizationGroupSummary>;
  importUserIdDraft: string;
  invalidateSelectedGroupDetails: Refreshers["invalidateSelectedGroupDetails"];
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
  selectedGroupIsAdminsGroup: boolean;
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
    await runScopedOrgMutation({
      isOperationActive,
      operationOrganizationId,
      run: async () => {
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
          afterMutation: true,
          skipNextGroupDetailsEffect: true,
        });
        if (!isOperationActive(operationOrganizationId)) {
          return;
        }
        setOrgManagerView("directory");
        selectUser(targetUser.userId);
        await refreshSelectedUserDetail(targetUser.userId);
      },
      setError,
      setMutating,
    });
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

  const { addUser, removeMember } = useOrgManagerMembershipMutations({
    addUserId,
    appData,
    directory,
    invalidateSelectedGroupDetails,
    isOperationActive,
    memberGroupId,
    members,
    orgManagerActions,
    refreshDirectoryAndGroups,
    refreshSelectedGroupDetails,
    selectedGroupId,
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
