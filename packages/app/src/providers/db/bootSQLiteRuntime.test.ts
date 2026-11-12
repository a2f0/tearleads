import { expect, test } from "bun:test";
import type { SQLiteRuntime } from "@tearleads/client-sdk/sqlite";
import { bootSQLiteRuntime } from "./bootSQLiteRuntime";

function createRuntime(init: SQLiteRuntime["client"]["init"]): SQLiteRuntime {
  const client: SQLiteRuntime["client"] = {
    close: async () => ({ ok: true }),
    delete: async () => ({ ok: true }),
    destroy() {},
    exec: async () => ({ ok: true, rows: [] }),
    init,
    ping: async () => ({ ok: true, message: "pong" }),
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
