import type {
  OrganizationContainerGrant,
  OrganizationDirectory,
  OrganizationUserDetail,
} from "@tearleads/client-sdk";
import type { OrgManagerGrantRouteRef } from "../routes";
import {
  type DirectoryContextMenuHandler,
  DirectoryListSection,
  DirectoryTable,
  type RosterUserContextMenuHandler,
} from "./DirectoryTable";
import { ImportRosterUserDialog } from "./ImportRosterUserDialog";
import { UserDetailView } from "./UserDetailView";

export function DirectoryView({
  canImportRosterUser,
  closeImportUserDialog,
  canUpdateSelectedRosterEntry,
  canRevokeGrants,
  detail,
  directory,
  error,
  importRosterUser,
  importUserIdDraft,
  isImportUserDialogOpen,
  loadingUserDetail,
  organizationId,
  pending,
  mutating,
  openDirectoryContextMenu,
  openRosterUserContextMenu,
  openGrantRoute,
  openGroupRoute,
  profileDisplayNamesByUserId,
  revokeGrant,
  rosterProfileEditRequest,
  selectedUserId,
  selectUser,
  setSelectedProfileDisplayName,
  setImportUserIdDraft,
  syncSeatUserIds,
}: {
  canImportRosterUser: boolean;
  canUpdateSelectedRosterEntry: boolean;
  canRevokeGrants: boolean;
  closeImportUserDialog: () => void;
  detail: OrganizationUserDetail | null;
  directory: OrganizationDirectory | null;
  error: string | null;
  importRosterUser: () => void;
  importUserIdDraft: string;
  isImportUserDialogOpen: boolean;
  loadingUserDetail: boolean;
  organizationId: string;
  pending: boolean;
  mutating: boolean;
  openDirectoryContextMenu?: DirectoryContextMenuHandler | undefined;
  openRosterUserContextMenu?: RosterUserContextMenuHandler | undefined;
  openGrantRoute: (grantRef: OrgManagerGrantRouteRef) => void;
  openGroupRoute: (groupId: string) => void;
  profileDisplayNamesByUserId: ReadonlyMap<string, string>;
  revokeGrant: (grant: OrganizationContainerGrant) => void;
  rosterProfileEditRequest: { key: number; userId: string } | null;
  selectedUserId: string | null;
  selectUser: (userId: string | null) => void;
  setSelectedProfileDisplayName: (displayName: string | null) => void;
  setImportUserIdDraft: (userId: string) => void;
  syncSeatUserIds: ReadonlySet<string> | null;
}) {
  const importUserDialog = (
    <ImportRosterUserDialog
      canImportRosterUser={canImportRosterUser}
      closeImportUserDialog={closeImportUserDialog}
      error={error}
      importRosterUser={importRosterUser}
      importUserIdDraft={importUserIdDraft}
      isOpen={isImportUserDialogOpen}
      mutating={mutating}
      setImportUserIdDraft={setImportUserIdDraft}
    />
  );

  if (!directory) {
    return (
      <>
        <DirectoryTable directory={directory} pending={pending} />
        {importUserDialog}
      </>
    );
  }

  if (!selectedUserId) {
    return (
      <>
        <DirectoryListSection
          directory={directory}
          pending={pending}
          openDirectoryContextMenu={openDirectoryContextMenu}
          openRosterUserContextMenu={openRosterUserContextMenu}
          profileDisplayNamesByUserId={profileDisplayNamesByUserId}
          selectedUserId={selectedUserId}
          selectUser={selectUser}
          syncSeatUserIds={syncSeatUserIds}
        />
        {importUserDialog}
      </>
    );
  }

  return (
    <>
      <section className="org-manager-panel">
        <UserDetailView
          canEditRosterProfile={canUpdateSelectedRosterEntry}
          canRevokeGrants={canRevokeGrants}
          detail={detail}
          key={selectedUserId}
          pending={loadingUserDetail || pending}
          mutating={mutating}
          onRosterProfileDisplayNameChange={setSelectedProfileDisplayName}
          openGrantRoute={openGrantRoute}
          openGroupRoute={openGroupRoute}
          organizationId={organizationId}
          profileDisplayName={profileDisplayNamesByUserId.get(selectedUserId)}
          revokeGrant={revokeGrant}
          rosterProfileEditRequestKey={
            rosterProfileEditRequest?.userId === selectedUserId
              ? rosterProfileEditRequest.key
              : null
          }
          syncSeatAssigned={
            detail?.user.status === "active" && syncSeatUserIds !== null
              ? syncSeatUserIds.has(detail.user.userId)
              : null
          }
        />
      </section>
      {importUserDialog}
    </>
  );
}
