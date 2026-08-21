import type {
  OrganizationBillingView,
  PendingWriteQueueItem,
} from "@symcrypt/client-sdk";

// The states the footer sync indicator can be in. `billing` outranks
// everything else: when the org cannot sync because billing lapsed, that is the
// reason nothing flushes, so it is the more useful thing to surface than the
// resulting red "pending" dot. `error` outranks `pending`: a queue item whose
// last submission failed terminally (e.g. the server denied the write after
// group access was revoked) will not flush on its own, which matters more than
// the same item's generic unflushed-ness. `loading` covers the window before
// the local write queue has been read once (or while the database is still
// booting), so a fresh mount never flashes a misleading green before the first
// read resolves.
export type SyncStatus = "loading" | "synced" | "pending" | "error" | "billing";

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

/** One read of the write queue, reduced to what the indicator needs. */
export interface PendingWriteQueueSummary {
  /** Aggregate unflushed write-operation count (see `countPendingWrites`). */
  readonly count: number;
  /** Queue items whose last submission failed terminally (status `error`). */
  readonly failedCount: number;
  /** The first failed item's recorded error, for the tooltip/popover. */
  readonly firstError: string | null;
}

export function summarizePendingWrites(
  items: ReadonlyArray<PendingWriteQueueItem>,
): PendingWriteQueueSummary {
  const failedItems = items.filter((item) => item.status === "error");
  const firstError =
    failedItems
      .flatMap((item) =>
        item.operations.flatMap((operation) =>
          operation.lastError ? [operation.lastError] : [],
        ),
      )
      .at(0) ?? null;
  return {
    count: countPendingWrites(items),
    failedCount: failedItems.length,
    firstError,
  };
}

/**
 * Which organization's billing paused sync. The shared billing snapshot only
 * covers the active org, so a block on any other org is known only from its 402
 * (see `SyncBillingGate`) and cannot name a billing status.
 */
type BillingBlockScope = "active" | "other";

interface SyncStatusInput {
  /**
   * Billing lapsed for the active org (expired trial / past due / disabled) so
   * sync is paused. Excludes the free "local" org, which is not trying to sync
   * and must not raise a warning. Mirrors `OrganizationBillingView.needsAttention`.
   */
  readonly billingNeedsAttention: boolean;
  /**
   * A non-active organization's sync is billing-blocked. The write queue is
   * identity-wide, so that org's writes strand in the same queue this indicator
   * counts — without this the block would surface as an unexplained red
   * "pending" dot, since the billing snapshot only sees the active org.
   */
  readonly otherOrganizationBillingBlocked: boolean;
  /** The local write queue has been read at least once (database ready + settled). */
  readonly ready: boolean;
  /** Aggregate count of unflushed write operations (see `countPendingWrites`). */
  readonly pendingWriteCount: number;
  /** Queue items whose last submission failed terminally (status `error`). */
  readonly failedWriteCount: number;
}

export function resolveSyncStatus(input: SyncStatusInput): SyncStatus {
  if (input.billingNeedsAttention || input.otherOrganizationBillingBlocked) {
    return "billing";
  }
  if (!input.ready) {
    return "loading";
  }
  if (input.failedWriteCount > 0) {
    return "error";
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
  errorOne: "1 change failed to sync",
  errorOther: "changes failed to sync",
  offlineSuffix: " (offline)",
  billingTrialEnded:
    "Free trial ended — sync paused. Update billing to resume.",
  billingPastDue: "Payment past due — sync paused. Update billing to resume.",
  billingDisabled:
    "Subscription disabled — sync paused. Update billing to resume.",
  billingGeneric: "Sync paused — billing needs attention.",
  billingOtherOrganization:
    "Sync paused for another organization — billing needs attention.",
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
  readonly failedWriteCount: number;
  readonly firstWriteError: string | null;
  readonly online: boolean;
  readonly billingStatus: BillingStatus | null;
  /** Whose billing paused sync; only read when `status` is `billing`. */
  readonly billingBlockScope: BillingBlockScope;
}

/** Human-readable tooltip / accessible label for the current status. */
export function describeSyncStatus(input: SyncStatusDescriptionInput): string {
  switch (input.status) {
    case "loading":
      return SYNC_STATUS_LABELS.loading;
    case "synced":
      return SYNC_STATUS_LABELS.synced;
    case "billing":
      return input.billingBlockScope === "other"
        ? SYNC_STATUS_LABELS.billingOtherOrganization
        : describeBillingBlock(input.billingStatus);
    case "error": {
      const base =
        input.failedWriteCount === 1
          ? SYNC_STATUS_LABELS.errorOne
          : `${input.failedWriteCount} ${SYNC_STATUS_LABELS.errorOther}`;
      // The recorded failure (e.g. "Write access denied by the server (403)")
      // is the actionable part, so it rides along in the same label.
      return input.firstWriteError
        ? `${base} — ${input.firstWriteError}`
        : base;
    }
    case "pending": {
      const base =
        input.pendingWriteCount === 1
          ? SYNC_STATUS_LABELS.pendingOne
          : `${input.pendingWriteCount} ${SYNC_STATUS_LABELS.pendingOther}`;
      return input.online ? base : `${base}${SYNC_STATUS_LABELS.offlineSuffix}`;
    }
  }
}
