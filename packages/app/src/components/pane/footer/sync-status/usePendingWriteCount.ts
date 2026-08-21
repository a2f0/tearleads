import type {
  ContainerDocumentQueries,
  DomainScope,
} from "@symcrypt/client-sdk";
import {
  subscribeToDomainSyncCoordinator,
  subscribeToPersistedDocuments,
} from "@symcrypt/client-sdk";
import { useEffect, useState } from "react";
import { createPendingWriteWatcher } from "./pendingWriteWatcher";
import {
  type PendingWriteQueueSummary,
  summarizePendingWrites,
} from "./syncStatusModel";

// `listPendingWrites()` is an identity-wide scan (multiple tables plus deferred
// Loro tails), and this indicator is always mounted (two panes in the windowed
// layout), so change notifications are throttled to at most one scan per window.
const READ_THROTTLE_MS = 750;

interface PendingWriteCount extends PendingWriteQueueSummary {
  /** False until the first successful read resolves (or while the db is booting). */
  readonly loaded: boolean;
}

const EMPTY_PENDING_WRITE_COUNT: PendingWriteCount = {
  loaded: false,
  count: 0,
  failedCount: 0,
  firstError: null,
};

/**
 * Track the durable write-queue size for the active domain (see
 * `createPendingWriteWatcher` for the read state machine). It subscribes to two
 * signals: the sync coordinator (lane requests, completions, settles) and
 * document persistence. The latter is essential — deferred writes (e.g.
 * `deferRemoteSync` during system bootstrap) enqueue durable work *without*
 * requesting a lane, so the coordinator alone would never re-trigger and the
 * indicator could stay green while the Explorer Write Queue holds items.
 */
export function usePendingWriteCount(
  documentQueries: ContainerDocumentQueries,
  domainScope: DomainScope,
  dbReady: boolean,
): PendingWriteCount {
  const [state, setState] = useState<PendingWriteCount>(
    EMPTY_PENDING_WRITE_COUNT,
  );

  useEffect(() => {
    if (!dbReady) {
      // Idempotent reset: return the same state when already cleared so a
      // re-render with unchanged not-ready inputs cannot loop.
      setState((prev) =>
        prev.loaded || prev.count !== 0 || prev.failedCount !== 0
          ? EMPTY_PENDING_WRITE_COUNT
          : prev,
      );
      return;
    }
    const watcher = createPendingWriteWatcher({
      listPendingWrites: () => documentQueries.listPendingWrites(),
      subscribe: (onChange) => {
        const unsubscribeCoordinator = subscribeToDomainSyncCoordinator(
          domainScope,
          onChange,
        );
        const unsubscribeDocuments = subscribeToPersistedDocuments(
          domainScope,
          onChange,
        );
        return () => {
          unsubscribeCoordinator();
          unsubscribeDocuments();
        };
      },
      onSnapshot: (items) =>
        setState({ loaded: true, ...summarizePendingWrites(items) }),
      throttleMs: READ_THROTTLE_MS,
    });
    return () => watcher.stop();
  }, [dbReady, documentQueries, domainScope]);

  return state;
}
