import type { DomainScope, SessionContext } from "@symcrypt/client-sdk";
import { useCallback } from "react";
import { useSymCrypt } from "../../../providers/sdk/SymCryptProvider";
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
  const symcrypt = useSymCrypt();
  const organizationIndexRefreshKey = useOrganizationIndexRefreshKey({
    scopeKey,
    symcrypt,
  });
  const listLocalOrganizations = useCallback(
    () => symcrypt.organizations.listLocalOrganizations(),
    [symcrypt],
  );
  const provisionOrganization = useCallback(
    (organizationProfileName: string) =>
      symcrypt.session.createOrganization({ organizationProfileName }),
    [symcrypt],
  );
  const setSessionContext = useCallback(
    (context: SessionContext) => symcrypt.session.setContext(context),
    [symcrypt],
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
