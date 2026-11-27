import { expect, test } from "bun:test";
import { createTestExecSql } from "@tearleads/test-utils";
import { sqlContainerContentsPersistence } from "../../persistence/container-contents/containerContentsPersistence";
import { localSchemaMigrations } from "./localSchemaMigrations";
import { migrateLocalSchema } from "./migrateLocalSchema";

const T0 = "2026-11-26T00:00:00.000Z";
const T1 = "2026-11-26T00:01:00.000Z";

const VERSION_16_STEPS = localSchemaMigrations.filter(
  (migration) => migration.version <= 16,
);

test("step 17 adds typed hold columns and backfills legacy error-text holds", async () => {
  const { close, execSql } = await createTestExecSql(
    "local-schema-create-intent-holds",
  );
  try {
    await migrateLocalSchema(execSql, { migrations: VERSION_16_STEPS });
    await execSql(`CREATE TABLE "local_intents" (
      "id" TEXT PRIMARY KEY,
      "lane" TEXT NOT NULL,
      "intent_type" TEXT NOT NULL,
      "subject_id" TEXT NOT NULL,
      "local_id" TEXT,
      "target_container_id" TEXT NOT NULL,
      "source_container_id" TEXT,
      "replace_linked_containers" INTEGER NOT NULL DEFAULT 0,
      "remote_container_id" TEXT,
      "remote_metadata_document_id" TEXT,
      "remote_metadata_access_state_hash" TEXT,
      "sync_status" TEXT NOT NULL,
      "last_error" TEXT,
      "last_attempted_at" TEXT,
      "created_at" TEXT NOT NULL,
      "updated_at" TEXT NOT NULL,
      UNIQUE ("lane", "subject_id")
    )`);
    const insertCreate = (
      id: string,
      subjectId: string,
      lastError: string | null,
    ) =>
      execSql(
        `INSERT INTO local_intents (
          id, lane, intent_type, subject_id, target_container_id,
          sync_status, last_error, created_at, updated_at
        ) VALUES (?, 'container.create', 'container.create', ?, 'root', 'pending', ?, ?, ?)`,
        [id, subjectId, lastError, T0, T1],
      );
    await insertCreate(
      "create-awaiting",
      "c-awaiting",
      "Container create waits for a listing of its parent",
    );
    await insertCreate(
      "create-taken",
      "c-taken",
      "Container system slot is already taken",
    );
    await insertCreate(
      "create-deep",
      "c-deep",
      "Container path exceeds maximum depth",
    );
    await insertCreate("create-error", "c-error", "Network unavailable");
    await insertCreate("create-plain", "c-plain", null);
    await execSql(
      `INSERT INTO local_intents (
        id, lane, intent_type, subject_id, target_container_id,
        sync_status, last_error, created_at, updated_at
      ) VALUES ('move-deep', 'container.move', 'container.move', 'c-moved', 'root', 'pending',
        'Container path exceeds maximum depth', ?, ?)`,
      [T0, T1],
    );

    expect((await migrateLocalSchema(execSql)).status).toBe("behind");
    await sqlContainerContentsPersistence.ensureSchema(execSql);

    // Move-lane rows carrying the same message keep their last_error untouched.
    expect(
      await execSql(
        `SELECT hold_kind, hold_since, last_error
           FROM local_intents WHERE lane = 'container.move' AND subject_id = 'c-moved'`,
      ),
    ).toEqual([
      {
        hold_kind: null,
        hold_since: null,
        last_error: "Container path exceeds maximum depth",
      },
    ]);

    const intents =
      await sqlContainerContentsPersistence.listPendingCreateIntents(execSql);
    expect(
      intents
        .map(({ containerId, hold, lastError }) => ({
          containerId,
          hold,
          lastError,
        }))
        .sort((left, right) => (left.containerId < right.containerId ? -1 : 1)),
    ).toEqual([
      {
        containerId: "c-awaiting",
        hold: { since: T1, status: "awaitingParentListing" },
        lastError: null,
      },
      {
        containerId: "c-deep",
        hold: { status: "pathTooDeep" },
        lastError: null,
      },
      {
        containerId: "c-error",
        hold: { status: "none" },
        lastError: "Network unavailable",
      },
      {
        containerId: "c-plain",
        hold: { status: "none" },
        lastError: null,
      },
      {
        containerId: "c-taken",
        hold: { status: "slotTaken" },
        lastError: null,
      },
    ]);
  } finally {
    close();
  }
});

test("step 17 skips a database without local_intents", async () => {
  const { close, execSql } = await createTestExecSql(
    "local-schema-create-intent-holds-absent",
  );
  try {
    await migrateLocalSchema(execSql, { migrations: VERSION_16_STEPS });
    expect((await migrateLocalSchema(execSql)).status).toBe("behind");
    await sqlContainerContentsPersistence.ensureSchema(execSql);
  } finally {
    close();
  }
});
