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

const DATA_USAGE_SYNC_SETTLE_QUIET_MS = 25;

export async function refreshDataUsageOnEntry(input: {
  readonly cancelled: () => boolean;
  readonly readPending: () => boolean;
  readonly refreshDataUsage: DataUsageRefreshInput["refreshDataUsage"];
}): Promise<void> {
  await input.refreshDataUsage({
    clearError: false,
    localOnly: true,
    manageLoading: false,
  });
  if (input.cancelled() || input.readPending()) {
    return;
  }
  await input.refreshDataUsage({ clearError: true, manageLoading: false });
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

/** Paints local usage on entry, then reconciles after entry or sync settles. */
export function useOrgManagerDataUsageRefresh({
  enabled,
  refreshDataUsage,
  visible,
}: DataUsageRefreshInput): void {
  const tearleads = useTearleads();
  const domainScope = tearleads.domainScope;
  const previouslyPendingRef = useRef(false);

  useEffect(() => {
    if (!enabled || !visible) {
      return;
    }
    let cancelled = false;
    void refreshDataUsageOnEntry({
      cancelled: () => cancelled,
      readPending: () =>
        getDomainSyncCoordinatorSnapshot(domainScope).hasPendingWork,
      refreshDataUsage,
    });
    return () => {
      cancelled = true;
    };
  }, [domainScope, enabled, refreshDataUsage, visible]);

  useEffect(() => {
    if (!enabled || !visible) {
      previouslyPendingRef.current = false;
      return;
    }

    let cancelled = false;
    let settleTimeout: ReturnType<typeof setTimeout> | null = null;
    const cancelSettle = () => {
      if (settleTimeout !== null) {
        clearTimeout(settleTimeout);
        settleTimeout = null;
      }
    };
    const readPendingState = () => {
      const pending =
        getDomainSyncCoordinatorSnapshot(domainScope).hasPendingWork;
      const previouslyPending = previouslyPendingRef.current;
      previouslyPendingRef.current = pending;
      if (pending) {
        cancelSettle();
        return;
      }
      if (
        shouldRefreshDataUsageAfterSync({
          enabled,
          pending,
          previouslyPending,
          visible,
        })
      ) {
        cancelSettle();
        settleTimeout = setTimeout(() => {
          settleTimeout = null;
          if (
            !cancelled &&
            !getDomainSyncCoordinatorSnapshot(domainScope).hasPendingWork
          ) {
            void refreshDataUsage({ clearError: true, manageLoading: false });
          }
        }, DATA_USAGE_SYNC_SETTLE_QUIET_MS);
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
      cancelSettle();
      unsubscribe();
    };
  }, [domainScope, enabled, refreshDataUsage, visible]);
}
