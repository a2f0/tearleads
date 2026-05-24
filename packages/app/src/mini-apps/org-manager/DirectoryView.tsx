import type { KeyboardEvent } from "react";
import {
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
import type {
  OrgManagerContainerGrant,
  OrgManagerDirectory,
  OrgManagerGroupSummary,
  OrgManagerUserDetail,
} from "../../stores/org-manager/OrgManagerProvider";
import { formatMiniAppDate } from "../../utils/formatMiniAppDate";
import { compactFingerprint, isKeyboardActivationKey } from "./display";
import { GrantTable } from "./GrantTable";
import { ORG_MANAGER_LABELS } from "./labels";

const DIRECTORY_TABLE_COLUMNS = [
  {
    id: "user",
    header: ORG_MANAGER_LABELS.user,
    width: "38%",
  },
  {
    id: "signing-key",
    header: ORG_MANAGER_LABELS.signingKey,
    width: "30%",
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

function DirectoryTable({
  directory,
  loading,
  selectedUserId,
  selectUser,
}: {
  directory: OrgManagerDirectory | null;
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
                <MiniAppTableText title={user.signingKeyFingerprint}>
                  {compactFingerprint(user.signingKeyFingerprint)}
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
                <MiniAppTableText title={user.createdAt}>
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
  groups: ReadonlyArray<OrgManagerGroupSummary>;
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

function UserDetailView({
  canRevokeGrants,
  detail,
  loading,
  mutating,
  openGroupRoute,
  revokeGrant,
  selectedUserId,
}: {
  canRevokeGrants: boolean;
  detail: OrgManagerUserDetail | null;
  loading: boolean;
  mutating: boolean;
  openGroupRoute: (groupId: string) => void;
  revokeGrant: (grant: OrgManagerContainerGrant) => void;
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
      <MiniAppStatus className="org-manager-hint">
        {loading
          ? ORG_MANAGER_LABELS.loadingUserDetail
          : ORG_MANAGER_LABELS.userDetailUnavailable}
      </MiniAppStatus>
    );
  }

  return (
    <>
      <div className="org-manager-detail-header">
        <div>
          <strong title={detail.user.userId}>
            {detail.user.isSelf
              ? ORG_MANAGER_LABELS.self
              : compactFingerprint(detail.user.userId)}
          </strong>
          <span title={detail.user.signingKeyFingerprint}>
            {compactFingerprint(detail.user.signingKeyFingerprint)}
          </span>
        </div>
        <span title={detail.user.joinedAt}>
          {detail.user.status === "disabled"
            ? ORG_MANAGER_LABELS.disabled
            : formatMiniAppDate(detail.user.joinedAt)}
        </span>
      </div>
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
  detail: OrgManagerUserDetail | null;
  directory: OrgManagerDirectory | null;
  loading: boolean;
  loadingUserDetail: boolean;
  mutating: boolean;
  openGroupRoute: (groupId: string) => void;
  revokeGrant: (grant: OrgManagerContainerGrant) => void;
  selectedUserId: string | null;
  selectUser: (userId: string) => void;
}) {
  if (!directory) {
    return <DirectoryTable directory={directory} loading={loading} />;
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
          openGroupRoute={openGroupRoute}
          revokeGrant={revokeGrant}
          selectedUserId={selectedUserId}
        />
      </section>
    </div>
  );
}
