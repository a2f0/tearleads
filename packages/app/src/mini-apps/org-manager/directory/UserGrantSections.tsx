import type {
  OrganizationContainerGrant,
  OrganizationUserDetail,
} from "@tearleads/client-sdk";
import {
  MiniAppSection,
  MiniAppSectionHeading,
} from "../../../components/shared/MiniAppLayout";
import { GrantTable } from "../grants/GrantTable";
import { ORG_MANAGER_LABELS } from "../labels";
import type { OrgManagerGrantRouteRef } from "../routes";

export function UserGrantSections({
  canRevokeGrants,
  grants,
  mutating,
  openGrantRoute,
  revokeGrant,
}: {
  canRevokeGrants: boolean;
  grants: OrganizationUserDetail["grants"];
  mutating: boolean;
  openGrantRoute: (grantRef: OrgManagerGrantRouteRef) => void;
  revokeGrant: (grant: OrganizationContainerGrant) => void;
}) {
  return (
    <>
      <MiniAppSection>
        <MiniAppSectionHeading>
          {ORG_MANAGER_LABELS.userContainerLinks}
        </MiniAppSectionHeading>
        <GrantTable
          canRevokeGrants={canRevokeGrants}
          emptyLabel={ORG_MANAGER_LABELS.noUserContainerLinks}
          grants={grants.directGrants}
          label={ORG_MANAGER_LABELS.userContainerLinks}
          mutating={mutating}
          openGrantRoute={openGrantRoute}
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
          grants={grants.groupGrants}
          label={ORG_MANAGER_LABELS.groupContainerLinks}
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
          grants={grants.organizationGrants}
          label={ORG_MANAGER_LABELS.organizationContainerLinks}
          mutating={mutating}
          openGrantRoute={openGrantRoute}
          revokeGrant={revokeGrant}
        />
      </MiniAppSection>
    </>
  );
}
