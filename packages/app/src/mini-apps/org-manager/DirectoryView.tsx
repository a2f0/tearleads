import type {
  OrganizationContainerGrant,
  OrganizationDirectory,
  OrganizationGroupSummary,
  OrganizationUserDetail,
} from "@tearleads/client-sdk";
import type { KeyboardEvent } from "react";
import {
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

function formatNullableDate(value: string | null): string {
  return value ? formatMiniAppDate(value) : ORG_MANAGER_LABELS.none;
}

function getNullableIdentifierLabel(value: string | null): string {
  return value ? compactFingerprint(value) : ORG_MANAGER_LABELS.none;
}

function DirectoryTable({
  directory,
  loading,
  selectedUserId,
  selectUser,
}: {
  directory: OrganizationDirectory | null;
  loading: boolean;
  selectedUserId?: string | null;
  selectUser?: ((userId: string) => void) | undefined;
}) {
  if (!directory) {
    return (
      <MiniAppStatus className="org-manager-hint">
        {loading
          ? ORG_MANAGER_LABELS.loadingDirectory
          : ORG_MANAGER_LABELS.directoryUnavailable}
      </MiniAppStatus>
    );
  }

  if (directory.users.length === 0) {
    return (
      <MiniAppStatus className="org-manager-hint">
        {ORG_MANAGER_LABELS.noDirectUsers}
      </MiniAppStatus>
    );
  }

  return (
    <MiniAppTableFrame>
      <MiniAppTable
        aria-label={ORG_MANAGER_LABELS.directory}
        columns={DIRECTORY_TABLE_COLUMNS}
      >
        {directory.users.map((user) => {
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
                  {user.isSelf
                    ? ORG_MANAGER_LABELS.self
                    : compactFingerprint(user.userId)}
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
  if (groups.length === 0) {
    return (
      <MiniAppStatus className="org-manager-hint">
        {ORG_MANAGER_LABELS.noGroups}
      </MiniAppStatus>
    );
  }

  return (
    <div className="org-manager-group-list">
      {groups.map((group) => (
        <MiniAppRowButton
          className="org-manager-group-button"
          density="roomy"
          key={group.groupId}
          onClick={() => openGroupRoute(group.groupId)}
        >
          <MiniAppRowStack>
            <strong>{group.name}</strong>
            <MiniAppRowText muted title={group.groupId}>
              {compactFingerprint(group.groupId)}
            </MiniAppRowText>
          </MiniAppRowStack>
        </MiniAppRowButton>
      ))}
    </div>
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
    <MiniAppRow
      className="org-manager-roster-row"
      density="roomy"
      variant="framed"
    >
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
  canRevokeGrants,
  detail,
  loading,
  onDismiss,
  openGroupRoute,
  revokeGrant,
  selectedUserId,
  mutating,
}: {
  canRevokeGrants: boolean;
  detail: OrganizationUserDetail | null;
  loading: boolean;
  onDismiss: () => void;
  mutating: boolean;
  openGroupRoute: (groupId: string) => void;
  revokeGrant: (grant: OrganizationContainerGrant) => void;
  selectedUserId: string | null;
}) {
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
            {detail.user.isSelf
              ? ORG_MANAGER_LABELS.self
              : compactFingerprint(detail.user.userId)}
          </strong>
          <span title={detail.user.signingKeyFingerprint}>
            {compactFingerprint(detail.user.signingKeyFingerprint)}
          </span>
        </MiniAppHeaderCopy>
        <span title={detail.user.joinedAt}>
          {detail.user.status === "disabled"
            ? ORG_MANAGER_LABELS.disabled
            : formatMiniAppDate(detail.user.joinedAt)}
        </span>
        <MiniAppButton onClick={onDismiss} variant="ghost">
          {ORG_MANAGER_LABELS.back}
        </MiniAppButton>
      </MiniAppHeader>
      <MiniAppSection>
        <MiniAppSectionHeading>
          {ORG_MANAGER_LABELS.directory}
        </MiniAppSectionHeading>
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
  canRevokeGrants,
  detail,
  directory,
  loading,
  loadingUserDetail,
  mutating,
  openGroupRoute,
  revokeGrant,
  selectedUserId,
  selectUser,
}: {
  canRevokeGrants: boolean;
  detail: OrganizationUserDetail | null;
  directory: OrganizationDirectory | null;
  loading: boolean;
  loadingUserDetail: boolean;
  mutating: boolean;
  openGroupRoute: (groupId: string) => void;
  revokeGrant: (grant: OrganizationContainerGrant) => void;
  selectedUserId: string | null;
  selectUser: (userId: string | null) => void;
}) {
  if (!directory) {
    return <DirectoryTable directory={directory} loading={loading} />;
  }

  if (!selectedUserId) {
    return (
      <section className="org-manager-panel">
        <DirectoryTable
          directory={directory}
          loading={loading}
          selectedUserId={selectedUserId}
          selectUser={selectUser}
        />
      </section>
    );
  }

  return (
    <div className="org-manager-groups">
      <section className="org-manager-panel">
        <DirectoryTable
          directory={directory}
          loading={loading}
          selectedUserId={selectedUserId}
          selectUser={selectUser}
        />
      </section>
      <section className="org-manager-panel org-manager-panel--detail">
        <UserDetailView
          canRevokeGrants={canRevokeGrants}
          detail={detail}
          loading={loadingUserDetail}
          mutating={mutating}
          onDismiss={() => selectUser(null)}
          openGroupRoute={openGroupRoute}
          revokeGrant={revokeGrant}
          selectedUserId={selectedUserId}
        />
      </section>
    </div>
  );
}
