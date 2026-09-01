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
      online: true,
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
      online: true,
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
      online: true,
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
      online: true,
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
      online: false,
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
      online: true,
      billingStatus: "trialing",
      billingBlockScope: "active",
    }),
  ).toContain("Free trial ended");
});

test("describeSyncStatus distinguishes past-due and disabled billing", () => {
  expect(
    describeSyncStatus({
      status: "billing",
      pendingWriteCount: 0,
      failedWriteCount: 0,
      firstWriteError: null,
      online: true,
      billingStatus: "past_due",
      billingBlockScope: "active",
    }),
  ).toContain("past due");
  expect(
    describeSyncStatus({
      status: "billing",
      pendingWriteCount: 0,
      failedWriteCount: 0,
      firstWriteError: null,
      online: true,
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
      online: true,
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
    count: 6,
    failedCount: 2,
    firstError: "Write access denied by the server (403)",
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
      online: true,
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
      online: true,
      billingStatus: null,
      billingBlockScope: "active",
    }),
  ).toBe("2 changes failed to sync");
});
