import {
  getDomainSyncCoordinatorSnapshot,
  subscribeToDomainSyncCoordinator,
} from "@tearleads/client-sdk";
import { useEffect } from "react";
import { useTearleads } from "../../../providers/sdk/TearleadsProvider";
import type { DataUsageRefreshOptions } from "../refresh";

interface DataUsageRefreshInput {
  readonly enabled: boolean;
  readonly refreshDataUsage: (
    options?: DataUsageRefreshOptions,
  ) => Promise<void>;
  readonly visible: boolean;
}

const DATA_USAGE_SYNC_SETTLE_QUIET_MS = 100;

type DataUsageQuietScheduler = (
  callback: () => void,
  delayMs: number,
) => () => void;

function scheduleDataUsageQuietWindow(
  callback: () => void,
  delayMs: number,
): () => void {
  const timeout = setTimeout(callback, delayMs);
  return () => clearTimeout(timeout);
}

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

export function createDataUsageSyncSettleController(input: {
  readonly onSettled: () => void;
  readonly readPending: () => boolean;
  readonly schedule?: DataUsageQuietScheduler;
}): {
  readonly dispose: () => void;
  readonly observe: (pending: boolean) => void;
} {
  const schedule = input.schedule ?? scheduleDataUsageQuietWindow;
  let cancelScheduled: (() => void) | null = null;
  let disposed = false;
  let previouslyPending = false;

  const cancelSettle = () => {
    cancelScheduled?.();
    cancelScheduled = null;
  };

  return {
    dispose: () => {
      disposed = true;
      cancelSettle();
    },
    observe: (pending) => {
      const shouldSettle = previouslyPending && !pending;
      previouslyPending = pending;
      if (pending) {
        cancelSettle();
        return;
      }
      if (!shouldSettle) {
        return;
      }
      cancelSettle();
      cancelScheduled = schedule(() => {
        cancelScheduled = null;
        if (!disposed && !input.readPending()) {
          input.onSettled();
        }
      }, DATA_USAGE_SYNC_SETTLE_QUIET_MS);
    },
  };
}

/** Paints local usage on entry, then reconciles after entry or sync settles. */
export function useOrgManagerDataUsageRefreshEffect({
  enabled,
  refreshDataUsage,
  visible,
}: DataUsageRefreshInput): void {
  const tearleads = useTearleads();
  const domainScope = tearleads.domainScope;

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
      return;
    }

    let cancelled = false;
    const settleController = createDataUsageSyncSettleController({
      onSettled: () => {
        void refreshDataUsage({ clearError: true, manageLoading: false });
      },
      readPending: () =>
        getDomainSyncCoordinatorSnapshot(domainScope).hasPendingWork,
    });
    const readPendingState = () => {
      const pending =
        getDomainSyncCoordinatorSnapshot(domainScope).hasPendingWork;
      settleController.observe(pending);
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
      settleController.dispose();
      unsubscribe();
    };
  }, [domainScope, enabled, refreshDataUsage, visible]);
}
