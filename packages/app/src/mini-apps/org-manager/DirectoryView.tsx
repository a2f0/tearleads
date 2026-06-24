import type {
  OrganizationContainerGrant,
  OrganizationDirectory,
  OrganizationDirectoryUser,
  OrganizationGroupSummary,
  OrganizationUserDetail,
} from "@tearleads/client-sdk";
import {
  type FormEvent,
  type KeyboardEvent,
  type MouseEvent,
  type ReactNode,
  useEffect,
  useId,
  useState,
} from "react";
import {
  MiniAppActions,
  MiniAppButton,
  MiniAppField,
  MiniAppHeader,
  MiniAppHeaderCopy,
  MiniAppInput,
  MiniAppModalBackdrop,
  MiniAppModalForm,
  MiniAppModalPanel,
  MiniAppSection,
  MiniAppSectionHeading,
  MiniAppStatus,
} from "../../components/shared/MiniAppLayout";
import {
  MiniAppRowButton,
  MiniAppRowStack,
  MiniAppRowText,
} from "../../components/shared/MiniAppRow";
import {
  MiniAppTable,
  MiniAppTableCell,
  type MiniAppTableColumn,
  MiniAppTableFrame,
  MiniAppTableRow,
  MiniAppTableText,
} from "../../components/shared/MiniAppTable";
import {
  getMiniAppVirtualFrameStyle,
  MINI_APP_VIRTUAL_COMPACT_TABLE_ROW_HEIGHT,
  MINI_APP_VIRTUAL_ROOMY_ROW_HEIGHT,
  MiniAppVirtualList,
  MiniAppVirtualListFrame,
  MiniAppVirtualListRow,
  MiniAppVirtualTableSpacerRow,
  useMiniAppVirtualRows,
} from "../../components/shared/MiniAppVirtual";
import { formatMiniAppDate } from "../../utils/formatMiniAppDate";
import {
  compactFingerprint,
  EMPTY_PROFILE_DISPLAY_NAMES,
  isKeyboardActivationKey,
} from "./display";
import { ORG_MANAGER_LABELS } from "./labels";
import { UserRosterMetadata } from "./RosterMetadata";
import type { OrgManagerGrantRouteRef } from "./routes";
import { UserGrantSections } from "./UserGrantSections";

const DIRECTORY_TABLE_COLUMNS = [
  {
    id: "user",
    header: ORG_MANAGER_LABELS.user,
    width: "48%",
  },
  {
    id: "status",
    header: ORG_MANAGER_LABELS.status,
    width: "7rem",
  },
  {
    className: "org-manager-directory-joined-column",
    id: "joined",
    header: ORG_MANAGER_LABELS.joined,
    width: "8rem",
  },
] satisfies ReadonlyArray<MiniAppTableColumn>;

type RenderRosterProfileEditor = (input: {
  canEdit: boolean;
  isEditing: boolean;
  onDisplayNameChange: (displayName: string | null) => void;
  user: OrganizationUserDetail["user"];
}) => ReactNode;

type DirectoryContextMenuHandler = (event: MouseEvent<HTMLElement>) => void;
type RosterUserContextMenuHandler = (
  event: MouseEvent<HTMLElement>,
  userId: string,
) => void;

function getDirectoryUserDisplayName(
  user: Pick<OrganizationDirectoryUser, "isSelf" | "userId">,
  profileDisplayNamesByUserId?: ReadonlyMap<string, string> | undefined,
): string {
  return (
    profileDisplayNamesByUserId?.get(user.userId) ??
    (user.isSelf ? ORG_MANAGER_LABELS.self : compactFingerprint(user.userId))
  );
}

function isDirectoryAreaContextMenuTarget(
  event: MouseEvent<HTMLElement>,
): boolean {
  if (!(event.target instanceof Element)) {
    return true;
  }

  const tableRow = event.target.closest(".mini-app-table-row");
  return (
    !tableRow ||
    tableRow.classList.contains("mini-app-virtual-table-spacer-row")
  );
}

function DirectoryTable({
  directory,
  loading,
  profileDisplayNamesByUserId,
  selectedUserId,
  openRosterUserContextMenu,
  selectUser,
}: {
  directory: OrganizationDirectory | null;
  loading: boolean;
  openRosterUserContextMenu?: RosterUserContextMenuHandler | undefined;
  profileDisplayNamesByUserId?: ReadonlyMap<string, string> | undefined;
  selectedUserId?: string | null;
  selectUser?: ((userId: string) => void) | undefined;
}) {
  const users = directory?.users ?? [];
  const virtualUsers = useMiniAppVirtualRows({
    rowHeight: MINI_APP_VIRTUAL_COMPACT_TABLE_ROW_HEIGHT,
    rows: users,
  });

  if (!directory) {
    return (
      <MiniAppStatus className="org-manager-hint">
        {loading
          ? ORG_MANAGER_LABELS.loadingDirectory
          : ORG_MANAGER_LABELS.directoryUnavailable}
      </MiniAppStatus>
    );
  }

  if (users.length === 0) {
    return (
      <MiniAppStatus className="org-manager-hint">
        {ORG_MANAGER_LABELS.noDirectUsers}
      </MiniAppStatus>
    );
  }

  return (
    <MiniAppTableFrame
      className="mini-app-table-frame--virtual mini-app-table-frame--compact org-manager-virtual-table"
      ref={virtualUsers.frameRef}
      style={getMiniAppVirtualFrameStyle(
        MINI_APP_VIRTUAL_COMPACT_TABLE_ROW_HEIGHT,
      )}
    >
      <MiniAppTable
        aria-label={ORG_MANAGER_LABELS.directory}
        columns={DIRECTORY_TABLE_COLUMNS}
      >
        <MiniAppVirtualTableSpacerRow
          colSpan={DIRECTORY_TABLE_COLUMNS.length}
          height={virtualUsers.topPadding}
        />
        {virtualUsers.rows.map((user) => {
          const isSelected = selectedUserId === user.userId;
          const openUserDetail = () => {
            selectUser?.(user.userId);
          };
          const handleUserRowKeyDown = (
            event: KeyboardEvent<HTMLTableRowElement>,
          ) => {
            if (selectUser && isKeyboardActivationKey(event.key)) {
              event.preventDefault();
              openUserDetail();
            }
          };

          return (
            <MiniAppTableRow
              aria-selected={selectUser ? isSelected : undefined}
              interactive={Boolean(selectUser)}
              key={user.userId}
              onClick={selectUser ? openUserDetail : undefined}
              onContextMenu={
                openRosterUserContextMenu
                  ? (event) => openRosterUserContextMenu(event, user.userId)
                  : undefined
              }
              onKeyDown={selectUser ? handleUserRowKeyDown : undefined}
              selected={isSelected}
              tabIndex={selectUser ? 0 : undefined}
            >
              <MiniAppTableCell>
                <MiniAppTableText title={user.userId}>
                  {getDirectoryUserDisplayName(
                    user,
                    profileDisplayNamesByUserId,
                  )}
                </MiniAppTableText>
              </MiniAppTableCell>
              <MiniAppTableCell>
                <MiniAppTableText>
                  {user.status === "disabled"
                    ? ORG_MANAGER_LABELS.disabled
                    : ORG_MANAGER_LABELS.active}
                </MiniAppTableText>
              </MiniAppTableCell>
              <MiniAppTableCell className="org-manager-directory-joined-column">
                <MiniAppTableText title={user.joinedAt}>
                  {formatMiniAppDate(user.joinedAt)}
                </MiniAppTableText>
              </MiniAppTableCell>
            </MiniAppTableRow>
          );
        })}
        <MiniAppVirtualTableSpacerRow
          colSpan={DIRECTORY_TABLE_COLUMNS.length}
          height={virtualUsers.bottomPadding}
        />
      </MiniAppTable>
    </MiniAppTableFrame>
  );
}

function ImportRosterUserDialog({
  canImportRosterUser,
  closeImportUserDialog,
  error,
  importRosterUser,
  importUserIdDraft,
  isOpen,
  mutating,
  setImportUserIdDraft,
}: {
  canImportRosterUser: boolean;
  closeImportUserDialog: () => void;
  error: string | null;
  importRosterUser: () => void;
  importUserIdDraft: string;
  isOpen: boolean;
  mutating: boolean;
  setImportUserIdDraft: (userId: string) => void;
}) {
  const inputId = useId();

  if (!isOpen) {
    return null;
  }

  const handleSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (
      !canImportRosterUser ||
      mutating ||
      importUserIdDraft.trim().length === 0
    ) {
      return;
    }

    importRosterUser();
  };

  return (
    <MiniAppModalBackdrop role="presentation">
      <MiniAppModalPanel
        role="dialog"
        aria-labelledby="org-manager-import-user-title"
        aria-modal="true"
      >
        <MiniAppModalForm onSubmit={handleSubmit}>
          <h2 id="org-manager-import-user-title">
            {ORG_MANAGER_LABELS.importUserAction}
          </h2>
          {error && (
            <MiniAppStatus className="org-manager-error" tone="error">
              {error}
            </MiniAppStatus>
          )}
          <MiniAppField>
            <label htmlFor={inputId}>{ORG_MANAGER_LABELS.userId}</label>
            <MiniAppInput
              id={inputId}
              autoFocus
              disabled={!canImportRosterUser || mutating}
              onChange={(event) => setImportUserIdDraft(event.target.value)}
              placeholder={ORG_MANAGER_LABELS.userId}
              value={importUserIdDraft}
            />
          </MiniAppField>
          <MiniAppActions>
            <MiniAppButton
              disabled={mutating}
              onClick={closeImportUserDialog}
              type="button"
            >
              {ORG_MANAGER_LABELS.cancel}
            </MiniAppButton>
            <MiniAppButton
              disabled={
                !canImportRosterUser ||
                mutating ||
                importUserIdDraft.trim().length === 0
              }
              type="submit"
            >
              {ORG_MANAGER_LABELS.importUserSubmitAction}
            </MiniAppButton>
          </MiniAppActions>
        </MiniAppModalForm>
      </MiniAppModalPanel>
    </MiniAppModalBackdrop>
  );
}

function UserGroups({
  groups,
  openGroupRoute,
}: {
  groups: ReadonlyArray<OrganizationGroupSummary>;
  openGroupRoute: (groupId: string) => void;
}) {
  const virtualGroups = useMiniAppVirtualRows({
    rowHeight: MINI_APP_VIRTUAL_ROOMY_ROW_HEIGHT,
    rows: groups,
  });

  if (groups.length === 0) {
    return (
      <MiniAppStatus className="org-manager-hint">
        {ORG_MANAGER_LABELS.noGroups}
      </MiniAppStatus>
    );
  }

  return (
    <MiniAppVirtualListFrame
      className="org-manager-virtual-list"
      ref={virtualGroups.frameRef}
      rowHeight={MINI_APP_VIRTUAL_ROOMY_ROW_HEIGHT}
    >
      <MiniAppVirtualList
        bottomPadding={virtualGroups.bottomPadding}
        topPadding={virtualGroups.topPadding}
      >
        {virtualGroups.rows.map((group) => (
          <MiniAppVirtualListRow key={group.groupId}>
            <MiniAppRowButton
              className="org-manager-group-button"
              density="roomy"
              onClick={() => openGroupRoute(group.groupId)}
            >
              <MiniAppRowStack>
                <strong>{group.name}</strong>
                <MiniAppRowText muted title={group.groupId}>
                  {compactFingerprint(group.groupId)}
                </MiniAppRowText>
              </MiniAppRowStack>
            </MiniAppRowButton>
          </MiniAppVirtualListRow>
        ))}
      </MiniAppVirtualList>
    </MiniAppVirtualListFrame>
  );
}

function UserDetailView({
  canEditRosterProfile,
  canRevokeGrants,
  detail,
  loading,
  onDismiss,
  onRosterProfileDisplayNameChange,
  rosterProfileEditRequestKey,
  openGrantRoute,
  openGroupRoute,
  profileDisplayName,
  renderRosterProfileEditor,
  revokeGrant,
  selectedUserId,
  mutating,
}: {
  canEditRosterProfile: boolean;
  canRevokeGrants: boolean;
  detail: OrganizationUserDetail | null;
  loading: boolean;
  onDismiss: () => void;
  onRosterProfileDisplayNameChange: (displayName: string | null) => void;
  rosterProfileEditRequestKey?: number | null | undefined;
  mutating: boolean;
  openGrantRoute: (grantRef: OrgManagerGrantRouteRef) => void;
  openGroupRoute: (groupId: string) => void;
  profileDisplayName?: string | undefined;
  renderRosterProfileEditor?: RenderRosterProfileEditor | undefined;
  revokeGrant: (grant: OrganizationContainerGrant) => void;
  selectedUserId: string | null;
}) {
  const [isRosterProfileEditing, setIsRosterProfileEditing] = useState(false);

  useEffect(() => {
    if (
      typeof rosterProfileEditRequestKey !== "number" ||
      !canEditRosterProfile ||
      !renderRosterProfileEditor
    ) {
      return;
    }

    setIsRosterProfileEditing(true);
  }, [
    canEditRosterProfile,
    renderRosterProfileEditor,
    rosterProfileEditRequestKey,
  ]);

  if (!selectedUserId) {
    return (
      <MiniAppStatus className="org-manager-hint">
        {ORG_MANAGER_LABELS.selectUser}
      </MiniAppStatus>
    );
  }

  if (!detail) {
    return (
      <>
        <MiniAppHeader className="org-manager-detail-header">
          <MiniAppHeaderCopy>
            <strong>
              {loading
                ? ORG_MANAGER_LABELS.loadingUserDetail
                : ORG_MANAGER_LABELS.userDetailUnavailable}
            </strong>
          </MiniAppHeaderCopy>
          <MiniAppButton onClick={onDismiss} variant="ghost">
            {ORG_MANAGER_LABELS.back}
          </MiniAppButton>
        </MiniAppHeader>
        <MiniAppStatus className="org-manager-hint">
          {loading
            ? ORG_MANAGER_LABELS.loadingUserDetail
            : ORG_MANAGER_LABELS.userDetailUnavailable}
        </MiniAppStatus>
      </>
    );
  }

  return (
    <>
      <MiniAppHeader className="org-manager-detail-header">
        <MiniAppHeaderCopy>
          <strong title={detail.user.userId}>
            {profileDisplayName ??
              (detail.user.isSelf
                ? ORG_MANAGER_LABELS.self
                : compactFingerprint(detail.user.userId))}
          </strong>
          <span title={detail.user.signingKeyFingerprint}>
            {compactFingerprint(detail.user.signingKeyFingerprint)}
          </span>
        </MiniAppHeaderCopy>
        <MiniAppActions className="org-manager-detail-actions">
          <span
            className="org-manager-detail-status"
            title={detail.user.joinedAt}
          >
            {detail.user.status === "disabled"
              ? ORG_MANAGER_LABELS.disabled
              : formatMiniAppDate(detail.user.joinedAt)}
          </span>
          {renderRosterProfileEditor && canEditRosterProfile && (
            <MiniAppButton
              onClick={() =>
                setIsRosterProfileEditing(
                  (currentIsEditing) => !currentIsEditing,
                )
              }
            >
              {isRosterProfileEditing
                ? ORG_MANAGER_LABELS.done
                : ORG_MANAGER_LABELS.edit}
            </MiniAppButton>
          )}
          <MiniAppButton onClick={onDismiss} variant="ghost">
            {ORG_MANAGER_LABELS.back}
          </MiniAppButton>
        </MiniAppActions>
      </MiniAppHeader>
      <MiniAppSection className="org-manager-roster-detail">
        {renderRosterProfileEditor
          ? renderRosterProfileEditor({
              canEdit: canEditRosterProfile,
              isEditing: isRosterProfileEditing,
              onDisplayNameChange: onRosterProfileDisplayNameChange,
              user: detail.user,
            })
          : null}
        <UserRosterMetadata user={detail.user} />
      </MiniAppSection>
      <MiniAppSection>
        <MiniAppSectionHeading>
          {ORG_MANAGER_LABELS.groups}
        </MiniAppSectionHeading>
        <UserGroups groups={detail.groups} openGroupRoute={openGroupRoute} />
      </MiniAppSection>
      <UserGrantSections
        canRevokeGrants={canRevokeGrants}
        grants={detail.grants}
        mutating={mutating}
        openGrantRoute={openGrantRoute}
        revokeGrant={revokeGrant}
      />
    </>
  );
}

function DirectoryListSection({
  directory,
  loading,
  openDirectoryContextMenu,
  openRosterUserContextMenu,
  profileDisplayNamesByUserId,
  selectedUserId,
  selectUser,
}: {
  directory: OrganizationDirectory;
  loading: boolean;
  openDirectoryContextMenu?: DirectoryContextMenuHandler | undefined;
  openRosterUserContextMenu?: RosterUserContextMenuHandler | undefined;
  profileDisplayNamesByUserId: ReadonlyMap<string, string>;
  selectedUserId: string | null;
  selectUser: (userId: string | null) => void;
}) {
  return (
    <section
      aria-label={ORG_MANAGER_LABELS.directory}
      className="org-manager-panel org-manager-panel--context-target"
      onContextMenu={(event) => {
        if (
          event.defaultPrevented ||
          !isDirectoryAreaContextMenuTarget(event)
        ) {
          return;
        }

        openDirectoryContextMenu?.(event);
      }}
    >
      <DirectoryTable
        directory={directory}
        loading={loading}
        openRosterUserContextMenu={openRosterUserContextMenu}
        profileDisplayNamesByUserId={profileDisplayNamesByUserId}
        selectedUserId={selectedUserId}
        selectUser={selectUser}
      />
    </section>
  );
}

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
  loading,
  loadingUserDetail,
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
  loading: boolean;
  loadingUserDetail: boolean;
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
        <DirectoryTable directory={directory} loading={loading} />
        {importUserDialog}
      </>
    );
  }

  if (!selectedUserId) {
    return (
      <>
        <DirectoryListSection
          directory={directory}
          loading={loading}
          openDirectoryContextMenu={openDirectoryContextMenu}
          openRosterUserContextMenu={openRosterUserContextMenu}
          profileDisplayNamesByUserId={profileDisplayNamesByUserId}
          selectedUserId={selectedUserId}
          selectUser={selectUser}
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
          loading={loadingUserDetail}
          mutating={mutating}
          onDismiss={() => selectUser(null)}
          onRosterProfileDisplayNameChange={setSelectedProfileDisplayName}
          openGrantRoute={openGrantRoute}
          openGroupRoute={openGroupRoute}
          profileDisplayName={
            selectedUserId
              ? profileDisplayNamesByUserId.get(selectedUserId)
              : undefined
          }
          renderRosterProfileEditor={renderRosterProfileEditor}
          revokeGrant={revokeGrant}
          rosterProfileEditRequestKey={
            rosterProfileEditRequest?.userId === selectedUserId
              ? rosterProfileEditRequest.key
              : null
          }
          selectedUserId={selectedUserId}
        />
      </section>
      {importUserDialog}
    </>
  );
}
