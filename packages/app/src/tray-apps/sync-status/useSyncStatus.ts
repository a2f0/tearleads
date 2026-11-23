import type { DomainScope } from "@tearleads/client-sdk";
import { useCallback, useMemo } from "react";
import { useOrganizationBilling } from "../../providers/billing/BillingProvider";
import {
  useTearleads,
  useTearleadsRuntime,
} from "../../providers/sdk/TearleadsProvider";
import { useDomainDocumentQueries } from "../../providers/sdk/useDomainDocumentQueries";
import { useDomainSyncSnapshot } from "../../providers/sdk/useDomainSyncSnapshot";
import { usePausedOrganizationIds } from "../../providers/sdk/usePausedOrganizationIds";
import {
  type SyncLaneSummary,
  selectSyncHolds,
  summarizeSyncLanes,
} from "./syncActivityModel";
import {
  type BillingBlockScope,
  describeSyncStatus,
  resolveSyncStatus,
  type SyncStatus,
} from "./syncStatusModel";
import { useHeldSyncActivity } from "./useHeldSyncActivity";
import { useLastOfflineWindow } from "./useLastOfflineWindow";
import { useOtherOrganizationBillingBlocked } from "./useOtherOrganizationBillingBlock";
import { usePendingWriteCount } from "./usePendingWriteCount";

export interface SyncStatusResult {
  readonly status: SyncStatus;
  readonly title: string;
  /** Aggregate unflushed write-operation count; drives the "view queue" link. */
  readonly pendingWriteCount: number;
  /** The latest write-queue read failed; the queue view shows why. */
  readonly queueReadFailed: boolean;
  /**
   * The sync coordinator's lanes as the status reports them: none while
   * offline, and without the failures carried back from being offline.
   */
  readonly lanes: SyncLaneSummary;
  /** Whose billing paused sync, if any organization's did. */
  readonly billingBlock: BillingBlockScope | null;
  /** Organizations whose sync is paused on this device. */
  readonly pausedOrganizationCount: number;
}

// The lanes, pauses, and held activity, as the status reports them.
function useSyncLaneHolds(input: {
  readonly dbReady: boolean;
  readonly domainScope: DomainScope;
  readonly online: boolean;
  readonly writeOrganizationIds: ReadonlyArray<string>;
}) {
  const pausedOrganizationIds = usePausedOrganizationIds();
  const syncSnapshot = useDomainSyncSnapshot(input.domainScope);
  const offlineWindow = useLastOfflineWindow(input.online, syncSnapshot);
  const allLanes = useMemo(
    () => summarizeSyncLanes(syncSnapshot, offlineWindow),
    [offlineWindow, syncSnapshot],
  );
  const { laneActive, ...holds } = selectSyncHolds({
    dbReady: input.dbReady,
    lanes: allLanes,
    online: input.online,
    pausedOrganizationIds,
    writeOrganizationIds: input.writeOrganizationIds,
  });
  return { ...holds, syncActive: useHeldSyncActivity(laneActive) };
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
 * and sync tasks failing, including pulls. Failures recorded while offline are
 * left out after the reconnect while a retry revisits them (see
 * `useLastOfflineWindow`).
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
  const { lanes, pausedOrganizationCount, syncActive, writesPaused } =
    useSyncLaneHolds({
      dbReady,
      domainScope,
      online,
      writeOrganizationIds: queue.organizationIds,
    });
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
    failedLaneCount: lanes.failed,
    syncActive,
  });
  const title = describeSyncStatus({
    status,
    pendingWriteCount: queue.count,
    failedWriteCount: queue.failedCount,
    firstWriteError: queue.firstError,
    queueReadError: queue.readError,
    failedLaneCount: lanes.failed,
    firstLaneError: lanes.firstError,
    syncActive,
    online,
    syncPaused: pausedOrganizationCount > 0,
    writesPaused,
    blockedWriteCount: queue.blockedCount,
    billingStatus: billing.view?.status ?? null,
    // The active org's own lapse is the more specific reason, so it names the
    // status whenever both are blocked.
    billingBlockScope: billingNeedsAttention ? "active" : "other",
  });

  const queueReadFailed = queue.readError !== null;
  const billingBlock: BillingBlockScope | null = billingNeedsAttention
    ? "active"
    : otherOrganizationBillingBlocked
      ? "other"
      : null;
  // One object per change, so the popover's memoized actions follow it.
  return useMemo(
    () => ({
      status,
      title,
      pendingWriteCount: queue.count,
      queueReadFailed,
      lanes,
      billingBlock,
      pausedOrganizationCount,
    }),
    [
      billingBlock,
      lanes,
      pausedOrganizationCount,
      queue.count,
      queueReadFailed,
      status,
      title,
    ],
  );
}
