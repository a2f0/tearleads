import type {
  OrganizationContainerGrants,
  OrganizationDirectory,
  OrganizationGroupContainers,
  OrganizationGroupMembers,
  OrganizationGroupPolicyHistory,
  OrganizationGroupSummary,
  OrganizationPolicyHistory,
  OrganizationUserDetail,
} from "@tearleads/client-sdk";
import { useCallback, useId, useMemo, useRef, useState } from "react";
import { useCompactRoutedMode } from "../../../navigation/useCompactRoutedMode";
import {
  useTearleads,
  useTearleadsRuntime,
} from "../../../providers/sdk/TearleadsProvider";
import { useOrgManagerActions } from "../../../stores/org-manager/OrgManagerProvider";
import { useMiniAppBusActions } from "../../bus";
import { useOrgManagerScopedDataUsage } from "../billing/useOrgManagerScopedDataUsage";
import { useOrgManagerContextMenu } from "../context-menu/OrgManagerContextMenu";
import { deriveOrgManagerState } from "../deriveOrgManagerState";
import { useClearMissingOrgManagerUser } from "../directory/useClearMissingOrgManagerUser";
import { useOrgManagerSidebarPanel } from "../OrgManagerSidebar";
import { useOrgManagerDetailRefreshes } from "../organization/useOrgManagerDetailRefreshes";
import { useOrgManagerDirectorySync } from "../organization/useOrgManagerDirectorySync";
import { useOrgManagerScopeReset } from "../organization/useOrgManagerScopeReset";
import { useOrgManagerViewRefreshes } from "../organization/useOrgManagerViewRefreshes";
import type { GroupDetailsEffectKey } from "../refresh";
import type { OrgManagerView } from "../routes";
import {
  getOrgManagerDataUsageScopeKey,
  getOrgManagerStateScopeKey,
  scopeOrganizationDirectory,
  scopeOrganizationList,
} from "./orgManagerStateScope";
import { useEnsureRosterProfileDocument } from "./useEnsureRosterProfileDocument";
import { useOrgManagerMutations } from "./useOrgManagerMutations";
import { useOrgManagerPendingState } from "./useOrgManagerPendingState";
import { useOrgManagerProfileDisplayNames } from "./useOrgManagerProfileDisplayNames";
import { useOrgManagerRefreshers } from "./useOrgManagerRefreshers";
import { useOrgManagerRequestGuard } from "./useOrgManagerRequestGuard";
import { useOrgManagerRosterActions } from "./useOrgManagerRosterActions";
import { useOrgManagerRoute } from "./useOrgManagerRoute";
import { useOrgManagerRouteMessages } from "./useOrgManagerRouteMessages";
import { useOrgSwitcher } from "./useOrgSwitcher";

// biome-ignore lint/complexity/noExcessiveLinesPerFunction: Coordinates model hooks.
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
  const [readModelCursor, setReadModelCursor] = useState<string | null>(null);
  const organizationId = appData.auth.organizationId;
  const dataUsageScopeKey = getOrgManagerDataUsageScopeKey(appData);
  const orgManagerScopeKey = getOrgManagerStateScopeKey(appData);
  const activeDirectory = scopeOrganizationDirectory(
    directory,
    organizationId,
    appData.auth.userId,
  );
  const activeGroups = useMemo(
    () => scopeOrganizationList(groups, organizationId),
    [groups, organizationId],
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
  } = useOrgManagerRoute({ groups: activeGroups });
  const compactRoutedMode = useCompactRoutedMode();
  const view: OrgManagerView =
    !compactRoutedMode && route.view === "menu" ? "directory" : route.view;
  const showCompactMenu = compactRoutedMode && route.view === "menu";
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
  const { dataUsage, dataUsageRef, setDataUsage } =
    useOrgManagerScopedDataUsage(dataUsageScopeKey);
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
  const skippedGroupDetailsEffectRef = useRef<GroupDetailsEffectKey | null>(
    null,
  );
  const selectedUserIdRef = useRef<string | null>(null);
  const beginRequest = useOrgManagerRequestGuard(orgManagerScopeKey);
  const canLoadAuthenticatedOrgData = Boolean(
    organizationId && appData.auth.isAuthenticated,
  );
  const databaseReady = appData.infra.dbStatus === "ready";
  const databaseStarting = appData.infra.dbStatus === "idle";
  const {
    dataPending,
    dataUsagePending,
    grantsPending,
    groupDetailsPending,
    markDataUsageSettled,
    markDirectorySettled,
    markGrantsSettled,
    markGroupDetailsSettled,
    markOrganizationPolicyHistorySettled,
    organizationPolicyHistoryPending,
  } = useOrgManagerPendingState({
    databaseStarting,
    loading,
    scopeKey: orgManagerScopeKey,
    selectedGroupId,
  });
  const {
    activeDataUsage,
    activeGrants,
    activeGroupContainers,
    activeGroupPolicyHistory,
    activeMemberGroupId,
    activeMembers,
    activeOrganizationPolicyHistory,
    activeUserDetail,
    addableUsers,
    canCreateGroup,
    canDisableRosterUsers,
    canImportRosterUser,
    canMutateSelectedGroup,
    canRevokeGrants,
    memberUserIds,
    selectedGrant,
    selectedGroup,
    selectedGroupIsMembersGroup,
    selectedRosterUser,
  } = deriveOrgManagerState({
    activeDirectory,
    activeGroups,
    canLoadAuthenticatedOrgData,
    crypto: {
      hasEncapsulationKeyPair: Boolean(appData.crypto.encapsulationKeyPair),
      hasSigningFingerprint: Boolean(appData.crypto.signingFingerprint),
      hasSigningKeyPair: Boolean(appData.crypto.signingKeyPair),
    },
    dataUsage,
    databaseReady,
    grants,
    groupContainers,
    groupPolicyHistory,
    memberGroupId,
    members,
    organizationId,
    organizationPolicyHistory,
    selectedGrantRef,
    selectedGroupId,
    selectedUserId,
    userDetail,
    userId: appData.auth.userId,
  });
  const selectedGroupStateHashRef = useRef<string | null>(null);
  selectedGroupStateHashRef.current =
    selectedGroup?.currentState?.stateHash ?? null;
  const { profileDisplayNamesByUserId, setSelectedProfileDisplayName } =
    useOrgManagerProfileDisplayNames({
      appData,
      canLoadAuthenticatedOrgData,
      directory: activeDirectory,
      selectedUserIdRef,
      tearleads,
    });
  useOrgManagerRouteMessages(openGroupRoute, openGrantRoute);
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
    canDisableRosterUsers,
    contextMenu: contextMenuState.contextMenu,
    directory: activeDirectory,
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
    invalidateSelectedGroupDetails,
    refreshDataUsage,
    refreshDirectoryAndGroups,
    refreshGrants,
    refreshOrgManager,
    refreshOrganizationPolicyHistory,
    refreshSelectedGroupContainers,
    refreshSelectedGroupDetails,
    refreshSelectedUserDetail,
    resetDirectoryState,
  } = useOrgManagerRefreshers({
    appData,
    beginRequest,
    canLoadAuthenticatedOrgData,
    dataUsageRef,
    orgManagerActions,
    resetSelectedRosterUser,
    selectGroup,
    selectedGroupIdRef,
    selectedGroupStateHashRef,
    selectedUserIdRef,
    skippedGroupDetailsEffectRef,
    markDataUsageSettled,
    markDirectorySettled,
    markGrantsSettled,
    markGroupDetailsSettled,
    markOrganizationPolicyHistorySettled,
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
    setReadModelCursor,
    setIsCreateGroupDialogOpen,
    setIsImportUserDialogOpen,
    setUserDetail,
    view,
  });
  // Clear abandoned scope state before the new scope's refreshes begin.
  useOrgManagerScopeReset({
    closeContextMenu: contextMenuState.closeContextMenu,
    resetDirectoryState,
    scopeKey: orgManagerScopeKey,
    setError,
    setGrants,
    setLoading,
    setLoadingUserDetail,
    setMutating,
    setOrganizationPolicyHistory,
  });
  useOrgManagerViewRefreshes({
    enabled: canLoadAuthenticatedOrgData,
    readModelCursor,
    refreshDataUsage,
    refreshGrants,
    refreshOrganizationPolicyHistory,
    scopeKey: orgManagerScopeKey,
    view,
  });
  useOrgManagerDirectorySync({
    canLoadAuthenticatedOrgData,
    mutating,
    online: appData.state.online,
    organizationId,
    refreshDirectoryAndGroups,
    scopeKey: orgManagerScopeKey,
    tearleads,
  });
  useOrgManagerDetailRefreshes({
    readModelCursor,
    refreshSelectedGroupContainers,
    refreshSelectedGroupDetails,
    refreshSelectedUserDetail,
    selectedGroupAvailable: selectedGroupId === null || selectedGroup !== null,
    selectedGroupId,
    selectedGroupStateHash: selectedGroup?.currentState?.stateHash ?? null,
    selectedUserId,
    skippedGroupDetailsEffectRef,
    view,
  });
  useClearMissingOrgManagerUser(activeDirectory, selectedUserId, selectUser);
  useEnsureRosterProfileDocument({
    appData,
    canLoadAuthenticatedOrgData,
    canUpdateSelectedRosterEntry: rosterActions.canUpdateSelectedRosterEntry,
    domainScope: appData.state.domainScope,
    orgManagerActions,
    scopeKey: orgManagerScopeKey,
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
    disableRosterUser,
    importRosterUser,
    removeMember,
    revokeGrant,
  } = useOrgManagerMutations({
    addUserId,
    appData,
    canDeleteGroup,
    canDisableRosterUsers,
    canImportRosterUser,
    directory: activeDirectory,
    groupNameDraft,
    groups: activeGroups,
    importUserIdDraft,
    invalidateSelectedGroupDetails,
    memberGroupId: activeMemberGroupId,
    members: activeMembers,
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
    activeContainerId: appData.state.containerId,
    activeOrganizationId: appData.auth.organizationId,
    databaseReady,
    enabled: Boolean(appData.auth.isAuthenticated),
    interactionDisabled: loading || mutating,
    operationScopeKey: orgManagerScopeKey,
    scopeKey: appData.state.domainScope,
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
    canDisableContextMenuRosterUser:
      rosterActions.canDisableContextMenuRosterUser,
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
    dataUsage: activeDataUsage,
    deleteGroup,
    defaultOrganizationId: appData.auth.defaultOrganizationId,
    disableRosterUser,
    directory: activeDirectory,
    error,
    grants: activeGrants,
    groupContainers: activeGroupContainers,
    groupNameDraft,
    groupPolicyHistory: activeGroupPolicyHistory,
    groups: activeGroups,
    importRosterUserIntoContacts: rosterActions.importRosterUserIntoContacts,
    importRosterUser,
    importUserIdDraft,
    isCreateGroupDialogOpen,
    isImportUserDialogOpen,
    isAuthenticated: appData.auth.isAuthenticated,
    isOrgAdmin: activeDirectory?.currentUser.isOrgAdmin ?? false,
    dataPending,
    dataUsagePending,
    grantsPending,
    groupDetailsPending,
    organizationPolicyHistoryPending,
    loading,
    loadingUserDetail,
    members: activeMembers,
    memberUserIds,
    mutating,
    openGrantRoute,
    openGroupRoute,
    openCreateGroupDialog,
    openImportUserDialog,
    openRosterUser: rosterActions.openRosterUser,
    openSection: setOrgManagerView,
    openRosterUserForEditing: rosterActions.openRosterUserForEditing,
    orgSwitcher,
    organizationId,
    organizationPolicyHistory: activeOrganizationPolicyHistory,
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
    showCompactMenu,
    setGroupNameDraft,
    setImportUserIdDraft,
    setSelectedProfileDisplayName,
    userDetail: activeUserDetail,
    userId: appData.auth.userId,
    view,
  };
}

export type OrgManagerModel = ReturnType<typeof useOrgManagerModel>;
