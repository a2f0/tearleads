import type {
  OrganizationContainerGrant,
  OrganizationContainerGrants,
} from "@tearleads/client-sdk";
import {
  MiniAppButton,
  MiniAppHeader,
  MiniAppHeaderCopy,
  MiniAppSection,
  MiniAppSectionHeading,
  MiniAppStatePanel,
  MiniAppStatus,
} from "../../../components/mini-app/MiniAppLayout";
import {
  MiniAppInfoRow,
  MiniAppInfoTable,
} from "../../../components/mini-app/MiniAppTable";
import { formatMiniAppDate } from "../../../utils/formatMiniAppDate";
import {
  compactFingerprint,
  getAccessLabel,
  getContainerDisplayLabel,
  getContainerDisplayTitle,
  getGrantPrincipalLabel,
} from "../display";
import { ORG_MANAGER_LABELS } from "../labels";
import type { OrgManagerGrantRouteRef } from "../routes";
import { GrantSections } from "./GrantSections";

function grantsBySubjectType(
  grants: ReadonlyArray<OrganizationContainerGrant>,
  subjectType: OrganizationContainerGrant["subjectType"],
): OrganizationContainerGrant[] {
  return grants.filter((grant) => grant.subjectType === subjectType);
}

export function GrantsView({
  canRevokeGrants,
  grants,
  memberGroupId,
  pending,
  mutating,
  openGrantRoute,
  openGroupRoute,
  revokeGrant,
  selectedGrant,
  selectedGrantRef,
}: {
  canRevokeGrants: boolean;
  grants: OrganizationContainerGrants | null;
  memberGroupId: string | null;
  pending: boolean;
  mutating: boolean;
  openGrantRoute: (grantRef: OrgManagerGrantRouteRef) => void;
  openGroupRoute: (groupId: string) => void;
  revokeGrant: (grant: OrganizationContainerGrant) => void;
  selectedGrant: OrganizationContainerGrant | null;
  selectedGrantRef: OrgManagerGrantRouteRef | null;
}) {
  if (!grants && pending) {
    return <MiniAppStatePanel busy title={ORG_MANAGER_LABELS.loadingGrants} />;
  }

  if (selectedGrantRef) {
    return (
      <GrantDetailView
        canRevokeGrants={canRevokeGrants}
        grant={selectedGrant}
        grants={grants}
        mutating={mutating}
        openGroupRoute={openGroupRoute}
        revokeGrant={revokeGrant}
      />
    );
  }

  if (!grants) {
    return (
      <MiniAppStatus className="org-manager-hint">
        {ORG_MANAGER_LABELS.grantsUnavailable}
      </MiniAppStatus>
    );
  }

  return (
    <div>
      <GrantSections
        canRevokeGrants={canRevokeGrants}
        memberGroupId={memberGroupId}
        mutating={mutating}
        openGrantRoute={openGrantRoute}
        revokeGrant={revokeGrant}
        sections={[
          {
            emptyLabel: ORG_MANAGER_LABELS.noGroupContainerLinks,
            grants: grantsBySubjectType(grants.grants, "group"),
            label: ORG_MANAGER_LABELS.groupContainerLinks,
          },
          {
            emptyLabel: ORG_MANAGER_LABELS.noUserContainerLinks,
            grants: grantsBySubjectType(grants.grants, "user"),
            label: ORG_MANAGER_LABELS.userContainerLinks,
          },
        ]}
      />
    </div>
  );
}

function GrantDetailView({
  canRevokeGrants,
  grant,
  grants,
  mutating,
  openGroupRoute,
  revokeGrant,
}: {
  canRevokeGrants: boolean;
  grant: OrganizationContainerGrant | null;
  grants: OrganizationContainerGrants | null;
  mutating: boolean;
  openGroupRoute: (groupId: string) => void;
  revokeGrant: (grant: OrganizationContainerGrant) => void;
}) {
  if (!grants) {
    return (
      <section className="org-manager-panel">
        <GrantDetailHeader />
        <MiniAppStatus className="org-manager-hint">
          {ORG_MANAGER_LABELS.grantsUnavailable}
        </MiniAppStatus>
      </section>
    );
  }

  if (!grant) {
    return (
      <section className="org-manager-panel">
        <GrantDetailHeader />
        <MiniAppStatus className="org-manager-hint">
          {ORG_MANAGER_LABELS.grantUnavailable}
        </MiniAppStatus>
      </section>
    );
  }

  const canRevokeGrant = canRevokeGrants && !grant.isBuiltin;
  return (
    <section className="org-manager-panel">
      <GrantDetailHeader
        grant={grant}
        mutating={mutating}
        onRevoke={
          canRevokeGrant
            ? () => {
                revokeGrant(grant);
              }
            : undefined
        }
      />
      <MiniAppSection>
        <MiniAppSectionHeading>
          {ORG_MANAGER_LABELS.grantDetail}
        </MiniAppSectionHeading>
        <MiniAppInfoTable className="mini-app-info-table--borderless">
          <tbody>
            <MiniAppInfoRow
              label={ORG_MANAGER_LABELS.principal}
              title={grant.subjectId}
            >
              {getGrantPrincipalLabel(grant)}
            </MiniAppInfoRow>
            <MiniAppInfoRow label={ORG_MANAGER_LABELS.subjectType}>
              {getGrantSubjectTypeLabel(grant.subjectType)}
            </MiniAppInfoRow>
            <MiniAppInfoRow label={ORG_MANAGER_LABELS.subjectId}>
              <code>{grant.subjectId}</code>
            </MiniAppInfoRow>
            {grant.subjectType === "group" ? (
              <MiniAppInfoRow label={ORG_MANAGER_LABELS.group}>
                <MiniAppButton
                  onClick={() => openGroupRoute(grant.subjectId)}
                  type="button"
                  variant="ghost"
                >
                  {grant.groupName ?? compactFingerprint(grant.subjectId)}
                </MiniAppButton>
              </MiniAppInfoRow>
            ) : null}
            <MiniAppInfoRow
              label={ORG_MANAGER_LABELS.container}
              title={getContainerDisplayTitle(grant)}
            >
              {getContainerDisplayLabel(grant)}
            </MiniAppInfoRow>
            <MiniAppInfoRow label={ORG_MANAGER_LABELS.containerId}>
              <code>{grant.containerId}</code>
            </MiniAppInfoRow>
            <MiniAppInfoRow label={ORG_MANAGER_LABELS.access}>
              {getAccessLabel(grant.accessLevel)}
            </MiniAppInfoRow>
            <MiniAppInfoRow
              label={ORG_MANAGER_LABELS.created}
              title={grant.createdAt}
            >
              {formatMiniAppDate(grant.createdAt)}
            </MiniAppInfoRow>
            <MiniAppInfoRow
              label={ORG_MANAGER_LABELS.updated}
              title={grant.updatedAt}
            >
              {formatMiniAppDate(grant.updatedAt)}
            </MiniAppInfoRow>
            <MiniAppInfoRow label={ORG_MANAGER_LABELS.metadataAccessEpoch}>
              {grant.metadataAccessEpoch}
            </MiniAppInfoRow>
            <MiniAppInfoRow label={ORG_MANAGER_LABELS.metadataAccessStateHash}>
              <code>{grant.metadataAccessStateHash}</code>
            </MiniAppInfoRow>
            <MiniAppInfoRow label={ORG_MANAGER_LABELS.metadataDocumentId}>
              {grant.metadataDocumentId ? (
                <code>{grant.metadataDocumentId}</code>
              ) : (
                ORG_MANAGER_LABELS.none
              )}
            </MiniAppInfoRow>
            {grant.subjectType === "user" ? (
              <MiniAppInfoRow label={ORG_MANAGER_LABELS.signingKey}>
                {grant.signingKeyFingerprint ? (
                  <code>{grant.signingKeyFingerprint}</code>
                ) : (
                  ORG_MANAGER_LABELS.none
                )}
              </MiniAppInfoRow>
            ) : null}
          </tbody>
        </MiniAppInfoTable>
      </MiniAppSection>
    </section>
  );
}

function GrantDetailHeader({
  grant,
  mutating = false,
  onRevoke,
}: {
  grant?: OrganizationContainerGrant | null | undefined;
  mutating?: boolean | undefined;
  onRevoke?: (() => void) | undefined;
}) {
  return (
    <MiniAppHeader className="org-manager-detail-header">
      <MiniAppHeaderCopy>
        <strong>{ORG_MANAGER_LABELS.grantDetail}</strong>
        {grant ? (
          <span title={grant.containerId}>
            {getGrantPrincipalLabel(grant)} / {getContainerDisplayLabel(grant)}
          </span>
        ) : null}
      </MiniAppHeaderCopy>
      {onRevoke ? (
        <div className="org-manager-detail-actions">
          <MiniAppButton disabled={mutating} onClick={onRevoke}>
            {ORG_MANAGER_LABELS.revoke}
          </MiniAppButton>
        </div>
      ) : null}
    </MiniAppHeader>
  );
}

function getGrantSubjectTypeLabel(
  subjectType: OrganizationContainerGrant["subjectType"],
): string {
  if (subjectType === "group") {
    return ORG_MANAGER_LABELS.group;
  }

  return ORG_MANAGER_LABELS.user;
}
