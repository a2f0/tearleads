import type {
  OrganizationContainerGrant,
  OrganizationDirectory,
  OrganizationGroupSummary,
  OrganizationUserDetail,
} from "@tearleads/client-sdk";
import type { KeyboardEvent } from "react";
import {
  MiniAppButton,
  MiniAppField,
  MiniAppInput,
  MiniAppSection,
  MiniAppSectionHeading,
  MiniAppStatus,
  MiniAppToolbar,
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
    width: "32%",
  },
  {
    id: "profile-document",
    header: ORG_MANAGER_LABELS.profileDocument,
    width: "32%",
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
                <MiniAppTableText title={user.profileDocumentId ?? undefined}>
                  {getNullableIdentifierLabel(user.profileDocumentId)}
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
        label={ORG_MANAGER_LABELS.profileDocument}
        title={user.profileDocumentId ?? undefined}
        value={getNullableIdentifierLabel(user.profileDocumentId)}
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

function RosterProfileEditor({
  canUpdateRosterEntry,
  mutating,
  profileDocumentIdDraft,
  profileDocumentIdDraftChanged,
  setProfileDocumentIdDraft,
  updateRosterProfileDocument,
}: {
  canUpdateRosterEntry: boolean;
  mutating: boolean;
  profileDocumentIdDraft: string;
  profileDocumentIdDraftChanged: boolean;
  setProfileDocumentIdDraft: (profileDocumentId: string) => void;
  updateRosterProfileDocument: () => void;
}) {
  if (!canUpdateRosterEntry) {
    return null;
  }

  return (
    <MiniAppToolbar className="org-manager-form-toolbar" wrap>
      <MiniAppField className="org-manager-roster-profile-field">
        <span>{ORG_MANAGER_LABELS.profileDocumentId}</span>
        <MiniAppInput
          aria-label={ORG_MANAGER_LABELS.profileDocumentId}
          disabled={mutating}
          onChange={(event) => setProfileDocumentIdDraft(event.target.value)}
          placeholder={ORG_MANAGER_LABELS.profileDocumentId}
          value={profileDocumentIdDraft}
        />
      </MiniAppField>
      <MiniAppButton
        disabled={mutating || !profileDocumentIdDraftChanged}
        onClick={updateRosterProfileDocument}
      >
        {ORG_MANAGER_LABELS.save}
      </MiniAppButton>
      <MiniAppButton
        disabled={mutating || profileDocumentIdDraft.trim().length === 0}
        onClick={() => setProfileDocumentIdDraft("")}
      >
        {ORG_MANAGER_LABELS.clear}
      </MiniAppButton>
    </MiniAppToolbar>
  );
}

function UserDetailView({
  canUpdateRosterEntry,
  canRevokeGrants,
  detail,
  loading,
  mutating,
  openGroupRoute,
  profileDocumentIdDraft,
  profileDocumentIdDraftChanged,
  revokeGrant,
  selectedUserId,
  setProfileDocumentIdDraft,
  updateRosterProfileDocument,
}: {
  canUpdateRosterEntry: boolean;
  canRevokeGrants: boolean;
  detail: OrganizationUserDetail | null;
  loading: boolean;
  mutating: boolean;
  openGroupRoute: (groupId: string) => void;
  profileDocumentIdDraft: string;
  profileDocumentIdDraftChanged: boolean;
  revokeGrant: (grant: OrganizationContainerGrant) => void;
  selectedUserId: string | null;
  setProfileDocumentIdDraft: (profileDocumentId: string) => void;
  updateRosterProfileDocument: () => void;
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
          {ORG_MANAGER_LABELS.directory}
        </MiniAppSectionHeading>
        <RosterProfileEditor
          canUpdateRosterEntry={canUpdateRosterEntry}
          mutating={mutating}
          profileDocumentIdDraft={profileDocumentIdDraft}
          profileDocumentIdDraftChanged={profileDocumentIdDraftChanged}
          setProfileDocumentIdDraft={setProfileDocumentIdDraft}
          updateRosterProfileDocument={updateRosterProfileDocument}
        />
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
  canUpdateRosterEntry,
  canRevokeGrants,
  detail,
  directory,
  loading,
  loadingUserDetail,
  mutating,
  openGroupRoute,
  profileDocumentIdDraft,
  profileDocumentIdDraftChanged,
  revokeGrant,
  selectedUserId,
  selectUser,
  setProfileDocumentIdDraft,
  updateRosterProfileDocument,
}: {
  canUpdateRosterEntry: boolean;
  canRevokeGrants: boolean;
  detail: OrganizationUserDetail | null;
  directory: OrganizationDirectory | null;
  loading: boolean;
  loadingUserDetail: boolean;
  mutating: boolean;
  openGroupRoute: (groupId: string) => void;
  profileDocumentIdDraft: string;
  profileDocumentIdDraftChanged: boolean;
  revokeGrant: (grant: OrganizationContainerGrant) => void;
  selectedUserId: string | null;
  selectUser: (userId: string) => void;
  setProfileDocumentIdDraft: (profileDocumentId: string) => void;
  updateRosterProfileDocument: () => void;
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
          canUpdateRosterEntry={canUpdateRosterEntry}
          canRevokeGrants={canRevokeGrants}
          detail={detail}
          loading={loadingUserDetail}
          mutating={mutating}
          openGroupRoute={openGroupRoute}
          profileDocumentIdDraft={profileDocumentIdDraft}
          profileDocumentIdDraftChanged={profileDocumentIdDraftChanged}
          revokeGrant={revokeGrant}
          selectedUserId={selectedUserId}
          setProfileDocumentIdDraft={setProfileDocumentIdDraft}
          updateRosterProfileDocument={updateRosterProfileDocument}
        />
      </section>
    </div>
  );
}
