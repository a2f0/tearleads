import { expect, test } from "bun:test";
import { createTestExecSql } from "@tearleads/test-utils";
import { resetConnectionSchemaMemo } from "../sqlExec";
import { ensureSqlTables, type SqlTableSchema } from "../sqlTableSchema";
import type { LocalSchemaMigration } from "./localSchemaMigrations";
import {
  assertRestorableLocalSchemaLedger,
  LOCAL_SCHEMA_MIGRATIONS_TABLE,
  migrateLocalSchema,
} from "./migrateLocalSchema";

type TestExecSql = Awaited<ReturnType<typeof createTestExecSql>>["execSql"];

const notesTable: SqlTableSchema = {
  createSql:
    'CREATE TABLE IF NOT EXISTS "notes" ("id" TEXT PRIMARY KEY NOT NULL, "title" TEXT)',
  name: "notes",
  requiredColumns: ["id", "title"],
};

// Version 2 adds `title` to a notes table created before it; version 3
// backfills it. Both skip a database that never created the table.
function notesMigrations(calls: string[]): LocalSchemaMigration[] {
  return [
    {
      name: "add_note_title",
      up: async (execSql, context) => {
        calls.push("add_note_title");
        if (await context.hasTable("notes")) {
          await execSql('ALTER TABLE "notes" ADD COLUMN "title" TEXT');
        }
      },
      version: 2,
    },
    {
      name: "backfill_note_title",
      up: async (execSql, context) => {
        calls.push("backfill_note_title");
        if (await context.hasTable("notes")) {
          await execSql(
            `UPDATE "notes" SET "title" = 'Untitled' WHERE "title" IS NULL`,
          );
        }
      },
      version: 3,
    },
  ];
}

async function ledger(execSql: TestExecSql): Promise<string[]> {
  const rows = await execSql(
    `SELECT version, name FROM "${LOCAL_SCHEMA_MIGRATIONS_TABLE}" ORDER BY version`,
  );
  return rows.map(({ name, version }) => `${version}:${name}`);
}

async function withDatabase(
  key: string,
  run: (execSql: TestExecSql) => Promise<void>,
): Promise<void> {
  const { close, execSql } = await createTestExecSql(key);
  try {
    await run(execSql);
  } finally {
    close();
  }
}

test("a fresh database records every step without running one", () =>
  withDatabase("local-schema-fresh", async (execSql) => {
    const calls: string[] = [];
    const state = await migrateLocalSchema(execSql, {
      migrations: notesMigrations(calls),
    });
    expect(state.status).toBe("fresh");
    expect(calls).toEqual([]);
    expect(await ledger(execSql)).toEqual([
      "1:baseline",
      "2:add_note_title",
      "3:backfill_note_title",
    ]);
  }));

test("a database from before the ledger runs every step on its baseline data", () =>
  withDatabase("local-schema-legacy", async (execSql) => {
    await execSql('CREATE TABLE "notes" ("id" TEXT PRIMARY KEY NOT NULL)');
    await execSql(`INSERT INTO "notes" ("id") VALUES ('a')`);
    const calls: string[] = [];
    const migrations = notesMigrations(calls);
    expect((await migrateLocalSchema(execSql, { migrations })).status).toBe(
      "legacy",
    );
    expect(calls).toEqual(["add_note_title", "backfill_note_title"]);
    expect(await execSql('SELECT id, title FROM "notes"')).toEqual([
      { id: "a", title: "Untitled" },
    ]);
    expect(await ledger(execSql)).toHaveLength(3);

    calls.length = 0;
    expect((await migrateLocalSchema(execSql, { migrations })).status).toBe(
      "current",
    );
    expect(calls).toEqual([]);
  }));

test("a database behind this build runs only the newer steps", () =>
  withDatabase("local-schema-behind", async (execSql) => {
    const calls: string[] = [];
    const migrations = notesMigrations(calls);
    await execSql('CREATE TABLE "notes" ("id" TEXT PRIMARY KEY NOT NULL)');
    await migrateLocalSchema(execSql, { migrations: [] });
    expect(await ledger(execSql)).toEqual(["1:baseline"]);

    expect((await migrateLocalSchema(execSql, { migrations })).status).toBe(
      "behind",
    );
    expect(calls).toEqual(["add_note_title", "backfill_note_title"]);
  }));

test("a failing step rolls back every step and ledger row of its run", () =>
  withDatabase("local-schema-atomic", async (execSql) => {
    await execSql('CREATE TABLE "notes" ("id" TEXT PRIMARY KEY NOT NULL)');
    const [addTitle] = notesMigrations([]);
    if (!addTitle) throw new Error("missing fixture");
    const failing: LocalSchemaMigration = {
      name: "fail",
      up: async () => {
        throw new Error("step failed");
      },
      version: 3,
    };
    await expect(
      migrateLocalSchema(execSql, { migrations: [addTitle, failing] }),
    ).rejects.toThrow("step failed");
    expect(
      await execSql(
        `SELECT name FROM sqlite_master WHERE name = '${LOCAL_SCHEMA_MIGRATIONS_TABLE}'`,
      ),
    ).toEqual([]);
    const columns = await execSql(
      `SELECT name FROM pragma_table_info('notes')`,
    );
    expect(columns).toEqual([{ name: "id" }]);
  }));

// Another connection records the baseline between this run's read and its
// write, so this run's ledger insert conflicts.
function racingExecSql(execSql: TestExecSql): TestExecSql {
  let raced = false;
  return (async (sql: string, bind?: never) => {
    if (!raced && sql.includes("INSERT INTO")) {
      raced = true;
      await execSql(
        `CREATE TABLE IF NOT EXISTS "${LOCAL_SCHEMA_MIGRATIONS_TABLE}" ("version" INTEGER PRIMARY KEY NOT NULL, "name" TEXT NOT NULL, "applied_at" INTEGER NOT NULL)`,
      );
      await execSql(
        `INSERT INTO "${LOCAL_SCHEMA_MIGRATIONS_TABLE}" VALUES (1, 'baseline', 0)`,
      );
    }
    return execSql(sql, bind);
  }) as TestExecSql;
}

for (const legacy of [false, true]) {
  test(`a ${legacy ? "legacy" : "fresh"} run that loses the first migration to another connection accepts its ledger and leaves no transaction open`, () =>
    withDatabase(`local-schema-race-${legacy}`, async (execSql) => {
      if (legacy) {
        await execSql('CREATE TABLE "notes" ("id" TEXT PRIMARY KEY NOT NULL)');
      }
      const state = await migrateLocalSchema(racingExecSql(execSql), {
        migrations: [],
      });
      expect(state).toEqual({ status: "current", version: 1 });
      expect(await ledger(execSql)).toEqual(["1:baseline"]);
      await execSql("BEGIN");
      await execSql("COMMIT");
    }));
}

// A FIFO stand-in for the browser's Web Locks, which Bun lacks.
function installWebLocks(): () => void {
  const tails = new Map<string, Promise<void>>();
  const locks = {
    request: async (name: string, callback: () => Promise<unknown>) => {
      const previous = tails.get(name) ?? Promise.resolve();
      let release = () => {};
      const current = new Promise<void>((resolve) => {
        release = resolve;
      });
      tails.set(
        name,
        previous.then(() => current),
      );
      await previous;
      try {
        return await callback();
      } finally {
        release();
      }
    },
  };
  Object.defineProperty(navigator, "locks", {
    configurable: true,
    value: locks,
  });
  return () => {
    Reflect.deleteProperty(navigator, "locks");
  };
}

test("another tab on the same handle waits for a migration to roll back before it writes", async () => {
  const uninstall = installWebLocks();
  try {
    await withDatabase("local-schema-tabs", async (execSql) => {
      await execSql('CREATE TABLE "notes" ("id" TEXT PRIMARY KEY NOT NULL)');
      // Each tab has its own executor (and mutation queue) on one handle.
      const tab = (() => (sql: string, bind?: never) =>
        execSql(sql, bind)) as () => TestExecSql;
      let stepStarted = () => {};
      const started = new Promise<void>((resolve) => {
        stepStarted = resolve;
      });
      let openGate = () => {};
      const gate = new Promise<void>((resolve) => {
        openGate = resolve;
      });
      const migrating = migrateLocalSchema(tab(), {
        migrations: [
          {
            name: "fails_after_pause",
            up: async () => {
              stepStarted();
              await gate;
              throw new Error("step failed");
            },
            version: 2,
          },
        ],
      });
      // Captured by hand: an `expect(...).rejects` created here hung this test.
      const failed = migrating.then(
        () => null,
        (error: unknown) => error,
      );
      await started;

      const otherTab = tab();
      let otherSettled = false;
      const writing = migrateLocalSchema(otherTab, { migrations: [] }).then(
        async () => {
          otherSettled = true;
          await otherTab(`INSERT INTO "notes" ("id") VALUES ('other-tab')`);
        },
      );
      await Bun.sleep(50);
      expect(otherSettled).toBe(false);

      openGate();
      expect(await failed).toEqual(new Error("step failed"));
      await writing;
      expect(await execSql('SELECT id FROM "notes"')).toEqual([
        { id: "other-tab" },
      ]);
      expect(await ledger(execSql)).toEqual(["1:baseline"]);
    });
  } finally {
    uninstall();
  }
});

test("a database written by a newer build is refused without changes", () =>
  withDatabase("local-schema-ahead", async (execSql) => {
    await migrateLocalSchema(execSql, { migrations: notesMigrations([]) });
    await expect(
      migrateLocalSchema(execSql, { migrations: [] }),
    ).rejects.toThrow(
      "Local database schema version 3 is newer than this app supports (1)",
    );
    expect(await ledger(execSql)).toHaveLength(3);
  }));

test("table ensures migrate first, once per connection, and again after a schema reset", () =>
  withDatabase("local-schema-ensure", async (execSql) => {
    await execSql(
      'CREATE TABLE "notes" ("id" TEXT PRIMARY KEY NOT NULL, "title" TEXT)',
    );
    await ensureSqlTables(execSql, [notesTable]);
    expect(await ledger(execSql)).toEqual(["1:baseline"]);

    await execSql(`DELETE FROM "${LOCAL_SCHEMA_MIGRATIONS_TABLE}"`);
    await execSql(
      `INSERT INTO "${LOCAL_SCHEMA_MIGRATIONS_TABLE}" VALUES (1, 'baseline', 0), (2, 'future', 0)`,
    );
    await ensureSqlTables(execSql, [notesTable]);
    resetConnectionSchemaMemo(execSql);
    await expect(ensureSqlTables(execSql, [notesTable])).rejects.toThrow(
      "Local database schema version 2 is newer than this app supports (1)",
    );
  }));

test("assertRestorableLocalSchemaLedger admits older and missing ledgers only", () => {
  expect(() => assertRestorableLocalSchemaLedger([])).not.toThrow();
  expect(() =>
    assertRestorableLocalSchemaLedger([
      { applied_at: 0, name: "baseline", version: 1 },
    ]),
  ).not.toThrow();
  expect(() =>
    assertRestorableLocalSchemaLedger([
      { applied_at: 0, name: "baseline", version: 1 },
      { applied_at: 0, name: "future", version: 2 },
    ]),
  ).toThrow(
    "Local database schema version 2 is newer than this app supports (1)",
  );
  expect(() =>
    assertRestorableLocalSchemaLedger([
      { applied_at: 0, name: "other", version: 1 },
    ]),
  ).toThrow("Local database schema history does not match this app");
});
