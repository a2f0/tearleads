import { expect, test } from "bun:test";
import type {
  PendingWriteQueueItem,
  PendingWriteQueueOperation,
} from "@tearleads/client-sdk";
import {
  countPendingWrites,
  describeSyncStatus,
  resolveSyncStatus,
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
      ready: true,
      pendingWriteCount: 0,
    }),
  ).toBe("synced");
});

test("resolveSyncStatus is pending when ready with unflushed data", () => {
  expect(
    resolveSyncStatus({
      billingNeedsAttention: false,
      ready: true,
      pendingWriteCount: 4,
    }),
  ).toBe("pending");
});

test("resolveSyncStatus is loading before the first read resolves", () => {
  expect(
    resolveSyncStatus({
      billingNeedsAttention: false,
      ready: false,
      pendingWriteCount: 0,
    }),
  ).toBe("loading");
});

test("resolveSyncStatus surfaces billing over a pending queue", () => {
  expect(
    resolveSyncStatus({
      billingNeedsAttention: true,
      ready: true,
      pendingWriteCount: 9,
    }),
  ).toBe("billing");
});

test("resolveSyncStatus surfaces billing even before the queue is read", () => {
  expect(
    resolveSyncStatus({
      billingNeedsAttention: true,
      ready: false,
      pendingWriteCount: 0,
    }),
  ).toBe("billing");
});

test("describeSyncStatus labels the settled states", () => {
  expect(
    describeSyncStatus({
      status: "loading",
      pendingWriteCount: 0,
      online: true,
      billingStatus: null,
    }),
  ).toBe("Checking sync status…");
  expect(
    describeSyncStatus({
      status: "synced",
      pendingWriteCount: 0,
      online: true,
      billingStatus: null,
    }),
  ).toBe("All changes synced");
});

test("describeSyncStatus uses the singular for one pending change", () => {
  expect(
    describeSyncStatus({
      status: "pending",
      pendingWriteCount: 1,
      online: true,
      billingStatus: null,
    }),
  ).toBe("1 change not yet synced");
});

test("describeSyncStatus pluralizes and notes offline for pending changes", () => {
  expect(
    describeSyncStatus({
      status: "pending",
      pendingWriteCount: 3,
      online: false,
      billingStatus: null,
    }),
  ).toBe("3 changes not yet synced (offline)");
});

test("describeSyncStatus names an expired trial as the billing reason", () => {
  expect(
    describeSyncStatus({
      status: "billing",
      pendingWriteCount: 0,
      online: true,
      billingStatus: "trialing",
    }),
  ).toContain("Free trial ended");
});

test("describeSyncStatus distinguishes past-due and disabled billing", () => {
  expect(
    describeSyncStatus({
      status: "billing",
      pendingWriteCount: 0,
      online: true,
      billingStatus: "past_due",
    }),
  ).toContain("past due");
  expect(
    describeSyncStatus({
      status: "billing",
      pendingWriteCount: 0,
      online: true,
      billingStatus: "disabled",
    }),
  ).toContain("Subscription disabled");
});

test("describeSyncStatus falls back to a generic billing message", () => {
  expect(
    describeSyncStatus({
      status: "billing",
      pendingWriteCount: 0,
      online: true,
      billingStatus: "deleting",
    }),
  ).toBe("Sync paused — billing needs attention.");
});
