import { expect, test } from "bun:test";
import type {
  PendingWriteQueueItem,
  PendingWriteQueueOperation,
} from "@tearleads/client-sdk";
import {
  countPendingWrites,
  describeSyncStatus,
  resolveSyncStatus,
  summarizePendingWrites,
} from "./syncStatusModel";

function op(count: number): PendingWriteQueueOperation {
  return {
    byteLength: 0,
    count,
    createdAt: null,
    kind: "update",
    lastAttemptedAt: null,
    lastError: null,
    status: "pending",
    targetContainerId: null,
    updatedAt: null,
  };
}

function item(
  ...operations: PendingWriteQueueOperation[]
): PendingWriteQueueItem {
  return {
    containerId: null,
    createdAt: null,
    localId: "local",
    name: null,
    namespace: null,
    objectKind: "document",
    operations,
    organizationId: null,
    remoteId: null,
    status: "pending",
    updatedAt: null,
  };
}

function failedItem(lastError: string, count = 1): PendingWriteQueueItem {
  return {
    ...item({ ...op(count), lastError }),
    status: "error",
  };
}

test("countPendingWrites is 0 for an empty queue", () => {
  expect(countPendingWrites([])).toBe(0);
});

test("countPendingWrites sums operation counts across items", () => {
  expect(countPendingWrites([item(op(2), op(3)), item(op(1))])).toBe(6);
});

test("resolveSyncStatus is synced when ready with an empty queue", () => {
  expect(
    resolveSyncStatus({
      billingNeedsAttention: false,
      otherOrganizationBillingBlocked: false,
      ready: true,
      pendingWriteCount: 0,
      failedWriteCount: 0,
      queueReadError: null,
      failedLaneCount: 0,
      syncActive: false,
    }),
  ).toBe("synced");
});

test("resolveSyncStatus is pending when ready with unflushed data", () => {
  expect(
    resolveSyncStatus({
      billingNeedsAttention: false,
      otherOrganizationBillingBlocked: false,
      ready: true,
      pendingWriteCount: 4,
      failedWriteCount: 0,
      queueReadError: null,
      failedLaneCount: 0,
      syncActive: false,
    }),
  ).toBe("pending");
});

test("resolveSyncStatus is loading before the first read resolves", () => {
  expect(
    resolveSyncStatus({
      billingNeedsAttention: false,
      otherOrganizationBillingBlocked: false,
      ready: false,
      pendingWriteCount: 0,
      failedWriteCount: 0,
      queueReadError: null,
      failedLaneCount: 0,
      syncActive: false,
    }),
  ).toBe("loading");
});

test("resolveSyncStatus surfaces billing over a pending queue", () => {
  expect(
    resolveSyncStatus({
      billingNeedsAttention: true,
      otherOrganizationBillingBlocked: false,
      ready: true,
      pendingWriteCount: 9,
      failedWriteCount: 2,
      queueReadError: null,
      failedLaneCount: 0,
      syncActive: false,
    }),
  ).toBe("billing");
});

test("resolveSyncStatus surfaces billing even before the queue is read", () => {
  expect(
    resolveSyncStatus({
      billingNeedsAttention: true,
      otherOrganizationBillingBlocked: false,
      ready: false,
      pendingWriteCount: 0,
      failedWriteCount: 0,
      queueReadError: null,
      failedLaneCount: 0,
      syncActive: false,
    }),
  ).toBe("billing");
});

test("resolveSyncStatus surfaces billing for a non-active organization", () => {
  // The write queue is identity-wide, so another org's 402 strands writes here
  // too — surface the reason instead of an unexplained red "pending" dot.
  expect(
    resolveSyncStatus({
      billingNeedsAttention: false,
      otherOrganizationBillingBlocked: true,
      ready: true,
      pendingWriteCount: 5,
      failedWriteCount: 0,
      queueReadError: null,
      failedLaneCount: 0,
      syncActive: false,
    }),
  ).toBe("billing");
});

test("describeSyncStatus names another organization as the billing reason", () => {
  // The billing snapshot only covers the active org, so a block elsewhere has
  // no status to name — the active org's own status must not be borrowed.
  expect(
    describeSyncStatus({
      status: "billing",
      pendingWriteCount: 0,
      failedWriteCount: 0,
      firstWriteError: null,
      queueReadError: null,
      failedLaneCount: 0,
      firstLaneError: null,
      syncActive: false,
      online: true,
      syncPaused: false,
      writesPaused: false,
      blockedWriteCount: 0,
      billingStatus: "active",
      billingBlockScope: "other",
    }),
  ).toBe("Sync paused for another organization — billing needs attention.");
});

test("describeSyncStatus labels the settled states", () => {
  expect(
    describeSyncStatus({
      status: "loading",
      pendingWriteCount: 0,
      failedWriteCount: 0,
      firstWriteError: null,
      queueReadError: null,
      failedLaneCount: 0,
      firstLaneError: null,
      syncActive: false,
      online: true,
      syncPaused: false,
      writesPaused: false,
      blockedWriteCount: 0,
      billingStatus: null,
      billingBlockScope: "active",
    }),
  ).toBe("Checking sync status…");
  expect(
    describeSyncStatus({
      status: "synced",
      pendingWriteCount: 0,
      failedWriteCount: 0,
      firstWriteError: null,
      queueReadError: null,
      failedLaneCount: 0,
      firstLaneError: null,
      syncActive: false,
      online: true,
      syncPaused: false,
      writesPaused: false,
      blockedWriteCount: 0,
      billingStatus: null,
      billingBlockScope: "active",
    }),
  ).toBe("All changes synced");
});

test("describeSyncStatus uses the singular for one pending change", () => {
  expect(
    describeSyncStatus({
      status: "pending",
      pendingWriteCount: 1,
      failedWriteCount: 0,
      firstWriteError: null,
      queueReadError: null,
      failedLaneCount: 0,
      firstLaneError: null,
      syncActive: false,
      online: true,
      syncPaused: false,
      writesPaused: false,
      blockedWriteCount: 0,
      billingStatus: null,
      billingBlockScope: "active",
    }),
  ).toBe("1 change not yet synced");
});

test("describeSyncStatus pluralizes and notes offline for pending changes", () => {
  expect(
    describeSyncStatus({
      status: "pending",
      pendingWriteCount: 3,
      failedWriteCount: 0,
      firstWriteError: null,
      queueReadError: null,
      failedLaneCount: 0,
      firstLaneError: null,
      syncActive: false,
      online: false,
      syncPaused: false,
      writesPaused: false,
      blockedWriteCount: 0,
      billingStatus: null,
      billingBlockScope: "active",
    }),
  ).toBe("3 changes not yet synced (offline)");
});

test("describeSyncStatus names an expired trial as the billing reason", () => {
  expect(
    describeSyncStatus({
      status: "billing",
      pendingWriteCount: 0,
      failedWriteCount: 0,
      firstWriteError: null,
      queueReadError: null,
      failedLaneCount: 0,
      firstLaneError: null,
      syncActive: false,
      online: true,
      syncPaused: false,
      writesPaused: false,
      blockedWriteCount: 0,
      billingStatus: "trialing",
      billingBlockScope: "active",
    }),
  ).toContain("Free trial ended");
});

test("describeSyncStatus explains disabled billing", () => {
  expect(
    describeSyncStatus({
      status: "billing",
      pendingWriteCount: 0,
      failedWriteCount: 0,
      firstWriteError: null,
      queueReadError: null,
      failedLaneCount: 0,
      firstLaneError: null,
      syncActive: false,
      online: true,
      syncPaused: false,
      writesPaused: false,
      blockedWriteCount: 0,
      billingStatus: "disabled",
      billingBlockScope: "active",
    }),
  ).toContain("Subscription disabled");
});

test("describeSyncStatus falls back to a generic billing message", () => {
  expect(
    describeSyncStatus({
      status: "billing",
      pendingWriteCount: 0,
      failedWriteCount: 0,
      firstWriteError: null,
      queueReadError: null,
      failedLaneCount: 0,
      firstLaneError: null,
      syncActive: false,
      online: true,
      syncPaused: false,
      writesPaused: false,
      blockedWriteCount: 0,
      billingStatus: "deleting",
      billingBlockScope: "active",
    }),
  ).toBe("Sync paused — billing needs attention.");
});

test("summarizePendingWrites counts failed items and captures the first error", () => {
  const summary = summarizePendingWrites([
    item(op(2)),
    failedItem("Write access denied by the server (403)", 3),
    failedItem("Sync failed (500)"),
  ]);
  expect(summary).toEqual({
    blockedCount: 0,
    count: 6,
    failedCount: 2,
    firstError: "Write access denied by the server (403)",
    organizationIds: [],
  });
});

test("resolveSyncStatus surfaces error over a merely pending queue", () => {
  expect(
    resolveSyncStatus({
      billingNeedsAttention: false,
      otherOrganizationBillingBlocked: false,
      ready: true,
      pendingWriteCount: 4,
      failedWriteCount: 1,
      queueReadError: null,
      failedLaneCount: 0,
      syncActive: false,
    }),
  ).toBe("error");
});

test("describeSyncStatus appends the recorded failure to the error label", () => {
  expect(
    describeSyncStatus({
      status: "error",
      pendingWriteCount: 4,
      failedWriteCount: 1,
      firstWriteError: "Write access denied by the server (403)",
      queueReadError: null,
      failedLaneCount: 0,
      firstLaneError: null,
      syncActive: false,
      online: true,
      syncPaused: false,
      writesPaused: false,
      blockedWriteCount: 0,
      billingStatus: null,
      billingBlockScope: "active",
    }),
  ).toBe("1 change failed to sync — Write access denied by the server (403)");
  expect(
    describeSyncStatus({
      status: "error",
      pendingWriteCount: 4,
      failedWriteCount: 2,
      firstWriteError: null,
      queueReadError: null,
      failedLaneCount: 0,
      firstLaneError: null,
      syncActive: false,
      online: true,
      syncPaused: false,
      writesPaused: false,
      blockedWriteCount: 0,
      billingStatus: null,
      billingBlockScope: "active",
    }),
  ).toBe("2 changes failed to sync");
});

test("resolveSyncStatus surfaces a failed queue read as error, not loading", () => {
  // The first read never succeeded, so the queue is not loaded — but waiting on
  // a read that keeps failing must not leave the indicator checking forever.
  expect(
    resolveSyncStatus({
      billingNeedsAttention: false,
      otherOrganizationBillingBlocked: false,
      ready: false,
      pendingWriteCount: 0,
      failedWriteCount: 0,
      queueReadError: "Local database schema is obsolete",
      failedLaneCount: 0,
      syncActive: false,
    }),
  ).toBe("error");
});

test("resolveSyncStatus keeps billing over a failed queue read", () => {
  expect(
    resolveSyncStatus({
      billingNeedsAttention: true,
      otherOrganizationBillingBlocked: false,
      ready: false,
      pendingWriteCount: 0,
      failedWriteCount: 0,
      queueReadError: "Local database schema is obsolete",
      failedLaneCount: 0,
      syncActive: false,
    }),
  ).toBe("billing");
});

test("describeSyncStatus names the queue read failure over stale failed writes", () => {
  expect(
    describeSyncStatus({
      status: "error",
      pendingWriteCount: 4,
      failedWriteCount: 1,
      firstWriteError: "Write access denied by the server (403)",
      queueReadError: "Local database schema is obsolete",
      failedLaneCount: 0,
      firstLaneError: null,
      syncActive: false,
      online: true,
      syncPaused: false,
      writesPaused: false,
      blockedWriteCount: 0,
      billingStatus: null,
      billingBlockScope: "active",
    }),
  ).toBe("Unable to check sync status — Local database schema is obsolete");
});

test("describeSyncStatus names a sync pause as why changes are waiting", () => {
  const pending = {
    status: "pending",
    pendingWriteCount: 2,
    failedWriteCount: 0,
    firstWriteError: null,
    queueReadError: null,
    failedLaneCount: 0,
    firstLaneError: null,
    syncActive: false,
    billingStatus: null,
    billingBlockScope: "active",
    blockedWriteCount: 0,
  } as const;
  const paused = { syncPaused: true, writesPaused: true } as const;

  expect(describeSyncStatus({ ...pending, ...paused, online: true })).toBe(
    "2 changes not yet synced (sync is paused for an organization)",
  );
  // Offline is the nearer reason: nothing would send even without the pause.
  expect(describeSyncStatus({ ...pending, ...paused, online: false })).toBe(
    "2 changes not yet synced (offline)",
  );
});
