import { expect, test } from "bun:test";
import { createCrossTabDatabaseWorker } from "../src/crossTabRuntime";
import {
  MockLockManager,
  PortAwareWorker,
  requireCrossTabWorker,
  SilentPortWorker,
  ThrowingWorker,
  uniqueWorkerUrl,
  waitForMessage,
  waitUntil,
  withCrossTabGlobals,
} from "./crossTabTestHarness";

class TransientThrowingWorker extends PortAwareWorker {
  static throwNext = true;

  constructor() {
    if (TransientThrowingWorker.throwNext) {
      TransientThrowingWorker.throwNext = false;
      throw new Error("transient worker construction failed");
    }

    super();
  }
}

test("cross-tab owner acquisition reports worker construction failures instead of hanging", async () => {
  await withCrossTabGlobals(new MockLockManager(), async () => {
    const worker = requireCrossTabWorker(
      createCrossTabDatabaseWorker(uniqueWorkerUrl("throwing"), ThrowingWorker),
    );

    const response = waitForMessage(worker);
    worker.postMessage({ id: 1, method: "ping", params: undefined });

    expect(await response).toEqual({
      id: 1,
      result: {
        ok: false,
        message: "worker construction failed",
      },
    });
  });
});

test("a new same-tab client retries after transient owner construction failure", async () => {
  const locks = new MockLockManager();

  await withCrossTabGlobals(locks, async () => {
    TransientThrowingWorker.throwNext = true;
    PortAwareWorker.lastConstructed = null;
    const workerUrl = uniqueWorkerUrl("transient-owner-error");

    const firstWorker = requireCrossTabWorker(
      createCrossTabDatabaseWorker(workerUrl, TransientThrowingWorker),
    );
    const failedResponse = waitForMessage(firstWorker);
    firstWorker.postMessage({ id: 1, method: "ping", params: undefined });
    expect(await failedResponse).toEqual({
      id: 1,
      result: {
        ok: false,
        message: "transient worker construction failed",
      },
    });

    const secondWorker = requireCrossTabWorker(
      createCrossTabDatabaseWorker(workerUrl, TransientThrowingWorker),
    );
    const recoveredResponse = waitForMessage(secondWorker);
    secondWorker.postMessage({ id: 2, method: "ping", params: undefined });

    expect(await recoveredResponse).toEqual({ id: 2, result: { ok: true } });
    expect(PortAwareWorker.lastConstructed).toBeInstanceOf(
      TransientThrowingWorker,
    );
  });
});

test("a tab whose worker fails to construct falls back to a healthy owner tab", async () => {
  // One tab's owner worker throws on construction; another tab's worker is fine.
  // The failed tab must not brick itself on the construction error — once a
  // healthy owner exists elsewhere, its requests route remotely to that owner.
  const locks = new MockLockManager();

  await withCrossTabGlobals(locks, async () => {
    PortAwareWorker.lastConstructed = null;

    const failingWorker = requireCrossTabWorker(
      createCrossTabDatabaseWorker(uniqueWorkerUrl("fail-a"), ThrowingWorker),
    );
    const healthyWorker = requireCrossTabWorker(
      createCrossTabDatabaseWorker(uniqueWorkerUrl("ok-b"), PortAwareWorker),
    );

    // The healthy tab takes ownership (the failing tab releases the lock when its
    // worker construction throws), then serves the failing tab's request remotely.
    const healthyResponse = waitForMessage(healthyWorker);
    healthyWorker.postMessage({ id: 1, method: "ping", params: undefined });
    expect(await healthyResponse).toEqual({ id: 1, result: { ok: true } });

    const failingResponse = waitForMessage(failingWorker, 3_000);
    failingWorker.postMessage({ id: 2, method: "ping", params: undefined });
    expect(await failingResponse).toEqual({ id: 2, result: { ok: true } });
  });
});

test("cross-tab owner drops a client whose lifetime lock disappears", async () => {
  const locks = new MockLockManager();

  await withCrossTabGlobals(locks, async () => {
    PortAwareWorker.lastConstructed = null;
    const worker = requireCrossTabWorker(
      createCrossTabDatabaseWorker(uniqueWorkerUrl("sweep"), PortAwareWorker),
    );

    const response = waitForMessage(worker);
    worker.postMessage({ id: 1, method: "ping", params: undefined });
    expect(await response).toEqual({
      id: 1,
      result: { ok: true },
    });

    const ownerWorker =
      PortAwareWorker.lastConstructed as PortAwareWorker | null;
    if (!ownerWorker) {
      throw new Error("Expected cross-tab owner worker to be constructed.");
    }

    expect(ownerWorker.terminated).toBe(false);
    expect(ownerWorker.ports).toHaveLength(1);

    // The client goes away: its liveness lock is released and the sweep drops it.
    worker.close();

    await waitUntil(
      () =>
        ![...locks.heldLockNames].some((name) =>
          name.startsWith("symcrypt-sqlite-worker-client:"),
        ),
    );

    // The owner worker stays alive even with no clients: under the single lifelong
    // ownership bid it must not release the owner lock (and re-contention never
    // happens), so a reopened client reuses it instead of being stranded.
    expect(ownerWorker.terminated).toBe(false);
  });
});

test("an explicit close tears the owner down once its last client is gone", async () => {
  // Unlike a client that merely vanishes, an explicit `close`/`delete` is teardown
  // (logout / forget-local-data): once the last client closes, the owner worker is
  // terminated and the owner lock released so the freed OPFS handles are available
  // to the next boot.
  const locks = new MockLockManager();

  await withCrossTabGlobals(locks, async () => {
    PortAwareWorker.lastConstructed = null;
    const worker = requireCrossTabWorker(
      createCrossTabDatabaseWorker(
        uniqueWorkerUrl("teardown"),
        PortAwareWorker,
      ),
    );

    const ready = waitForMessage(worker);
    worker.postMessage({ id: 1, method: "ping", params: undefined });
    expect(await ready).toEqual({ id: 1, result: { ok: true } });

    const ownerWorker =
      PortAwareWorker.lastConstructed as PortAwareWorker | null;
    if (!ownerWorker) {
      throw new Error("Expected cross-tab owner worker to be constructed.");
    }
    expect(ownerWorker.terminated).toBe(false);

    const closed = waitForMessage(worker);
    worker.postMessage({ id: 2, method: "close", params: undefined });
    expect(await closed).toEqual({ id: 2, result: { ok: true } });

    await waitUntil(() => ownerWorker.terminated);
    // The owner lock releases a microtask after stop() (the blocking bid's callback
    // returns), so wait for the release rather than asserting synchronously.
    await waitUntil(
      () => !locks.heldLockNames.has("symcrypt-sqlite-worker-owner"),
    );
  });
});

test("a same-tab client can reopen after an explicit close tears the owner down", async () => {
  // Routed/windowed mode switches can close every current SQLite client and then
  // mount a replacement client in the same page. The coordinator must start a
  // fresh owner bid for that later client instead of broadcasting into a page
  // that no longer has an owner.
  const locks = new MockLockManager();

  await withCrossTabGlobals(locks, async () => {
    const workerUrl = uniqueWorkerUrl("same-tab-reopen");
    PortAwareWorker.lastConstructed = null;
    const firstWorker = requireCrossTabWorker(
      createCrossTabDatabaseWorker(workerUrl, PortAwareWorker),
    );

    const ready = waitForMessage(firstWorker);
    firstWorker.postMessage({ id: 1, method: "ping", params: undefined });
    expect(await ready).toEqual({ id: 1, result: { ok: true } });

    const firstOwnerWorker =
      PortAwareWorker.lastConstructed as PortAwareWorker | null;
    if (!firstOwnerWorker) {
      throw new Error("Expected the first owner worker to be constructed.");
    }

    const closed = waitForMessage(firstWorker);
    firstWorker.postMessage({ id: 2, method: "close", params: undefined });
    expect(await closed).toEqual({ id: 2, result: { ok: true } });
    firstWorker.close();

    await waitUntil(() => firstOwnerWorker.terminated);
    await waitUntil(
      () => !locks.heldLockNames.has("symcrypt-sqlite-worker-owner"),
    );

    const secondWorker = requireCrossTabWorker(
      createCrossTabDatabaseWorker(workerUrl, PortAwareWorker),
    );
    const reopened = waitForMessage(secondWorker);
    secondWorker.postMessage({ id: 3, method: "ping", params: undefined });

    expect(await reopened).toEqual({ id: 3, result: { ok: true } });
    expect(PortAwareWorker.lastConstructed).not.toBe(firstOwnerWorker);
  });
});

test("a surviving tab is promoted to owner after the owner tab releases", async () => {
  // Two coordinators (two tabs) share one lock manager + broadcast channel. The
  // first wins ownership and serves both tabs' requests. When it releases the
  // owner lock (its tab is discarded), the second tab must be promoted and serve
  // requests itself — no stranded tab, no reliance on the request timeout.
  const locks = new MockLockManager();

  await withCrossTabGlobals(locks, async () => {
    PortAwareWorker.lastConstructed = null;

    const firstWorker = requireCrossTabWorker(
      createCrossTabDatabaseWorker(uniqueWorkerUrl("owner-a"), PortAwareWorker),
    );
    const firstResponse = waitForMessage(firstWorker);
    firstWorker.postMessage({ id: 1, method: "ping", params: undefined });
    expect(await firstResponse).toEqual({ id: 1, result: { ok: true } });

    const firstOwnerWorker =
      PortAwareWorker.lastConstructed as PortAwareWorker | null;
    if (!firstOwnerWorker) {
      throw new Error("Expected the first owner worker to be constructed.");
    }

    // Second tab joins. It loses the ownership race, so its requests are routed
    // over the channel to the first tab's owner worker (which now serves 2 ports).
    const secondWorker = requireCrossTabWorker(
      createCrossTabDatabaseWorker(uniqueWorkerUrl("owner-b"), PortAwareWorker),
    );
    const secondResponse = waitForMessage(secondWorker);
    secondWorker.postMessage({ id: 2, method: "ping", params: undefined });
    expect(await secondResponse).toEqual({ id: 2, result: { ok: true } });
    expect(firstOwnerWorker.ports).toHaveLength(2);

    // The owner tab crashes: the browser reclaims its owner lock without the
    // graceful stop path running (the tab — and its worker — are simply gone).
    locks.forceRelease("symcrypt-sqlite-worker-owner");

    // The second tab must now be promoted: its queued bid is granted, a NEW owner
    // worker is constructed, and it serves the second tab's subsequent requests.
    await waitUntil(() => PortAwareWorker.lastConstructed !== firstOwnerWorker);
    const secondOwnerWorker =
      PortAwareWorker.lastConstructed as PortAwareWorker | null;
    if (!secondOwnerWorker || secondOwnerWorker === firstOwnerWorker) {
      throw new Error("Expected the second tab to be promoted to owner.");
    }

    const promotedResponse = waitForMessage(secondWorker);
    secondWorker.postMessage({ id: 3, method: "ping", params: undefined });
    expect(await promotedResponse).toEqual({ id: 3, result: { ok: true } });
    expect(secondOwnerWorker.terminated).toBe(false);
  });
});

test("a tab that loses the cold-start ownership race still routes its requests", async () => {
  // Two tabs are created in the same tick, before any owner exists. One wins the
  // ownership bid; the other must still observe that an owner now exists and route
  // its request to it, rather than wedging on a gate that a single owner-lock
  // query (taken before anyone owned) would never settle.
  const locks = new MockLockManager();

  await withCrossTabGlobals(locks, async () => {
    PortAwareWorker.lastConstructed = null;

    const firstWorker = requireCrossTabWorker(
      createCrossTabDatabaseWorker(uniqueWorkerUrl("cold-a"), PortAwareWorker),
    );
    const secondWorker = requireCrossTabWorker(
      createCrossTabDatabaseWorker(uniqueWorkerUrl("cold-b"), PortAwareWorker),
    );

    // Both tabs issue a request immediately, racing the ownership election.
    const firstResponse = waitForMessage(firstWorker);
    const secondResponse = waitForMessage(secondWorker);
    firstWorker.postMessage({ id: 1, method: "ping", params: undefined });
    secondWorker.postMessage({ id: 2, method: "ping", params: undefined });

    expect(await firstResponse).toEqual({ id: 1, result: { ok: true } });
    expect(await secondResponse).toEqual({ id: 2, result: { ok: true } });
  });
});

test("promotion fails a tab's in-flight remote requests instead of waiting out the timeout", async () => {
  // A request routed to the owner that never answers (its tab is about to crash)
  // must not hang for the full timeout. When the surviving tab is promoted, it
  // fails its own orphaned in-flight requests with a retryable error right away.
  const locks = new MockLockManager();

  await withCrossTabGlobals(locks, async () => {
    SilentPortWorker.lastConstructed = null;

    // First tab wins ownership; its owner worker accepts ports but never replies.
    const firstWorker = requireCrossTabWorker(
      createCrossTabDatabaseWorker(
        uniqueWorkerUrl("silent-a"),
        SilentPortWorker,
      ),
    );
    firstWorker.postMessage({ id: 1, method: "ping", params: undefined });
    await waitUntil(() => SilentPortWorker.lastConstructed !== null);
    const firstOwnerWorker =
      SilentPortWorker.lastConstructed as SilentPortWorker | null;

    // Second tab loses the race and routes a request to the (silent) owner, where
    // it sits unanswered.
    const secondWorker = requireCrossTabWorker(
      createCrossTabDatabaseWorker(
        uniqueWorkerUrl("silent-b"),
        SilentPortWorker,
      ),
    );
    const pendingResponse = waitForMessage(secondWorker, 2_000);
    secondWorker.postMessage({
      id: 2,
      method: "exec",
      params: { sql: "SELECT 1" },
    });

    // Give the request time to reach the owner and be recorded as in-flight.
    await waitUntil(() => (firstOwnerWorker?.ports.length ?? 0) >= 1);

    // The owner tab crashes before answering. The second tab is promoted and must
    // fail its orphaned request promptly (well under the 10s request timeout).
    locks.forceRelease("symcrypt-sqlite-worker-owner");

    expect(await pendingResponse).toEqual({
      id: 2,
      result: {
        ok: false,
        message: "The database owner tab changed; retry the request.",
      },
    });
  });
});
