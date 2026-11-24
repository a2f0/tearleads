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
 * Whether the scope's sync has work requested or running. A view that only
 * needs to know that re-renders when it flips, not on every lane's progress.
 */
export function useDomainSyncPendingWork(domainScope: DomainScope): boolean {
  const subscribe = useDomainSyncSubscription(domainScope);
  const getPendingWork = useCallback(
    () => getDomainSyncCoordinatorSnapshot(domainScope).hasPendingWork,
    [domainScope],
  );

  return useTearleadsExternalValue(subscribe, getPendingWork);
}
