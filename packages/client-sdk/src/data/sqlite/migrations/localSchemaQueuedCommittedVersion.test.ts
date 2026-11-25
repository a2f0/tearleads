import { expect, test } from "bun:test";
import { createTestExecSql } from "@tearleads/test-utils";
import { documentTables } from "../schema/documentRecordSchema";
import { ensureSqlTables } from "../sqlSchema";
import { localSchemaMigrations } from "./localSchemaMigrations";
import { migrateLocalSchema } from "./migrateLocalSchema";

// The version-12 shape: the current log without a relay's committed version.
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

test("step 13 reads a version-12 database's queued updates as no relay", async () => {
  const { close, execSql } = await createTestExecSql(
    "local-schema-queued-committed-version",
  );
  try {
    await migrateLocalSchema(execSql, { migrations: VERSION_12_STEPS });
    await execSql(VERSION_12_HISTORY_UPDATES);
    await execSql(
      `INSERT INTO document_history_updates (id, app_kind, local_id,
         update_data, origin, created_at, update_id,
         partial_start_version_vector, partial_end_version_vector)
       VALUES ('row', 'documents', 'note', 'dXBkYXRl', 'local',
         '2026-11-25T00:00:00.000Z', 'queued', 'start', 'end')`,
    );

    expect((await migrateLocalSchema(execSql)).status).toBe("behind");

    expect(
      await execSql(
        "SELECT update_id, committed_version_vector FROM document_history_updates",
      ),
    ).toEqual([{ committed_version_vector: null, update_id: "queued" }]);
    // The migrated table is the shape the current definition checks.
    await ensureSqlTables(execSql, documentTables);
  } finally {
    close();
  }
});

// A log that somehow missed the step is refused, not read with no column.
test("the current definition refuses an update log without the column", async () => {
  const { close, execSql } = await createTestExecSql(
    "local-schema-queued-committed-version-missing",
  );
  try {
    await migrateLocalSchema(execSql);
    await execSql(VERSION_12_HISTORY_UPDATES);

    await expect(ensureSqlTables(execSql, documentTables)).rejects.toThrow(
      "obsolete",
    );
  } finally {
    close();
  }
});

test("step 13 skips a version-12 database without the update log", async () => {
  const { close, execSql } = await createTestExecSql(
    "local-schema-queued-committed-version-absent",
  );
  try {
    await migrateLocalSchema(execSql, { migrations: VERSION_12_STEPS });
    expect((await migrateLocalSchema(execSql)).status).toBe("behind");
    expect(
      await execSql(
        "SELECT name FROM sqlite_master WHERE name = 'document_history_updates'",
      ),
    ).toEqual([]);
  } finally {
    close();
  }
});
