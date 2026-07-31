import type {
  OrganizationContainerGrant,
  OrganizationUserDetail,
} from "@tearleads/client-sdk";
import { type MouseEvent, useCallback, useMemo, useState } from "react";
import {
  MiniAppButton,
  MiniAppRoot,
  MiniAppStatus,
  MiniAppToolbar,
} from "../../components/mini-app/MiniAppLayout";
import {
  useWindowFileMenuItem,
  useWindowRefreshMenuItem,
} from "../../components/window/WindowMenuContext";
import { useAuthenticateAction } from "../../identity/useAuthenticateAction";
import { useMiniAppRouteSegments } from "../../navigation/AppNavigationProvider";
import { useOrganizationBilling } from "../../providers/billing/BillingProvider";
import { useIdentity } from "../../providers/identity/IdentityProvider";
import { BillingPanel } from "./billing/BillingPanel";
import { DataUsageView } from "./billing/DataUsageView";
import { OrgManagerContextMenuLayer } from "./context-menu/OrgManagerContextMenu";
import { resolveOrgManagerDetailBackVisibility } from "./detailBackActions";
import { DirectoryView } from "./directory/DirectoryView";
import { RosterProfileEditor } from "./directory/RosterProfileEditor";
import { GrantsView } from "./grants/GrantsView";
import { RevokeGrantConfirmationDialog } from "./grants/RevokeGrantConfirmationDialog";
import { GroupsView } from "./groups/GroupsView";
import {
  type OrgManagerModel,
  useOrgManagerModel,
} from "./hooks/useOrgManagerModel";
import { ORG_MANAGER_LABELS } from "./labels";
import { OrgManagerMenu } from "./OrgManagerMenu";
import { useOrgManagerRoutedChromeActions } from "./OrgManagerRoutedChrome";
import { CreateOrganizationDialog } from "./organization/CreateOrganizationDialog";
import { OrganizationView } from "./organization/OrganizationView";
import { OrgSwitcher } from "./organization/OrgSwitcher";
import "./OrgManager.css";

function renderRosterEdit(organizationId: string) {
  return ({
    canEdit,
    isEditing,
    onDisplayNameChange,
    user,
  }: {
    canEdit: boolean;
    isEditing: boolean;
    onDisplayNameChange: (displayName: string | null) => void;
    user: OrganizationUserDetail["user"];
  }) => (
    <RosterProfileEditor
      canEdit={canEdit}
      isEditing={isEditing}
      onDisplayNameChange={onDisplayNameChange}
      organizationId={organizationId}
      user={user}
    />
  );
}

function OrgManagerDirectoryContent({
  model,
  renderProfileEditor,
  revokeGrant,
}: {
  model: OrgManagerModel;
  renderProfileEditor: ReturnType<typeof renderRosterEdit>;
  revokeGrant: (grant: OrganizationContainerGrant) => void;
}) {
  return (
    <DirectoryView
      canImportRosterUser={model.canImportRosterUser}
      canUpdateSelectedRosterEntry={model.canUpdateSelectedRosterEntry}
      canRevokeGrants={model.canRevokeGrants}
      closeImportUserDialog={model.closeImportUserDialog}
      detail={model.userDetail}
      directory={model.directory}
      error={model.error}
      importRosterUser={model.importRosterUser}
      importUserIdDraft={model.importUserIdDraft}
      isImportUserDialogOpen={model.isImportUserDialogOpen}
      loadingUserDetail={model.loadingUserDetail}
      pending={model.dataPending}
      mutating={model.mutating}
      openDirectoryContextMenu={(event) =>
        model.contextMenuState.handleSidebarContextMenu(event, "directory")
      }
      openRosterUserContextMenu={
        model.contextMenuState.handleRosterUserContextMenu
      }
      openGrantRoute={model.openGrantRoute}
      openGroupRoute={model.openGroupRoute}
      profileDisplayNamesByUserId={model.profileDisplayNamesByUserId}
      renderRosterProfileEditor={renderProfileEditor}
      revokeGrant={revokeGrant}
      rosterProfileEditRequest={model.rosterProfileEditRequest}
      selectedUserId={model.selectedUserId}
      selectUser={model.selectUser}
      setSelectedProfileDisplayName={model.setSelectedProfileDisplayName}
      setImportUserIdDraft={model.setImportUserIdDraft}
    />
  );
}

function OrgManagerContent({
  model,
  organizationId,
  revokeGrant,
}: {
  model: OrgManagerModel;
  organizationId: string;
  revokeGrant: (grant: OrganizationContainerGrant) => void;
}) {
  const b = useOrganizationBilling();
  const renderProfileEditor = useMemo(
    () => renderRosterEdit(organizationId),
    [organizationId],
  );

  if (model.view === "directory") {
    return (
      <OrgManagerDirectoryContent
        model={model}
        renderProfileEditor={renderProfileEditor}
        revokeGrant={revokeGrant}
      />
    );
  }

  if (model.view === "grants") {
    return (
      <GrantsView
        canRevokeGrants={model.canRevokeGrants}
        grants={model.grants}
        pending={model.grantsPending}
        mutating={model.mutating}
        openGrantRoute={model.openGrantRoute}
        openGroupRoute={model.openGroupRoute}
        revokeGrant={revokeGrant}
        selectedGrant={model.selectedGrant}
        selectedGrantRef={model.selectedGrantRef}
      />
    );
  }

  if (model.view === "organization") {
    return (
      <OrganizationView
        directory={model.directory}
        groups={model.groups}
        organizationId={organizationId}
        pending={model.dataPending}
        policyHistoryPending={model.organizationPolicyHistoryPending}
        policyHistory={model.organizationPolicyHistory}
        profileDisplayNamesByUserId={model.profileDisplayNamesByUserId}
      />
    );
  }

  if (model.view === "usage") {
    return (
      <DataUsageView
        canSync={
          b.billing?.organizationId === organizationId
            ? (b.view?.canSync ?? null)
            : null
        }
        dataUsage={model.dataUsage}
        pending={model.dataUsagePending}
      />
    );
  }
  if (model.view === "billing") {
    return (
      <BillingPanel
        isPersonalOrganization={model.defaultOrganizationId === organizationId}
        isOrgAdmin={model.isOrgAdmin}
        organizationId={organizationId}
        userId={model.userId}
      />
    );
  }

  return <OrgManagerGroupsContent model={model} />;
}

function OrgManagerGroupsContent({ model }: { model: OrgManagerModel }) {
  return (
    <GroupsView
      addUser={model.addUser}
      addUserId={model.addUserId}
      addUserListId={model.addUserListId}
      addableUsers={model.addableUsers}
      canCreateGroup={model.canCreateGroup}
      canDeleteGroup={model.canDeleteGroup}
      canMutateSelectedGroup={model.canMutateSelectedGroup}
      closeCreateGroupDialog={model.closeCreateGroupDialog}
      createGroup={model.createGroup}
      deleteGroup={model.deleteGroup}
      directory={model.directory}
      groupContainers={model.groupContainers}
      groupNameDraft={model.groupNameDraft}
      groupPolicyHistory={model.groupPolicyHistory}
      groups={model.groups}
      error={model.error}
      isCreateGroupDialogOpen={model.isCreateGroupDialogOpen}
      members={model.members}
      memberUserIds={model.memberUserIds}
      mutating={model.mutating}
      pending={model.groupDetailsPending}
      openCreateGroupDialog={model.openCreateGroupDialog}
      openRosterUser={model.openRosterUser}
      profileDisplayNamesByUserId={model.profileDisplayNamesByUserId}
      removeMember={model.removeMember}
      selectedGroup={model.selectedGroup}
      selectedGroupId={model.selectedGroupId}
      selectGroup={model.selectGroup}
      setAddUserId={model.setAddUserId}
      setGroupNameDraft={model.setGroupNameDraft}
      userId={model.userId}
    />
  );
}

function useRevokeGrantConfirmation(model: OrgManagerModel) {
  const [pendingRevoke, setPendingRevoke] = useState<{
    grant: OrganizationContainerGrant;
    organizationId: string;
  } | null>(null);
  const grantPendingRevoke =
    pendingRevoke?.organizationId === model.organizationId
      ? pendingRevoke.grant
      : null;
  const requestRevokeGrant = useCallback(
    (grant: OrganizationContainerGrant) => {
      if (
        !model.organizationId ||
        !model.canRevokeGrants ||
        model.mutating ||
        grant.isBuiltin
      ) {
        return;
      }

      setPendingRevoke({ grant, organizationId: model.organizationId });
    },
    [model.canRevokeGrants, model.mutating, model.organizationId],
  );
  const closeRevokeGrantDialog = useCallback(() => {
    setPendingRevoke(null);
  }, []);
  const confirmRevokeGrant = useCallback(() => {
    if (
      !pendingRevoke ||
      !grantPendingRevoke ||
      !model.canRevokeGrants ||
      model.mutating
    ) {
      return;
    }

    void model.revokeGrant(grantPendingRevoke).finally(() => {
      setPendingRevoke((current) =>
        current === pendingRevoke ? null : current,
      );
    });
  }, [
    grantPendingRevoke,
    model.canRevokeGrants,
    model.mutating,
    model.revokeGrant,
    pendingRevoke,
  ]);

  return {
    closeRevokeGrantDialog,
    confirmRevokeGrant,
    grantPendingRevoke,
    requestRevokeGrant,
  };
}

function useOrgManagerWindowMenus(model: OrgManagerModel) {
  useWindowFileMenuItem(
    model.canLoadAuthenticatedOrgData
      ? {
          disabled: !model.canCreateGroup || model.loading || model.mutating,
          id: "org-manager-new-group",
          label: ORG_MANAGER_LABELS.newGroupAction,
          onClick: model.openCreateGroupDialog,
          priority: 100,
        }
      : null,
  );
  useWindowFileMenuItem(
    model.canLoadAuthenticatedOrgData
      ? {
          disabled:
            !model.canImportRosterUser || model.loading || model.mutating,
          id: "org-manager-import-user",
          label: ORG_MANAGER_LABELS.importUserAction,
          onClick: model.openImportUserDialog,
          priority: 90,
        }
      : null,
  );
  useWindowRefreshMenuItem(
    model.canLoadAuthenticatedOrgData
      ? {
          disabled: model.loading || model.mutating,
          onRefresh: model.refreshOrgManager,
          refreshing: model.loading,
        }
      : null,
  );
}

function useOrgManagerDetailBackActions(model: OrgManagerModel) {
  const {
    selectGrantRef,
    selectGroup,
    selectUser,
    selectedGrantRef,
    selectedGroup,
    selectedUserId,
    view,
  } = model;
  const { canGoBack } = useMiniAppRouteSegments("org-manager");

  const {
    showGrantDetailBackAction,
    showGroupDetailBackAction,
    showRosterDetailBackAction,
  } = resolveOrgManagerDetailBackVisibility({
    hasSelectedGrant: selectedGrantRef !== null,
    hasSelectedGroup: selectedGroup !== null,
    hasSelectedUser: selectedUserId !== null,
    historyCanGoBack: canGoBack,
    view,
  });

  const backFromRosterDetail = useCallback(() => {
    selectUser(null);
  }, [selectUser]);
  const backFromGroupDetail = useCallback(() => {
    selectGroup(null, { replace: true });
  }, [selectGroup]);
  const backFromGrantDetail = useCallback(() => {
    selectGrantRef(null, { replace: true });
  }, [selectGrantRef]);

  return {
    backFromGrantDetail,
    backFromGroupDetail,
    backFromRosterDetail,
    showGrantDetailBackAction,
    showGroupDetailBackAction,
    showRosterDetailBackAction,
  };
}

function useOrgManagerChrome(model: OrgManagerModel) {
  const {
    backFromGrantDetail,
    backFromGroupDetail,
    backFromRosterDetail,
    showGrantDetailBackAction,
    showGroupDetailBackAction,
    showRosterDetailBackAction,
  } = useOrgManagerDetailBackActions(model);

  useOrgManagerRoutedChromeActions({
    canCreateGroup: model.canCreateGroup,
    canImportRosterUser: model.canImportRosterUser,
    canLoadAuthenticatedOrgData: model.canLoadAuthenticatedOrgData,
    loading: model.loading,
    mutating: model.mutating,
    onBackFromGrantDetail: backFromGrantDetail,
    onBackFromGroupDetail: backFromGroupDetail,
    onBackFromRosterDetail: backFromRosterDetail,
    openCreateGroupDialog: model.openCreateGroupDialog,
    openImportUserDialog: model.openImportUserDialog,
    showGrantDetailBackAction,
    showGroupDetailBackAction,
    showRosterDetailBackAction,
    view: model.view,
  });
}

function OrgManagerAuthenticationRequired() {
  const { signingKeyPair } = useIdentity();
  const { authenticate, authenticating, error } = useAuthenticateAction();

  return (
    <MiniAppRoot centered>
      <MiniAppStatus className="org-manager-hint">
        {ORG_MANAGER_LABELS.authenticate}
      </MiniAppStatus>
      {error && <MiniAppStatus tone="error">{error}</MiniAppStatus>}
      {signingKeyPair !== null && (
        <MiniAppToolbar>
          <MiniAppButton
            disabled={authenticating}
            onClick={() => void authenticate()}
          >
            {authenticating ? "Logging in..." : "Login"}
          </MiniAppButton>
        </MiniAppToolbar>
      )}
    </MiniAppRoot>
  );
}

export function OrgManager() {
  const model = useOrgManagerModel();
  const revokeGrantDialog = useRevokeGrantConfirmation(model);
  const organizationId = model.organizationId;
  const contextMenuTarget =
    model.view === "groups" && !model.selectedGroup ? "groups" : null;
  const handleMainContextMenu = contextMenuTarget
    ? (event: MouseEvent<HTMLElement>) => {
        if (event.defaultPrevented) {
          return;
        }

        model.contextMenuState.handleSidebarContextMenu(
          event,
          contextMenuTarget,
        );
      }
    : undefined;

  useOrgManagerWindowMenus(model);
  useOrgManagerChrome(model);

  if (!model.isAuthenticated) {
    return <OrgManagerAuthenticationRequired />;
  }

  return (
    <MiniAppRoot>
      <OrgSwitcher switcher={model.orgSwitcher} />
      <main className="org-manager-main" onContextMenu={handleMainContextMenu}>
        {!organizationId && (
          <MiniAppStatus className="org-manager-hint">
            {ORG_MANAGER_LABELS.selectOrganization}
          </MiniAppStatus>
        )}
        {model.error && (
          <MiniAppStatus className="org-manager-error" tone="error">
            {model.error}
          </MiniAppStatus>
        )}
        {organizationId && model.showCompactMenu ? (
          <OrgManagerMenu setView={model.openSection} />
        ) : organizationId ? (
          <OrgManagerContent
            model={model}
            organizationId={organizationId}
            revokeGrant={revokeGrantDialog.requestRevokeGrant}
          />
        ) : null}
      </main>
      <OrgManagerContextMenuLayer
        canCreateGroup={model.canCreateGroup}
        canDisableContextMenuRosterUser={model.canDisableContextMenuRosterUser}
        canEditContextMenuRosterUser={model.canEditContextMenuRosterUser}
        canImportRosterUser={model.canImportRosterUser}
        closeContextMenu={model.contextMenuState.closeContextMenu}
        contextMenu={model.contextMenuState.contextMenu}
        disableRosterUser={model.disableRosterUser}
        importRosterUserIntoContacts={model.importRosterUserIntoContacts}
        loading={model.loading}
        mutating={model.mutating}
        openCreateGroupDialog={model.openCreateGroupDialog}
        openImportUserDialog={model.openImportUserDialog}
        openRosterUser={model.openRosterUser}
        openRosterUserForEditing={model.openRosterUserForEditing}
      />
      <CreateOrganizationDialog
        closeCreateOrganizationDialog={
          model.orgSwitcher.closeCreateOrganizationDialog
        }
        createOrganization={(organizationName) => {
          void model.orgSwitcher.createOrganization(organizationName);
        }}
        creating={model.orgSwitcher.creating}
        error={model.orgSwitcher.createOrganizationError}
        isOpen={model.orgSwitcher.isCreateOrganizationDialogOpen}
      />
      <RevokeGrantConfirmationDialog
        busy={model.mutating}
        grant={revokeGrantDialog.grantPendingRevoke}
        onCancel={revokeGrantDialog.closeRevokeGrantDialog}
        onConfirm={revokeGrantDialog.confirmRevokeGrant}
      />
    </MiniAppRoot>
  );
}
