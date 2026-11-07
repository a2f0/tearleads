import type { OrganizationContainerGrant } from "@tearleads/client-sdk";
import { useMemo } from "react";
import {
  MiniAppSection,
  MiniAppSectionHeading,
} from "../../../components/mini-app/MiniAppLayout";
import { useAppFeatureFlags } from "../../../providers/feature-flags/AppFeatureFlagsProvider";
import { useGrantRowMenu } from "../../shared/grants/useGrantRowMenu";
import { ORG_MANAGER_LABELS } from "../labels";
import type { OrgManagerGrantRouteRef } from "../routes";
import { GrantTable } from "./GrantTable";
import { withoutOrganizationMetadataSystemGrants } from "./systemGrants";

interface GrantSectionDescriptor {
  emptyLabel: string;
  grants: ReadonlyArray<OrganizationContainerGrant>;
  label: string;
}

/**
 * The container-link sections shared by the Grants view and the roster user
 * detail: one titled GrantTable per subject type (in the caller's order), all
 * wired to a single grant context menu. With the
 * `hide-org-manager-system-grants` flag on, the organization metadata system
 * grants are left out of every section.
 */
export function GrantSections({
  canRevokeGrants,
  memberGroupId,
  mutating,
  openGrantRoute,
  revokeGrant,
  sections,
}: {
  canRevokeGrants: boolean;
  memberGroupId: string | null;
  mutating: boolean;
  openGrantRoute: (grantRef: OrgManagerGrantRouteRef) => void;
  revokeGrant: (grant: OrganizationContainerGrant) => void;
  sections: ReadonlyArray<GrantSectionDescriptor>;
}) {
  const { grantRowMenu, openGrantRowMenu } =
    useGrantRowMenu<OrganizationContainerGrant>({
      onOpen: (grant) =>
        openGrantRoute({
          containerId: grant.containerId,
          subjectId: grant.subjectId,
          subjectType: grant.subjectType,
        }),
      revoke: {
        canRevoke: (grant) => canRevokeGrants && !grant.isBuiltin && !mutating,
        label: ORG_MANAGER_LABELS.revoke,
        onRevoke: revokeGrant,
      },
    });
  const visibleSections = useVisibleGrantSections(sections, memberGroupId);

  return (
    <>
      {visibleSections.map((section) => (
        <MiniAppSection key={section.label}>
          <MiniAppSectionHeading>{section.label}</MiniAppSectionHeading>
          <GrantTable
            canRevokeGrants={canRevokeGrants}
            emptyLabel={section.emptyLabel}
            grants={section.grants}
            label={section.label}
            mutating={mutating}
            openGrantContextMenu={openGrantRowMenu}
            openGrantRoute={openGrantRoute}
            revokeGrant={revokeGrant}
          />
        </MiniAppSection>
      ))}
      {grantRowMenu}
    </>
  );
}

function useVisibleGrantSections(
  sections: ReadonlyArray<GrantSectionDescriptor>,
  memberGroupId: string | null,
): ReadonlyArray<GrantSectionDescriptor> {
  const { isEnabled } = useAppFeatureFlags();
  const hideSystemGrants = isEnabled("hide-org-manager-system-grants");

  return useMemo(() => {
    if (!hideSystemGrants) {
      return sections;
    }

    const visibleGrants = withoutOrganizationMetadataSystemGrants(
      sections.map((section) => section.grants),
      memberGroupId,
    );
    return sections.map((section, index) => ({
      ...section,
      grants: visibleGrants[index] ?? section.grants,
    }));
  }, [hideSystemGrants, memberGroupId, sections]);
}
