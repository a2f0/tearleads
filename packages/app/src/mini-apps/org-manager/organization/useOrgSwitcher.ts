import type {
  DomainScope,
  LocalOrganizationSummary,
  SessionContext,
} from "@tearleads/client-sdk";
import { useCallback } from "react";
import { useLog } from "../../../providers/logging/LogProvider";
import { useTearleads } from "../../../providers/sdk/TearleadsProvider";
import type {
  OrganizationWorkspace,
  OrgSwitcherState,
} from "./orgSwitcherTypes";
import { useOrganizationIndexRefreshKey } from "./useOrganizationIndexRefreshKey";
import { useOrgSwitcherController } from "./useOrgSwitcherController";

function isOrganizationWorkspace(
  organization: LocalOrganizationSummary,
): organization is OrganizationWorkspace {
  return organization.rootContainerId !== null;
}

/**
 * Backs the org-manager organization switcher: enumerates the organization
 * workspaces the user can reach locally and lets them pick which one is active
 * or provision a new one. Selecting an organization updates the single active
 * organization; Explorer and the Organizations dashboard show every
 * organization independently.
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
  const { logError } = useLog();
  const organizationIndexRefreshKey = useOrganizationIndexRefreshKey({
    scopeKey,
    tearleads,
  });
  const listLocalOrganizations = useCallback(
    async () =>
      (await tearleads.organizations.listLocalOrganizations()).filter(
        isOrganizationWorkspace,
      ),
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
    logError,
    organizationIndexRefreshKey,
    operationScopeKey,
    provisionOrganization,
    scopeKey,
    setSessionContext,
  });
}
