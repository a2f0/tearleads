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
