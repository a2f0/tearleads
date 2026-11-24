import type { DomainScope, DomainSyncSnapshot } from "@tearleads/client-sdk";
import {
  getDomainSyncCoordinatorSnapshot,
  subscribeToDomainSyncCoordinator,
} from "@tearleads/client-sdk";
import { useCallback } from "react";
import { useTearleadsExternalValue } from "./useTearleadsSubscription";

/**
 * Subscribes to the scope's sync coordinator. Lanes can register while a
 * provider renders (the SDK builds its runtimes in render-time memos), so a
 * snapshot can publish in the middle of another component's render. Telling
 * React then would update that view during the render, so the change is
 * handed over in a microtask, once per burst, and React reads the latest
 * snapshot.
 */
function useDomainSyncSubscription(
  domainScope: DomainScope,
): (listener: () => void) => () => void {
  return useCallback(
    (listener: () => void) => {
      let subscribed = true;
      let scheduled = false;
      const unsubscribe = subscribeToDomainSyncCoordinator(domainScope, () => {
        if (scheduled) return;
        scheduled = true;
        queueMicrotask(() => {
          scheduled = false;
          if (subscribed) listener();
        });
      });
      return () => {
        subscribed = false;
        unsubscribe();
      };
    },
    [domainScope],
  );
}

/** The scope's sync coordinator snapshot, on every lane change. */
export function useDomainSyncSnapshot(
  domainScope: DomainScope,
): DomainSyncSnapshot {
  const subscribe = useDomainSyncSubscription(domainScope);
  const getSnapshot = useCallback(
    () => getDomainSyncCoordinatorSnapshot(domainScope),
    [domainScope],
  );

  return useTearleadsExternalValue(subscribe, getSnapshot);
}

/**
 * Whether sync is doing work that can still bring content in: some lane is
 * running or requested and is not failing, abandoned, or an upload. A failing
 * lane re-arms on a timer for the rest of the session, so counting it would
 * keep the work from ever looking settled; uploads bring nothing in.
 */
export function hasActiveSyncWork(snapshot: DomainSyncSnapshot): boolean {
  return snapshot.lanes.some(
    (lane) =>
      (lane.running || lane.requested) &&
      lane.lastError === null &&
      !lane.runAbandoned &&
      lane.phase !== "blob",
  );
}

/**
 * {@link hasActiveSyncWork} for the scope's coordinator. A view that only
 * needs that re-renders when it flips, not on every lane's progress.
 */
export function useDomainSyncActiveWork(domainScope: DomainScope): boolean {
  const subscribe = useDomainSyncSubscription(domainScope);
  const getActiveWork = useCallback(
    () => hasActiveSyncWork(getDomainSyncCoordinatorSnapshot(domainScope)),
    [domainScope],
  );

  return useTearleadsExternalValue(subscribe, getActiveWork);
}
