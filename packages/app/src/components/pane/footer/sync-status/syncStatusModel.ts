import type {
  OrganizationBillingView,
  PendingWriteQueueItem,
} from "@tearleads/client-sdk";

// The four states the footer sync indicator can be in. `billing` outranks
// everything else: when the org cannot sync because billing lapsed, that is the
// reason nothing flushes, so it is the more useful thing to surface than the
// resulting red "pending" dot. `loading` covers the window before the local
// write queue has been read once (or while the database is still booting), so a
// fresh mount never flashes a misleading green before the first read resolves.
export type SyncStatus = "loading" | "synced" | "pending" | "billing";

type BillingStatus = OrganizationBillingView["status"];

// Aggregate unflushed-operation count across the durable write queue — the exact
// figure the Explorer Write Queue panel derives (sum of every queued item's
// per-operation counts). `> 0` means there is local data not yet synced. Errored
// and blocked operations are counted too: they are still unflushed, so the
// indicator deliberately treats a stuck write as "pending" (red) rather than
// hiding it.
export function countPendingWrites(
  items: ReadonlyArray<PendingWriteQueueItem>,
): number {
  return items.reduce(
    (total, item) =>
      total +
      item.operations.reduce(
        (operationTotal, operation) => operationTotal + operation.count,
        0,
      ),
    0,
  );
}

interface SyncStatusInput {
  /**
   * Billing lapsed for the active org (expired trial / past due / disabled) so
   * sync is paused. Excludes the free "local" org, which is not trying to sync
   * and must not raise a warning. Mirrors `OrganizationBillingView.needsAttention`.
   */
  readonly billingNeedsAttention: boolean;
  /** The local write queue has been read at least once (database ready + settled). */
  readonly ready: boolean;
  /** Aggregate count of unflushed write operations (see `countPendingWrites`). */
  readonly pendingWriteCount: number;
}

export function resolveSyncStatus(input: SyncStatusInput): SyncStatus {
  if (input.billingNeedsAttention) {
    return "billing";
  }
  if (!input.ready) {
    return "loading";
  }
  if (input.pendingWriteCount > 0) {
    return "pending";
  }
  return "synced";
}

const SYNC_STATUS_LABELS = {
  loading: "Checking sync status…",
  synced: "All changes synced",
  pendingOne: "1 change not yet synced",
  pendingOther: "changes not yet synced",
  offlineSuffix: " (offline)",
  billingTrialEnded:
    "Free trial ended — sync paused. Update billing to resume.",
  billingPastDue: "Payment past due — sync paused. Update billing to resume.",
  billingDisabled:
    "Subscription disabled — sync paused. Update billing to resume.",
  billingGeneric: "Sync paused — billing needs attention.",
} as const;

function describeBillingBlock(status: BillingStatus | null): string {
  switch (status) {
    // `needsAttention` with a still-"trialing" status means the trial window
    // elapsed without converting — i.e. the free trial expired.
    case "trialing":
      return SYNC_STATUS_LABELS.billingTrialEnded;
    case "past_due":
      return SYNC_STATUS_LABELS.billingPastDue;
    case "disabled":
      return SYNC_STATUS_LABELS.billingDisabled;
    default:
      return SYNC_STATUS_LABELS.billingGeneric;
  }
}

interface SyncStatusDescriptionInput {
  readonly status: SyncStatus;
  readonly pendingWriteCount: number;
  readonly online: boolean;
  readonly billingStatus: BillingStatus | null;
}

/** Human-readable tooltip / accessible label for the current status. */
export function describeSyncStatus(input: SyncStatusDescriptionInput): string {
  switch (input.status) {
    case "loading":
      return SYNC_STATUS_LABELS.loading;
    case "synced":
      return SYNC_STATUS_LABELS.synced;
    case "billing":
      return describeBillingBlock(input.billingStatus);
    case "pending": {
      const base =
        input.pendingWriteCount === 1
          ? SYNC_STATUS_LABELS.pendingOne
          : `${input.pendingWriteCount} ${SYNC_STATUS_LABELS.pendingOther}`;
      return input.online ? base : `${base}${SYNC_STATUS_LABELS.offlineSuffix}`;
    }
  }
}
