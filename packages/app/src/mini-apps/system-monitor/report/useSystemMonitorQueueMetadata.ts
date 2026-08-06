import type { DomainScope, DomainSyncSnapshot } from "@tearleads/client-sdk";
import {
  getDomainSyncCoordinatorSnapshot,
  subscribeToDomainSyncCoordinator,
  subscribeToPersistedDocuments,
} from "@tearleads/client-sdk";
import { useCallback, useEffect, useMemo, useState } from "react";
import { createPendingWriteWatcher } from "../../../components/pane/footer/sync-status/pendingWriteWatcher";
import {
  useTearleads,
  useTearleadsRuntime,
} from "../../../providers/sdk/TearleadsProvider";
import { useTearleadsExternalValue } from "../../../providers/sdk/useTearleadsSubscription";
import type { SystemMonitorWriteQueueReport } from "./systemMonitorReport";

// `listPendingWrites()` is an identity-wide scan, so re-reads are throttled: a
// burst of sync activity collapses into one scan per window. Matches the footer
// indicator's cadence (`usePendingWriteCount`).
const WRITE_QUEUE_READ_THROTTLE_MS = 750;

interface SystemMonitorQueueMetadata {
  readonly writeQueue: SystemMonitorWriteQueueReport;
  readonly syncLanes: DomainSyncSnapshot | null;
}

const UNAVAILABLE_WRITE_QUEUE: SystemMonitorWriteQueueReport = {
  available: false,
  items: [],
};

interface ScopedWriteQueueReport {
  readonly domainScope: DomainScope | null;
  readonly report: SystemMonitorWriteQueueReport;
}

export function selectSystemMonitorWriteQueue(input: {
  readonly dbReady: boolean;
  readonly domainScope: DomainScope;
  readonly observed: ScopedWriteQueueReport;
}): SystemMonitorWriteQueueReport {
  return input.dbReady && input.observed.domainScope === input.domainScope
    ? input.observed.report
    : UNAVAILABLE_WRITE_QUEUE;
}

/**
 * Gathers the durable write queue and the active domain scope's sync-lane
 * telemetry for the System Monitor report.
 *
 * Both are read the same way the Explorer sync panels and the footer indicator
 * read them — `containerContents.documentQueries().listPendingWrites()` for the
 * identity-wide queue and the domain sync coordinator snapshot for the lanes —
 * so the monitor agrees with them. The queue is kept in state via a throttled
 * subscription rather than fetched on click, because the copy button resolves
 * its value synchronously; the report therefore captures the latest observed
 * state.
 *
 * Only the active domain scope has a live sync coordinator (switching orgs
 * rotates the single scope), so the lanes cover the active scope while the
 * queue spans every organization in the database (see `organizationId`).
 */
export function useSystemMonitorQueueMetadata(): SystemMonitorQueueMetadata {
  const runtime = useTearleadsRuntime();
  const { containerContents } = useTearleads();
  const domainScope = runtime.state.domainScope;
  const dbStatus = runtime.infra.dbStatus;
  const dbReady = dbStatus === "ready";

  const documentQueries = useMemo(
    () => containerContents.documentQueries(),
    // Rebind when the underlying scope/db changes, matching the Explorer's
    // `useExplorerDocumentQueries` so the query reads the active domain.
    [containerContents, dbStatus, domainScope],
  );

  const [observedWriteQueue, setObservedWriteQueue] =
    useState<ScopedWriteQueueReport>({
      domainScope: null,
      report: UNAVAILABLE_WRITE_QUEUE,
    });

  useEffect(() => {
    if (!dbReady) {
      // Idempotent reset: keep the same object when already unavailable so a
      // re-render with unchanged not-ready inputs cannot loop.
      setObservedWriteQueue((prev) =>
        prev.domainScope !== null ||
        prev.report.available ||
        prev.report.items.length > 0
          ? { domainScope: null, report: UNAVAILABLE_WRITE_QUEUE }
          : prev,
      );
      return;
    }
    const watcher = createPendingWriteWatcher({
      listPendingWrites: () => documentQueries.listPendingWrites(),
      // Subscribe to both signals the queue depends on: the sync coordinator
      // (lane requests, completions, failures) and document persistence —
      // deferred writes enqueue durable work without requesting a lane, so the
      // coordinator alone would miss them.
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
        setObservedWriteQueue({
          domainScope,
          report: { available: true, items },
        }),
      throttleMs: WRITE_QUEUE_READ_THROTTLE_MS,
    });
    return () => watcher.stop();
  }, [dbReady, documentQueries, domainScope]);

  const subscribeSync = useCallback(
    (listener: () => void) =>
      subscribeToDomainSyncCoordinator(domainScope, listener),
    [domainScope],
  );
  const getSyncSnapshot = useCallback(
    () => getDomainSyncCoordinatorSnapshot(domainScope),
    [domainScope],
  );
  const syncSnapshot = useTearleadsExternalValue(
    subscribeSync,
    getSyncSnapshot,
  );

  // An inactive scope yields an empty coordinator snapshot; report it as
  // unavailable until the database is ready rather than as a live-but-empty
  // coordinator.
  const syncLanes = dbReady ? syncSnapshot : null;
  const writeQueue = selectSystemMonitorWriteQueue({
    dbReady,
    domainScope,
    observed: observedWriteQueue,
  });

  return { writeQueue, syncLanes };
}
