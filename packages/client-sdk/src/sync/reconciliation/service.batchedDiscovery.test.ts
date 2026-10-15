import { expect, test } from "bun:test";
import { waitFor } from "../../../test/helpers/waitFor";
import { markContainerForced } from "./idleBackfill";
import { createInitialDocumentProbe } from "./initialDocumentProbe";
import { sweepKnownContainers } from "./knownContainerSweep";
import { createReconcileQueue } from "./queue";
import { createReconciliationService } from "./service";
import {
  createReconciliationTestHost,
  perContainerDiscovery,
} from "./service.testFixtures";

test("a lane run lists up to four queued containers in one discovery", async () => {
  const batches: string[][] = [];
  const service = createReconciliationService(
    createReconciliationTestHost({
      discoverContainerDocuments: async (requests, onOutcome) => {
        batches.push(requests.map((request) => request.containerId));
        return perContainerDiscovery(async () => [])(requests, onOutcome);
      },
    }),
  );
  try {
    for (const containerId of ["a", "b", "c", "d", "e"]) {
      service.enqueueContainer(containerId, "idle");
    }
    service.start();
    await waitFor(() => batches.flat().length === 5, "all containers listed");
    expect(batches).toEqual([["a", "b", "c", "d"], ["e"]]);
  } finally {
    service.stop();
  }
});

test("a sweep lists every known container per batched request", async () => {
  const knownIds = Array.from({ length: 33 }, (_, index) => `c-${index}`);
  const batches: number[] = [];
  const service = createReconciliationService(
    createReconciliationTestHost({
      discoverContainerDocuments: async (requests, onOutcome) => {
        batches.push(requests.length);
        return perContainerDiscovery(async () => [])(requests, onOutcome);
      },
      listKnownContainerIds: () => knownIds,
    }),
  );
  try {
    service.start();
    await service.reconcileNow();
    // The protocol bound is 32 lanes per request.
    expect(batches).toEqual([32, 1]);
  } finally {
    service.stop();
  }
});

test("a force recorded after a batched listing started survives the batch", async () => {
  const host = createReconciliationTestHost();
  const state = {
    active: true,
    activeContainerId: null,
    automaticRetryGenerations: new Map<string, number>(),
    discoveredContainerIds: new Set<string>(),
    forcedDocumentIds: new Map(),
    forcedContainerGenerations: new Map<string, number>(),
    initialDocumentProbe: createInitialDocumentProbe(host),
    nextForceGeneration: 0,
    queue: createReconcileQueue(),
    lifecycleGeneration: 1,
    lane: { requestSync: () => {}, requestSyncAfter: () => {} },
  };
  markContainerForced(state, "early");
  const discover = perContainerDiscovery(async () => []);
  host.discoverContainerDocuments = (requests, onOutcome) =>
    discover(requests, async (outcome) => {
      // The batch's single listing request has already been answered; a hint
      // for a later lane now records a newer force before that lane settles.
      if (outcome.containerId === "early") markContainerForced(state, "late");
      await onOutcome(outcome);
    });

  await sweepKnownContainers({
    forceAllDocumentContentPulls: false,
    host,
    knownIds: ["early", "late"],
    lifecycleGeneration: 1,
    state,
  });

  // The listing predates the late hint, so only the early force is settled.
  expect(state.forcedContainerGenerations.has("early")).toBe(false);
  expect(state.forcedContainerGenerations.has("late")).toBe(true);
});
