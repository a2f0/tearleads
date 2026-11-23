import type { DomainScope, DomainSyncSnapshot } from "@tearleads/client-sdk";
import {
  getDomainSyncCoordinatorSnapshot,
  subscribeToDomainSyncCoordinator,
} from "@tearleads/client-sdk";
import { useCallback } from "react";
import { useTearleadsExternalValue } from "./useTearleadsSubscription";

/**
 * The scope's sync coordinator snapshot. Lanes can register while a provider
 * renders (the SDK builds its runtimes in render-time memos), so a snapshot can
 * publish in the middle of another component's render. Telling React then
 * would update this view during that render, so the change is handed over in
 * a microtask, once per burst, and React reads the latest snapshot.
 */
export function useDomainSyncSnapshot(
  domainScope: DomainScope,
): DomainSyncSnapshot {
  const subscribe = useCallback(
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
  const getSnapshot = useCallback(
    () => getDomainSyncCoordinatorSnapshot(domainScope),
    [domainScope],
  );

  return useTearleadsExternalValue(subscribe, getSnapshot);
}
