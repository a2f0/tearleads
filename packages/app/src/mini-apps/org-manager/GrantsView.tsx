import {
  MiniAppSection,
  MiniAppSectionHeading,
  MiniAppStatus,
} from "../../components/shared/MiniAppLayout";
import type {
  OrgManagerContainerGrant,
  OrgManagerContainerGrants,
} from "../../stores/org-manager/OrgManagerProvider";
import { GrantTable } from "./GrantTable";
import { ORG_MANAGER_LABELS } from "./labels";

function grantsBySubjectType(
  grants: ReadonlyArray<OrgManagerContainerGrant>,
  subjectType: OrgManagerContainerGrant["subjectType"],
): OrgManagerContainerGrant[] {
  return grants.filter((grant) => grant.subjectType === subjectType);
}

export function GrantsView({
  canRevokeGrants,
  grants,
  loading,
  mutating,
  openGroupRoute,
  revokeGrant,
}: {
  canRevokeGrants: boolean;
  grants: OrgManagerContainerGrants | null;
  loading: boolean;
  mutating: boolean;
  openGroupRoute: (groupId: string) => void;
  revokeGrant: (grant: OrgManagerContainerGrant) => void;
}) {
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
          openGroupRoute={openGroupRoute}
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
          grants={organizationGrants}
          label={ORG_MANAGER_LABELS.organizationContainerLinks}
          mutating={mutating}
          openGroupRoute={openGroupRoute}
          revokeGrant={revokeGrant}
        />
      </MiniAppSection>
    </div>
  );
}
