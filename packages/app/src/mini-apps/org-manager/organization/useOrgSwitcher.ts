import type { DomainScope, SessionContext } from "@tearleads/client-sdk";
import { useCallback } from "react";
import { useTearleads } from "../../../providers/sdk/TearleadsProvider";
import type { OrgSwitcherState } from "./orgSwitcherTypes";
import { useOrganizationIndexRefreshKey } from "./useOrganizationIndexRefreshKey";
import { useOrgSwitcherController } from "./useOrgSwitcherController";

/**
 * Backs the org-manager organization switcher: enumerates the organizations the
 * user can manage locally and lets them pick which one is active or provision a
 * new one. Selecting an organization updates the single active organization;
 * Explorer resolves cross-organization files independently.
 */
export function useOrgSwitcher({
  activeContainerId,
  activeOrganizationId,
  databaseReady,
  enabled,
  interactionDisabled = false,
  operationScopeKey,
  scopeKey,
}: {
  activeContainerId: string | null;
  activeOrganizationId: string | null;
  databaseReady: boolean;
  enabled: boolean;
  interactionDisabled?: boolean | undefined;
  operationScopeKey: string;
  scopeKey: DomainScope;
}): OrgSwitcherState {
  const tearleads = useTearleads();
  const organizationIndexRefreshKey = useOrganizationIndexRefreshKey({
    scopeKey,
    tearleads,
  });
  const listLocalOrganizations = useCallback(
    () => tearleads.organizations.listLocalOrganizations(),
    [tearleads],
  );
  const provisionOrganization = useCallback(
    (organizationProfileName: string) =>
      tearleads.session.createOrganization({ organizationProfileName }),
    [tearleads],
  );
  const setSessionContext = useCallback(
    (context: SessionContext) => tearleads.session.setContext(context),
    [tearleads],
  );

  return useOrgSwitcherController({
    activeContainerId,
    activeOrganizationId,
    databaseReady,
    enabled,
    interactionDisabled,
    listLocalOrganizations,
    organizationIndexRefreshKey,
    operationScopeKey,
    provisionOrganization,
    scopeKey,
    setSessionContext,
  });
}
