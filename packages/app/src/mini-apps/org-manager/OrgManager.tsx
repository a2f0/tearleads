import type {
  OrganizationContainerGrant,
  OrganizationUserDetail,
} from "@tearleads/client-sdk";
import { type MouseEvent, useCallback, useMemo, useState } from "react";
import {
  MiniAppRoot,
  MiniAppStatus,
} from "../../components/shared/MiniAppLayout";
import {
  useWindowFileMenuItem,
  useWindowRefreshMenuItem,
} from "../../components/window/WindowMenuContext";
import { BillingPanel } from "./BillingPanel";
import { CreateOrganizationDialog } from "./CreateOrganizationDialog";
import { OrgManagerContextMenuLayer } from "./context-menu/OrgManagerContextMenu";
import { DataUsageView } from "./DataUsageView";
import { DirectoryView } from "./DirectoryView";
import { GrantsView } from "./GrantsView";
import { GroupsView } from "./GroupsView";
import {
  type OrgManagerModel,
  useOrgManagerModel,
} from "./hooks/useOrgManagerModel";
import { ORG_MANAGER_LABELS } from "./labels";
import { OrganizationView } from "./OrganizationView";
import { useOrgManagerRoutedChromeActions } from "./OrgManagerRoutedChrome";
import { OrgSwitcher } from "./OrgSwitcher";
import { RevokeGrantConfirmationDialog } from "./RevokeGrantConfirmationDialog";
import { RosterProfileEditor } from "./RosterProfileEditor";
import "./OrgManager.css";

function renderRosterProfileEditor(organizationId: string) {
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
  renderProfileEditor: ReturnType<typeof renderRosterProfileEditor>;
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
      loading={model.loading}
      loadingUserDetail={model.loadingUserDetail}
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
  const renderProfileEditor = useMemo(
    () => renderRosterProfileEditor(organizationId),
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
        loading={model.loading}
        mutating={model.mutating}
        openGrantRoute={model.openGrantRoute}
        openGroupRoute={model.openGroupRoute}
        revokeGrant={revokeGrant}
        selectedGrant={model.selectedGrant}
        selectedGrantRef={model.selectedGrantRef}
        selectGrantRef={model.selectGrantRef}
      />
    );
  }

  if (model.view === "organization") {
    return (
      <OrganizationView
        directory={model.directory}
        groups={model.groups}
        organizationId={organizationId}
        policyHistory={model.organizationPolicyHistory}
        profileDisplayNamesByUserId={model.profileDisplayNamesByUserId}
      />
    );
  }

  if (model.view === "usage") {
    return (
      <DataUsageView dataUsage={model.dataUsage} loading={model.loading} />
    );
  }

  if (model.view === "billing") {
    return (
      <BillingPanel
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
  const [grantPendingRevoke, setGrantPendingRevoke] =
    useState<OrganizationContainerGrant | null>(null);
  const requestRevokeGrant = useCallback(
    (grant: OrganizationContainerGrant) => {
      if (!model.canRevokeGrants || model.mutating || grant.isBuiltin) {
        return;
      }

      setGrantPendingRevoke(grant);
    },
    [model.canRevokeGrants, model.mutating],
  );
  const closeRevokeGrantDialog = useCallback(() => {
    setGrantPendingRevoke(null);
  }, []);
  const confirmRevokeGrant = useCallback(() => {
    if (!grantPendingRevoke || !model.canRevokeGrants || model.mutating) {
      return;
    }

    void model.revokeGrant(grantPendingRevoke).finally(() => {
      setGrantPendingRevoke(null);
    });
  }, [
    grantPendingRevoke,
    model.canRevokeGrants,
    model.mutating,
    model.revokeGrant,
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
  useOrgManagerRoutedChromeActions({
    canCreateGroup: model.canCreateGroup,
    canImportRosterUser: model.canImportRosterUser,
    canLoadAuthenticatedOrgData: model.canLoadAuthenticatedOrgData,
    loading: model.loading,
    mutating: model.mutating,
    openCreateGroupDialog: model.openCreateGroupDialog,
    openImportUserDialog: model.openImportUserDialog,
    view: model.view,
  });

  if (!organizationId || !model.isAuthenticated) {
    return (
      <MiniAppRoot centered>
        <MiniAppStatus className="org-manager-hint">
          {ORG_MANAGER_LABELS.authenticate}
        </MiniAppStatus>
      </MiniAppRoot>
    );
  }

  return (
    <MiniAppRoot>
      <OrgSwitcher switcher={model.orgSwitcher} />
      <main className="org-manager-main" onContextMenu={handleMainContextMenu}>
        {model.error && (
          <MiniAppStatus className="org-manager-error" tone="error">
            {model.error}
          </MiniAppStatus>
        )}
        <OrgManagerContent
          model={model}
          organizationId={organizationId}
          revokeGrant={revokeGrantDialog.requestRevokeGrant}
        />
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
