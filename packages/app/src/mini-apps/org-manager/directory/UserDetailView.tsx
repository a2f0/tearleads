import type {
  OrganizationContainerGrant,
  OrganizationGroupSummary,
  OrganizationUserDetail,
} from "@symcrypt/client-sdk";
import { useEffect, useState } from "react";
import {
  MiniAppActions,
  MiniAppButton,
  MiniAppHeader,
  MiniAppHeaderCopy,
  MiniAppSection,
  MiniAppSectionHeading,
  MiniAppStatus,
} from "../../../components/mini-app/MiniAppLayout";
import {
  MiniAppRowButton,
  MiniAppRowStack,
  MiniAppRowText,
} from "../../../components/mini-app/rows/MiniAppRow";
import {
  MINI_APP_VIRTUAL_ROOMY_ROW_HEIGHT,
  MiniAppVirtualList,
  MiniAppVirtualListFrame,
  MiniAppVirtualListRow,
  useMiniAppVirtualRows,
} from "../../../components/mini-app/virtual/MiniAppVirtual";
import { formatMiniAppDate } from "../../../utils/formatMiniAppDate";
import { compactFingerprint } from "../display";
import { GrantSections } from "../grants/GrantSections";
import { ORG_MANAGER_LABELS } from "../labels";
import type { OrgManagerGrantRouteRef } from "../routes";
import { UserRosterMetadata } from "./RosterMetadata";
import { RosterProfileEditor } from "./RosterProfileEditor";

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

export function UserDetailView({
  canEditRosterProfile,
  canRevokeGrants,
  detail,
  pending,
  onRosterProfileDisplayNameChange,
  organizationId,
  rosterProfileEditRequestKey,
  openGrantRoute,
  openGroupRoute,
  profileDisplayName,
  revokeGrant,
  syncSeatAssigned,
  mutating,
}: {
  canEditRosterProfile: boolean;
  canRevokeGrants: boolean;
  detail: OrganizationUserDetail | null;
  pending: boolean;
  onRosterProfileDisplayNameChange: (displayName: string | null) => void;
  organizationId: string;
  rosterProfileEditRequestKey: number | null;
  mutating: boolean;
  openGrantRoute: (grantRef: OrgManagerGrantRouteRef) => void;
  openGroupRoute: (groupId: string) => void;
  profileDisplayName: string | undefined;
  revokeGrant: (grant: OrganizationContainerGrant) => void;
  syncSeatAssigned: boolean | null;
}) {
  const [isRosterProfileEditing, setIsRosterProfileEditing] = useState(false);

  useEffect(() => {
    if (
      typeof rosterProfileEditRequestKey !== "number" ||
      !canEditRosterProfile
    ) {
      return;
    }

    setIsRosterProfileEditing(true);
  }, [canEditRosterProfile, rosterProfileEditRequestKey]);

  if (!detail) {
    return (
      <>
        <MiniAppHeader className="org-manager-detail-header">
          <MiniAppHeaderCopy>
            <strong>
              {pending
                ? ORG_MANAGER_LABELS.loadingUserDetail
                : ORG_MANAGER_LABELS.userDetailUnavailable}
            </strong>
          </MiniAppHeaderCopy>
        </MiniAppHeader>
        <MiniAppStatus className="org-manager-hint">
          {pending
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
          {detail.user.status === "active" && syncSeatAssigned === false && (
            <span className="org-manager-detail-status">
              {ORG_MANAGER_LABELS.syncSeatUnavailable}
            </span>
          )}
          {canEditRosterProfile && (
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
        </MiniAppActions>
      </MiniAppHeader>
      <MiniAppSection className="org-manager-roster-detail">
        <RosterProfileEditor
          canEdit={canEditRosterProfile}
          isEditing={isRosterProfileEditing}
          onDisplayNameChange={onRosterProfileDisplayNameChange}
          organizationId={organizationId}
          user={detail.user}
        />
        <UserRosterMetadata user={detail.user} />
      </MiniAppSection>
      <MiniAppSection>
        <MiniAppSectionHeading>
          {ORG_MANAGER_LABELS.groups}
        </MiniAppSectionHeading>
        <UserGroups groups={detail.groups} openGroupRoute={openGroupRoute} />
      </MiniAppSection>
      <GrantSections
        canRevokeGrants={canRevokeGrants}
        mutating={mutating}
        openGrantRoute={openGrantRoute}
        revokeGrant={revokeGrant}
        sections={[
          {
            emptyLabel: ORG_MANAGER_LABELS.noUserContainerLinks,
            grants: detail.grants.directGrants,
            label: ORG_MANAGER_LABELS.userContainerLinks,
          },
          {
            emptyLabel: ORG_MANAGER_LABELS.noGroupContainerLinks,
            grants: detail.grants.groupGrants,
            label: ORG_MANAGER_LABELS.groupContainerLinks,
          },
        ]}
      />
    </>
  );
}
