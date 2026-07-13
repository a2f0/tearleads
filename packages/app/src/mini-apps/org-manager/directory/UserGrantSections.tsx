import type {
  OrganizationContainerGrant,
  OrganizationUserDetail,
} from "@tearleads/client-sdk";
import {
  MiniAppSection,
  MiniAppSectionHeading,
} from "../../../components/shared/MiniAppLayout";
import { useGrantContextMenu } from "../grants/GrantContextMenu";
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
  const { grantContextMenu, openGrantContextMenu } = useGrantContextMenu({
    canRevokeGrants,
    mutating,
    openGrantRoute,
    revokeGrant,
  });

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
          openGrantContextMenu={openGrantContextMenu}
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
          openGrantContextMenu={openGrantContextMenu}
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
          openGrantContextMenu={openGrantContextMenu}
          openGrantRoute={openGrantRoute}
          revokeGrant={revokeGrant}
        />
      </MiniAppSection>
      {grantContextMenu}
    </>
  );
}
