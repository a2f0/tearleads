import { expect, test } from "bun:test";
import {
  execDatabaseStatement,
  initDatabase,
} from "@tearleads/sqlite-worker/load-sqlite3";
import { eq, sql } from "drizzle-orm";
import {
  type AppDatabaseRuntime,
  createAppDatabaseRuntime,
} from "./appDatabaseRuntime";
import { ensureDocumentTables } from "./documentPersistence";
import { documents } from "./schema";
import type { SqlArrayRow, SqlRow } from "./sqlSchema";

async function createTestRuntime(key: string): Promise<{
  close: () => void;
  runtime: AppDatabaseRuntime;
}> {
  const db = await initDatabase({
    dbName: `/${crypto.randomUUID()}.db`,
    cipher: "chacha20",
    key,
  });

  return {
    close: () => db.close(),
    runtime: createAppDatabaseRuntime({
      exec: async (options) => ({
        rows: execDatabaseStatement(db, options) as Array<SqlRow | SqlArrayRow>,
      }),
    }),
  };
}

test("app database runtime supports positional binds and row modes", async () => {
  const { close, runtime } = await createTestRuntime(
    "app-database-runtime-test",
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

test("app database runtime maps Drizzle select rows from array mode", async () => {
  const { close, runtime } = await createTestRuntime(
    "app-database-runtime-test",
  );

  try {
    await ensureDocumentTables(runtime.execSql);
    await runtime.runMutation(async (db) => {
      await db
        .insert(documents)
        .values({
          appKind: "documents",
          localId: "local-document-1",
          loroSnapshot: "snapshot-1",
          updatedAt: "2026-05-04T00:00:00.000Z",
        })
        .run();
    });

    const rows = await runtime.db
      .select({
        localId: documents.localId,
        snapshot: documents.loroSnapshot,
      })
      .from(documents)
      .where(eq(documents.localId, "local-document-1"));

    expect(rows).toEqual([
      {
        localId: "local-document-1",
        snapshot: "snapshot-1",
      },
    ]);
  } finally {
    close();
  }
});

test("app database runtime reuses its Drizzle database for serialized mutations", async () => {
  const runtime = createAppDatabaseRuntime({
    exec: async () => ({ rows: [] }),
  });

  await runtime.runMutation((db) => {
    expect(db).toBe(runtime.db);
  });
});

test("app database runtime maps undefined Drizzle params to null", async () => {
  const binds: unknown[] = [];
  const runtime = createAppDatabaseRuntime({
    exec: async (options) => {
      binds.push(options.bind);
      return { rows: [] };
    },
  });

  await runtime.db.run(sql`select ${sql.param(undefined)}`);

  expect(binds).toEqual([[null]]);
});

test("app database runtime serializes Drizzle transactions", async () => {
  const statements: string[] = [];
  const runtime = createAppDatabaseRuntime({
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
