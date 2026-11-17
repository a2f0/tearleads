import { useEffect, useState } from "react";
import { useTearleads, useTearleadsRuntime } from "./TearleadsProvider";

const EMPTY_IDS: ReadonlySet<string> = new Set();

/**
 * The organizations whose sync is paused on this device. Read from local
 * storage, so it works offline, and kept current as pauses change.
 */
export function usePausedOrganizationIds(): ReadonlySet<string> {
  const tearleads = useTearleads();
  const scopeKey = useTearleadsRuntime().state.domainScope;
  const [pausedOrganizationIds, setPausedOrganizationIds] =
    useState<ReadonlySet<string>>(EMPTY_IDS);

  useEffect(() => {
    let active = true;
    const membershipConduit = tearleads.organizations.memberships;
    const reload = () => {
      void membershipConduit.loadPausedOrganizationIds().then(
        (ids) => {
          if (active) setPausedOrganizationIds(new Set(ids));
        },
        // A read that fails, such as while the database closes, keeps the
        // last set; the next change to the pauses reads it again.
        () => undefined,
      );
    };
    const unsubscribe = membershipConduit.subscribeToSyncPauses(reload);
    reload();
    return () => {
      active = false;
      unsubscribe();
    };
  }, [scopeKey, tearleads]);

  return pausedOrganizationIds;
}
