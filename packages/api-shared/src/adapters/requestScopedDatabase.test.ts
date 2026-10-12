import { expect, test } from "bun:test";
import { createRequestScopedDatabaseRuntime } from "./requestScopedDatabase";
import type { ApiDatabase, ManagedApiDatabase } from "./types";

interface FakeDatabase extends ManagedApiDatabase {
  readonly name: string;
  readonly closed: () => boolean;
}

function fakeDatabase(name: string): FakeDatabase {
  let closed = false;
  const db = {
    name,
    async transaction<T>(callback: (tx: ApiDatabase) => Promise<T>) {
      return callback(db as unknown as ApiDatabase);
    },
  };
  return {
    name,
    closed: () => closed,
    db: db as unknown as ApiDatabase,
    kind: "postgres",
    close: async () => {
      closed = true;
    },
    migrate: async () => {},
  };
}

function nameOf(db: ApiDatabase): string {
  return (db as unknown as { readonly name: string }).name;
}

test("concurrent requests each see their own database through one handle", async () => {
  let created = 0;
  const fallback = fakeDatabase("fallback");
  const runtime = createRequestScopedDatabaseRuntime({
    create: () => fakeDatabase(`request-${++created}`),
    fallback,
  });
  const release = Promise.withResolvers<void>();
  const first = runtime.run(async () => {
    const before = nameOf(runtime.db);
    await release.promise;
    return [before, nameOf(runtime.db)];
  });
  const second = runtime.run(async () => nameOf(runtime.db));
  expect(await second).toBe("request-2");
  release.resolve();
  expect(await first).toEqual(["request-1", "request-1"]);
  expect(nameOf(runtime.db)).toBe("fallback");
});

test("the handle binds methods to the current database, including inside a transaction", async () => {
  const runtime = createRequestScopedDatabaseRuntime({
    create: () => fakeDatabase("request"),
    fallback: fakeDatabase("fallback"),
  });
  const seen = await runtime.run(() =>
    runtime.db.transaction(async (tx) => nameOf(tx)),
  );
  expect(seen).toBe("request");
});

test("the request database closes after success and after failure, via settle", async () => {
  const databases: FakeDatabase[] = [];
  const runtime = createRequestScopedDatabaseRuntime({
    create: () => {
      const database = fakeDatabase(`request-${databases.length + 1}`);
      databases.push(database);
      return database;
    },
    fallback: fakeDatabase("fallback"),
  });
  const closings: Promise<void>[] = [];
  const settle = (closing: Promise<void>) => {
    closings.push(closing);
  };
  await runtime.run(async () => "ok", settle);
  await expect(
    runtime.run(async () => {
      throw new Error("request failed");
    }, settle),
  ).rejects.toThrow("request failed");
  await Promise.all(closings);
  expect(databases.map((database) => database.closed())).toEqual([true, true]);
  expect(closings).toHaveLength(2);
});

test("a failing close is reported without failing the request", async () => {
  const runtime = createRequestScopedDatabaseRuntime({
    create: () => ({
      ...fakeDatabase("request"),
      close: async () => {
        throw new Error("close failed");
      },
    }),
    fallback: fakeDatabase("fallback"),
  });
  let closing: Promise<void> | undefined;
  const result = await runtime.run(
    async () => "ok",
    (promise) => {
      closing = promise;
    },
  );
  expect(result).toBe("ok");
  await expect(closing).resolves.toBeUndefined();
});
