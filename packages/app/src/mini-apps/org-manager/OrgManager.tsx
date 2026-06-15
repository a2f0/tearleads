import type { OrganizationUserDetail } from "@tearleads/client-sdk";
import { type MouseEvent, useMemo } from "react";
import {
  MiniAppRoot,
  MiniAppStatus,
} from "../../components/shared/MiniAppLayout";
import {
  useWindowFileMenuItem,
  useWindowRefreshMenuItem,
} from "../../components/window/WindowMenuContext";
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
}: {
  model: OrgManagerModel;
  renderProfileEditor: ReturnType<typeof renderRosterProfileEditor>;
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
      openGroupRoute={model.openGroupRoute}
      profileDisplayNamesByUserId={model.profileDisplayNamesByUserId}
      renderRosterProfileEditor={renderProfileEditor}
      revokeGrant={model.revokeGrant}
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
}: {
  model: OrgManagerModel;
  organizationId: string;
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
        openGroupRoute={model.openGroupRoute}
        revokeGrant={model.revokeGrant}
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

export function OrgManager() {
  const model = useOrgManagerModel();
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
      <main className="org-manager-main" onContextMenu={handleMainContextMenu}>
        {model.error && (
          <MiniAppStatus className="org-manager-error" tone="error">
            {model.error}
          </MiniAppStatus>
        )}
        <OrgManagerContent model={model} organizationId={organizationId} />
      </main>
      <OrgManagerContextMenuLayer
        canCreateGroup={model.canCreateGroup}
        canEditContextMenuRosterUser={model.canEditContextMenuRosterUser}
        canImportRosterUser={model.canImportRosterUser}
        closeContextMenu={model.contextMenuState.closeContextMenu}
        contextMenu={model.contextMenuState.contextMenu}
        importRosterUserIntoContacts={model.importRosterUserIntoContacts}
        loading={model.loading}
        mutating={model.mutating}
        openCreateGroupDialog={model.openCreateGroupDialog}
        openImportUserDialog={model.openImportUserDialog}
        openRosterUser={model.openRosterUser}
        openRosterUserForEditing={model.openRosterUserForEditing}
      />
    </MiniAppRoot>
  );
}
