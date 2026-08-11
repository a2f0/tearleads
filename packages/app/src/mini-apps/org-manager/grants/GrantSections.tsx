import type { OrganizationContainerGrant } from "@tearleads/client-sdk";
import {
  MiniAppSection,
  MiniAppSectionHeading,
} from "../../../components/mini-app/MiniAppLayout";
import type { OrgManagerGrantRouteRef } from "../routes";
import { useGrantContextMenu } from "./GrantContextMenu";
import { GrantTable } from "./GrantTable";

interface GrantSectionDescriptor {
  emptyLabel: string;
  grants: ReadonlyArray<OrganizationContainerGrant>;
  label: string;
}

/**
 * The container-link sections shared by the Grants view and the roster user
 * detail: one titled GrantTable per subject type (in the caller's order), all
 * wired to a single grant context menu.
 */
export function GrantSections({
  canRevokeGrants,
  mutating,
  openGrantRoute,
  revokeGrant,
  sections,
}: {
  canRevokeGrants: boolean;
  mutating: boolean;
  openGrantRoute: (grantRef: OrgManagerGrantRouteRef) => void;
  revokeGrant: (grant: OrganizationContainerGrant) => void;
  sections: ReadonlyArray<GrantSectionDescriptor>;
}) {
  const { grantContextMenu, openGrantContextMenu } = useGrantContextMenu({
    canRevokeGrants,
    mutating,
    openGrantRoute,
    revokeGrant,
  });

  return (
    <>
      {sections.map((section) => (
        <MiniAppSection key={section.label}>
          <MiniAppSectionHeading>{section.label}</MiniAppSectionHeading>
          <GrantTable
            canRevokeGrants={canRevokeGrants}
            emptyLabel={section.emptyLabel}
            grants={section.grants}
            label={section.label}
            mutating={mutating}
            openGrantContextMenu={openGrantContextMenu}
            openGrantRoute={openGrantRoute}
            revokeGrant={revokeGrant}
          />
        </MiniAppSection>
      ))}
      {grantContextMenu}
    </>
  );
}
