import type {
  OrganizationMembership,
  OrganizationSyncPauseResult,
} from "@tearleads/client-sdk";
import { useCallback, useEffect, useState } from "react";
import {
  useTearleads,
  useTearleadsRuntime,
} from "../../../providers/sdk/TearleadsProvider";
import { ORGANIZATIONS_LABELS } from "../labels";

const EMPTY_IDS: ReadonlySet<string> = new Set();

export interface OrganizationSyncChoices {
  readonly changingOrganizationId: string | null;
  readonly error: string | null;
  readonly pausedOrganizationIds: ReadonlySet<string>;
  readonly personalOrganizationIds: ReadonlySet<string>;
  setSyncPaused(organizationId: string, paused: boolean): Promise<void>;
}

function personalIds(
  memberships: readonly OrganizationMembership[],
): ReadonlySet<string> {
  return new Set(
    memberships.flatMap((membership) =>
      membership.isPersonalOrganizationOwner ? [membership.organizationId] : [],
    ),
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

/**
 * The user's own sync choices for each organization: the paused set read from
 * this device (so it works offline), the personal organizations the server
 * reports, and the pause/resume action.
 */
export function useOrganizationSyncChoices(): OrganizationSyncChoices {
  const tearleads = useTearleads();
  const scopeKey = useTearleadsRuntime().state.domainScope;
  const [pausedOrganizationIds, setPausedOrganizationIds] =
    useState<ReadonlySet<string>>(EMPTY_IDS);
  const [personalOrganizationIds, setPersonalOrganizationIds] =
    useState<ReadonlySet<string>>(EMPTY_IDS);
  const [changingOrganizationId, setChangingOrganizationId] = useState<
    string | null
  >(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    const memberships = tearleads.organizations.memberships;
    const reloadPaused = () => {
      void memberships.loadPausedOrganizationIds().then((ids) => {
        if (active) setPausedOrganizationIds(new Set(ids));
      });
    };
    const unsubscribe = memberships.subscribeToSyncPauses(reloadPaused);
    reloadPaused();
    void memberships.refresh().then((list) => {
      if (active && list) setPersonalOrganizationIds(personalIds(list));
    });
    return () => {
      active = false;
      unsubscribe();
    };
  }, [scopeKey, tearleads]);

  const setSyncPaused = useCallback(
    async (organizationId: string, paused: boolean) => {
      setChangingOrganizationId(organizationId);
      setError(null);
      try {
        const result = await tearleads.organizations.memberships.setSyncPaused(
          organizationId,
          paused,
        );
        setError(pauseErrorMessage(result));
      } catch {
        setError(ORGANIZATIONS_LABELS.syncChangeFailed);
      } finally {
        setChangingOrganizationId(null);
      }
    },
    [tearleads],
  );

  return {
    changingOrganizationId,
    error,
    pausedOrganizationIds,
    personalOrganizationIds,
    setSyncPaused,
  };
}
