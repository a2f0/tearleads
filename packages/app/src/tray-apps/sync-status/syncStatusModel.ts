import type {
  DatabaseStatus,
  OrganizationBillingView,
  PendingWriteQueueItem,
} from "@tearleads/client-sdk";

// The states the Sync Status tray app can be in. `inactive` outranks
// everything: with no identity on this device yet, or its keys locked, there is
// no local data to read or sync until the user acts, so waiting for the queue's
// first read would leave the indicator "checking" forever. `billing` outranks
// everything else: when the org cannot sync because billing lapsed, that is the
// reason nothing flushes, so it is the more useful thing to surface than the
// resulting red "pending" dot. `error` outranks `pending`: a queue item whose
// last submission failed terminally (e.g. the server denied the write after
// group access was revoked) will not flush on its own, which matters more than
// the same item's generic unflushed-ness. A failed read of the queue itself is
// also `error`: the true state is unknown, and waiting on a read that keeps
// failing (e.g. an obsolete local schema) would otherwise leave the indicator
// "checking" forever. `loading` covers the window before the local write queue
// has been read once (or while the database is still booting), so a fresh mount
// never flashes a misleading green before the first read resolves. A failed
// sync task (a lane whose last run failed or stopped responding) is `error` as
// well, while online: sync is failing now, whatever the queue holds. `syncing`
// is `synced` while sync work has been running for a moment (see
// `useHeldSyncActivity`): nothing local is waiting, but content is still
// arriving, so it is not alarming.
export type SyncStatus =
  | "inactive"
  | "loading"
  | "synced"
  | "syncing"
  | "pending"
  | "error"
  | "billing";

type BillingStatus = OrganizationBillingView["status"];

/**
 * Why this device's data cannot be read at all, so nothing syncs until the
 * user acts: it has no identity yet (first launch, or after a device reset),
 * its keys are locked behind the PIN, or its database gave up opening.
 */
export type SyncUnavailableReason =
  | "no-identity"
  | "locked"
  | "database-failed";

export function resolveSyncUnavailableReason(input: {
  readonly databaseStatus: DatabaseStatus;
  readonly hasIdentity: boolean;
  /** The stored identity has been looked for, and no switch is under way. */
  readonly identitySettled: boolean;
  readonly isLocked: boolean;
}): SyncUnavailableReason | null {
  if (input.databaseStatus === "ready") return null;
  if (input.isLocked) return "locked";
  if (input.databaseStatus === "error") return "database-failed";
  // Until the stored identity is found, or while a switch opens the next
  // one, the database is still on its way.
  return input.identitySettled && !input.hasIdentity ? "no-identity" : null;
}

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
  /**
   * Queue items waiting on something else (status `blocked`), which running
   * sync does not send.
   */
  readonly blockedCount: number;
  /** The organizations the queued items belong to, each once. */
  readonly organizationIds: ReadonlyArray<string>;
}

export function summarizePendingWrites(
  items: ReadonlyArray<PendingWriteQueueItem>,
): PendingWriteQueueSummary {
  const failedItems = items.filter((item) => item.status === "error");
  const organizationIds = new Set<string>();
  for (const item of items) {
    if (item.organizationId !== null) organizationIds.add(item.organizationId);
  }
  const firstError =
    failedItems
      .flatMap((item) =>
        item.operations.flatMap((operation) =>
          operation.lastError ? [operation.lastError] : [],
        ),
      )
      .at(0) ?? null;
  return {
    blockedCount: items.filter((item) => item.status === "blocked").length,
    count: countPendingWrites(items),
    failedCount: failedItems.length,
    firstError,
    organizationIds: [...organizationIds],
  };
}

/**
 * Which organization's billing paused sync. The shared billing snapshot only
 * covers the active org, so a block on any other org is known only from its 402
 * (see `SyncBillingGate`) and cannot name a billing status.
 */
export type BillingBlockScope = "active" | "other";

/** Whose billing paused sync: the active org's lapse is the more specific. */
export function selectBillingBlock(
  activeOrganizationBlocked: boolean,
  otherOrganizationBlocked: boolean,
): BillingBlockScope | null {
  if (activeOrganizationBlocked) return "active";
  return otherOrganizationBlocked ? "other" : null;
}

interface SyncStatusInput {
  /** Why nothing on this device can sync until the user acts, if so. */
  readonly unavailableReason: SyncUnavailableReason | null;
  /**
   * Billing lapsed for the active org (expired trial or disabled) so
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
  /** Why the latest write-queue read failed, or null when it succeeded. */
  readonly queueReadError: string | null;
  /** Sync tasks failing now; zero while offline, where failures are expected. */
  readonly failedLaneCount: number;
  /** Sync work has been running for a moment (see `useHeldSyncActivity`). */
  readonly syncActive: boolean;
}

export function resolveSyncStatus(input: SyncStatusInput): SyncStatus {
  if (input.unavailableReason === "database-failed") return "error";
  if (input.unavailableReason !== null) return "inactive";
  if (input.billingNeedsAttention || input.otherOrganizationBillingBlocked) {
    return "billing";
  }
  if (input.queueReadError !== null) {
    return "error";
  }
  if (!input.ready) {
    return "loading";
  }
  if (input.failedWriteCount > 0 || input.failedLaneCount > 0) {
    return "error";
  }
  if (input.pendingWriteCount > 0) {
    return "pending";
  }
  return input.syncActive ? "syncing" : "synced";
}

const SYNC_STATUS_LABELS = {
  noIdentity: "Not syncing — this device has no identity yet",
  locked: "Not syncing — this device is locked",
  databaseFailed:
    "Unable to check sync status — this device's data did not open",
  loading: "Checking sync status…",
  synced: "All changes synced",
  syncing: "All changes synced, syncing updates…",
  pendingOne: "1 change not yet synced",
  pendingOther: "changes not yet synced",
  pendingSyncingOne: "Syncing 1 change…",
  pendingSyncingPrefix: "Syncing",
  pendingSyncingOther: "changes…",
  errorOne: "1 change failed to sync",
  errorOther: "changes failed to sync",
  laneErrorOne: "1 sync task failed",
  laneErrorOther: "sync tasks failed",
  queueReadFailed: "Unable to check sync status",
  offlineSuffix: " (offline)",
  syncPausedSuffix: " (sync is paused for an organization)",
  billingTrialEnded:
    "Free trial ended — sync paused. Update billing to resume.",
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
    case "disabled":
      return SYNC_STATUS_LABELS.billingDisabled;
    default:
      return SYNC_STATUS_LABELS.billingGeneric;
  }
}

interface SyncStatusDescriptionInput {
  readonly status: SyncStatus;
  readonly unavailableReason: SyncUnavailableReason | null;
  readonly pendingWriteCount: number;
  readonly failedWriteCount: number;
  readonly firstWriteError: string | null;
  readonly queueReadError: string | null;
  readonly failedLaneCount: number;
  /** The first failed sync task's recorded error. */
  readonly firstLaneError: string | null;
  /** Sync work has been running for a moment (see `useHeldSyncActivity`). */
  readonly syncActive: boolean;
  readonly online: boolean;
  /**
   * The user paused some organization's sync on this device. Its content is
   * not pulled, so "All changes synced" names the pause rather than reading
   * as complete.
   */
  readonly syncPaused: boolean;
  /**
   * Some queued write belongs to a paused organization. Only then does a
   * pending status name the pause: writes for other organizations still send.
   */
  readonly writesPaused: boolean;
  /** Queued items waiting on something else, which running sync skips. */
  readonly blockedWriteCount: number;
  readonly billingStatus: BillingStatus | null;
  /** Whose billing paused sync; only read when `status` is `billing`. */
  readonly billingBlockScope: BillingBlockScope;
}

// What holds sync back on this device, if anything: offline is the nearer
// reason, since nothing would send even without a pause.
function describeHold(input: SyncStatusDescriptionInput): string {
  if (!input.online) return SYNC_STATUS_LABELS.offlineSuffix;
  return input.syncPaused ? SYNC_STATUS_LABELS.syncPausedSuffix : "";
}

// What holds the queued writes back. A pause on an organization none of them
// belong to holds nothing, so naming it would blame it for the wait; the
// popover lists it instead.
function describeWriteHold(input: SyncStatusDescriptionInput): string {
  if (!input.online) return SYNC_STATUS_LABELS.offlineSuffix;
  return input.writesPaused ? SYNC_STATUS_LABELS.syncPausedSuffix : "";
}

function describeFailure(input: SyncStatusDescriptionInput): string {
  if (input.unavailableReason === "database-failed") {
    return SYNC_STATUS_LABELS.databaseFailed;
  }
  // A failed queue read outranks the failed-write count, which is only the
  // last successful read's and may be stale.
  if (input.queueReadError !== null) {
    return `${SYNC_STATUS_LABELS.queueReadFailed} — ${input.queueReadError}`;
  }
  const writes = input.failedWriteCount > 0;
  const count = writes ? input.failedWriteCount : input.failedLaneCount;
  const base =
    count === 1
      ? writes
        ? SYNC_STATUS_LABELS.errorOne
        : SYNC_STATUS_LABELS.laneErrorOne
      : `${count} ${writes ? SYNC_STATUS_LABELS.errorOther : SYNC_STATUS_LABELS.laneErrorOther}`;
  // The recorded failure (e.g. "Write access denied by the server (403)") is
  // the actionable part, so it rides along in the same label.
  const reason = writes ? input.firstWriteError : input.firstLaneError;
  return reason ? `${base} — ${reason}` : base;
}

function describePendingCount(input: SyncStatusDescriptionInput): string {
  const count = input.pendingWriteCount;
  // Running sync sends the queued writes unless some wait on a pause or on
  // something else; then they read as waiting, whatever else runs. (A write
  // whose last attempt failed is already the `error` status.)
  const sending =
    input.syncActive && !input.writesPaused && input.blockedWriteCount === 0;
  if (sending) {
    return count === 1
      ? SYNC_STATUS_LABELS.pendingSyncingOne
      : `${SYNC_STATUS_LABELS.pendingSyncingPrefix} ${count} ${SYNC_STATUS_LABELS.pendingSyncingOther}`;
  }
  return count === 1
    ? SYNC_STATUS_LABELS.pendingOne
    : `${count} ${SYNC_STATUS_LABELS.pendingOther}`;
}

/** Human-readable tooltip / accessible label for the current status. */
export function describeSyncStatus(input: SyncStatusDescriptionInput): string {
  switch (input.status) {
    case "inactive":
      return input.unavailableReason === "locked"
        ? SYNC_STATUS_LABELS.locked
        : SYNC_STATUS_LABELS.noIdentity;
    case "loading":
      return SYNC_STATUS_LABELS.loading;
    case "synced":
      return `${SYNC_STATUS_LABELS.synced}${describeHold(input)}`;
    case "syncing":
      return `${SYNC_STATUS_LABELS.syncing}${describeHold(input)}`;
    case "billing":
      return input.billingBlockScope === "other"
        ? SYNC_STATUS_LABELS.billingOtherOrganization
        : describeBillingBlock(input.billingStatus);
    case "error":
      return describeFailure(input);
    case "pending":
      return `${describePendingCount(input)}${describeWriteHold(input)}`;
  }
}
