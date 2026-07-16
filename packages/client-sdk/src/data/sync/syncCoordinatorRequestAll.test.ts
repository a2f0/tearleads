import { expect, test } from "bun:test";
import { createDomainScope } from "../domainScope";
import {
  getOrCreateDomainSyncCoordinator,
  requestAllDomainSyncLanes,
  waitForDomainSyncCoordinatorToSettle,
} from "./syncCoordinator";

test("requestAllDomainSyncLanes re-runs every registered lane", async () => {
  const domainScope = createDomainScope();
  const coordinator = getOrCreateDomainSyncCoordinator(domainScope);
  let runA = 0;
  let runB = 0;
  coordinator.registerLane("lane-a", {
    run: async () => {
      runA += 1;
    },
  });
  coordinator.registerLane("lane-b", {
    run: async () => {
      runB += 1;
    },
  });

  // Registered lanes are idle until requested — a transient failure leaves them
  // here with nothing to re-arm them.
  expect(
    await waitForDomainSyncCoordinatorToSettle(domainScope, {
      quietMs: 0,
      timeoutMs: 1_000,
    }),
  ).toBe(true);
  expect(runA).toBe(0);
  expect(runB).toBe(0);

  // A manual "sync now" re-requests every lane.
  requestAllDomainSyncLanes(domainScope);
  expect(
    await waitForDomainSyncCoordinatorToSettle(domainScope, {
      quietMs: 0,
      timeoutMs: 1_000,
    }),
  ).toBe(true);
  expect(runA).toBe(1);
  expect(runB).toBe(1);
});

test("requestAllDomainSyncLanes is a no-op for a scope with no coordinator", () => {
  // No coordinator has been created for this scope yet; must not throw or create
  // one.
  expect(() => requestAllDomainSyncLanes(createDomainScope())).not.toThrow();
});

test("requestAllDomainSyncLanes publishes the snapshot once for a batch", async () => {
  const domainScope = createDomainScope();
  const coordinator = getOrCreateDomainSyncCoordinator(domainScope);
  coordinator.registerLane("lane-a", { run: async () => {} });
  coordinator.registerLane("lane-b", { run: async () => {} });
  coordinator.registerLane("lane-c", { run: async () => {} });

  let notifications = 0;
  const unsubscribe = coordinator.subscribe(() => {
    notifications += 1;
  });

  requestAllDomainSyncLanes(domainScope);

  // One synchronous snapshot publish for the whole batch, not one per lane.
  expect(notifications).toBe(1);

  unsubscribe();
  await waitForDomainSyncCoordinatorToSettle(domainScope, {
    quietMs: 0,
    timeoutMs: 1_000,
  });
});

test("requestAllDomainSyncLanes does not fake-complete observational blob uploads", async () => {
  const domainScope = createDomainScope();
  const coordinator = getOrCreateDomainSyncCoordinator(domainScope);
  let documentRuns = 0;
  coordinator.registerLane("document:report", {
    run: async () => {
      documentRuns += 1;
    },
  });
  const upload = coordinator.beginUploadLane("blob-upload:report", {
    blobStorageKey: "documents/report.pdf",
  });
  upload.reportProgress({
    bytesTotal: 80,
    bytesUploaded: 56,
    partsCompleted: 7,
    partsTotal: 10,
  });
  upload.fail(new Error("network request failed"));

  const before = coordinator
    .getSnapshot()
    .lanes.find((lane) => lane.key === "blob-upload:report");
  expect(before).toMatchObject({
    requestCount: 0,
    runCount: 1,
    status: "error",
  });

  requestAllDomainSyncLanes(domainScope);
  expect(
    await waitForDomainSyncCoordinatorToSettle(domainScope, {
      quietMs: 0,
      timeoutMs: 1_000,
    }),
  ).toBe(true);

  expect(documentRuns).toBe(1);
  expect(
    coordinator
      .getSnapshot()
      .lanes.find((lane) => lane.key === "blob-upload:report"),
  ).toMatchObject({
    lastError: "network request failed",
    progress: {
      bytesTotal: 80,
      bytesUploaded: 56,
      partsCompleted: 7,
      partsTotal: 10,
    },
    requestCount: 0,
    requested: false,
    runCount: 1,
    running: false,
    status: "error",
  });
});

test("requestAllDomainSyncLanes leaves running blob uploads under their owner", async () => {
  const domainScope = createDomainScope();
  const coordinator = getOrCreateDomainSyncCoordinator(domainScope);
  const upload = coordinator.beginUploadLane("blob-upload:running");

  requestAllDomainSyncLanes(domainScope);
  expect(coordinator.getSnapshot().lanes[0]).toMatchObject({
    requestCount: 0,
    requested: false,
    runCount: 1,
    running: true,
    status: "running",
  });

  upload.complete();
  expect(
    await waitForDomainSyncCoordinatorToSettle(domainScope, {
      quietMs: 0,
      timeoutMs: 1_000,
    }),
  ).toBe(true);
});
