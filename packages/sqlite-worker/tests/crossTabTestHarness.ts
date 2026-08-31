import type { createCrossTabDatabaseWorker } from "../src/crossTabRuntime";
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
export class MockLockManager {
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

  private readonly pendingMessages: unknown[] = [];
  private suspended = false;

  static reset(): void {
    MockBroadcastChannel.channelsByName.clear();
  }

  static first(): MockBroadcastChannel | null {
    const channels = MockBroadcastChannel.channelsByName.values().next().value;
    return channels?.values().next().value ?? null;
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

      channel.receive(message);
    }
  }

  suspend(): void {
    this.suspended = true;
  }

  resume(): void {
    this.suspended = false;
    for (const message of this.pendingMessages.splice(0)) {
      this.dispatch(message);
    }
  }

  get pendingMessageCount(): number {
    return this.pendingMessages.length;
  }

  private receive(message: unknown): void {
    if (this.suspended) {
      this.pendingMessages.push(message);
      return;
    }

    this.dispatch(message);
  }

  private dispatch(message: unknown): void {
    queueMicrotask(() => {
      this.dispatchEvent(new MessageEvent("message", { data: message }));
    });
  }
}

interface BroadcastChannelSuspension {
  readonly pendingMessageCount: number;
  resume(): void;
}

export function suspendFirstCrossTabChannel(): BroadcastChannelSuspension {
  const channel = MockBroadcastChannel.first();
  if (!channel) {
    throw new Error("Expected a cross-tab broadcast channel.");
  }

  channel.suspend();
  return {
    get pendingMessageCount() {
      return channel.pendingMessageCount;
    },
    resume() {
      channel.resume();
    },
  };
}

export class ThrowingWorker extends EventTarget {
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
export class SilentPortWorker extends EventTarget {
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

export class PortAwareWorker extends EventTarget {
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

export function uniqueWorkerUrl(label: string): string {
  return `/worker-${label}-${crypto.randomUUID()}.js`;
}

export function requireCrossTabWorker(
  worker: ReturnType<typeof createCrossTabDatabaseWorker>,
): NonNullable<ReturnType<typeof createCrossTabDatabaseWorker>> {
  if (!worker) {
    throw new Error("Expected cross-tab worker to be available.");
  }

  return worker;
}

export async function withCrossTabGlobals<T>(
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

export function waitForMessage(
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

export async function waitUntil(
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
