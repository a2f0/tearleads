import type {
  ContainerDocumentQueries,
  DomainScope,
} from "@tearleads/client-sdk";
import { useMemo } from "react";
import { getOrCreatePendingWriteQueueStore } from "../../stores/sync-queues/syncQueueStores";
import { useQueueRead } from "../../stores/sync-queues/useQueueRead";
import {
  type PendingWriteQueueSummary,
  summarizePendingWrites,
} from "./syncStatusModel";

interface PendingWriteCount extends PendingWriteQueueSummary {
  /**
   * The latest settled read succeeded: false while the db is booting, before
   * the first read settles, and after a failed read.
   */
  readonly loaded: boolean;
  /**
   * Why the latest read failed, or null once a read succeeds. The counts keep
   * their last known values alongside it.
   */
  readonly readError: string | null;
}

const EMPTY_PENDING_WRITE_COUNT: PendingWriteCount = {
  loaded: false,
  count: 0,
  failedCount: 0,
  firstError: null,
  organizationIds: [],
  readError: null,
};

/**
 * Track the durable write-queue size for the active domain through the
 * scope's shared write-queue store, which the Explorer Write Queue panel and
 * the System Monitor report read too, so the indicator agrees with them and
 * adds no scan of its own. While the database is not ready the indicator
 * watches nothing and reports the loading state.
 */
export function usePendingWriteCount(
  documentQueries: ContainerDocumentQueries,
  domainScope: DomainScope,
  dbReady: boolean,
): PendingWriteCount {
  const state = useQueueRead(
    getOrCreatePendingWriteQueueStore(domainScope),
    dbReady ? documentQueries : null,
  );
  return useMemo(() => {
    if (!dbReady) return EMPTY_PENDING_WRITE_COUNT;
    switch (state.status) {
      case "loading":
        return EMPTY_PENDING_WRITE_COUNT;
      case "ready":
        return {
          loaded: true,
          readError: null,
          ...summarizePendingWrites(state.items),
        };
      case "failed":
        return {
          loaded: false,
          readError: state.message,
          ...summarizePendingWrites(state.items),
        };
    }
  }, [dbReady, state]);
}
