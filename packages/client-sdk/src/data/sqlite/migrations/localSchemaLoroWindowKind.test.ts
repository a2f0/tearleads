import { expect, test } from "bun:test";
import { createTestExecSql } from "@tearleads/test-utils";
import { documentLoroWindowTables } from "../schema/documentLoroWindowSchema";
import { ensureSqlTables } from "../sqlSchema";
import { localSchemaMigrations } from "./localSchemaMigrations";
import { migrateLocalSchema } from "./migrateLocalSchema";

const OPENED_AT = "2026-11-20T00:00:00.000Z";

// The version-9 shape: the current table without its window kind.
const VERSION_9_LORO_WINDOWS = `CREATE TABLE "document_loro_windows" (
  "app_kind" TEXT NOT NULL,
  "local_id" TEXT NOT NULL,
  "lifetime_id" TEXT NOT NULL,
  "window_id" TEXT NOT NULL,
  "document_id" TEXT NOT NULL,
  "update_ids" TEXT NOT NULL,
  "counts" INTEGER NOT NULL,
  "judge" TEXT NOT NULL,
  "opened_at" TEXT NOT NULL,
  PRIMARY KEY ("app_kind", "local_id", "lifetime_id")
)`;

const VERSION_9_STEPS = localSchemaMigrations.filter(
  (migration) => migration.version <= 9,
);

test("step 10 reads a version-9 database's open windows as read windows", async () => {
  const { close, execSql } = await createTestExecSql("local-schema-loro-kind");
  try {
    await migrateLocalSchema(execSql, { migrations: VERSION_9_STEPS });
    await execSql(VERSION_9_LORO_WINDOWS);
    await execSql(
      `INSERT INTO document_loro_windows (app_kind, local_id, lifetime_id,
         window_id, document_id, update_ids, counts, judge, opened_at)
       VALUES ('documents', 'note', 'dead', 'dead-window', 'doc', '["u1"]',
         1, 'judge', ?)`,
      [OPENED_AT],
    );

    expect((await migrateLocalSchema(execSql)).status).toBe("behind");

    expect(
      await execSql("SELECT lifetime_id, kind FROM document_loro_windows"),
    ).toEqual([{ kind: "read", lifetime_id: "dead" }]);
    // The migrated table is the shape the current definition checks.
    await ensureSqlTables(execSql, documentLoroWindowTables);
  } finally {
    close();
  }
});

// A table that somehow missed the step is refused, not read with no kind.
test("the current definition refuses a window table without its kind", async () => {
  const { close, execSql } = await createTestExecSql(
    "local-schema-loro-kind-missing",
  );
  try {
    await migrateLocalSchema(execSql);
    await execSql(VERSION_9_LORO_WINDOWS);

    await expect(
      ensureSqlTables(execSql, documentLoroWindowTables),
    ).rejects.toThrow("obsolete");
  } finally {
    close();
  }
});

test("step 10 skips a version-9 database without the window table", async () => {
  const { close, execSql } = await createTestExecSql(
    "local-schema-loro-kind-absent",
  );
  try {
    await migrateLocalSchema(execSql, { migrations: VERSION_9_STEPS });
    expect((await migrateLocalSchema(execSql)).status).toBe("behind");
    expect(
      await execSql(
        "SELECT name FROM sqlite_master WHERE name = 'document_loro_windows'",
      ),
    ).toEqual([]);
  } finally {
    close();
  }
});
