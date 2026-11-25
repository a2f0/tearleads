import { expect, test } from "bun:test";
import { createTestExecSql } from "@tearleads/test-utils";
import {
  ContainerSyncWatermarkRepository,
  containerContentsSyncLane,
  containerParentSyncLane,
} from "../../persistence/container-contents/containerSyncWatermarkPersistence";
import { containerSyncWatermarkTables } from "../schema/containerSyncWatermarkSchema";
import { ensureSqlTables } from "../sqlSchema";
import { localSchemaMigrations } from "./localSchemaMigrations";
import { migrateLocalSchema } from "./migrateLocalSchema";

const SAVED_AT = "2026-11-20T00:00:00.000Z";
const WATERMARK = { id: "d1/sealed", updatedAt: SAVED_AT };

const VERSION_10_STEPS = localSchemaMigrations.filter(
  (migration) => migration.version <= 10,
);

test("step 11 lists every document lane from its start once", async () => {
  const { close, execSql } = await createTestExecSql(
    "local-schema-document-lane-relist",
  );
  try {
    await migrateLocalSchema(execSql, { migrations: VERSION_10_STEPS });
    // The version-10 shape, which is also the current one. Creating it
    // through the table's ensure would migrate the database first.
    await execSql(`CREATE TABLE "container_sync_watermarks" (
      "lane_kind" TEXT NOT NULL, "lane_id" TEXT NOT NULL,
      "watermark_updated_at" TEXT, "watermark_id" TEXT,
      "cursor_format" INTEGER NOT NULL DEFAULT 1, "updated_at" TEXT,
      "checked_at" TEXT, PRIMARY KEY ("lane_kind", "lane_id"))`);
    await execSql(
      `INSERT INTO container_sync_watermarks VALUES
       ('container_parent', 'root', ?, ?, 2, ?, NULL),
       ('container_parent', 'parent:folder', ?, ?, 2, ?, NULL),
       ('container_documents', 'folder', ?, ?, 2, ?, ?),
       ('container_documents', 'other', ?, ?, 2, ?, NULL)`,
      [
        ...Array(2).fill([WATERMARK.updatedAt, WATERMARK.id, SAVED_AT]).flat(),
        ...[WATERMARK.updatedAt, WATERMARK.id, SAVED_AT, SAVED_AT],
        ...[WATERMARK.updatedAt, WATERMARK.id, SAVED_AT],
      ],
    );
    const repository = new ContainerSyncWatermarkRepository(execSql);
    const lanes = [
      containerParentSyncLane(null),
      containerParentSyncLane("folder"),
      containerContentsSyncLane("folder"),
      containerContentsSyncLane("other"),
    ];

    expect((await migrateLocalSchema(execSql)).status).toBe("behind");

    // A document lane that passed rows before listings owed reads forgets its
    // cursor; the tree's parent lanes keep theirs.
    expect(
      await Promise.all(lanes.map((lane) => repository.loadWatermark(lane))),
    ).toEqual([WATERMARK, WATERMARK, null, null]);
    // The lane's row and its freshness marker survive.
    expect(
      await execSql(
        `SELECT checked_at IS NOT NULL AS checked
           FROM container_sync_watermarks
          WHERE lane_kind = 'container_documents' AND lane_id = 'folder'`,
      ),
    ).toEqual([{ checked: 1 }]);
    await ensureSqlTables(execSql, containerSyncWatermarkTables);
  } finally {
    close();
  }
});

test("step 11 skips a database that never listed a lane", async () => {
  const { close, execSql } = await createTestExecSql(
    "local-schema-document-lane-relist-absent",
  );
  try {
    await migrateLocalSchema(execSql, { migrations: VERSION_10_STEPS });

    expect((await migrateLocalSchema(execSql)).status).toBe("behind");
  } finally {
    close();
  }
});
