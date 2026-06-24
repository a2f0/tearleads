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
  MiniAppStatus,
} from "../../components/shared/MiniAppLayout";
import { MiniAppInfoTable } from "../../components/shared/MiniAppTable";
import { formatMiniAppDate } from "../../utils/formatMiniAppDate";
import {
  compactFingerprint,
  getAccessLabel,
  getContainerDisplayLabel,
  getContainerDisplayTitle,
  getGrantPrincipalLabel,
} from "./display";
import { GrantTable } from "./GrantTable";
import { ORG_MANAGER_LABELS } from "./labels";
import type { OrgManagerGrantRouteRef } from "./routes";

function grantsBySubjectType(
  grants: ReadonlyArray<OrganizationContainerGrant>,
  subjectType: OrganizationContainerGrant["subjectType"],
): OrganizationContainerGrant[] {
  return grants.filter((grant) => grant.subjectType === subjectType);
}

export function GrantsView({
  canRevokeGrants,
  grants,
  loading,
  mutating,
  openGrantRoute,
  openGroupRoute,
  revokeGrant,
  selectedGrant,
  selectedGrantRef,
  selectGrantRef,
}: {
  canRevokeGrants: boolean;
  grants: OrganizationContainerGrants | null;
  loading: boolean;
  mutating: boolean;
  openGrantRoute: (grantRef: OrgManagerGrantRouteRef) => void;
  openGroupRoute: (groupId: string) => void;
  revokeGrant: (grant: OrganizationContainerGrant) => void;
  selectedGrant: OrganizationContainerGrant | null;
  selectedGrantRef: OrgManagerGrantRouteRef | null;
  selectGrantRef: (grantRef: OrgManagerGrantRouteRef | null) => void;
}) {
  if (selectedGrantRef) {
    return (
      <GrantDetailView
        canRevokeGrants={canRevokeGrants}
        grant={selectedGrant}
        grants={grants}
        loading={loading}
        mutating={mutating}
        openGroupRoute={openGroupRoute}
        revokeGrant={revokeGrant}
        selectGrantRef={selectGrantRef}
      />
    );
  }

  if (!grants) {
    return (
      <MiniAppStatus className="org-manager-hint">
        {loading
          ? ORG_MANAGER_LABELS.loadingGrants
          : ORG_MANAGER_LABELS.grantsUnavailable}
      </MiniAppStatus>
    );
  }

  const groupGrants = grantsBySubjectType(grants.grants, "group");
  const userGrants = grantsBySubjectType(grants.grants, "user");
  const organizationGrants = grantsBySubjectType(grants.grants, "organization");

  return (
    <div>
      <MiniAppSection>
        <MiniAppSectionHeading>
          {ORG_MANAGER_LABELS.groupContainerLinks}
        </MiniAppSectionHeading>
        <GrantTable
          canRevokeGrants={canRevokeGrants}
          emptyLabel={ORG_MANAGER_LABELS.noGroupContainerLinks}
          grants={groupGrants}
          label={ORG_MANAGER_LABELS.groupContainerLinks}
          mutating={mutating}
          openGrantRoute={openGrantRoute}
          revokeGrant={revokeGrant}
        />
      </MiniAppSection>
      <MiniAppSection>
        <MiniAppSectionHeading>
          {ORG_MANAGER_LABELS.userContainerLinks}
        </MiniAppSectionHeading>
        <GrantTable
          canRevokeGrants={canRevokeGrants}
          emptyLabel={ORG_MANAGER_LABELS.noUserContainerLinks}
          grants={userGrants}
          label={ORG_MANAGER_LABELS.userContainerLinks}
          mutating={mutating}
          openGrantRoute={openGrantRoute}
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
          grants={organizationGrants}
          label={ORG_MANAGER_LABELS.organizationContainerLinks}
          mutating={mutating}
          openGrantRoute={openGrantRoute}
          revokeGrant={revokeGrant}
        />
      </MiniAppSection>
    </div>
  );
}

function GrantDetailView({
  canRevokeGrants,
  grant,
  grants,
  loading,
  mutating,
  openGroupRoute,
  revokeGrant,
  selectGrantRef,
}: {
  canRevokeGrants: boolean;
  grant: OrganizationContainerGrant | null;
  grants: OrganizationContainerGrants | null;
  loading: boolean;
  mutating: boolean;
  openGroupRoute: (groupId: string) => void;
  revokeGrant: (grant: OrganizationContainerGrant) => void;
  selectGrantRef: (grantRef: OrgManagerGrantRouteRef | null) => void;
}) {
  const goBack = () => selectGrantRef(null);

  if (!grants) {
    return (
      <section className="org-manager-panel">
        <GrantDetailHeader onBack={goBack} />
        <MiniAppStatus className="org-manager-hint">
          {loading
            ? ORG_MANAGER_LABELS.loadingGrants
            : ORG_MANAGER_LABELS.grantsUnavailable}
        </MiniAppStatus>
      </section>
    );
  }

  if (!grant) {
    return (
      <section className="org-manager-panel">
        <GrantDetailHeader onBack={goBack} />
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
        onBack={goBack}
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
        <MiniAppInfoTable>
          <tbody>
            <tr>
              <th>{ORG_MANAGER_LABELS.principal}</th>
              <td title={grant.subjectId}>{getGrantPrincipalLabel(grant)}</td>
            </tr>
            <tr>
              <th>{ORG_MANAGER_LABELS.subjectType}</th>
              <td>{getGrantSubjectTypeLabel(grant.subjectType)}</td>
            </tr>
            <tr>
              <th>{ORG_MANAGER_LABELS.subjectId}</th>
              <td>
                <code>{grant.subjectId}</code>
              </td>
            </tr>
            {grant.subjectType === "group" ? (
              <tr>
                <th>{ORG_MANAGER_LABELS.group}</th>
                <td>
                  <MiniAppButton
                    onClick={() => openGroupRoute(grant.subjectId)}
                    type="button"
                    variant="ghost"
                  >
                    {grant.groupName ?? compactFingerprint(grant.subjectId)}
                  </MiniAppButton>
                </td>
              </tr>
            ) : null}
            <tr>
              <th>{ORG_MANAGER_LABELS.container}</th>
              <td title={getContainerDisplayTitle(grant)}>
                {getContainerDisplayLabel(grant)}
              </td>
            </tr>
            <tr>
              <th>{ORG_MANAGER_LABELS.containerId}</th>
              <td>
                <code>{grant.containerId}</code>
              </td>
            </tr>
            <tr>
              <th>{ORG_MANAGER_LABELS.access}</th>
              <td>{getAccessLabel(grant.accessLevel)}</td>
            </tr>
            <tr>
              <th>{ORG_MANAGER_LABELS.created}</th>
              <td title={grant.createdAt}>
                {formatMiniAppDate(grant.createdAt)}
              </td>
            </tr>
            <tr>
              <th>{ORG_MANAGER_LABELS.updated}</th>
              <td title={grant.updatedAt}>
                {formatMiniAppDate(grant.updatedAt)}
              </td>
            </tr>
            <tr>
              <th>{ORG_MANAGER_LABELS.metadataAccessEpoch}</th>
              <td>{grant.metadataAccessEpoch}</td>
            </tr>
            <tr>
              <th>{ORG_MANAGER_LABELS.metadataAccessStateHash}</th>
              <td>
                <code>{grant.metadataAccessStateHash}</code>
              </td>
            </tr>
            <tr>
              <th>{ORG_MANAGER_LABELS.metadataDocumentId}</th>
              <td>
                {grant.metadataDocumentId ? (
                  <code>{grant.metadataDocumentId}</code>
                ) : (
                  ORG_MANAGER_LABELS.none
                )}
              </td>
            </tr>
            <tr>
              <th>{ORG_MANAGER_LABELS.signingKey}</th>
              <td>
                {grant.signingKeyFingerprint ? (
                  <code>{grant.signingKeyFingerprint}</code>
                ) : (
                  ORG_MANAGER_LABELS.none
                )}
              </td>
            </tr>
          </tbody>
        </MiniAppInfoTable>
      </MiniAppSection>
    </section>
  );
}

function GrantDetailHeader({
  grant,
  mutating = false,
  onBack,
  onRevoke,
}: {
  grant?: OrganizationContainerGrant | null | undefined;
  mutating?: boolean | undefined;
  onBack: () => void;
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
      <div className="org-manager-detail-actions">
        {onRevoke ? (
          <MiniAppButton disabled={mutating} onClick={onRevoke}>
            {ORG_MANAGER_LABELS.revoke}
          </MiniAppButton>
        ) : null}
        <MiniAppButton onClick={onBack} variant="ghost">
          {ORG_MANAGER_LABELS.back}
        </MiniAppButton>
      </div>
    </MiniAppHeader>
  );
}

function getGrantSubjectTypeLabel(
  subjectType: OrganizationContainerGrant["subjectType"],
): string {
  if (subjectType === "group") {
    return ORG_MANAGER_LABELS.group;
  }
  if (subjectType === "organization") {
    return ORG_MANAGER_LABELS.organization;
  }

  return ORG_MANAGER_LABELS.user;
}
