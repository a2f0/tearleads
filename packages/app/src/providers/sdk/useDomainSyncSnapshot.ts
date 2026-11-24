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
 * Whether the scope's structural sync, which lists the container tree and
 * pulls each container's details, is still working: a structural lane is
 * running or requested and its last run did not fail (a run the watchdog
 * abandons records a failure too). A failing lane re-arms on a timer for the
 * rest of the session, so counting it would keep the tree from ever looking
 * settled; it counts again once a run completes. That includes the retry
 * after a single transient failure, which reads as settled until it
 * succeeds. Document lanes are left out: they bring content, not containers,
 * and they wait behind a structural lane that is backing off.
 */
export function hasActiveStructuralSync(snapshot: DomainSyncSnapshot): boolean {
  return snapshot.lanes.some(
    (lane) =>
      lane.phase === "structural" &&
      (lane.running || lane.requested) &&
      lane.lastError === null,
  );
}

/**
 * {@link hasActiveStructuralSync} for the scope's coordinator. A view that
 * only needs that re-renders when it flips, not on every lane's progress.
 */
export function useDomainStructuralSyncActive(
  domainScope: DomainScope,
): boolean {
  const subscribe = useDomainSyncSubscription(domainScope);
  const getActive = useCallback(
    () =>
      hasActiveStructuralSync(getDomainSyncCoordinatorSnapshot(domainScope)),
    [domainScope],
  );

  return useTearleadsExternalValue(subscribe, getActive);
}
