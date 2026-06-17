import { expect, test } from "bun:test";
import { createCrossTabDatabaseWorker } from "../src/crossTabRuntime";
import { WORKER_CONNECT_PORT_MESSAGE_TYPE } from "../src/types";

type WorkerMessage = {
  id: number;
  method: string;
  params: unknown;
};

type LockCallback = (lock: unknown) => Promise<void> | void;

// Faithful enough to the Web Locks API for these tests: exclusive locks, granted
// one holder at a time. A blocking request (no `ifAvailable`) for a held lock is
// QUEUED and granted when the holder releases — that queuing is what lets a tab
// be promoted to owner after the previous owner's lock is released, so the mock
// must model it rather than throw.
class MockLockManager {
  readonly heldLockNames = new Set<string>();
  private readonly waitersByName = new Map<string, Array<() => void>>();

  async request(
    name: string,
    optionsOrCallback: { ifAvailable?: true } | LockCallback,
    maybeCallback?: LockCallback,
  ): Promise<void> {
    const callback =
      typeof optionsOrCallback === "function"
        ? optionsOrCallback
        : maybeCallback;
    if (!callback) {
      throw new Error("Missing lock callback.");
    }

    const ifAvailable =
      typeof optionsOrCallback !== "function" &&
      optionsOrCallback.ifAvailable === true;

    if (this.heldLockNames.has(name)) {
      if (ifAvailable) {
        await callback(null);
        return;
      }

      // Block until the current holder releases, then take our turn.
      await new Promise<void>((resolve) => {
        const waiters = this.waitersByName.get(name) ?? [];
        waiters.push(resolve);
        this.waitersByName.set(name, waiters);
      });
    }

    this.heldLockNames.add(name);
    try {
      await callback({ name });
    } finally {
      this.heldLockNames.delete(name);
      const waiters = this.waitersByName.get(name);
      const next = waiters?.shift();
      if (waiters && waiters.length === 0) {
        this.waitersByName.delete(name);
      }
      next?.();
    }
  }

  async query(): Promise<{ held: Array<{ name: string }> }> {
    return {
      held: [...this.heldLockNames].map((name) => ({ name })),
    };
  }

  // Simulate the browser reclaiming a discarded tab's lock: drop the holder and
  // grant the next queued waiter, without running the holder's release path (the
  // holder's tab is gone). Models an owner-tab crash for failover tests.
  forceRelease(name: string): void {
    if (!this.heldLockNames.delete(name)) {
      return;
    }

    const waiters = this.waitersByName.get(name);
    const next = waiters?.shift();
    if (waiters && waiters.length === 0) {
      this.waitersByName.delete(name);
    }
    next?.();
  }
}

class MockBroadcastChannel extends EventTarget {
  private static readonly channelsByName = new Map<
    string,
    Set<MockBroadcastChannel>
  >();

  static reset(): void {
    MockBroadcastChannel.channelsByName.clear();
  }

  constructor(readonly name: string) {
    super();
    const channels = MockBroadcastChannel.channelsByName.get(name) ?? new Set();
    channels.add(this);
    MockBroadcastChannel.channelsByName.set(name, channels);
  }

  close(): void {
    MockBroadcastChannel.channelsByName.get(this.name)?.delete(this);
  }

  postMessage(message: unknown): void {
    for (const channel of MockBroadcastChannel.channelsByName.get(this.name) ??
      []) {
      if (channel === this) {
        continue;
      }

      queueMicrotask(() => {
        channel.dispatchEvent(new MessageEvent("message", { data: message }));
      });
    }
  }
}

class ThrowingWorker extends EventTarget {
  constructor() {
    super();
    throw new Error("worker construction failed");
  }

  postMessage(): void {}

  terminate(): void {}
}

// Accepts port connections like PortAwareWorker but never replies to requests, so
// a routed request stays pending. Used to test what happens to in-flight requests
// when the owner that received them goes away before responding.
class SilentPortWorker extends EventTarget {
  static lastConstructed: SilentPortWorker | null = null;

  readonly ports: MessagePort[] = [];
  terminated = false;

  constructor() {
    super();
    SilentPortWorker.lastConstructed = this;
  }

  postMessage(message: unknown, transfer?: Transferable[]): void {
    if (
      typeof message === "object" &&
      message !== null &&
      Reflect.get(message, "type") === WORKER_CONNECT_PORT_MESSAGE_TYPE
    ) {
      const port = transfer?.[0];
      if (port instanceof MessagePort) {
        this.ports.push(port);
        port.start();
      }
    }
  }

  terminate(): void {
    this.terminated = true;
  }
}

class PortAwareWorker extends EventTarget {
  static lastConstructed: PortAwareWorker | null = null;

  readonly ports: MessagePort[] = [];
  terminated = false;

  constructor() {
    super();
    PortAwareWorker.lastConstructed = this;
  }

  postMessage(message: unknown, transfer?: Transferable[]): void {
    if (
      typeof message === "object" &&
      message !== null &&
      Reflect.get(message, "type") === WORKER_CONNECT_PORT_MESSAGE_TYPE
    ) {
      const port = transfer?.[0];
      if (!(port instanceof MessagePort)) {
        throw new Error("Expected transferred MessagePort.");
      }

      this.ports.push(port);
      port.start();
      port.addEventListener("message", (event) => {
        if (!(event instanceof MessageEvent)) {
          return;
        }

        const request = event.data as WorkerMessage;
        port.postMessage({
          id: request.id,
          result: { ok: true },
        });
      });
    }
  }

  terminate(): void {
    this.terminated = true;
  }
}

function uniqueWorkerUrl(label: string): string {
  return `/worker-${label}-${crypto.randomUUID()}.js`;
}

function requireCrossTabWorker(
  worker: ReturnType<typeof createCrossTabDatabaseWorker>,
): NonNullable<ReturnType<typeof createCrossTabDatabaseWorker>> {
  if (!worker) {
    throw new Error("Expected cross-tab worker to be available.");
  }

  return worker;
}

async function withCrossTabGlobals<T>(
  locks: MockLockManager,
  run: () => Promise<T>,
): Promise<T> {
  const originalBroadcastChannel = globalThis.BroadcastChannel;
  const navigatorValue = Reflect.get(globalThis, "navigator");
  const originalNavigatorDescriptor = Object.getOwnPropertyDescriptor(
    globalThis,
    "navigator",
  );
  const originalLocksDescriptor =
    typeof navigatorValue === "object" && navigatorValue !== null
      ? Object.getOwnPropertyDescriptor(navigatorValue, "locks")
      : undefined;

  Object.defineProperty(globalThis, "BroadcastChannel", {
    configurable: true,
    value: MockBroadcastChannel,
  });

  if (typeof navigatorValue === "object" && navigatorValue !== null) {
    Object.defineProperty(navigatorValue, "locks", {
      configurable: true,
      value: locks,
    });
  } else {
    Object.defineProperty(globalThis, "navigator", {
      configurable: true,
      value: { locks },
    });
  }

  try {
    return await run();
  } finally {
    MockBroadcastChannel.reset();
    Object.defineProperty(globalThis, "BroadcastChannel", {
      configurable: true,
      value: originalBroadcastChannel,
    });

    if (typeof navigatorValue === "object" && navigatorValue !== null) {
      if (originalLocksDescriptor) {
        Object.defineProperty(navigatorValue, "locks", originalLocksDescriptor);
      } else {
        Reflect.deleteProperty(navigatorValue, "locks");
      }
    } else if (originalNavigatorDescriptor) {
      Object.defineProperty(
        globalThis,
        "navigator",
        originalNavigatorDescriptor,
      );
    } else {
      Reflect.deleteProperty(globalThis, "navigator");
    }
  }
}

function waitForMessage(
  worker: {
    addEventListener(type: "message", listener: (event: Event) => void): void;
    removeEventListener(
      type: "message",
      listener: (event: Event) => void,
    ): void;
  },
  timeoutMs = 500,
): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const timeoutId = setTimeout(() => {
      worker.removeEventListener("message", listener);
      reject(new Error("Timed out waiting for worker message."));
    }, timeoutMs);

    const listener = (event: Event) => {
      if (!(event instanceof MessageEvent)) {
        return;
      }

      clearTimeout(timeoutId);
      worker.removeEventListener("message", listener);
      resolve(event.data);
    };

    worker.addEventListener("message", listener);
  });
}

async function waitUntil(
  predicate: () => boolean,
  timeoutMs = 2_000,
): Promise<void> {
  const startedAt = performance.now();
  while (performance.now() - startedAt < timeoutMs) {
    if (predicate()) {
      return;
    }

    await new Promise((resolve) => setTimeout(resolve, 25));
  }

  throw new Error("Timed out waiting for condition.");
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

    worker.close();

    await waitUntil(() => ownerWorker.terminated);
    expect(
      [...locks.heldLockNames].some((name) =>
        name.startsWith("tearleads-sqlite-worker-client:"),
      ),
    ).toBe(false);
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
    locks.forceRelease("tearleads-sqlite-worker-owner");

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
    locks.forceRelease("tearleads-sqlite-worker-owner");

    expect(await pendingResponse).toEqual({
      id: 2,
      result: {
        ok: false,
        message: "The database owner tab changed; retry the request.",
      },
    });
  });
});
