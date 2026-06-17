import { expect, test } from "bun:test";
import { createCrossTabDatabaseWorker } from "../src/crossTabRuntime";
import { WORKER_CONNECT_PORT_MESSAGE_TYPE } from "../src/types";

type WorkerMessage = {
  id: number;
  method: string;
  params: unknown;
};

type LockCallback = (lock: unknown) => Promise<void> | void;

class MockLockManager {
  readonly heldLockNames = new Set<string>();

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

      throw new Error(`Lock already held: ${name}`);
    }

    this.heldLockNames.add(name);
    try {
      await callback({ name });
    } finally {
      this.heldLockNames.delete(name);
    }
  }

  async query(): Promise<{ held: Array<{ name: string }> }> {
    return {
      held: [...this.heldLockNames].map((name) => ({ name })),
    };
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
