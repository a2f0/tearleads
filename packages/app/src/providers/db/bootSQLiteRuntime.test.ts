import { afterEach, expect, test } from "bun:test";
import {
  isLocalSchemaMigrationLockTimeoutError,
  type SQLiteRuntime,
  withLocalSchemaMigrationLock,
} from "@tearleads/client-sdk/sqlite";
import { DATABASE_TRANSACTION_BUSY_MESSAGE } from "@tearleads/sqlite-worker/types";
import {
  completeDeviceReset,
  isWorkerStorageWipePending,
} from "../device-reset/deviceReset";
import { bootSQLiteRuntime } from "./bootSQLiteRuntime";

afterEach(() => {
  localStorage.clear();
});

// The main thread of a WKWebView has no OPFS, so the device reset leaves the
// wipe to the page's first database boot.
async function resetDeviceWithoutMainThreadOpfs(): Promise<void> {
  await completeDeviceReset({
    clearNativeCache: undefined,
    indexedDB: undefined,
    localStorage,
    sessionStorage: undefined,
    wipeOpfs: async () => "unavailable",
  });
}

function createRuntime(init: SQLiteRuntime["client"]["init"]): SQLiteRuntime {
  const client: SQLiteRuntime["client"] = {
    close: async () => ({ ok: true }),
    delete: async () => ({ ok: true }),
    destroy() {},
    exec: async () => ({ ok: true, rows: [] }),
    init,
    ping: async () => ({ ok: true, message: "pong" }),
    wipeStorage: async () => ({ ok: true }),
  };

  return {
    client,
    deleteData: async () => client.destroy(),
    destroy: () => client.destroy(),
    id: "test-runtime",
    terminateNow: () => client.destroy(),
  };
}

test("bootSQLiteRuntime logs cipher-key resolution failures with causes", async () => {
  const logs: string[] = [];
  const cause = new Error("keychain locked");
  const failure = new Error("key unavailable", { cause });
  const runtime = createRuntime(async () => ({ ok: true }));

  await expect(
    bootSQLiteRuntime(
      runtime,
      "test-db",
      "memory",
      async () => {
        throw failure;
      },
      (message) => logs.push(message),
    ),
  ).rejects.toBe(failure);

  expect(logs).toContain(
    "Failed to resolve SQLite cipher key: Error: key unavailable (cause: Error: keychain locked)",
  );
});

test("bootSQLiteRuntime logs SQLite client init failures with causes", async () => {
  const logs: string[] = [];
  const cause = new Error("SQLITE_NOTADB");
  const failure = new Error("worker rejected init", { cause });
  const runtime = createRuntime(async () => {
    throw failure;
  });

  await expect(
    bootSQLiteRuntime(
      runtime,
      "test-db",
      "memory",
      async () => "test-key",
      (message) => logs.push(message),
    ),
  ).rejects.toBe(failure);

  expect(logs).toContain(
    "Failed to initialize SQLite client: Error: worker rejected init (cause: Error: SQLITE_NOTADB)",
  );
});

test("bootSQLiteRuntime logs circular error causes without overflowing", async () => {
  const logs: string[] = [];
  const failure = new Error("key unavailable");
  failure.cause = failure;
  const runtime = createRuntime(async () => ({ ok: true }));

  await expect(
    bootSQLiteRuntime(
      runtime,
      "test-db",
      "memory",
      async () => {
        throw failure;
      },
      (message) => logs.push(message),
    ),
  ).rejects.toBe(failure);

  expect(logs).toContain(
    "Failed to resolve SQLite cipher key: Error: key unavailable (cause: [Circular Error])",
  );
});

test("bootSQLiteRuntime does not wait for an unanswered durable-storage prompt", async () => {
  // Firefox asks the user before granting persistent storage and leaves
  // persist() pending until they answer; boot must not wait on that answer.
  const previousStorage = Object.getOwnPropertyDescriptor(
    globalThis.navigator,
    "storage",
  );
  const calls: string[] = [];
  const prompt = Promise.withResolvers<boolean>();
  Object.defineProperty(globalThis.navigator, "storage", {
    configurable: true,
    value: {
      persisted: async () => false,
      persist: () => {
        calls.push("persist");
        return prompt.promise;
      },
    },
  });
  const storageWarning = Promise.withResolvers<string>();
  const runtime = createRuntime(async () => {
    calls.push("init");
    return { ok: true };
  });

  try {
    await bootSQLiteRuntime(
      runtime,
      "test-db",
      "opfs-sahpool",
      async () => "test-key",
      (message) => {
        if (message.startsWith("Warning: durable storage")) {
          storageWarning.resolve(message);
        }
      },
    );
    expect(calls).toEqual(["persist", "init"]);

    // A later answer is still reported once the user responds.
    prompt.resolve(false);
    expect(await storageWarning.promise).toBe(
      "Warning: durable storage not granted (not-persisted); local data and its encryption keyring may be evicted.",
    );
  } finally {
    if (previousStorage) {
      Object.defineProperty(globalThis.navigator, "storage", previousStorage);
    } else {
      Reflect.deleteProperty(globalThis.navigator, "storage");
    }
  }
});

test("bootSQLiteRuntime migrates the local schema before features run", async () => {
  const statements: string[] = [];
  const runtime = createRuntime(async () => ({ ok: true }));
  runtime.client.exec = async ({ sql }) => {
    statements.push(sql);
    return { ok: true, rows: [] };
  };

  await bootSQLiteRuntime(
    runtime,
    "test-db",
    "memory",
    async () => "test-key",
    () => {},
  );

  expect(
    statements.some((sql) =>
      sql.includes('INSERT INTO "local_schema_migrations"'),
    ),
  ).toBe(true);
});

test("bootSQLiteRuntime runs a step again when another tab's transaction held it off", async () => {
  // The worker refuses a statement that waited out another tab's transaction;
  // failing the boot would spend its retry budget behind that tab's work.
  const statements: string[] = [];
  // The first statement of the readability check and of the migration.
  const refusalsLeft = { migration: 1, probe: 1 };
  const runtime = createRuntime(async () => ({ ok: true }));
  runtime.client.exec = async ({ sql }) => {
    const step =
      sql === "SELECT count(*) FROM sqlite_master" ? "probe" : "migration";
    if (refusalsLeft[step] > 0) {
      refusalsLeft[step] -= 1;
      throw new Error(DATABASE_TRANSACTION_BUSY_MESSAGE);
    }
    statements.push(sql);
    return { ok: true, rows: [] };
  };
  const logs: string[] = [];

  await bootSQLiteRuntime(
    runtime,
    "test-db",
    "opfs-sahpool",
    async () => "test-key",
    (message) => logs.push(message),
  );

  expect(logs).toContain(
    "Another tab held a database transaction during the readability check; retrying.",
  );
  expect(logs).toContain(
    "Another tab held a database transaction during the schema migration; retrying.",
  );
  expect(
    statements.some((sql) =>
      sql.includes('INSERT INTO "local_schema_migrations"'),
    ),
  ).toBe(true);
});

test("bootSQLiteRuntime has the worker wipe OPFS for a device reset before opening the database", async () => {
  await resetDeviceWithoutMainThreadOpfs();
  const calls: string[] = [];
  const runtime = createRuntime(async () => {
    calls.push("init");
    return { ok: true };
  });
  runtime.client.wipeStorage = async () => {
    calls.push("wipeStorage");
    return { ok: true };
  };

  await bootSQLiteRuntime(
    runtime,
    "test-db",
    "memory",
    async () => "test-key",
    () => {},
  );

  expect(calls).toEqual(["wipeStorage", "init"]);
  expect(isWorkerStorageWipePending()).toBe(false);
});

test("bootSQLiteRuntime opens nothing when the device-reset wipe fails, and keeps it pending", async () => {
  await resetDeviceWithoutMainThreadOpfs();
  const failure = new Error(
    "Storage can only be wiped before this worker opens a database.",
  );
  let initialized = false;
  const runtime = createRuntime(async () => {
    initialized = true;
    return { ok: true };
  });
  runtime.client.wipeStorage = async () => {
    throw failure;
  };

  await expect(
    bootSQLiteRuntime(
      runtime,
      "test-db",
      "memory",
      async () => "test-key",
      () => {},
    ),
  ).rejects.toBe(failure);

  expect(initialized).toBe(false);
  expect(isWorkerStorageWipePending()).toBe(true);
});

function installAbortableWebLocks(): () => void {
  const previous = Object.getOwnPropertyDescriptor(navigator, "locks");
  const queues = new Map<
    string,
    Array<{
      readonly callback: () => Promise<unknown>;
      readonly reject: (reason?: unknown) => void;
      readonly resolve: (value: unknown) => void;
      readonly signal?: AbortSignal | undefined;
    }>
  >();
  const held = new Set<string>();
  const pump = (name: string) => {
    if (held.has(name)) return;
    const queue = queues.get(name);
    while (queue && queue.length > 0) {
      const next = queue.shift();
      if (!next) return;
      if (next.signal?.aborted) {
        next.reject(
          next.signal.reason ?? new DOMException("Aborted", "AbortError"),
        );
        continue;
      }
      held.add(name);
      void Promise.resolve()
        .then(next.callback)
        .then(next.resolve, next.reject)
        .finally(() => {
          held.delete(name);
          pump(name);
        });
      return;
    }
  };
  Object.defineProperty(navigator, "locks", {
    configurable: true,
    value: {
      request: (
        name: string,
        optionsOrCallback:
          | (() => Promise<unknown>)
          | { readonly signal?: AbortSignal },
        maybeCallback?: () => Promise<unknown>,
      ) => {
        const callback =
          typeof optionsOrCallback === "function"
            ? optionsOrCallback
            : maybeCallback;
        const signal =
          typeof optionsOrCallback === "function"
            ? undefined
            : optionsOrCallback.signal;
        if (!callback) throw new Error("Missing Web Lock callback");
        if (signal?.aborted) {
          return Promise.reject(
            signal.reason ?? new DOMException("Aborted", "AbortError"),
          );
        }
        return new Promise((resolve, reject) => {
          const entry = { callback, reject, resolve, signal };
          const queue = queues.get(name) ?? [];
          queue.push(entry);
          queues.set(name, queue);
          signal?.addEventListener(
            "abort",
            () => {
              const index = queue.indexOf(entry);
              if (index !== -1) {
                queue.splice(index, 1);
                reject(
                  signal.reason ?? new DOMException("Aborted", "AbortError"),
                );
              }
            },
            { once: true },
          );
          pump(name);
        });
      },
    },
  });
  return () => {
    if (previous) {
      Object.defineProperty(navigator, "locks", previous);
    } else {
      Reflect.deleteProperty(navigator, "locks");
    }
  };
}

test("bootSQLiteRuntime surfaces a retrying state within the bound when another tab holds the migration lock", async () => {
  const uninstall = installAbortableWebLocks();
  let releaseRestore = () => {};
  const restoreReleased = new Promise<void>((resolve) => {
    releaseRestore = resolve;
  });
  let signalRestoreLocked = () => {};
  const restoreLocked = new Promise<void>((resolve) => {
    signalRestoreLocked = resolve;
  });
  let signalWaiting = () => {};
  const waitingObserved = new Promise<void>((resolve) => {
    signalWaiting = resolve;
  });
  let holder: Promise<void> = Promise.resolve();
  const waitingTransitions: boolean[] = [];
  const logs: string[] = [];
  const runtime = createRuntime(async () => ({ ok: true }));

  try {
    holder = withLocalSchemaMigrationLock(async () => {
      signalRestoreLocked();
      await restoreReleased;
    });
    await restoreLocked;

    const startedAt = Date.now();
    const boot = bootSQLiteRuntime(
      runtime,
      "test-db",
      "memory",
      async () => "test-key",
      (message) => logs.push(message),
      {
        lockWaitTimeoutMs: 50,
        onWaitingForAnotherTab: (waiting) => {
          waitingTransitions.push(waiting);
          if (waiting) signalWaiting();
        },
      },
    );

    await waitingObserved;
    expect(Date.now() - startedAt).toBeLessThan(1_000);
    expect(waitingTransitions).toEqual([true]);
    expect(logs).toContain(
      "Another tab holds the local schema migration lock during the schema migration; retrying.",
    );

    releaseRestore();
    await holder;
    await boot;
    expect(waitingTransitions).toEqual([true, false]);
  } finally {
    releaseRestore();
    await holder.catch(() => undefined);
    uninstall();
  }
});

test("bootSQLiteRuntime stops waiting on the migration lock when superseded", async () => {
  const uninstall = installAbortableWebLocks();
  let releaseRestore = () => {};
  const restoreReleased = new Promise<void>((resolve) => {
    releaseRestore = resolve;
  });
  let signalRestoreLocked = () => {};
  const restoreLocked = new Promise<void>((resolve) => {
    signalRestoreLocked = resolve;
  });
  let holder: Promise<void> = Promise.resolve();
  let current = true;
  const runtime = createRuntime(async () => ({ ok: true }));

  try {
    holder = withLocalSchemaMigrationLock(async () => {
      signalRestoreLocked();
      await restoreReleased;
    });
    await restoreLocked;

    const startedAt = Date.now();
    const failure = await bootSQLiteRuntime(
      runtime,
      "test-db",
      "memory",
      async () => "test-key",
      () => {},
      {
        isCurrent: () => current,
        lockWaitTimeoutMs: 50,
        onWaitingForAnotherTab: (waiting) => {
          if (waiting) current = false;
        },
      },
    ).then(
      () => null,
      (error: unknown) => error,
    );
    expect(Date.now() - startedAt).toBeLessThan(1_000);
    expect(isLocalSchemaMigrationLockTimeoutError(failure)).toBe(true);
  } finally {
    releaseRestore();
    await holder.catch(() => undefined);
    uninstall();
  }
});
