import { expect, test } from "bun:test";
import { execDatabaseStatement } from "@symcrypt/sqlite-worker/load-sqlite3";
import { initTestSqliteDatabase } from "@symcrypt/test-utils";
import { eq, sql } from "drizzle-orm";
import { ensureDocumentTables } from "./documentPersistence";
import { documents } from "./schema";
import {
  type ClientSQLitePersistenceRuntime,
  createClientSQLitePersistenceRuntime,
} from "./sqlitePersistenceRuntime";
import type { SqlArrayRow, SqlRow } from "./sqlSchema";

async function createTestRuntime(key: string): Promise<{
  close: () => void;
  runtime: ClientSQLitePersistenceRuntime;
}> {
  const db = await initTestSqliteDatabase({
    dbName: `/${crypto.randomUUID()}.db`,
    cipher: "chacha20",
    key,
  });

  return {
    close: () => db.close(),
    runtime: createClientSQLitePersistenceRuntime({
      exec: async (options) => ({
        rows: execDatabaseStatement(db, options) as Array<SqlRow | SqlArrayRow>,
      }),
    }),
  };
}

test("client SQLite persistence runtime supports positional binds and row modes", async () => {
  const { close, runtime } = await createTestRuntime(
    "client-sqlite-persistence-runtime-test",
  );

  try {
    await runtime.execSql(
      "CREATE TABLE runtime_values (id INTEGER PRIMARY KEY, label TEXT NOT NULL)",
    );
    await runtime.execSql(
      "INSERT INTO runtime_values (id, label) VALUES (?, ?)",
      [1, "one"],
    );

    await expect(
      runtime.execSql("SELECT label FROM runtime_values WHERE id = ?", [1], {
        rowMode: "array",
      }),
    ).resolves.toEqual([["one"]]);
    await expect(
      runtime.execSql("SELECT label FROM runtime_values WHERE id = :id", {
        ":id": 1,
      }),
    ).resolves.toEqual([{ label: "one" }]);
  } finally {
    close();
  }
});

test("client SQLite persistence runtime maps Drizzle select rows from array mode", async () => {
  const { close, runtime } = await createTestRuntime(
    "client-sqlite-persistence-runtime-test",
  );

  try {
    await ensureDocumentTables(runtime.execSql);
    await runtime.runMutation(async (db) => {
      await db
        .insert(documents)
        .values({
          appKind: "documents",
          localId: "local-document-1",
          snapshotEndVersion: "end-version-1",
          updatedAt: "2026-05-04T00:00:00.000Z",
        })
        .run();
    });

    const rows = await runtime.db
      .select({
        localId: documents.localId,
        snapshotEndVersion: documents.snapshotEndVersion,
      })
      .from(documents)
      .where(eq(documents.localId, "local-document-1"));

    expect(rows).toEqual([
      {
        localId: "local-document-1",
        snapshotEndVersion: "end-version-1",
      },
    ]);
  } finally {
    close();
  }
});

test("client SQLite persistence runtime returns undefined for missing Drizzle get rows", async () => {
  const { close, runtime } = await createTestRuntime(
    "client-sqlite-persistence-runtime-test",
  );

  try {
    await ensureDocumentTables(runtime.execSql);

    const row = await runtime.db
      .select({
        localId: documents.localId,
      })
      .from(documents)
      .where(eq(documents.localId, "missing-document"))
      .get();

    expect(row).toBeUndefined();
  } finally {
    close();
  }
});

test("client SQLite persistence runtime reuses its Drizzle database for serialized mutations", async () => {
  const runtime = createClientSQLitePersistenceRuntime({
    exec: async () => ({ rows: [] }),
  });

  await runtime.runMutation((db) => {
    expect(db).toBe(runtime.db);
  });
});

test("client SQLite persistence runtime reuses one runtime for the same client", () => {
  const client = {
    exec: async () => ({ rows: [] }),
  };

  const first = createClientSQLitePersistenceRuntime(client);
  const second = createClientSQLitePersistenceRuntime(client);

  expect(second).toBe(first);
  expect(second.execSql).toBe(first.execSql);
  expect(second.db).toBe(first.db);
});

test("client SQLite persistence runtime maps undefined Drizzle params to null", async () => {
  const binds: unknown[] = [];
  const runtime = createClientSQLitePersistenceRuntime({
    exec: async (options) => {
      binds.push(options.bind);
      return { rows: [] };
    },
  });

  await runtime.db.run(sql`select ${sql.param(undefined)}`);

  expect(binds).toEqual([[null]]);
});

test("client SQLite persistence runtime serializes Drizzle transactions", async () => {
  const statements: string[] = [];
  const runtime = createClientSQLitePersistenceRuntime({
    exec: async ({ sql: statement }) => {
      statements.push(statement);
      return { rows: [] };
    },
  });
  let releaseFirst = () => {};
  const firstCanCommit = new Promise<void>((resolve) => {
    releaseFirst = resolve;
  });
  let markFirstInside = () => {};
  const firstInside = new Promise<void>((resolve) => {
    markFirstInside = resolve;
  });

  const first = runtime.transaction(async (tx) => {
    await tx.run(sql`select 1`);
    markFirstInside();
    await firstCanCommit;
  });

  await firstInside;

  const second = runtime.transaction(async (tx) => {
    await tx.run(sql`select 2`);
  });

  await Promise.resolve();
  expect(statements).toEqual(["begin", "select 1"]);

  releaseFirst();
  await expect(Promise.all([first, second])).resolves.toEqual([
    undefined,
    undefined,
  ]);
  expect(statements).toEqual([
    "begin",
    "select 1",
    "commit",
    "begin",
    "select 2",
    "commit",
  ]);
});

test("client SQLite persistence runtime supports immediate transactions", async () => {
  const statements: string[] = [];
  const runtime = createClientSQLitePersistenceRuntime({
    exec: async ({ sql: statement }) => {
      statements.push(statement);
      return { rows: [] };
    },
  });

  await runtime.transaction(
    async (tx) => {
      await tx.run(sql`select 1`);
    },
    { behavior: "immediate" },
  );

  expect(statements).toEqual(["begin immediate", "select 1", "commit"]);
});

test("guarded transactions preserve immediate write locking", async () => {
  const statements: string[] = [];
  const runtime = createClientSQLitePersistenceRuntime({
    exec: async ({ sql: statement }) => {
      statements.push(statement);
      return { rows: [] };
    },
  });

  await runtime.guardedTransaction(
    async (tx) => {
      await tx.run(sql`select 1`);
    },
    () => true,
    { behavior: "immediate" },
  );

  expect(statements).toEqual(["BEGIN IMMEDIATE", "select 1", "COMMIT"]);
});
