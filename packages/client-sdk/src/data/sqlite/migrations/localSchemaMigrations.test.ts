import { expect, test } from "bun:test";
import { createTestExecSql } from "@tearleads/test-utils";
import {
  ContainerSyncWatermarkRepository,
  containerContentsSyncLane,
  containerParentSyncLane,
} from "../../persistence/container-contents/containerSyncWatermarkPersistence";
import { organizationReadModelTables } from "../schema";
import { documentLoroWindowTables } from "../schema/documentLoroWindowSchema";
import { documentProjectionTables } from "../schema/documentProjectionSchema";
import { documentTables } from "../schema/documentRecordSchema";
import { documentSyncVerdictTables } from "../schema/documentSyncVerdictSchema";
import { type ExecSql, ensureSqlTables } from "../sqlSchema";
import { localSchemaMigrations } from "./localSchemaMigrations";
import {
  LOCAL_SCHEMA_MIGRATIONS_TABLE,
  migrateLocalSchema,
} from "./migrateLocalSchema";

const CREATED_AT = "2026-11-01T00:00:00.000Z";

// The version-1 shape, as the table definition created it before step 2.
const VERSION_1_DIRECTORY_USERS = `CREATE TABLE "organization_read_model_directory_users" (
  "organization_id" TEXT NOT NULL,
  "user_id" TEXT NOT NULL,
  "sort_order" INTEGER NOT NULL,
  "signing_key_fingerprint" TEXT NOT NULL,
  "signing_public_key" TEXT NOT NULL,
  "encapsulation_public_key" TEXT NOT NULL,
  "encapsulation_key_fingerprint" TEXT NOT NULL,
  "is_personal_organization_owner" INTEGER NOT NULL,
  "created_at" TEXT NOT NULL,
  "status" TEXT NOT NULL,
  "profile_document_id" TEXT,
  "joined_at" TEXT NOT NULL,
  "updated_at" TEXT NOT NULL,
  "disabled_at" TEXT,
  "disabled_by_user_id" TEXT,
  "leave_request" TEXT,
  PRIMARY KEY ("organization_id", "user_id")
)`;

test("step 2 drops the directory rows' public keys and keeps the rows", async () => {
  const { close, execSql } = await createTestExecSql(
    "local-schema-directory-keys",
  );
  try {
    await execSql(VERSION_1_DIRECTORY_USERS);
    await execSql(
      `INSERT INTO organization_read_model_directory_users VALUES
        ('organization', 'user', 0, 'signing-fingerprint', 'signing-key',
         'encapsulation-key', 'encapsulation-fingerprint', 0, ?, 'active',
         NULL, ?, ?, NULL, NULL, NULL)`,
      [CREATED_AT, CREATED_AT, CREATED_AT],
    );

    const state = await migrateLocalSchema(execSql);
    expect(state.status).toBe("legacy");

    const columns = (
      await execSql(
        "SELECT name FROM pragma_table_info('organization_read_model_directory_users')",
      )
    ).map(({ name }) => String(name));
    expect(columns).not.toContain("signing_public_key");
    expect(columns).not.toContain("encapsulation_public_key");
    expect(columns).toContain("signing_key_fingerprint");
    expect(
      await execSql(
        "SELECT user_id, signing_key_fingerprint, encapsulation_key_fingerprint FROM organization_read_model_directory_users",
      ),
    ).toEqual([
      {
        encapsulation_key_fingerprint: "encapsulation-fingerprint",
        signing_key_fingerprint: "signing-fingerprint",
        user_id: "user",
      },
    ]);
    // The migrated table is the shape the current definition writes.
    await ensureSqlTables(execSql, organizationReadModelTables);
    await execSql(
      `INSERT INTO organization_read_model_directory_users
        (organization_id, user_id, sort_order, signing_key_fingerprint,
         encapsulation_key_fingerprint, is_personal_organization_owner,
         created_at, status, joined_at, updated_at)
       VALUES ('organization', 'peer', 1, 's', 'e', 0, ?, 'active', ?, ?)`,
      [CREATED_AT, CREATED_AT, CREATED_AT],
    );
  } finally {
    close();
  }
});

test("step 2 skips a database that never created the directory table", async () => {
  const { close, execSql } = await createTestExecSql(
    "local-schema-directory-keys-absent",
  );
  try {
    await execSql('CREATE TABLE "other" ("id" TEXT PRIMARY KEY)');
    expect((await migrateLocalSchema(execSql)).status).toBe("legacy");
    await ensureSqlTables(execSql, organizationReadModelTables);
  } finally {
    close();
  }
});

test("step 3 drops the sync failure status from a version-2 database and keeps the failure", async () => {
  const { close, execSql } = await createTestExecSql(
    "local-schema-sync-failure-status",
  );
  try {
    // A version-2 database: its ledger, and the documents table and indexes
    // as the previous build created them, with a recorded failure.
    await migrateLocalSchema(execSql, {
      migrations: localSchemaMigrations.slice(0, 1),
    });
    const [documents] = documentTables;
    if (!documents) throw new Error("Documents table schema is missing");
    await execSql(
      documents.createSql
        .replace('  "peer_salt" TEXT,\n', "")
        .replace('  "committed_version" TEXT,\n', "")
        .replace(
          '  "sync_failure_message" TEXT,\n',
          '  "sync_failure_status" INTEGER,\n  "sync_failure_message" TEXT,\n',
        ),
    );
    for (const index of documents.indexes ?? []) await execSql(index);
    await execSql(
      `INSERT INTO documents (app_kind, local_id, updated_at,
         sync_failure_status, sync_failure_message, sync_failure_attempted_at)
       VALUES ('documents', 'note', ?, 409, 'refused', ?)`,
      [CREATED_AT, CREATED_AT],
    );

    expect((await migrateLocalSchema(execSql)).status).toBe("behind");

    const columns = (
      await execSql("SELECT name FROM pragma_table_info('documents')")
    ).map(({ name }) => String(name));
    expect(columns).not.toContain("sync_failure_status");
    expect(
      await execSql(
        "SELECT sync_failure_message, sync_failure_attempted_at FROM documents",
      ),
    ).toEqual([
      {
        sync_failure_attempted_at: CREATED_AT,
        sync_failure_message: "refused",
      },
    ]);
    expect(
      (
        await execSql(
          "SELECT name FROM sqlite_master WHERE type = 'index' AND tbl_name = 'documents' AND sql IS NOT NULL ORDER BY name",
        )
      ).map(({ name }) => String(name)),
    ).toEqual(["documents_app_document_idx", "documents_deferred_tail_idx"]);
    expect(
      (
        await execSql(
          `SELECT version FROM ${LOCAL_SCHEMA_MIGRATIONS_TABLE} ORDER BY version`,
        )
      ).map(({ version }) => Number(version)),
    ).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13]);
    // The migrated table is the shape the current definition checks.
    await ensureSqlTables(execSql, documentTables);
  } finally {
    close();
  }
});

test("step 4 replays publication cursors saved before unlink and restored-folder recovery", async () => {
  const { close, execSql } = await createTestExecSql(
    "local-schema-discovery-replay",
  );
  try {
    await migrateLocalSchema(execSql, {
      migrations: localSchemaMigrations.slice(0, 2),
    });
    await execSql(`CREATE TABLE container_sync_watermarks (
      lane_kind TEXT NOT NULL, lane_id TEXT NOT NULL, watermark_id TEXT, watermark_updated_at TEXT,
      updated_at TEXT, checked_at TEXT, PRIMARY KEY(lane_kind,lane_id))`);
    await execSql(
      `INSERT INTO container_sync_watermarks VALUES
      ('container_documents', 'replay', '123/doc', ?, ?, NULL),
      ('container_documents', 'legacy', 'doc', ?, ?, NULL),
      ('container_parent', 'root', '123/folder', ?, ?, NULL)`,
      Array(6).fill(CREATED_AT),
    );
    expect((await migrateLocalSchema(execSql)).status).toBe("behind");
    const repository = new ContainerSyncWatermarkRepository(execSql);
    const lane = containerContentsSyncLane("replay");
    expect(await repository.loadWatermark(lane)).toBeNull();
    // Step 4 keeps a legacy document cursor, which replays by itself; step 11
    // forgets every document-lane cursor, so the lane lists from its start.
    expect(
      await repository.loadWatermark(containerContentsSyncLane("legacy")),
    ).toBeNull();
    expect(
      await repository.loadWatermark(containerParentSyncLane(null)),
    ).toBeNull();
    const next = { id: "124/doc", updatedAt: CREATED_AT };
    await repository.saveWatermark(lane, next);
    expect(
      await new ContainerSyncWatermarkRepository(execSql).loadWatermark(lane),
    ).toEqual(next);
  } finally {
    close();
  }
});

test("step 6 marks a version-5 database's pending uploads as first attaches", async () => {
  const { close, execSql } = await createTestExecSql(
    "local-schema-requeued-pending",
  );
  try {
    await migrateLocalSchema(execSql, {
      migrations: localSchemaMigrations.slice(0, 4),
    });
    const pending = documentProjectionTables.find(
      ({ name }) => name === "document_pending_attachments",
    );
    if (!pending) throw new Error("Pending attachment schema is missing");
    // The version-5 shape: the current table without its requeued column.
    const previous = pending.createSql.replace(
      '\n  "requeued" INTEGER NOT NULL DEFAULT 0,',
      "",
    );
    expect(previous).not.toContain('"requeued"');
    await execSql(previous);
    await execSql(
      `INSERT INTO document_pending_attachments (local_id, slot_id, name,
         storage_key, byte_length, content_sha256, created_at)
       VALUES ('note', 'photo', 'photo.bin', 'note-photo', 3, ?, ?)`,
      ["0".repeat(64), CREATED_AT],
    );

    expect((await migrateLocalSchema(execSql)).status).toBe("behind");

    expect(
      await execSql(
        "SELECT slot_id, requeued FROM document_pending_attachments",
      ),
    ).toEqual([{ requeued: 0, slot_id: "photo" }]);
    await ensureSqlTables(execSql, documentProjectionTables);
  } finally {
    close();
  }
});

// The version-6 shapes, as the table definitions created them before step 7.
const VERSION_6_VOID_UPDATES = `CREATE TABLE "document_void_updates" (
  "app_kind" TEXT NOT NULL,
  "local_id" TEXT NOT NULL,
  "document_id" TEXT NOT NULL,
  "update_id" TEXT NOT NULL,
  "stage" TEXT NOT NULL,
  "message" TEXT NOT NULL,
  "attempts" INTEGER,
  "judge" TEXT NOT NULL,
  "content_key_epoch" INTEGER,
  "key_fingerprint" TEXT,
  "voided_at" TEXT NOT NULL,
  PRIMARY KEY ("app_kind", "local_id", "update_id")
)`;
const VERSION_6_LORO_WINDOWS = `CREATE TABLE "document_loro_windows" (
  "app_kind" TEXT NOT NULL,
  "local_id" TEXT NOT NULL,
  "lifetime_id" TEXT NOT NULL,
  "window_id" TEXT NOT NULL,
  "document_id" TEXT NOT NULL,
  "update_ids" TEXT NOT NULL,
  "counts" INTEGER NOT NULL,
  "content_key_epoch" INTEGER,
  "key_fingerprint" TEXT,
  "judge" TEXT NOT NULL,
  "opened_at" TEXT NOT NULL,
  PRIMARY KEY ("app_kind", "local_id", "lifetime_id")
)`;
const JUDGE = "void-rules-3:loro-crdt@1.0.0";

async function columnsOf(execSql: ExecSql, table: string) {
  return (
    await execSql(`SELECT name FROM pragma_table_info('${table}') ORDER BY cid`)
  ).map(({ name }) => String(name));
}

test("step 7 drops the void rows' and read windows' key columns and keeps the rows", async () => {
  const { close, execSql } = await createTestExecSql(
    "local-schema-sync-key-columns",
  );
  try {
    await migrateLocalSchema(execSql, {
      migrations: localSchemaMigrations.slice(0, 5),
    });
    await execSql(VERSION_6_VOID_UPDATES);
    await execSql(VERSION_6_LORO_WINDOWS);
    await execSql(
      `INSERT INTO document_void_updates (app_kind, local_id, document_id,
         update_id, stage, message, attempts, judge, content_key_epoch,
         key_fingerprint, voided_at)
       VALUES ('documents', 'note', 'doc', 'liar', 'loro_import', 'false span',
         NULL, ?, 1, ?, ?)`,
      [JUDGE, "a".repeat(64), CREATED_AT],
    );
    await execSql(
      `INSERT INTO document_loro_windows (app_kind, local_id, lifetime_id,
         window_id, document_id, update_ids, counts, content_key_epoch,
         key_fingerprint, judge, opened_at)
       VALUES ('documents', 'note', 'dead', 'dead-window', 'doc', '["liar"]',
         1, 1, ?, ?, ?)`,
      ["a".repeat(64), JUDGE, CREATED_AT],
    );

    expect((await migrateLocalSchema(execSql)).status).toBe("behind");

    expect(await columnsOf(execSql, "document_void_updates")).toEqual([
      "app_kind",
      "local_id",
      "document_id",
      "update_id",
      "stage",
      "message",
      "attempts",
      "judge",
      "voided_at",
    ]);
    expect(await execSql("SELECT * FROM document_void_updates")).toEqual([
      {
        app_kind: "documents",
        attempts: null,
        document_id: "doc",
        judge: JUDGE,
        local_id: "note",
        message: "false span",
        stage: "loro_import",
        update_id: "liar",
        voided_at: CREATED_AT,
      },
    ]);
    expect(await columnsOf(execSql, "document_loro_windows")).toEqual([
      "app_kind",
      "local_id",
      "lifetime_id",
      "window_id",
      "document_id",
      "update_ids",
      "counts",
      "judge",
      "opened_at",
      "kind",
    ]);
    expect(await execSql("SELECT * FROM document_loro_windows")).toEqual([
      {
        app_kind: "documents",
        counts: 1,
        document_id: "doc",
        judge: JUDGE,
        kind: "read",
        lifetime_id: "dead",
        local_id: "note",
        opened_at: CREATED_AT,
        update_ids: '["liar"]',
        window_id: "dead-window",
      },
    ]);
    // The migrated tables are the shapes the current definitions check.
    await ensureSqlTables(execSql, [
      ...documentSyncVerdictTables,
      ...documentLoroWindowTables,
    ]);
  } finally {
    close();
  }
});

// Step 6 shipped a day before the void table and two before the window
// table, and no step creates either, so a database a build between them
// wrote reaches step 7 without one or both.
test("step 7 migrates a version-6 database from before the window table", async () => {
  const { close, execSql } = await createTestExecSql(
    "local-schema-sync-key-columns-absent",
  );
  try {
    await migrateLocalSchema(execSql, {
      migrations: localSchemaMigrations.slice(0, 5),
    });
    await execSql(VERSION_6_VOID_UPDATES);
    expect((await migrateLocalSchema(execSql)).status).toBe("behind");
    expect(await columnsOf(execSql, "document_void_updates")).not.toContain(
      "key_fingerprint",
    );
    expect(
      await execSql(
        "SELECT name FROM sqlite_master WHERE name = 'document_loro_windows'",
      ),
    ).toEqual([]);
  } finally {
    close();
  }
});

test("step 7 skips a version-6 database with neither table", async () => {
  const { close, execSql } = await createTestExecSql(
    "local-schema-sync-key-columns-none",
  );
  try {
    await migrateLocalSchema(execSql, {
      migrations: localSchemaMigrations.slice(0, 5),
    });
    expect((await migrateLocalSchema(execSql)).status).toBe("behind");
    expect(
      await execSql(
        "SELECT name FROM sqlite_master WHERE name IN ('document_void_updates', 'document_loro_windows')",
      ),
    ).toEqual([]);
  } finally {
    close();
  }
});

test("step 8 adds an empty peer salt to a version-7 database's documents", async () => {
  const { close, execSql } = await createTestExecSql(
    "local-schema-document-peer-salt",
  );
  try {
    await migrateLocalSchema(execSql, {
      migrations: localSchemaMigrations.slice(0, 6),
    });
    const [documents] = documentTables;
    if (!documents) throw new Error("Documents table schema is missing");
    // The version-7 shape: the current table without its peer salt, or the
    // committed version step 13 adds.
    const previous = documents.createSql
      .replace('  "peer_salt" TEXT,\n', "")
      .replace('  "committed_version" TEXT,\n', "");
    expect(previous).not.toContain('"peer_salt"');
    expect(previous).not.toContain('"committed_version"');
    await execSql(previous);
    await execSql(
      `INSERT INTO documents (app_kind, local_id, updated_at)
       VALUES ('documents', 'note', ?)`,
      [CREATED_AT],
    );

    expect((await migrateLocalSchema(execSql)).status).toBe("behind");

    expect(await execSql("SELECT local_id, peer_salt FROM documents")).toEqual([
      { local_id: "note", peer_salt: null },
    ]);
    await ensureSqlTables(execSql, documentTables);
  } finally {
    close();
  }
});
