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
