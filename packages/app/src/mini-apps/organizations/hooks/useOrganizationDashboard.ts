import { useCallback, useMemo } from "react";
import {
  useTearleads,
  useTearleadsRuntime,
} from "../../../providers/sdk/TearleadsProvider";
import { useTearleadsExternalStoreSnapshot } from "../../../providers/sdk/useTearleadsSubscription";
import { useOrganizationNames } from "../../shared/organizations/useOrganizationNames";
import {
  buildOrganizationDashboardCards,
  type OrganizationDashboardCard,
} from "../model/organizationDashboard";

export interface OrganizationDashboardModel {
  readonly cards: ReadonlyArray<OrganizationDashboardCard>;
  readonly ready: boolean;
}

/**
 * Every organization this user holds a container of, read from the local
 * container tree. Membership needs no request: each Members recipient holds the
 * organization's metadata root, and shared folders arrive with their
 * organization attached.
 */
export function useOrganizationDashboard(): OrganizationDashboardModel {
  const appData = useTearleadsRuntime();
  const tearleads = useTearleads();
  const scopeKey = appData.state.domainScope;
  const tree = useMemo(
    () => tearleads.deviceFirst.open().containerStore,
    [scopeKey, tearleads],
  );
  const snapshot = useTearleadsExternalStoreSnapshot(tree);
  const listLocalOrganizations = useCallback(
    () => tearleads.organizations.listLocalOrganizations(),
    [tearleads],
  );
  const namesById = useOrganizationNames({
    excludedOrganizationId: null,
    listLocalOrganizations,
    nodes: snapshot.nodes,
    ready: snapshot.ready,
  });
  const activeOrganizationId = appData.auth.organizationId ?? null;
  const cards = useMemo(
    () =>
      buildOrganizationDashboardCards({
        activeOrganizationId,
        namesById,
        nodes: snapshot.nodes,
      }),
    [activeOrganizationId, namesById, snapshot.nodes],
  );
  return { cards, ready: snapshot.ready };
}
