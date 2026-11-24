import { expect, test } from "bun:test";
import { createTestExecSql } from "@tearleads/test-utils";
import { containerTableSchemas } from "../schema/containerSchema";
import { documentSyncVerdictTables } from "../schema/documentSyncVerdictSchema";
import { ensureSqlTables } from "../sqlSchema";
import { localSchemaMigrations } from "./localSchemaMigrations";
import {
  LOCAL_SCHEMA_MIGRATIONS_TABLE,
  migrateLocalSchema,
} from "./migrateLocalSchema";

const CREATED_AT = "2026-11-01T00:00:00.000Z";

test("step 9 keeps a version-8 database's cursors and owed reads, counting neither", async () => {
  const { close, execSql } = await createTestExecSql(
    "local-schema-metadata-update-count",
  );
  try {
    await migrateLocalSchema(execSql, {
      migrations: localSchemaMigrations.slice(0, 7),
    });
    // The version-8 shapes: no pull count, and owed reads by version vector.
    await execSql(`CREATE TABLE "document_sync_progress" (
      "app_kind" TEXT NOT NULL, "local_id" TEXT NOT NULL,
      "document_id" TEXT NOT NULL, "through_update_id" TEXT,
      "through_version" TEXT, "judge" TEXT, "pull_judge" TEXT,
      "pull_sent_cursor" TEXT, PRIMARY KEY ("app_kind", "local_id"))`);
    await execSql(`CREATE TABLE "container_metadata_revalidations" (
      "document_id" TEXT NOT NULL PRIMARY KEY,
      "advertised_version_vector" TEXT NOT NULL,
      "revision" TEXT NOT NULL, "requested_at" TEXT NOT NULL)`);
    await execSql(
      `INSERT INTO document_sync_progress (app_kind, local_id, document_id,
         through_update_id, through_version, judge)
       VALUES ('container-metadata', 'folder', 'metadata-1', 'update-1', '', 'judge')`,
    );
    await execSql(
      `INSERT INTO container_metadata_revalidations
       VALUES ('metadata-1', 'version', 'revision-1', ?)`,
      [CREATED_AT],
    );

    expect((await migrateLocalSchema(execSql)).status).toBe("behind");
    expect(
      (
        await execSql(
          `SELECT version FROM ${LOCAL_SCHEMA_MIGRATIONS_TABLE} ORDER BY version`,
        )
      ).map(({ version }) => Number(version)),
    ).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9]);

    // A cursor whose pull count is unknown covers no listed count.
    expect(
      await execSql(
        "SELECT through_update_id, through_update_count FROM document_sync_progress",
      ),
    ).toEqual([{ through_update_count: null, through_update_id: "update-1" }]);
    // The owed read survives at a count only a completed pull settles.
    expect(
      await execSql("SELECT * FROM container_metadata_revalidations"),
    ).toEqual([
      {
        advertised_update_count: 1,
        document_id: "metadata-1",
        requested_at: CREATED_AT,
        revision: "revision-1",
      },
    ]);
    await ensureSqlTables(execSql, documentSyncVerdictTables);
    await ensureSqlTables(execSql, containerTableSchemas);
  } finally {
    close();
  }
});
