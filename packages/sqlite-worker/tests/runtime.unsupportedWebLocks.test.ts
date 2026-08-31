import { expect, test } from "bun:test";
import { createModuleDatabaseRuntime } from "../src/runtime";

type WorkerMessage = {
  readonly id: number;
  readonly method: string;
  readonly params: unknown;
};

class UnsupportedLocksWorker extends EventTarget {
  static lastConstructed: UnsupportedLocksWorker | null = null;
  static lastOptions: WorkerOptions | undefined;
  static lastScriptUrl: string | URL | null = null;

  readonly messages: WorkerMessage[] = [];
  terminated = false;

  constructor(scriptUrl: string | URL, options?: WorkerOptions) {
    super();
    UnsupportedLocksWorker.lastConstructed = this;
    UnsupportedLocksWorker.lastOptions = options;
    UnsupportedLocksWorker.lastScriptUrl = scriptUrl;
  }

  postMessage(message: WorkerMessage): void {
    this.messages.push(message);
  }

  terminate(): void {
    this.terminated = true;
  }
}

async function withoutWebLocks(run: () => Promise<void>): Promise<void> {
  const navigatorValue = Reflect.get(globalThis, "navigator");
  const originalNavigatorDescriptor = Object.getOwnPropertyDescriptor(
    globalThis,
    "navigator",
  );
  const originalLocksDescriptor =
    typeof navigatorValue === "object" && navigatorValue !== null
      ? Object.getOwnPropertyDescriptor(navigatorValue, "locks")
      : undefined;
  const originalWorkerDescriptor = Object.getOwnPropertyDescriptor(
    globalThis,
    "Worker",
  );

  Object.defineProperty(globalThis, "Worker", {
    configurable: true,
    value: UnsupportedLocksWorker,
  });
  if (typeof navigatorValue === "object" && navigatorValue !== null) {
    Object.defineProperty(navigatorValue, "locks", {
      configurable: true,
      value: undefined,
    });
  } else {
    Object.defineProperty(globalThis, "navigator", {
      configurable: true,
      value: {},
    });
  }

  try {
    await run();
  } finally {
    if (originalWorkerDescriptor) {
      Object.defineProperty(globalThis, "Worker", originalWorkerDescriptor);
    } else {
      Reflect.deleteProperty(globalThis, "Worker");
    }
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

test("unsupported Web Locks fall back to a dedicated module worker", async () => {
  await withoutWebLocks(async () => {
    UnsupportedLocksWorker.lastConstructed = null;
    const runtime = createModuleDatabaseRuntime({
      workerUrl: "/unsupported-web-locks.js",
    });
    const worker =
      UnsupportedLocksWorker.lastConstructed as UnsupportedLocksWorker | null;

    expect(worker).not.toBeNull();
    if (!worker) throw new Error("Expected the dedicated worker fallback");
    expect(UnsupportedLocksWorker.lastScriptUrl).toBe(
      "/unsupported-web-locks.js",
    );
    expect(UnsupportedLocksWorker.lastOptions).toEqual({ type: "module" });
    expect(runtime.renewClient).toBeFunction();

    runtime.terminateNow();
    expect(worker.terminated).toBe(true);
  });
});
