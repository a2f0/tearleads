import { expect, test } from "bun:test";
import { createTestExecSql } from "@tearleads/test-utils";
import { organizationReadModelTables } from "../schema";
import { documentTables } from "../schema/documentRecordSchema";
import { ensureSqlTables } from "../sqlSchema";
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
      documents.createSql.replace(
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
    ).toEqual([1, 2, 3, 4]);
    // The migrated table is the shape the current definition checks.
    await ensureSqlTables(execSql, documentTables);
  } finally {
    close();
  }
});

test("step 4 replays only document lanes an earlier SDK advanced in publication order", async () => {
  const { close, execSql } = await createTestExecSql(
    "local-schema-discovery-replay",
  );
  try {
    await migrateLocalSchema(execSql, {
      migrations: localSchemaMigrations.slice(0, 2),
    });
    await execSql(
      "CREATE TABLE container_sync_watermarks (lane_id TEXT PRIMARY KEY, lane_kind TEXT, watermark_id TEXT)",
    );
    await execSql(`INSERT INTO container_sync_watermarks VALUES
      ('skipped-unlink', 'container_documents', '123/doc'),
      ('legacy', 'container_documents', 'doc'),
      ('parent', 'container_parent', '123/folder')`);
    expect((await migrateLocalSchema(execSql)).status).toBe("behind");
    expect(
      await execSql(
        "SELECT lane_id FROM container_sync_watermarks ORDER BY lane_id",
      ),
    ).toEqual([{ lane_id: "legacy" }, { lane_id: "parent" }]);
    await execSql(
      "INSERT INTO container_sync_watermarks VALUES ('replayed', 'container_documents', '124/doc')",
    );
    expect((await migrateLocalSchema(execSql)).status).toBe("current");
    expect(
      await execSql(
        "SELECT lane_id FROM container_sync_watermarks WHERE lane_id = 'replayed'",
      ),
    ).toHaveLength(1);
  } finally {
    close();
  }
});
