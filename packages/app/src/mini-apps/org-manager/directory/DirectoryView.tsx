import type {
  OrganizationContainerGrant,
  OrganizationDirectory,
  OrganizationUserDetail,
} from "@tearleads/client-sdk";
import { EMPTY_PROFILE_DISPLAY_NAMES } from "../display";
import type { OrgManagerGrantRouteRef } from "../routes";
import {
  type DirectoryContextMenuHandler,
  DirectoryListSection,
  DirectoryTable,
  type RosterUserContextMenuHandler,
} from "./DirectoryTable";
import { ImportRosterUserDialog } from "./ImportRosterUserDialog";
import {
  type RenderRosterProfileEditor,
  UserDetailView,
} from "./UserDetailView";

export function DirectoryView({
  canImportRosterUser = false,
  closeImportUserDialog = () => undefined,
  canUpdateSelectedRosterEntry = false,
  canRevokeGrants,
  detail,
  directory,
  error = null,
  importRosterUser = () => undefined,
  importUserIdDraft = "",
  isImportUserDialogOpen = false,
  loadingUserDetail,
  pending,
  mutating,
  openDirectoryContextMenu,
  openRosterUserContextMenu,
  openGrantRoute,
  openGroupRoute,
  profileDisplayNamesByUserId = EMPTY_PROFILE_DISPLAY_NAMES,
  renderRosterProfileEditor,
  revokeGrant,
  rosterProfileEditRequest,
  selectedUserId,
  selectUser,
  setSelectedProfileDisplayName = () => undefined,
  setImportUserIdDraft = () => undefined,
  syncSeatUserIds = null,
}: {
  canImportRosterUser?: boolean | undefined;
  canUpdateSelectedRosterEntry?: boolean | undefined;
  canRevokeGrants: boolean;
  closeImportUserDialog?: (() => void) | undefined;
  detail: OrganizationUserDetail | null;
  directory: OrganizationDirectory | null;
  error?: string | null | undefined;
  importRosterUser?: (() => void) | undefined;
  importUserIdDraft?: string | undefined;
  isImportUserDialogOpen?: boolean | undefined;
  loadingUserDetail: boolean;
  pending: boolean;
  mutating: boolean;
  openDirectoryContextMenu?: DirectoryContextMenuHandler | undefined;
  openRosterUserContextMenu?: RosterUserContextMenuHandler | undefined;
  openGrantRoute: (grantRef: OrgManagerGrantRouteRef) => void;
  openGroupRoute: (groupId: string) => void;
  profileDisplayNamesByUserId?: ReadonlyMap<string, string> | undefined;
  renderRosterProfileEditor?: RenderRosterProfileEditor | undefined;
  revokeGrant: (grant: OrganizationContainerGrant) => void;
  rosterProfileEditRequest?: { key: number; userId: string } | null | undefined;
  selectedUserId: string | null;
  selectUser: (userId: string | null) => void;
  setSelectedProfileDisplayName?:
    | ((displayName: string | null) => void)
    | undefined;
  setImportUserIdDraft?: ((userId: string) => void) | undefined;
  syncSeatUserIds?: ReadonlySet<string> | null | undefined;
}) {
  const importUserDialog = (
    <ImportRosterUserDialog
      canImportRosterUser={canImportRosterUser}
      closeImportUserDialog={closeImportUserDialog}
      error={error ?? null}
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
          profileDisplayName={profileDisplayNamesByUserId.get(selectedUserId)}
          renderRosterProfileEditor={renderRosterProfileEditor}
          revokeGrant={revokeGrant}
          rosterProfileEditRequestKey={
            rosterProfileEditRequest?.userId === selectedUserId
              ? rosterProfileEditRequest.key
              : null
          }
          selectedUserId={selectedUserId}
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
