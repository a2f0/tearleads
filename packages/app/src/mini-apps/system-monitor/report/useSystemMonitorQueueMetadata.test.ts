import { expect, test } from "bun:test";
import type { PendingWriteQueueItem } from "@tearleads/client-sdk";
import { selectSystemMonitorWriteQueue } from "./useSystemMonitorQueueMetadata";

const QUEUED_ITEM = {
  containerId: null,
  createdAt: null,
  localId: "PRIVATE cardiology scan.pdf",
  name: null,
  namespace: null,
  objectKind: "document",
  operations: [],
  organizationId: null,
  remoteId: null,
  status: "pending",
  updatedAt: null,
} satisfies PendingWriteQueueItem;

test("the queue is reported once a read settles and the db is ready", () => {
  const state = {
    items: [QUEUED_ITEM],
    read: 1,
    status: "ready",
  } as const;

  expect(selectSystemMonitorWriteQueue({ dbReady: true, state })).toEqual({
    status: "available",
    items: [QUEUED_ITEM],
  });
  expect(selectSystemMonitorWriteQueue({ dbReady: false, state })).toEqual({
    status: "unavailable",
  });
});

test("a queue not yet read is unavailable, and a failed read leaves out its rows", () => {
  expect(
    selectSystemMonitorWriteQueue({
      dbReady: true,
      state: { read: 1, status: "loading" },
    }),
  ).toEqual({ status: "unavailable" });
  expect(
    selectSystemMonitorWriteQueue({
      dbReady: true,
      state: {
        items: [QUEUED_ITEM],
        message: "PRIVATE disk path",
        read: 2,
        status: "failed",
      },
    }),
  ).toEqual({ status: "failed" });
});
