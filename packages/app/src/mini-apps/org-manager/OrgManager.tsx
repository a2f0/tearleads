import {
  MiniAppRoot,
  MiniAppStatus,
} from "../../components/shared/MiniAppLayout";
import {
  useWindowFileMenuItem,
  useWindowRefreshMenuItem,
} from "../../components/window/WindowMenuContext";
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
import "./OrgManager.css";

function OrgManagerContent({
  model,
  organizationId,
}: {
  model: OrgManagerModel;
  organizationId: string;
}) {
  if (model.view === "directory") {
    return (
      <DirectoryView
        canRevokeGrants={model.canRevokeGrants}
        detail={model.userDetail}
        directory={model.directory}
        loading={model.loading}
        loadingUserDetail={model.loadingUserDetail}
        mutating={model.mutating}
        openGroupRoute={model.openGroupRoute}
        revokeGrant={model.revokeGrant}
        selectedUserId={model.selectedUserId}
        selectUser={model.selectUser}
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
      canMutateSelectedGroup={model.canMutateSelectedGroup}
      closeCreateGroupDialog={model.closeCreateGroupDialog}
      createGroup={model.createGroup}
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
      <main className="org-manager-main">
        {model.error && (
          <MiniAppStatus className="org-manager-error" tone="error">
            {model.error}
          </MiniAppStatus>
        )}
        <OrgManagerContent model={model} organizationId={organizationId} />
      </main>
    </MiniAppRoot>
  );
}
