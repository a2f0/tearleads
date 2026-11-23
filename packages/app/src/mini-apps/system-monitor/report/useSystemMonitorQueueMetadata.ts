import type {
  DomainSyncSnapshot,
  PendingWriteQueueItem,
} from "@tearleads/client-sdk";
import { useMemo } from "react";
import { useTearleadsRuntime } from "../../../providers/sdk/TearleadsProvider";
import { useDomainDocumentQueries } from "../../../providers/sdk/useDomainDocumentQueries";
import { useDomainSyncSnapshot } from "../../../providers/sdk/useDomainSyncSnapshot";
import type { QueueReadState } from "../../../stores/sync-queues/queueReadMachine";
import { getOrCreatePendingWriteQueueStore } from "../../../stores/sync-queues/syncQueueStores";
import { useQueueRead } from "../../../stores/sync-queues/useQueueRead";
import type { SystemMonitorWriteQueueReport } from "./systemMonitorReport";

interface SystemMonitorQueueMetadata {
  readonly writeQueue: SystemMonitorWriteQueueReport;
  readonly syncLanes: DomainSyncSnapshot | null;
}

const UNAVAILABLE_WRITE_QUEUE: SystemMonitorWriteQueueReport = {
  status: "unavailable",
};

// The error text stays out of the report (see its redaction policy); the
// Sync Status tray app and the Explorer Write Queue show it.
const FAILED_WRITE_QUEUE: SystemMonitorWriteQueueReport = { status: "failed" };

export function selectSystemMonitorWriteQueue(input: {
  readonly dbReady: boolean;
  readonly state: QueueReadState<PendingWriteQueueItem>;
}): SystemMonitorWriteQueueReport {
  if (!input.dbReady) return UNAVAILABLE_WRITE_QUEUE;
  switch (input.state.status) {
    case "loading":
      return UNAVAILABLE_WRITE_QUEUE;
    case "failed":
      return FAILED_WRITE_QUEUE;
    case "ready":
      return { status: "available", items: input.state.items };
  }
}

/**
 * Gathers the durable write queue and the active domain scope's sync-lane
 * telemetry for the System Monitor report.
 *
 * Both come from the sources the Explorer sync panels and the Sync Status tray
 * app read — the scope's shared write-queue store and the domain sync
 * coordinator snapshot — so the monitor agrees with them. The queue is kept
 * current while the monitor is open rather than fetched on click, because the
 * copy button resolves its value synchronously; the report therefore captures
 * the latest observed state. The store belongs to the active domain scope, so
 * a scope switch never shows the previous scope's queue.
 *
 * Only the active domain scope has a live sync coordinator (switching orgs
 * rotates the single scope), so the lanes cover the active scope while the
 * queue spans every organization in the database (see `organizationId`).
 */
export function useSystemMonitorQueueMetadata(): SystemMonitorQueueMetadata {
  const runtime = useTearleadsRuntime();
  const domainScope = runtime.state.domainScope;
  const dbReady = runtime.infra.dbStatus === "ready";
  const documentQueries = useDomainDocumentQueries(runtime);
  const state = useQueueRead(
    getOrCreatePendingWriteQueueStore(domainScope),
    dbReady ? documentQueries : null,
  );
  const writeQueue = useMemo(
    () => selectSystemMonitorWriteQueue({ dbReady, state }),
    [dbReady, state],
  );
  const syncSnapshot = useDomainSyncSnapshot(domainScope);

  // An inactive scope yields an empty coordinator snapshot; report it as
  // unavailable until the database is ready rather than as a live-but-empty
  // coordinator.
  const syncLanes = dbReady ? syncSnapshot : null;

  return { writeQueue, syncLanes };
}
