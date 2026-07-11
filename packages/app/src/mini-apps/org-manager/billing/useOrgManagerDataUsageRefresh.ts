import {
  getDomainSyncCoordinatorSnapshot,
  subscribeToDomainSyncCoordinator,
} from "@tearleads/client-sdk";
import { useEffect, useRef } from "react";
import { useTearleads } from "../../../providers/sdk/TearleadsProvider";
import type { DataUsageRefreshOptions } from "../refresh";

interface DataUsageRefreshInput {
  readonly enabled: boolean;
  readonly refreshDataUsage: (
    options?: DataUsageRefreshOptions,
  ) => Promise<void>;
  readonly visible: boolean;
}

export function shouldRefreshDataUsageAfterSync(input: {
  readonly enabled: boolean;
  readonly pending: boolean;
  readonly previouslyPending: boolean;
  readonly visible: boolean;
}): boolean {
  return (
    input.enabled && input.visible && input.previouslyPending && !input.pending
  );
}

/** Refreshes server usage when its view opens or queued local writes settle. */
export function useOrgManagerDataUsageRefresh({
  enabled,
  refreshDataUsage,
  visible,
}: DataUsageRefreshInput): void {
  const tearleads = useTearleads();
  const domainScope = tearleads.domainScope;
  const previouslyPendingRef = useRef(false);

  useEffect(() => {
    if (enabled && visible) {
      void refreshDataUsage({ clearError: true, manageLoading: false });
    }
  }, [enabled, refreshDataUsage, visible]);

  useEffect(() => {
    if (!enabled || !visible) {
      previouslyPendingRef.current = false;
      return;
    }

    let cancelled = false;
    const readPendingState = () => {
      const pending =
        getDomainSyncCoordinatorSnapshot(domainScope).hasPendingWork;
      const previouslyPending = previouslyPendingRef.current;
      previouslyPendingRef.current = pending;
      if (
        shouldRefreshDataUsageAfterSync({
          enabled,
          pending,
          previouslyPending,
          visible,
        })
      ) {
        void refreshDataUsage({ clearError: true, manageLoading: false });
      }
    };
    readPendingState();
    const unsubscribe = subscribeToDomainSyncCoordinator(domainScope, () => {
      queueMicrotask(() => {
        if (!cancelled) {
          readPendingState();
        }
      });
    });
    return () => {
      cancelled = true;
      unsubscribe();
    };
  }, [domainScope, enabled, refreshDataUsage, visible]);
}
