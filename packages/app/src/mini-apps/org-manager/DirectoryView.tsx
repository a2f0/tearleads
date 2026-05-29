import type {
  OrganizationContainerGrant,
  OrganizationDirectory,
  OrganizationGroupSummary,
  OrganizationUserDetail,
} from "@tearleads/client-sdk";
import {
  type KeyboardEvent,
  type ReactNode,
  useCallback,
  useState,
} from "react";
import {
  MiniAppActions,
  MiniAppButton,
  MiniAppHeader,
  MiniAppHeaderCopy,
  MiniAppSection,
  MiniAppSectionHeading,
  MiniAppStatus,
} from "../../components/shared/MiniAppLayout";
import {
  MiniAppRow,
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
  MINI_APP_VIRTUAL_ROOMY_ROW_HEIGHT,
  MINI_APP_VIRTUAL_TABLE_ROW_HEIGHT,
  MiniAppVirtualList,
  MiniAppVirtualListFrame,
  MiniAppVirtualListRow,
  MiniAppVirtualTableSpacerRow,
  useMiniAppVirtualRows,
} from "../../components/shared/MiniAppVirtual";
import { formatMiniAppDate } from "../../utils/formatMiniAppDate";
import { compactFingerprint, isKeyboardActivationKey } from "./display";
import { GrantTable } from "./GrantTable";
import { ORG_MANAGER_LABELS } from "./labels";

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

function formatNullableDate(value: string | null): string {
  return value ? formatMiniAppDate(value) : ORG_MANAGER_LABELS.none;
}

function getNullableIdentifierLabel(value: string | null): string {
  return value ? compactFingerprint(value) : ORG_MANAGER_LABELS.none;
}

function DirectoryTable({
  directory,
  loading,
  profileDisplayNamesByUserId,
  selectedUserId,
  selectUser,
}: {
  directory: OrganizationDirectory | null;
  loading: boolean;
  profileDisplayNamesByUserId?: ReadonlyMap<string, string> | undefined;
  selectedUserId?: string | null;
  selectUser?: ((userId: string) => void) | undefined;
}) {
  const users = directory?.users ?? [];
  const virtualUsers = useMiniAppVirtualRows({
    rowHeight: MINI_APP_VIRTUAL_TABLE_ROW_HEIGHT,
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
      className="mini-app-table-frame--virtual org-manager-virtual-table"
      ref={virtualUsers.frameRef}
      style={getMiniAppVirtualFrameStyle(MINI_APP_VIRTUAL_TABLE_ROW_HEIGHT)}
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
              onKeyDown={selectUser ? handleUserRowKeyDown : undefined}
              selected={isSelected}
              tabIndex={selectUser ? 0 : undefined}
            >
              <MiniAppTableCell>
                <MiniAppTableText title={user.userId}>
                  {profileDisplayNamesByUserId?.get(user.userId) ??
                    compactFingerprint(user.userId)}
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

function RosterMetadataRow({
  label,
  title,
  value,
}: {
  label: string;
  title?: string | undefined;
  value: string;
}) {
  return (
    <MiniAppRow className="org-manager-roster-row" density="roomy">
      <MiniAppRowStack>
        <strong>{label}</strong>
        <MiniAppRowText muted title={title}>
          {value}
        </MiniAppRowText>
      </MiniAppRowStack>
    </MiniAppRow>
  );
}

function UserRosterMetadata({
  user,
}: {
  user: OrganizationUserDetail["user"];
}) {
  return (
    <div className="org-manager-roster-metadata">
      <RosterMetadataRow
        label={ORG_MANAGER_LABELS.signingKey}
        title={user.signingKeyFingerprint}
        value={compactFingerprint(user.signingKeyFingerprint)}
      />
      <RosterMetadataRow
        label={ORG_MANAGER_LABELS.joined}
        title={user.joinedAt}
        value={formatMiniAppDate(user.joinedAt)}
      />
      <RosterMetadataRow
        label={ORG_MANAGER_LABELS.disabledAt}
        title={user.disabledAt ?? undefined}
        value={formatNullableDate(user.disabledAt)}
      />
      <RosterMetadataRow
        label={ORG_MANAGER_LABELS.disabledBy}
        title={user.disabledByUserId ?? undefined}
        value={getNullableIdentifierLabel(user.disabledByUserId)}
      />
    </div>
  );
}

function UserDetailView({
  canEditRosterProfile,
  canRevokeGrants,
  detail,
  loading,
  onDismiss,
  onRosterProfileDisplayNameChange,
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
  mutating: boolean;
  openGroupRoute: (groupId: string) => void;
  profileDisplayName?: string | undefined;
  renderRosterProfileEditor?: RenderRosterProfileEditor | undefined;
  revokeGrant: (grant: OrganizationContainerGrant) => void;
  selectedUserId: string | null;
}) {
  const [isRosterProfileEditing, setIsRosterProfileEditing] = useState(false);

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
            {profileDisplayName ?? compactFingerprint(detail.user.userId)}
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
      <MiniAppSection>
        <MiniAppSectionHeading>
          {ORG_MANAGER_LABELS.userContainerLinks}
        </MiniAppSectionHeading>
        <GrantTable
          canRevokeGrants={canRevokeGrants}
          emptyLabel={ORG_MANAGER_LABELS.noUserContainerLinks}
          grants={detail.grants.directGrants}
          label={ORG_MANAGER_LABELS.userContainerLinks}
          mutating={mutating}
          openGroupRoute={openGroupRoute}
          revokeGrant={revokeGrant}
        />
      </MiniAppSection>
      <MiniAppSection>
        <MiniAppSectionHeading>
          {ORG_MANAGER_LABELS.groupContainerLinks}
        </MiniAppSectionHeading>
        <GrantTable
          canRevokeGrants={canRevokeGrants}
          emptyLabel={ORG_MANAGER_LABELS.noGroupContainerLinks}
          grants={detail.grants.groupGrants}
          label={ORG_MANAGER_LABELS.groupContainerLinks}
          mutating={mutating}
          openGroupRoute={openGroupRoute}
          revokeGrant={revokeGrant}
        />
      </MiniAppSection>
      <MiniAppSection>
        <MiniAppSectionHeading>
          {ORG_MANAGER_LABELS.organizationContainerLinks}
        </MiniAppSectionHeading>
        <GrantTable
          canRevokeGrants={canRevokeGrants}
          emptyLabel={ORG_MANAGER_LABELS.noOrganizationContainerLinks}
          grants={detail.grants.organizationGrants}
          label={ORG_MANAGER_LABELS.organizationContainerLinks}
          mutating={mutating}
          openGroupRoute={openGroupRoute}
          revokeGrant={revokeGrant}
        />
      </MiniAppSection>
    </>
  );
}

export function DirectoryView({
  canUpdateSelectedRosterEntry = false,
  canRevokeGrants,
  detail,
  directory,
  loading,
  loadingUserDetail,
  mutating,
  openGroupRoute,
  renderRosterProfileEditor,
  revokeGrant,
  selectedUserId,
  selectUser,
}: {
  canUpdateSelectedRosterEntry?: boolean | undefined;
  canRevokeGrants: boolean;
  detail: OrganizationUserDetail | null;
  directory: OrganizationDirectory | null;
  loading: boolean;
  loadingUserDetail: boolean;
  mutating: boolean;
  openGroupRoute: (groupId: string) => void;
  renderRosterProfileEditor?: RenderRosterProfileEditor | undefined;
  revokeGrant: (grant: OrganizationContainerGrant) => void;
  selectedUserId: string | null;
  selectUser: (userId: string | null) => void;
}) {
  const [profileDisplayNamesByUserId, setProfileDisplayNamesByUserId] =
    useState<ReadonlyMap<string, string>>(new Map());

  const setProfileDisplayName = useCallback(
    (userId: string, displayName: string | null) => {
      const trimmedDisplayName = displayName?.trim() ?? "";

      setProfileDisplayNamesByUserId((current) => {
        const existing = current.get(userId) ?? "";
        if (existing === trimmedDisplayName) {
          return current;
        }

        const next = new Map(current);
        if (trimmedDisplayName.length > 0) {
          next.set(userId, trimmedDisplayName);
        } else {
          next.delete(userId);
        }
        return next;
      });
    },
    [],
  );

  const setSelectedProfileDisplayName = useCallback(
    (displayName: string | null) => {
      if (selectedUserId) {
        setProfileDisplayName(selectedUserId, displayName);
      }
    },
    [selectedUserId, setProfileDisplayName],
  );

  if (!directory) {
    return <DirectoryTable directory={directory} loading={loading} />;
  }

  if (!selectedUserId) {
    return (
      <section className="org-manager-panel">
        <DirectoryTable
          directory={directory}
          loading={loading}
          profileDisplayNamesByUserId={profileDisplayNamesByUserId}
          selectedUserId={selectedUserId}
          selectUser={selectUser}
        />
      </section>
    );
  }

  return (
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
        openGroupRoute={openGroupRoute}
        profileDisplayName={
          selectedUserId
            ? profileDisplayNamesByUserId.get(selectedUserId)
            : undefined
        }
        renderRosterProfileEditor={renderRosterProfileEditor}
        revokeGrant={revokeGrant}
        selectedUserId={selectedUserId}
      />
    </section>
  );
}
