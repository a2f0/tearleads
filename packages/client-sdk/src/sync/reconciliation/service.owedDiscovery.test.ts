import { expect, test } from "bun:test";
import { waitFor } from "../../../test/helpers/data/waitFor";
import { createReconciliationService } from "./service";
import {
  createGate,
  createManualReconciliationClock,
  createOwedLaneHost,
  createReconciliationTestHost,
  perContainerDiscovery,
} from "./service.testFixtures";

const settle = async () => {
  await new Promise((resolve) => setTimeout(resolve, 0));
};

test("resuming owed discovery lists exactly the owed lanes once", async () => {
  const discovered: string[] = [];
  const service = createReconciliationService(
    createReconciliationTestHost({
      discoverContainerDocuments: perContainerDiscovery(async (containerId) => {
        discovered.push(containerId);
        return [];
      }),
      listKnownContainerIds: () => ["settled", "owed-a", "owed-b"],
      listOwedDocumentDiscoveryContainerIds: async () => ["owed-a", "owed-b"],
    }),
  );
  try {
    service.start();
    service.resumeOwedDiscovery();
    await waitFor(() => discovered.length === 2, "Owed lanes were not listed");
    expect(discovered.toSorted()).toEqual(["owed-a", "owed-b"]);

    // A lane this session already reconciled is not listed again unforced.
    service.resumeOwedDiscovery();
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(discovered).toHaveLength(2);
  } finally {
    service.stop();
  }
});

test("a stopped reconciler drops an owed lookup that resolves late", async () => {
  const lookup = createGate();
  const discovered: string[] = [];
  const service = createReconciliationService(
    createReconciliationTestHost({
      discoverContainerDocuments: perContainerDiscovery(async (containerId) => {
        discovered.push(containerId);
        return [];
      }),
      listOwedDocumentDiscoveryContainerIds: async () => {
        await lookup.wait;
        return ["owed"];
      },
    }),
  );
  service.start();
  service.resumeOwedDiscovery();
  service.stop();
  service.start();
  lookup.open();
  await new Promise((resolve) => setTimeout(resolve, 20));
  service.stop();
  expect(discovered).toEqual([]);
});

test("a failed owed lookup is reported, and an ignorable one is not", async () => {
  for (const ignorable of [false, true]) {
    const failure = new Error("database closed");
    const reports: unknown[] = [];
    const service = createReconciliationService(
      createReconciliationTestHost({
        isIgnorableError: (error) => ignorable && error === failure,
        listOwedDocumentDiscoveryContainerIds: () => Promise.reject(failure),
        logError: (message, error) => {
          reports.push([message, error]);
        },
      }),
    );
    try {
      service.start();
      service.resumeOwedDiscovery();
      await new Promise((resolve) => setTimeout(resolve, 10));
      expect(reports).toEqual(
        ignorable
          ? []
          : [["Reconciliation: owed discovery lookup failed", failure]],
      );
    } finally {
      service.stop();
    }
  }
});

test("unacknowledged catch-up crawls the tree, lists only owed lanes, and wakes owed reads", async () => {
  let owed: ReadonlyArray<string> = [];
  let crawls = 0;
  const { host, listings, steps } = createOwedLaneHost({
    owed: () => owed,
    overrides: {
      crawlTreeForCatchUp: async () => {
        crawls += 1;
        // Simulate the server container row for `b` moving past watermark.
        owed = ["b"];
        return true;
      },
    },
  });
  const service = createReconciliationService(host);
  try {
    service.start();
    service.resumeOwedDiscovery();
    await waitFor(() => steps.length === 1, "Unacknowledged sweep did not run");
    expect(crawls).toBe(1);
    expect(listings).toEqual([["b"]]);
    expect(steps).toEqual(["owed-reads"]);

    // Untouched lanes were vouched for by the complete crawl.
    service.enqueueContainer("a", "idle");
    service.enqueueContainer("c", "idle");
    await settle();
    expect(listings).toEqual([["b"]]);
  } finally {
    service.stop();
  }
});

test("unacknowledged catch-up falls back to every known lane when the tree crawl is incomplete", async () => {
  const { host, listings, steps } = createOwedLaneHost({
    owed: () => ["b"],
    overrides: {
      crawlTreeForCatchUp: async () => false,
    },
  });
  const service = createReconciliationService(host);
  try {
    service.start();
    service.resumeOwedDiscovery();
    await waitFor(
      () => steps.length === 1,
      "Fallback unacknowledged sweep did not run",
    );
    expect(listings).toEqual([["a", "b", "c"]]);
    expect(steps).toEqual(["owed-reads"]);
  } finally {
    service.stop();
  }
});

test("periodic catch-up polls across flapping reconnects and cancels on connect, offline, or stop", async () => {
  const clock = createManualReconciliationClock();
  const listeners = new Set<() => void>();
  const notify = () => {
    for (const listener of listeners) listener();
  };
  let status = {
    dbStatus: "ready",
    isAuthenticated: true,
    online: true,
    serverEventsConnected: false,
  };
  let crawls = 0;
  let owed: ReadonlyArray<string> = [];
  const { host, listings } = createOwedLaneHost({
    owed: () => owed,
    overrides: {
      clock,
      crawlTreeForCatchUp: async () => {
        crawls += 1;
        return true;
      },
      getRuntimeStatus: () => status,
      subscribeConnectionStatus: (listener) => {
        listeners.add(listener);
        return () => {
          listeners.delete(listener);
        };
      },
      unacknowledgedCatchUpIntervalMs: 1_000,
    },
  });
  const service = createReconciliationService(host);
  try {
    service.start();
    // Quiet first tick: crawls tree, 0 document listings on untouched folders.
    clock.advance(1_000);
    await settle();
    expect(crawls).toBe(1);
    expect(listings).toEqual([]);

    // Reconnect churn while still unacknowledged must not starve periodic catch-up.
    owed = ["c"];
    notify();
    clock.advance(600);
    notify();
    clock.advance(400);
    await settle();
    expect(crawls).toBe(2);
    expect(listings).toEqual([["c"]]);

    // Connecting cancels periodic polling immediately.
    status = { ...status, serverEventsConnected: true };
    notify();
    clock.advance(5_000);
    await settle();
    expect(crawls).toBe(2);

    // Dropping the socket re-arms periodic catch-up; going offline cancels it.
    owed = [];
    status = { ...status, serverEventsConnected: false };
    notify();
    status = { ...status, online: false };
    notify();
    clock.advance(5_000);
    await settle();
    expect(crawls).toBe(2);

    // Coming back online while still unacknowledged resumes periodic polling.
    status = { ...status, online: true };
    notify();
    clock.advance(1_000);
    await settle();
    expect(crawls).toBe(3);
  } finally {
    service.stop();
  }
  // Stopping cancels any scheduled timer.
  clock.advance(5_000);
  await settle();
  expect(crawls).toBe(3);
});

test("resumeOwedDiscovery while unauthenticated or offline does not fire an immediate sweep on regain", async () => {
  const clock = createManualReconciliationClock();
  const listeners = new Set<() => void>();
  let isAuthenticated = false;
  let crawls = 0;
  const { host, listings } = createOwedLaneHost({
    owed: () => ["b"],
    overrides: {
      clock,
      crawlTreeForCatchUp: async () => {
        crawls += 1;
        return true;
      },
      getRuntimeStatus: () => ({
        dbStatus: "ready",
        isAuthenticated,
        online: true,
        serverEventsConnected: false,
      }),
      subscribeConnectionStatus: (listener) => {
        listeners.add(listener);
        return () => {
          listeners.delete(listener);
        };
      },
      unacknowledgedCatchUpIntervalMs: 1_000,
    },
  });
  const service = createReconciliationService(host);
  try {
    service.start();
    service.resumeOwedDiscovery();
    await settle();
    expect(crawls).toBe(0);

    // Auth gain lets prerequisites-regained / connectAttemptWaitMachine lead
    // instead of firing an immediate sweep; periodic polling still arms if
    // the connection stays unacknowledged.
    isAuthenticated = true;
    for (const listener of listeners) listener();
    await settle();
    expect(crawls).toBe(0);

    clock.advance(1_000);
    await settle();
    expect(crawls).toBe(1);
    expect(listings).toEqual([["b"]]);
  } finally {
    service.stop();
  }
});

test("resumeOwedDiscovery and periodic polling defer to acknowledged control and startup attempt", async () => {
  const clock = createManualReconciliationClock();
  const listeners = new Set<() => void>();
  const notify = () => {
    for (const listener of listeners) listener();
  };
  let status = {
    dbStatus: "ready",
    isAuthenticated: true,
    online: true,
    serverEventsConnected: false,
    serverEventsPendingConnectAttempt: 1 as number | undefined,
  };
  let crawls = 0;
  const { host } = createOwedLaneHost({
    owed: () => ["a"],
    overrides: {
      clock,
      crawlTreeForCatchUp: async () => {
        crawls += 1;
        return true;
      },
      getRuntimeStatus: () => status,
      subscribeConnectionStatus: (listener) => {
        listeners.add(listener);
        return () => {
          listeners.delete(listener);
        };
      },
      unacknowledgedCatchUpIntervalMs: 1_000,
    },
  });
  const service = createReconciliationService(host);
  try {
    // Initial pending connect attempt holds periodic polling until settled.
    service.start();
    clock.advance(5_000);
    await settle();
    expect(crawls).toBe(0);

    // Already-connected session ignores stale resumeOwedDiscovery signals.
    status = {
      ...status,
      serverEventsConnected: true,
      serverEventsPendingConnectAttempt: undefined,
    };
    notify();
    service.resumeOwedDiscovery();
    await settle();
    expect(crawls).toBe(0);
  } finally {
    service.stop();
  }
});

test("stop during start leaves no leaked connection-status listener, and rejecting logError is contained", async () => {
  const listeners = new Set<() => void>();
  const host = createReconciliationTestHost({
    crawlTreeForCatchUp: async () => {
      throw new Error("crawl boom");
    },
    logError: () => Promise.reject(new Error("logger boom")),
    registerLane: (_key, config) => {
      // Simulate synchronous scope disposal during lane registration.
      service.stop();
      return createReconciliationTestHost().registerLane("test", config);
    },
    subscribeConnectionStatus: (listener) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
  });
  const service = createReconciliationService(host);
  service.start();
  expect(listeners.size).toBe(0);

  // Separate healthy service: rejecting logError on sweep failure is swallowed.
  const failingHost = createReconciliationTestHost({
    crawlTreeForCatchUp: async () => {
      throw new Error("crawl boom");
    },
    logError: () => Promise.reject(new Error("logger boom")),
  });
  const failingService = createReconciliationService(failingHost);
  try {
    failingService.start();
    failingService.resumeOwedDiscovery();
    await settle();
  } finally {
    failingService.stop();
  }
});
