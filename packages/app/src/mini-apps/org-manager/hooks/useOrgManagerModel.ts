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
  useCallback,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  useTearleads,
  useTearleadsRuntime,
} from "../../../providers/sdk/TearleadsProvider";
import { useOrgManagerActions } from "../../../stores/org-manager/OrgManagerProvider";
import { useMiniAppBusActions } from "../../bus";
import { useOrgManagerContextMenu } from "../context-menu/OrgManagerContextMenu";
import { ORG_MANAGER_LABELS } from "../labels";
import { useOrgManagerSidebarPanel } from "../OrgManagerSidebar";
import { canCurrentUserMutateSelectedGroup } from "../permissions";
import type { OrgManagerView } from "../routes";
import { useEnsureRosterProfileDocument } from "./useEnsureRosterProfileDocument";
import { useOrgManagerMutations } from "./useOrgManagerMutations";
import { useOrgManagerProfileDisplayNames } from "./useOrgManagerProfileDisplayNames";
import { useOrgManagerRefreshers } from "./useOrgManagerRefreshers";
import { useOrgManagerRosterActions } from "./useOrgManagerRosterActions";
import { useOrgManagerRoute } from "./useOrgManagerRoute";
import { useOrgManagerRouteMessages } from "./useOrgManagerRouteMessages";
import { useOrgSwitcher } from "./useOrgSwitcher";

// biome-ignore lint/complexity/noExcessiveLinesPerFunction: The hook keeps related async refresh and mutation ordering in one place.
export function useOrgManagerModel() {
  const appData = useTearleadsRuntime();
  const tearleads = useTearleads();
  const orgManagerActions = useOrgManagerActions();
  const { openMiniApp } = useMiniAppBusActions();
  const addUserListId = useId();
  const [directory, setDirectory] = useState<OrganizationDirectory | null>(
    null,
  );
  const [groups, setGroups] = useState<ReadonlyArray<OrganizationGroupSummary>>(
    [],
  );
  const [memberGroupId, setMemberGroupId] = useState<string | null>(null);
  const {
    openGrantRoute,
    openGroupRoute,
    route,
    selectedGrantRef,
    selectedGroupId,
    selectedGroupIdRef,
    setSelectedGrantRef: selectGrantRef,
    setSelectedGroupId: selectGroup,
    setView,
  } = useOrgManagerRoute({ groups });
  const view = route.view;
  const [members, setMembers] = useState<OrganizationGroupMembers | null>(null);
  const [groupContainers, setGroupContainers] =
    useState<OrganizationGroupContainers | null>(null);
  const [groupPolicyHistory, setGroupPolicyHistory] =
    useState<OrganizationGroupPolicyHistory | null>(null);
  const [organizationPolicyHistory, setOrganizationPolicyHistory] =
    useState<OrganizationPolicyHistory | null>(null);
  const [grants, setGrants] = useState<OrganizationContainerGrants | null>(
    null,
  );
  const [dataUsage, setDataUsage] = useState<OrganizationDataUsage | null>(
    null,
  );
  const [selectedUserId, setSelectedUserIdState] = useState<string | null>(
    null,
  );
  const [userDetail, setUserDetail] = useState<OrganizationUserDetail | null>(
    null,
  );
  const [groupNameDraft, setGroupNameDraft] = useState("");
  const [isCreateGroupDialogOpen, setIsCreateGroupDialogOpen] = useState(false);
  const [importUserIdDraft, setImportUserIdDraft] = useState("");
  const [isImportUserDialogOpen, setIsImportUserDialogOpen] = useState(false);
  const [addUserId, setAddUserId] = useState("");
  const [loading, setLoading] = useState(false);
  const [loadingUserDetail, setLoadingUserDetail] = useState(false);
  const [mutating, setMutating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const skippedGroupDetailsEffectRef = useRef<{
    groupId: string | null;
  } | null>(null);
  const selectedUserIdRef = useRef<string | null>(null);
  const canLoadAuthenticatedOrgData = Boolean(
    appData.auth.organizationId && appData.auth.isAuthenticated,
  );
  const {
    profileDisplayNamesByUserId,
    setProfileDisplayNamesByUserId,
    setSelectedProfileDisplayName,
  } = useOrgManagerProfileDisplayNames({
    appData,
    canLoadAuthenticatedOrgData,
    directory,
    orgManagerActions,
    selectedUserIdRef,
    tearleads,
  });

  useOrgManagerRouteMessages(openGroupRoute, openGrantRoute);

  const selectedGroup =
    groups.find((group) => group.groupId === selectedGroupId) ?? null;
  const selectedGrant = useMemo(() => {
    if (!selectedGrantRef) {
      return null;
    }

    return (
      (grants?.grants ?? []).find(
        (grant) =>
          grant.containerId === selectedGrantRef.containerId &&
          grant.subjectId === selectedGrantRef.subjectId &&
          grant.subjectType === selectedGrantRef.subjectType,
      ) ?? null
    );
  }, [grants?.grants, selectedGrantRef]);
  const selectedGroupIsMembersGroup =
    selectedGroup?.name === ORG_MANAGER_LABELS.members;
  const canCreateGroup = directory?.currentUser.isOrgAdmin ?? false;
  const canImportRosterUser = Boolean(
    canLoadAuthenticatedOrgData &&
      directory?.currentUser.isOrgAdmin &&
      memberGroupId &&
      appData.auth.userId &&
      appData.crypto.signingFingerprint &&
      appData.crypto.signingKeyPair &&
      appData.crypto.encapsulationKeyPair,
  );
  const canMutateSelectedGroup = canCurrentUserMutateSelectedGroup({
    directory,
    members,
    userId: appData.auth.userId,
  });
  const selectedRosterUser = useMemo(
    () =>
      userDetail?.user ??
      directory?.users.find((user) => user.userId === selectedUserId) ??
      null,
    [directory?.users, selectedUserId, userDetail?.user],
  );
  const memberUserIds = useMemo(
    () =>
      new Set(
        members?.members
          .filter((member) => member.memberPrincipalType === "user")
          .map((member) => member.memberPrincipalId) ?? [],
      ),
    [members],
  );
  const addableUsers = useMemo(
    () =>
      directory?.users.filter(
        (user) =>
          (user.status === "active" || selectedGroupIsMembersGroup) &&
          !memberUserIds.has(user.userId),
      ) ?? [],
    [directory, memberUserIds, selectedGroupIsMembersGroup],
  );
  const canRevokeGrants = directory?.currentUser.isOrgAdmin ?? false;
  const canDeleteGroup = useCallback(
    (group: OrganizationGroupSummary) => canCreateGroup && !group.isBuiltin,
    [canCreateGroup],
  );

  const openCreateGroupDialog = useCallback(() => {
    if (!canCreateGroup) {
      return;
    }

    setError(null);
    setGroupNameDraft("");
    selectGroup(null);
    setView("groups");
    setIsCreateGroupDialogOpen(true);
  }, [canCreateGroup, selectGroup, setView]);

  const closeCreateGroupDialog = useCallback(() => {
    if (mutating) {
      return;
    }

    setError(null);
    setGroupNameDraft("");
    setIsCreateGroupDialogOpen(false);
  }, [mutating]);

  const selectUser = useCallback((userId: string | null) => {
    selectedUserIdRef.current = userId;
    setSelectedUserIdState(userId);
    setUserDetail(null);
  }, []);

  const setOrgManagerView = useCallback(
    (nextView: OrgManagerView) => {
      if (nextView === "directory") {
        selectUser(null);
      }
      if (nextView === "groups") {
        selectGroup(null);
      }
      setView(nextView);
    },
    [selectGroup, selectUser, setView],
  );

  const openImportUserDialog = useCallback(() => {
    if (!canImportRosterUser) {
      return;
    }

    setError(null);
    setImportUserIdDraft("");
    setOrgManagerView("directory");
    setIsImportUserDialogOpen(true);
  }, [canImportRosterUser, setOrgManagerView]);

  const closeImportUserDialog = useCallback(() => {
    if (mutating) {
      return;
    }

    setError(null);
    setImportUserIdDraft("");
    setIsImportUserDialogOpen(false);
  }, [mutating]);

  const contextMenuState = useOrgManagerContextMenu();
  const rosterActions = useOrgManagerRosterActions({
    authUserId: appData.auth.userId,
    contextMenu: contextMenuState.contextMenu,
    directory,
    openMiniApp,
    selectUser,
    selectedRosterUser,
    setOrgManagerView,
  });
  const resetSelectedRosterUser = useCallback(() => {
    rosterActions.clearRosterProfileEditRequest();
    selectUser(null);
  }, [rosterActions.clearRosterProfileEditRequest, selectUser]);

  const {
    refreshDirectoryAndGroups,
    refreshOrgManager,
    refreshSelectedGroupDetails,
    refreshSelectedUserDetail,
  } = useOrgManagerRefreshers({
    appData,
    canLoadAuthenticatedOrgData,
    orgManagerActions,
    resetSelectedRosterUser,
    selectGroup,
    selectedGroupIdRef,
    selectedUserIdRef,
    skippedGroupDetailsEffectRef,
    setDataUsage,
    setDirectory,
    setError,
    setGrants,
    setGroupContainers,
    setGroupPolicyHistory,
    setGroups,
    setLoading,
    setLoadingUserDetail,
    setMemberGroupId,
    setMembers,
    setOrganizationPolicyHistory,
    setProfileDisplayNamesByUserId,
    setIsCreateGroupDialogOpen,
    setIsImportUserDialogOpen,
    setUserDetail,
  });

  useEffect(() => {
    void refreshOrgManager();
  }, [refreshOrgManager]);

  useEffect(() => {
    const skippedGroupDetailsEffect = skippedGroupDetailsEffectRef.current;
    if (skippedGroupDetailsEffect?.groupId === selectedGroupId) {
      skippedGroupDetailsEffectRef.current = null;
      return;
    }

    void refreshSelectedGroupDetails(selectedGroupId);
  }, [refreshSelectedGroupDetails, selectedGroupId]);

  useEffect(() => {
    if (
      directory &&
      selectedUserId &&
      !directory.users.some((user) => user.userId === selectedUserId)
    ) {
      selectUser(null);
    }
  }, [directory, selectedUserId, selectUser]);

  useEffect(() => {
    void refreshSelectedUserDetail(selectedUserId);
  }, [refreshSelectedUserDetail, selectedUserId]);

  useEnsureRosterProfileDocument({
    appData,
    canLoadAuthenticatedOrgData,
    canUpdateSelectedRosterEntry: rosterActions.canUpdateSelectedRosterEntry,
    orgManagerActions,
    selectedRosterUser,
    selectedUserIdRef,
    setDirectory,
    setError,
    setMutating,
    setUserDetail,
  });

  const {
    addUser,
    createGroup,
    deleteGroup,
    importRosterUser,
    removeMember,
    revokeGrant,
  } = useOrgManagerMutations({
    addUserId,
    appData,
    canDeleteGroup,
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
  });
  const orgSwitcher = useOrgSwitcher({
    activeOrganizationId: appData.auth.organizationId,
    enabled: Boolean(appData.auth.isAuthenticated),
  });
  useOrgManagerSidebarPanel({
    enabled: Boolean(
      appData.auth.organizationId && appData.auth.isAuthenticated,
    ),
    handleContextMenu: contextMenuState.handleSidebarContextMenu,
    setView: setOrgManagerView,
    view,
  });

  return {
    addUser,
    addUserId,
    addUserListId,
    addableUsers,
    canCreateGroup,
    canDeleteGroup,
    canEditContextMenuRosterUser: rosterActions.canEditContextMenuRosterUser,
    canImportRosterUser,
    canLoadAuthenticatedOrgData,
    canMutateSelectedGroup,
    canRevokeGrants,
    canUpdateSelectedRosterEntry: rosterActions.canUpdateSelectedRosterEntry,
    closeCreateGroupDialog,
    closeImportUserDialog,
    contextMenuState,
    createGroup,
    dataUsage,
    deleteGroup,
    directory,
    error,
    grants,
    groupContainers,
    groupNameDraft,
    groupPolicyHistory,
    groups,
    importRosterUserIntoContacts: rosterActions.importRosterUserIntoContacts,
    importRosterUser,
    importUserIdDraft,
    isCreateGroupDialogOpen,
    isImportUserDialogOpen,
    isAuthenticated: appData.auth.isAuthenticated,
    isOrgAdmin: directory?.currentUser.isOrgAdmin ?? false,
    loading,
    loadingUserDetail,
    members,
    memberUserIds,
    mutating,
    openGrantRoute,
    openGroupRoute,
    openCreateGroupDialog,
    openImportUserDialog,
    openRosterUser: rosterActions.openRosterUser,
    openRosterUserForEditing: rosterActions.openRosterUserForEditing,
    orgSwitcher,
    organizationId: appData.auth.organizationId,
    organizationPolicyHistory,
    profileDisplayNamesByUserId,
    refreshOrgManager,
    removeMember,
    revokeGrant,
    rosterProfileEditRequest: rosterActions.rosterProfileEditRequest,
    selectedGrant,
    selectedGrantRef,
    selectedGroup,
    selectedGroupId,
    selectedUserId,
    selectGrantRef,
    selectGroup,
    selectUser: rosterActions.selectRosterUser,
    setAddUserId,
    setGroupNameDraft,
    setImportUserIdDraft,
    setSelectedProfileDisplayName,
    userDetail,
    userId: appData.auth.userId,
    view,
  };
}

export type OrgManagerModel = ReturnType<typeof useOrgManagerModel>;
