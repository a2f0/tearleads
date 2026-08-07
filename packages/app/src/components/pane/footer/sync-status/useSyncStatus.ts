import { useCallback, useMemo } from "react";
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
import { useOtherOrganizationBillingBlocked } from "./useOtherOrganizationBillingBlock";
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
 * the billing banner about whether the org can sync. That snapshot is scoped to
 * the active organization while the queue is identity-wide, so the sync billing
 * gate covers the rest (see `useOtherOrganizationBillingBlocked`): an
 * organization whose billing lapsed raises the warning even when it is not the
 * one currently switched to.
 */
export function useSyncStatus(): SyncStatusResult {
  const appData = useTearleadsRuntime();
  const billing = useOrganizationBilling();
  const { containerContents, organizations, syncBillingGate } = useTearleads();
  const domainScope = appData.state.domainScope;
  const dbStatus = appData.infra.dbStatus;
  const dbReady = dbStatus === "ready";
  const online = appData.state.online;

  const documentQueries = useMemo(
    () => containerContents.documentQueries(),
    // Keep this query handle stable across server events: rebuilding its
    // watcher performs an immediate identity-wide scan outside the throttle.
    // Match useExplorerDocumentQueries, which protects orphan visibility too.
    [containerContents, dbStatus, domainScope],
  );

  const queue = usePendingWriteCount(documentQueries, domainScope, dbReady);

  const loadBlockedOrganizationBilling = useCallback(
    (organizationId: string) =>
      organizations.loadBillingForOrganization(organizationId),
    [organizations],
  );
  const billingNeedsAttention = billing.view?.needsAttention ?? false;
  const otherOrganizationBillingBlocked = useOtherOrganizationBillingBlocked({
    activeOrganizationId: appData.auth.organizationId,
    gate: syncBillingGate,
    // The gate outlives a logout, so its blocks are scoped to the session that
    // earned them rather than leaking into the next identity.
    identityKey: appData.auth.isAuthenticated ? appData.auth.userId : null,
    loadBilling: loadBlockedOrganizationBilling,
  });
  const status = resolveSyncStatus({
    billingNeedsAttention,
    otherOrganizationBillingBlocked,
    ready: dbReady && queue.loaded,
    pendingWriteCount: queue.count,
    failedWriteCount: queue.failedCount,
  });
  const title = describeSyncStatus({
    status,
    pendingWriteCount: queue.count,
    failedWriteCount: queue.failedCount,
    firstWriteError: queue.firstError,
    online,
    billingStatus: billing.view?.status ?? null,
    // The active org's own lapse is the more specific reason, so it names the
    // status whenever both are blocked.
    billingBlockScope: billingNeedsAttention ? "active" : "other",
  });

  return { status, title, pendingWriteCount: queue.count };
}
