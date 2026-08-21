import type {
  OrganizationContainerGrant,
  OrganizationContainerGrants,
} from "@symcrypt/client-sdk";
import {
  MiniAppButton,
  MiniAppHeader,
  MiniAppHeaderCopy,
  MiniAppSection,
  MiniAppSectionHeading,
  MiniAppStatus,
} from "../../../components/mini-app/MiniAppLayout";
import { MiniAppInfoTable } from "../../../components/mini-app/MiniAppTable";
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
  pending: boolean;
  mutating: boolean;
  openGrantRoute: (grantRef: OrgManagerGrantRouteRef) => void;
  openGroupRoute: (groupId: string) => void;
  revokeGrant: (grant: OrganizationContainerGrant) => void;
  selectedGrant: OrganizationContainerGrant | null;
  selectedGrantRef: OrgManagerGrantRouteRef | null;
}) {
  if (selectedGrantRef) {
    return (
      <GrantDetailView
        canRevokeGrants={canRevokeGrants}
        grant={selectedGrant}
        grants={grants}
        pending={pending}
        mutating={mutating}
        openGroupRoute={openGroupRoute}
        revokeGrant={revokeGrant}
      />
    );
  }

  if (!grants) {
    return (
      <MiniAppStatus className="org-manager-hint">
        {pending
          ? ORG_MANAGER_LABELS.loadingGrants
          : ORG_MANAGER_LABELS.grantsUnavailable}
      </MiniAppStatus>
    );
  }

  return (
    <div>
      <GrantSections
        canRevokeGrants={canRevokeGrants}
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
  pending,
  mutating,
  openGroupRoute,
  revokeGrant,
}: {
  canRevokeGrants: boolean;
  grant: OrganizationContainerGrant | null;
  grants: OrganizationContainerGrants | null;
  pending: boolean;
  mutating: boolean;
  openGroupRoute: (groupId: string) => void;
  revokeGrant: (grant: OrganizationContainerGrant) => void;
}) {
  if (!grants) {
    return (
      <section className="org-manager-panel">
        <GrantDetailHeader />
        <MiniAppStatus className="org-manager-hint">
          {pending
            ? ORG_MANAGER_LABELS.loadingGrants
            : ORG_MANAGER_LABELS.grantsUnavailable}
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
            {grant.subjectType === "user" ? (
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
