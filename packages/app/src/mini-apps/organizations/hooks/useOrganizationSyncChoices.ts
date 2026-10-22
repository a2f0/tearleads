import type {
  OrganizationLeaveRequestResult,
  OrganizationMembership,
  OrganizationSyncPauseResult,
} from "@tearleads/client-sdk";
import { useCallback, useEffect, useMemo, useState } from "react";
import {
  useTearleads,
  useTearleadsRuntime,
} from "../../../providers/sdk/TearleadsProvider";
import { ORGANIZATIONS_LABELS } from "../labels";

const EMPTY_IDS: ReadonlySet<string> = new Set();

export interface OrganizationSyncChoices {
  readonly changingOrganizationId: string | null;
  readonly error: string | null;
  /** The user's memberships as the server last reported them, or null. */
  readonly memberships: ReadonlyMap<string, OrganizationMembership> | null;
  readonly pausedOrganizationIds: ReadonlySet<string>;
  readonly personalOrganizationIds: ReadonlySet<string>;
  setLeaveRequested(organizationId: string, requested: boolean): Promise<void>;
  setSyncPaused(organizationId: string, paused: boolean): Promise<void>;
}

function byOrganizationId(
  memberships: readonly OrganizationMembership[],
): ReadonlyMap<string, OrganizationMembership> {
  return new Map(
    memberships.map((membership) => [membership.organizationId, membership]),
  );
}

function pauseErrorMessage(result: OrganizationSyncPauseResult): string | null {
  switch (result.status) {
    case "updated":
      return null;
    case "unsynced-writes":
      return ORGANIZATIONS_LABELS.pauseBlockedByUnsyncedWrites;
    case "failed":
      return result.message || ORGANIZATIONS_LABELS.syncChangeFailed;
  }
}

function leaveErrorMessage(
  result: OrganizationLeaveRequestResult,
): string | null {
  return result.status === "updated"
    ? null
    : result.message || ORGANIZATIONS_LABELS.leaveRequestFailed;
}

/** The paused set on this device and the memberships the server reports. */
function useMembershipState() {
  const tearleads = useTearleads();
  const scopeKey = useTearleadsRuntime().state.domainScope;
  const [pausedOrganizationIds, setPausedOrganizationIds] =
    useState<ReadonlySet<string>>(EMPTY_IDS);
  const [memberships, setMemberships] = useState<ReadonlyMap<
    string,
    OrganizationMembership
  > | null>(null);

  useEffect(() => {
    let active = true;
    const membershipConduit = tearleads.organizations.memberships;
    const reloadPaused = () => {
      void membershipConduit.loadPausedOrganizationIds().then((ids) => {
        if (active) setPausedOrganizationIds(new Set(ids));
      });
    };
    const unsubscribe = membershipConduit.subscribeToSyncPauses(reloadPaused);
    // Every refresh, including one a memberships hint triggers after a change
    // on another device, replaces the list shown here.
    const unsubscribeMemberships = membershipConduit.subscribeToMemberships(
      (list) => {
        if (active) setMemberships(byOrganizationId(list));
      },
    );
    reloadPaused();
    setMemberships(null);
    void membershipConduit.refresh();
    return () => {
      active = false;
      unsubscribe();
      unsubscribeMemberships();
    };
  }, [scopeKey, tearleads]);

  return { memberships, pausedOrganizationIds, setMemberships, tearleads };
}

/**
 * The user's own choices for each organization: the paused set read from this
 * device (so it works offline), the memberships the server reports, and the
 * pause/resume and leave-request actions. One change runs at a time.
 */
export function useOrganizationSyncChoices(): OrganizationSyncChoices {
  const { memberships, pausedOrganizationIds, setMemberships, tearleads } =
    useMembershipState();
  const [changingOrganizationId, setChangingOrganizationId] = useState<
    string | null
  >(null);
  const [error, setError] = useState<string | null>(null);

  const runChange = useCallback(
    async (organizationId: string, change: () => Promise<string | null>) => {
      setChangingOrganizationId(organizationId);
      setError(null);
      try {
        setError(await change());
      } catch {
        setError(ORGANIZATIONS_LABELS.syncChangeFailed);
      } finally {
        setChangingOrganizationId(null);
      }
    },
    [],
  );

  const setSyncPaused = useCallback(
    (organizationId: string, paused: boolean) =>
      runChange(organizationId, async () =>
        pauseErrorMessage(
          await tearleads.organizations.memberships.setSyncPaused(
            organizationId,
            paused,
          ),
        ),
      ),
    [runChange, tearleads],
  );

  const setLeaveRequested = useCallback(
    (organizationId: string, requested: boolean) =>
      runChange(organizationId, async () => {
        const result =
          await tearleads.organizations.memberships.setLeaveRequested(
            organizationId,
            requested,
          );
        if (result.status === "updated") {
          setMemberships((current) =>
            new Map(current).set(organizationId, result.membership),
          );
        }
        return leaveErrorMessage(result);
      }),
    [runChange, setMemberships, tearleads],
  );

  const personalOrganizationIds = useMemo(
    () =>
      new Set(
        [...(memberships?.values() ?? [])].flatMap((membership) =>
          membership.isPersonalOrganizationOwner
            ? [membership.organizationId]
            : [],
        ),
      ),
    [memberships],
  );

  return {
    changingOrganizationId,
    error,
    memberships,
    pausedOrganizationIds,
    personalOrganizationIds,
    setLeaveRequested,
    setSyncPaused,
  };
}
