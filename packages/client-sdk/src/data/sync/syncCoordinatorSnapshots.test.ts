import { expect, test } from "bun:test";
import { createDomainScope } from "../shared/domainScope";
import {
  getDomainSyncCoordinatorSnapshot,
  getOrCreateDomainSyncCoordinator,
  subscribeToDomainSyncCoordinator,
  waitForDomainSyncCoordinatorToSettle,
} from "./syncCoordinator";

test("sync coordinator snapshots report lane lifecycle telemetry", async () => {
  const domainScope = createDomainScope();
  const coordinator = getOrCreateDomainSyncCoordinator(domainScope);
  let releaseRun: () => void = () => {};
  let resolveStarted: () => void = () => {};
  const started = new Promise<void>((resolve) => {
    resolveStarted = resolve;
  });
  const release = new Promise<void>((resolve) => {
    releaseRun = resolve;
  });
  let notificationCount = 0;
  const unsubscribe = subscribeToDomainSyncCoordinator(domainScope, () => {
    notificationCount += 1;
  });

  const lane = coordinator.registerLane("slow", {
    label: "Slow lane",
    phase: "structural",
    run: async () => {
      resolveStarted();
      await release;
    },
  });

  expect(getDomainSyncCoordinatorSnapshot(domainScope).lanes[0]).toMatchObject({
    key: "slow",
    label: "Slow lane",
    lastAction: "registered",
    phase: "structural",
    status: "idle",
  });

  lane.requestSync();
  expect(getDomainSyncCoordinatorSnapshot(domainScope).lanes[0]).toMatchObject({
    lastAction: "requested",
    requestCount: 1,
    requested: true,
    status: "queued",
  });

  await started;
  expect(getDomainSyncCoordinatorSnapshot(domainScope).lanes[0]).toMatchObject({
    lastAction: "started",
    runCount: 1,
    running: true,
    status: "running",
  });

  releaseRun();
  expect(
    await waitForDomainSyncCoordinatorToSettle(domainScope, {
      intervalMs: 1,
      quietMs: 0,
      timeoutMs: 100,
    }),
  ).toBe(true);

  const completedLane = getDomainSyncCoordinatorSnapshot(domainScope).lanes[0];
  expect(completedLane).toMatchObject({
    errorCount: 0,
    lastAction: "completed",
    requestCount: 1,
    requested: false,
    runCount: 1,
    running: false,
    status: "complete",
  });
  expect(completedLane?.lastCompletedAt).toBeTruthy();
  expect(notificationCount).toBeGreaterThanOrEqual(4);

  unsubscribe();
});

test("sync coordinator snapshots preserve handled lane errors", async () => {
  const domainScope = createDomainScope();
  const coordinator = getOrCreateDomainSyncCoordinator(domainScope);
  const reportedErrors: unknown[] = [];

  coordinator
    .registerLane("failing", {
      onUnexpectedError: (error) => {
        reportedErrors.push(error);
      },
      run: async () => {
        throw new Error("boom");
      },
    })
    .requestSync();

  expect(
    await waitForDomainSyncCoordinatorToSettle(domainScope, {
      intervalMs: 1,
      quietMs: 0,
      timeoutMs: 100,
    }),
  ).toBe(true);

  expect(reportedErrors[0]).toBeInstanceOf(Error);
  const failedLane = getDomainSyncCoordinatorSnapshot(domainScope).lanes[0];
  expect(failedLane).toMatchObject({
    errorCount: 1,
    key: "failing",
    lastAction: "failed",
    lastError: "boom",
    status: "error",
  });
  expect(failedLane?.lastFailedAt).toBeTruthy();
});

test("sync coordinator subscriptions ignore listener failures", async () => {
  const domainScope = createDomainScope();
  const coordinator = getOrCreateDomainSyncCoordinator(domainScope);
  let notifications = 0;
  let runs = 0;

  coordinator.subscribe(() => {
    throw new Error("listener failed");
  });
  coordinator.subscribe(() => {
    notifications += 1;
  });

  const requestSync = coordinator.registerLane("observable", {
    run: async () => {
      runs += 1;
    },
  }).requestSync;

  requestSync();

  expect(
    await waitForDomainSyncCoordinatorToSettle(domainScope, {
      intervalMs: 1,
      quietMs: 0,
      timeoutMs: 100,
    }),
  ).toBe(true);
  expect(notifications).toBeGreaterThan(0);
  expect(runs).toBe(1);
});

test("sync coordinator subscriptions snapshot listeners before notifying", () => {
  const domainScope = createDomainScope();
  const coordinator = getOrCreateDomainSyncCoordinator(domainScope);
  let firstNotifications = 0;
  let secondNotifications = 0;
  let unsubscribeSecond = () => {};

  coordinator.subscribe(() => {
    firstNotifications += 1;
    unsubscribeSecond();
  });
  unsubscribeSecond = coordinator.subscribe(() => {
    secondNotifications += 1;
  });

  coordinator.registerLane("observable", {
    run: async () => {},
  });

  expect(firstNotifications).toBe(1);
  expect(secondNotifications).toBe(1);
});
