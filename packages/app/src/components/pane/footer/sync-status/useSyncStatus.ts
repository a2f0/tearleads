import { useMemo } from "react";
import { useOrganizationBilling } from "../../../../providers/billing/BillingProvider";
import {
  useTearleads,
  useTearleadsRuntime,
} from "../../../../providers/sdk/TearleadsProvider";
import {
  describeSyncStatus,
  resolveSyncStatus,
  type SyncStatus,
} from "./syncStatusModel";
import { usePendingWriteCount } from "./usePendingWriteCount";

interface SyncStatusResult {
  readonly status: SyncStatus;
  readonly title: string;
  /** Aggregate unflushed write-operation count; drives the "view queue" link. */
  readonly pendingWriteCount: number;
}

/**
 * The footer sync indicator's data source. It reads the same durable write queue
 * the Explorer "Write Queue" panel does — `containerContents.documentQueries()
 * .listPendingWrites()` (see `usePendingWriteCount`) — treating a non-empty queue
 * as unflushed local data, and takes billing from the shared
 * `useOrganizationBilling` snapshot, so the widget agrees with the Explorer and
 * the billing banner about whether the org can sync.
 */
export function useSyncStatus(): SyncStatusResult {
  const appData = useTearleadsRuntime();
  const billing = useOrganizationBilling();
  const { containerContents } = useTearleads();
  const domainScope = appData.state.domainScope;
  const dbStatus = appData.infra.dbStatus;
  const dbReady = dbStatus === "ready";
  const online = appData.state.online;

  const documentQueries = useMemo(
    () => containerContents.documentQueries(),
    // Rebind when the underlying scope/db changes, matching the Explorer's
    // `useExplorerDocumentQueries` so the query reads the active domain.
    [containerContents, dbStatus, domainScope],
  );

  const queue = usePendingWriteCount(documentQueries, domainScope, dbReady);

  const billingNeedsAttention = billing.view?.needsAttention ?? false;
  const status = resolveSyncStatus({
    billingNeedsAttention,
    ready: dbReady && queue.loaded,
    pendingWriteCount: queue.count,
  });
  const title = describeSyncStatus({
    status,
    pendingWriteCount: queue.count,
    online,
    billingStatus: billing.view?.status ?? null,
  });

  return { status, title, pendingWriteCount: queue.count };
}
