import { useCallback, useMemo } from "react";
import {
  useTearleads,
  useTearleadsRuntime,
} from "../../../providers/sdk/TearleadsProvider";
import { useTearleadsExternalStoreSnapshot } from "../../../providers/sdk/useTearleadsSubscription";
import { useOrganizationNames } from "../../shared/organizations/useOrganizationNames";
import {
  buildSharedWithMeRows,
  type SharedWithMeRow,
} from "../model/sharedWithMeRows";
import {
  type OrganizationSyncChoices,
  useOrganizationSyncChoices,
} from "./useOrganizationSyncChoices";

function leaveRequestIds(memberships: OrganizationSyncChoices["memberships"]): {
  leavableOrganizationIds: ReadonlySet<string>;
  leaveRequestedOrganizationIds: ReadonlySet<string>;
} {
  const listed = [...(memberships?.values() ?? [])];
  return {
    leavableOrganizationIds: new Set(
      listed.flatMap((membership) =>
        membership.isPersonalOrganizationOwner
          ? []
          : [membership.organizationId],
      ),
    ),
    leaveRequestedOrganizationIds: new Set(
      listed.flatMap((membership) =>
        membership.leaveRequestedAt === null ? [] : [membership.organizationId],
      ),
    ),
  };
}

export interface SharedWithMeModel {
  readonly ready: boolean;
  readonly rows: ReadonlyArray<SharedWithMeRow>;
  readonly syncChoices: OrganizationSyncChoices;
}

/**
 * Every folder this user can reach, and every organization they hold a
 * container of, read from the local container tree. Membership needs no
 * request: each Members recipient holds the organization's metadata root, and
 * shared folders arrive with their organization attached.
 */
export function useSharedWithMe(): SharedWithMeModel {
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
  const syncChoices = useOrganizationSyncChoices();
  const { memberships, pausedOrganizationIds } = syncChoices;
  const activeOrganizationId = appData.auth.organizationId ?? null;
  const rows = useMemo(
    () =>
      buildSharedWithMeRows({
        activeOrganizationId,
        ...leaveRequestIds(memberships),
        namesById,
        nodes: snapshot.nodes,
        pausedOrganizationIds,
      }),
    [
      activeOrganizationId,
      memberships,
      namesById,
      pausedOrganizationIds,
      snapshot.nodes,
    ],
  );
  return { ready: snapshot.ready, rows, syncChoices };
}
