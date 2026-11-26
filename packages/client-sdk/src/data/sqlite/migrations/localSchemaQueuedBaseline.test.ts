import { expect, test } from "bun:test";
import { createTestExecSql } from "@tearleads/test-utils";
import { documentTables } from "../schema/documentRecordSchema";
import { ensureSqlTables } from "../sqlSchema";
import { localSchemaMigrations } from "./localSchemaMigrations";
import { migrateLocalSchema } from "./migrateLocalSchema";

const CREATED_AT = "2026-11-25T00:00:00.000Z";

// The version-12 shape: the current table with the vector that marked a
// queued rotation baseline.
const VERSION_12_HISTORY_UPDATES = `CREATE TABLE "document_history_updates" (
  "id" TEXT,
  "app_kind" TEXT NOT NULL,
  "local_id" TEXT NOT NULL,
  "update_data" TEXT NOT NULL,
  "origin" TEXT NOT NULL,
  "created_at" TEXT NOT NULL,
  "update_id" TEXT,
  "partial_start_version_vector" TEXT,
  "partial_end_version_vector" TEXT,
  "source_version_vector" TEXT,
  "rekey_count" INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY ("id")
)`;

const VERSION_12_STEPS = localSchemaMigrations.filter(
  (migration) => migration.version <= 12,
);

function historyUpdateColumns(
  execSql: Awaited<ReturnType<typeof createTestExecSql>>["execSql"],
) {
  return execSql('PRAGMA table_info("document_history_updates")').then((rows) =>
    rows.map(({ name }) => String(name)),
  );
}

test("step 13 drops the queued baseline vector and keeps a version-12 queue", async () => {
  const { close, execSql } = await createTestExecSql(
    "local-schema-queued-baseline",
  );
  try {
    await migrateLocalSchema(execSql, { migrations: VERSION_12_STEPS });
    await execSql(VERSION_12_HISTORY_UPDATES);
    await execSql(
      `CREATE UNIQUE INDEX "document_history_updates_update_id_idx"
         ON "document_history_updates" ("update_id")
         WHERE "update_id" IS NOT NULL`,
    );
    await execSql(
      `INSERT INTO document_history_updates (id, app_kind, local_id,
         update_data, origin, created_at, update_id,
         partial_start_version_vector, partial_end_version_vector,
         source_version_vector, rekey_count)
       VALUES ('row-1', 'documents', 'local-1', 'queued', 'local', ?,
         'update-1', 'start', 'end', NULL, 2),
         ('row-2', 'documents', 'local-1', 'settled', 'remote', ?,
         NULL, NULL, NULL, NULL, 0)`,
      [CREATED_AT, CREATED_AT],
    );
    expect(await historyUpdateColumns(execSql)).toContain(
      "source_version_vector",
    );

    expect((await migrateLocalSchema(execSql)).status).toBe("behind");

    expect(await historyUpdateColumns(execSql)).not.toContain(
      "source_version_vector",
    );
    expect(
      await execSql(
        `SELECT id, update_data, origin, update_id,
           partial_start_version_vector, partial_end_version_vector,
           rekey_count
         FROM document_history_updates ORDER BY id`,
      ),
    ).toEqual([
      {
        id: "row-1",
        origin: "local",
        partial_end_version_vector: "end",
        partial_start_version_vector: "start",
        rekey_count: 2,
        update_data: "queued",
        update_id: "update-1",
      },
      {
        id: "row-2",
        origin: "remote",
        partial_end_version_vector: null,
        partial_start_version_vector: null,
        rekey_count: 0,
        update_data: "settled",
        update_id: null,
      },
    ]);
    // The migrated table is the shape the current definition checks.
    await ensureSqlTables(execSql, documentTables);
  } finally {
    close();
  }
});

test("step 13 skips a database that never created the history table", async () => {
  const { close, execSql } = await createTestExecSql(
    "local-schema-queued-baseline-absent",
  );
  try {
    await migrateLocalSchema(execSql, { migrations: VERSION_12_STEPS });
    // Another table makes the database one with user data, not a fresh one.
    await execSql('CREATE TABLE "unrelated" ("id" TEXT PRIMARY KEY)');

    expect((await migrateLocalSchema(execSql)).status).toBe("behind");

    await ensureSqlTables(execSql, documentTables);
    expect(await historyUpdateColumns(execSql)).not.toContain(
      "source_version_vector",
    );
  } finally {
    close();
  }
});
