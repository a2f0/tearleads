import { useCallback, useMemo } from "react";
import { useOrganizationBilling } from "../../providers/billing/BillingProvider";
import {
  useTearleads,
  useTearleadsRuntime,
} from "../../providers/sdk/TearleadsProvider";
import { useDomainDocumentQueries } from "../../providers/sdk/useDomainDocumentQueries";
import { useDomainSyncSnapshot } from "../../providers/sdk/useDomainSyncSnapshot";
import { usePausedOrganizationIds } from "../../providers/sdk/usePausedOrganizationIds";
import { type SyncLaneSummary, summarizeSyncLanes } from "./syncActivityModel";
import {
  describeSyncStatus,
  resolveSyncStatus,
  type SyncStatus,
} from "./syncStatusModel";
import { useHeldSyncActivity } from "./useHeldSyncActivity";
import { useOtherOrganizationBillingBlocked } from "./useOtherOrganizationBillingBlock";
import { usePendingWriteCount } from "./usePendingWriteCount";

export interface SyncStatusResult {
  readonly status: SyncStatus;
  readonly title: string;
  /** Aggregate unflushed write-operation count; drives the "view queue" link. */
  readonly pendingWriteCount: number;
  /** The latest write-queue read failed; the queue view shows why. */
  readonly queueReadFailed: boolean;
  /** The sync coordinator's lanes: what runs now and what failed. */
  readonly lanes: SyncLaneSummary;
}

/**
 * The Sync Status tray app's data source. It reads the durable write queue
 * through the store the Explorer "Write Queue" panel shares (see
 * `usePendingWriteCount`), treating a non-empty queue
 * as unflushed local data, and takes billing from the shared
 * `useOrganizationBilling` snapshot, so the widget agrees with the Explorer and
 * the billing banner about whether the org can sync. That snapshot is scoped to
 * the active organization while the queue is identity-wide, so the sync billing
 * gate covers the rest (see `useOtherOrganizationBillingBlocked`): an
 * organization whose billing lapsed raises the warning even when it is not the
 * one currently switched to. The sync coordinator's lanes add what the queue
 * cannot show: sync work running (held, so short runs do not blink the glyph)
 * and sync tasks failing, including pulls.
 */
export function useSyncStatus(): SyncStatusResult {
  const appData = useTearleadsRuntime();
  const billing = useOrganizationBilling();
  const { organizations, syncBillingGate } = useTearleads();
  const domainScope = appData.state.domainScope;
  const dbReady = appData.infra.dbStatus === "ready";
  const online = appData.state.online;

  const documentQueries = useDomainDocumentQueries(appData);

  const queue = usePendingWriteCount(documentQueries, domainScope, dbReady);

  const loadBlockedOrganizationBilling = useCallback(
    (organizationId: string) =>
      organizations.loadBillingForOrganization(organizationId),
    [organizations],
  );
  // A pause holds back both directions whether or not anything is queued for
  // it, so it is named whenever one holds.
  const syncPaused = usePausedOrganizationIds().size > 0;
  const syncSnapshot = useDomainSyncSnapshot(domainScope);
  const lanes = useMemo(() => summarizeSyncLanes(syncSnapshot), [syncSnapshot]);
  // Offline, sync tasks fail or wait as a matter of course; the offline note
  // explains them.
  const failedLaneCount = online ? lanes.failed : 0;
  const syncActive = useHeldSyncActivity(
    dbReady && online && lanes.running > 0,
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
    queueReadError: queue.readError,
    failedLaneCount,
    syncActive,
  });
  const title = describeSyncStatus({
    status,
    pendingWriteCount: queue.count,
    failedWriteCount: queue.failedCount,
    firstWriteError: queue.firstError,
    queueReadError: queue.readError,
    failedLaneCount,
    firstLaneError: lanes.firstError,
    syncActive,
    online,
    syncPaused,
    billingStatus: billing.view?.status ?? null,
    // The active org's own lapse is the more specific reason, so it names the
    // status whenever both are blocked.
    billingBlockScope: billingNeedsAttention ? "active" : "other",
  });

  return {
    status,
    title,
    pendingWriteCount: queue.count,
    queueReadFailed: queue.readError !== null,
    lanes,
  };
}
