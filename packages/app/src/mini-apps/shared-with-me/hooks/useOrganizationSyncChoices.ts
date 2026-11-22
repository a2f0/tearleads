import type {
  OrganizationLeaveRequestResult,
  OrganizationMembership,
  OrganizationSyncPauseResult,
} from "@tearleads/client-sdk";
import { useCallback, useEffect, useRef, useState } from "react";
import {
  useTearleads,
  useTearleadsRuntime,
} from "../../../providers/sdk/TearleadsProvider";
import { usePausedOrganizationIds } from "../../../providers/sdk/usePausedOrganizationIds";
import { SHARED_WITH_ME_LABELS } from "../labels";

export interface OrganizationSyncChoices {
  readonly changingOrganizationId: string | null;
  readonly error: string | null;
  /** The user's memberships as the server last reported them, or null. */
  readonly memberships: ReadonlyMap<string, OrganizationMembership> | null;
  /** The organizations whose sync is paused on this device. */
  readonly pausedOrganizationIds: ReadonlySet<string>;
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
  return result.status === "updated"
    ? null
    : result.message || SHARED_WITH_ME_LABELS.syncChangeFailed;
}

function leaveErrorMessage(
  result: OrganizationLeaveRequestResult,
): string | null {
  return result.status === "updated"
    ? null
    : result.message || SHARED_WITH_ME_LABELS.leaveRequestFailed;
}

/** The paused set on this device and the memberships the server reports. */
function useMembershipState() {
  const tearleads = useTearleads();
  const scopeKey = useTearleadsRuntime().state.domainScope;
  const pausedOrganizationIds = usePausedOrganizationIds();
  const [memberships, setMemberships] = useState<ReadonlyMap<
    string,
    OrganizationMembership
  > | null>(null);

  useEffect(() => {
    let active = true;
    const membershipConduit = tearleads.organizations.memberships;
    // Every refresh, including one a memberships hint triggers after a change
    // on another device, replaces the list shown here.
    const unsubscribeMemberships = membershipConduit.subscribeToMemberships(
      (list) => {
        if (active) setMemberships(byOrganizationId(list));
      },
    );
    setMemberships(null);
    void membershipConduit.refresh();
    return () => {
      active = false;
      unsubscribeMemberships();
    };
  }, [scopeKey, tearleads]);

  return {
    memberships,
    pausedOrganizationIds,
    scopeKey,
    setMemberships,
    tearleads,
  };
}

/**
 * Runs one membership change at a time. A change that settles after the
 * session switched identities belongs to the old identity and must not touch
 * what this one shows.
 */
function useScopedChange(scopeKey: unknown) {
  const [changingOrganizationId, setChangingOrganizationId] = useState<
    string | null
  >(null);
  const [error, setError] = useState<string | null>(null);
  const scopeRef = useRef(scopeKey);
  useEffect(() => {
    scopeRef.current = scopeKey;
    setChangingOrganizationId(null);
    setError(null);
  }, [scopeKey]);

  const runChange = useCallback(
    async (
      organizationId: string,
      change: (isCurrent: () => boolean) => Promise<string | null>,
    ) => {
      const startedIn = scopeRef.current;
      const isCurrent = () => scopeRef.current === startedIn;
      setChangingOrganizationId(organizationId);
      setError(null);
      let message: string | null;
      try {
        message = await change(isCurrent);
      } catch {
        message = SHARED_WITH_ME_LABELS.syncChangeFailed;
      }
      if (!isCurrent()) return;
      setError(message);
      setChangingOrganizationId(null);
    },
    [],
  );

  return { changingOrganizationId, error, runChange };
}

/**
 * The user's own choices for each organization: the paused set read from this
 * device (so it works offline), the memberships the server reports, and the
 * pause/resume and leave-request actions. One change runs at a time.
 */
export function useOrganizationSyncChoices(): OrganizationSyncChoices {
  const {
    memberships,
    pausedOrganizationIds,
    scopeKey,
    setMemberships,
    tearleads,
  } = useMembershipState();
  const { changingOrganizationId, error, runChange } =
    useScopedChange(scopeKey);

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
      runChange(organizationId, async (isCurrent) => {
        const result =
          await tearleads.organizations.memberships.setLeaveRequested(
            organizationId,
            requested,
          );
        if (result.status === "updated" && isCurrent()) {
          setMemberships((current) =>
            new Map(current).set(organizationId, result.membership),
          );
        }
        return leaveErrorMessage(result);
      }),
    [runChange, setMemberships, tearleads],
  );

  return {
    changingOrganizationId,
    error,
    memberships,
    pausedOrganizationIds,
    setLeaveRequested,
    setSyncPaused,
  };
}
