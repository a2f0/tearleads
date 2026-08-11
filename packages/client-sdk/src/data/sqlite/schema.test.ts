import { expect, test } from "bun:test";
import { createTestExecSql } from "@tearleads/test-utils";
import { integer, sqliteTable, text, unique } from "drizzle-orm/sqlite-core";
import { readTableColumns } from "../../../test/helpers/sqlitePragma";
import { clientSqlTables } from "./schema";
import type { ExecSql, SqlRow, SqlTableSchema } from "./sqlSchema";
import { defineSqlTableSchema, ensureSqlTables } from "./sqlTableSchema";

function readString(row: SqlRow, key: string): string {
  return String(row[key] ?? "");
}

function readNumber(row: SqlRow, key: string): number {
  return Number(row[key] ?? 0);
}

function readRecordValue<T>(record: Record<string, T>, key: string): T {
  const value = record[key];
  if (value === undefined) {
    throw new Error(`Missing record value for ${key}`);
  }

  return value;
}

async function readIndexList(
  execSql: ExecSql,
  tableName: string,
): Promise<Record<string, { partial: number; unique: number }>> {
  const rows = await execSql(`PRAGMA index_list(${tableName})`);

  return Object.fromEntries(
    rows.map((row) => [
      readString(row, "name"),
      {
        partial: readNumber(row, "partial"),
        unique: readNumber(row, "unique"),
      },
    ]),
  );
}

async function readIndexColumns(
  execSql: ExecSql,
  indexName: string,
): Promise<string[]> {
  const rows = await execSql(`PRAGMA index_info(${indexName})`);
  return rows.map((row) => readString(row, "name"));
}

test("client sqlite schema creates tables and indexes", async () => {
  const { close, execSql } = await createTestExecSql("app-schema-test");

  try {
    await ensureSqlTables(execSql, clientSqlTables);

    const objects = await execSql(`
      SELECT name, type
      FROM sqlite_master
      WHERE type IN ('table', 'index')
        AND name NOT LIKE 'sqlite_autoindex%'
      ORDER BY type ASC, name ASC
    `);

    const tableNames = objects
      .filter((row) => readString(row, "type") === "table")
      .map((row) => readString(row, "name"));
    const indexNames = objects
      .filter((row) => readString(row, "type") === "index")
      .map((row) => readString(row, "name"));

    expect(tableNames).toEqual(
      clientSqlTables.map((table) => table.name).sort(),
    );
    expect(indexNames).toEqual([
      "container_create_intents_status_created_idx",
      "container_move_intents_status_created_idx",
      "document_attachment_blob_projection_mime_type_idx",
      "document_attachment_blob_projection_storage_key_idx",
      "document_history_updates_scope_created_idx",
      "document_move_intents_status_created_idx",
      "document_pending_attachments_mime_type_idx",
      "document_pending_attachments_storage_key_idx",
      "document_pending_updates_scope_created_idx",
      "document_projection_container_idx",
      "document_projection_document_idx",
      "document_projection_orphan_organization_idx",
      "documents_app_document_idx",
      "dormant_container_metadata_organization_idx",
      "security_incidents_trust_last_detected_idx",
    ]);

    const documents = await readTableColumns(execSql, "documents");
    expect(readRecordValue(documents, "app_kind")).toEqual({
      defaultValue: null,
      notNull: 1,
      pk: 1,
      type: "TEXT",
    });
    expect(readRecordValue(documents, "local_id")).toEqual({
      defaultValue: null,
      notNull: 1,
      pk: 2,
      type: "TEXT",
    });
    expect(readRecordValue(documents, "access_epoch")).toEqual({
      defaultValue: "1",
      notNull: 1,
      pk: 0,
      type: "INTEGER",
    });

    const trustedIdentityPins = await readTableColumns(
      execSql,
      "trusted_user_identity_pins",
    );
    expect(trustedIdentityPins).toEqual({
      identity_trust_domain: {
        defaultValue: null,
        notNull: 1,
        pk: 1,
        type: "TEXT",
      },
      user_id: {
        defaultValue: null,
        notNull: 1,
        pk: 2,
        type: "TEXT",
      },
      format_version: {
        defaultValue: null,
        notNull: 1,
        pk: 0,
        type: "INTEGER",
      },
      signing_suite: {
        defaultValue: null,
        notNull: 1,
        pk: 0,
        type: "TEXT",
      },
      signing_public_key: {
        defaultValue: null,
        notNull: 1,
        pk: 0,
        type: "TEXT",
      },
      signing_key_fingerprint: {
        defaultValue: null,
        notNull: 1,
        pk: 0,
        type: "TEXT",
      },
      encapsulation_suite: {
        defaultValue: null,
        notNull: 1,
        pk: 0,
        type: "TEXT",
      },
      encapsulation_public_key: {
        defaultValue: null,
        notNull: 1,
        pk: 0,
        type: "TEXT",
      },
      encapsulation_key_fingerprint: {
        defaultValue: null,
        notNull: 1,
        pk: 0,
        type: "TEXT",
      },
      first_seen_at: {
        defaultValue: null,
        notNull: 1,
        pk: 0,
        type: "TEXT",
      },
    });

    const organizationReadModelState = await readTableColumns(
      execSql,
      "organization_read_model_state",
    );
    expect(
      readRecordValue(organizationReadModelState, "organization_id"),
    ).toEqual({
      defaultValue: null,
      notNull: 1,
      pk: 1,
      type: "TEXT",
    });
    expect(readRecordValue(organizationReadModelState, "cursor")).toEqual({
      defaultValue: null,
      notNull: 1,
      pk: 0,
      type: "TEXT",
    });

    const organizationDirectoryUsers = await readTableColumns(
      execSql,
      "organization_read_model_directory_users",
    );
    expect("is_self" in organizationDirectoryUsers).toBe(false);
    expect(
      readRecordValue(organizationDirectoryUsers, "organization_id"),
    ).toMatchObject({ notNull: 1, pk: 1 });
    expect(
      readRecordValue(organizationDirectoryUsers, "user_id"),
    ).toMatchObject({ notNull: 1, pk: 2 });

    const organizationRequesters = await readTableColumns(
      execSql,
      "organization_read_model_requesters",
    );
    expect(readRecordValue(organizationRequesters, "is_org_admin")).toEqual({
      defaultValue: null,
      notNull: 1,
      pk: 0,
      type: "INTEGER",
    });

    const pendingUpdates = await readTableColumns(
      execSql,
      "document_pending_updates",
    );
    expect(readRecordValue(pendingUpdates, "id")).toEqual({
      defaultValue: null,
      notNull: 0,
      pk: 1,
      type: "TEXT",
    });

    const documentIndexes = await readIndexList(execSql, "documents");
    expect(
      readRecordValue(documentIndexes, "documents_app_document_idx"),
    ).toEqual({
      partial: 1,
      unique: 0,
    });
    expect(
      await readIndexColumns(execSql, "documents_app_document_idx"),
    ).toEqual(["app_kind", "document_id"]);

    const pendingUpdateIndexes = await readIndexList(
      execSql,
      "document_pending_updates",
    );
    expect(
      readRecordValue(
        pendingUpdateIndexes,
        "document_pending_updates_scope_created_idx",
      ),
    ).toEqual({
      partial: 0,
      unique: 0,
    });
    expect(
      await readIndexColumns(
        execSql,
        "document_pending_updates_scope_created_idx",
      ),
    ).toEqual(["app_kind", "local_id", "created_at"]);

    const pendingAttachmentIndexes = await readIndexList(
      execSql,
      "document_pending_attachments",
    );
    expect(
      readRecordValue(
        pendingAttachmentIndexes,
        "document_pending_attachments_mime_type_idx",
      ),
    ).toEqual({
      partial: 0,
      unique: 0,
    });
    expect(
      await readIndexColumns(
        execSql,
        "document_pending_attachments_mime_type_idx",
      ),
    ).toEqual(["mime_type"]);

    const localAttachmentIndexes = await readIndexList(
      execSql,
      "document_attachment_blob_projection",
    );
    expect(
      readRecordValue(
        localAttachmentIndexes,
        "document_attachment_blob_projection_mime_type_idx",
      ),
    ).toEqual({
      partial: 0,
      unique: 0,
    });
    expect(
      await readIndexColumns(
        execSql,
        "document_attachment_blob_projection_mime_type_idx",
      ),
    ).toEqual(["mime_type"]);

    const containerSyncWatermarks = await readTableColumns(
      execSql,
      "container_sync_watermarks",
    );
    expect(readRecordValue(containerSyncWatermarks, "lane_kind")).toEqual({
      defaultValue: null,
      notNull: 1,
      pk: 1,
      type: "TEXT",
    });
    expect(readRecordValue(containerSyncWatermarks, "lane_id")).toEqual({
      defaultValue: null,
      notNull: 1,
      pk: 2,
      type: "TEXT",
    });
    expect(
      readRecordValue(containerSyncWatermarks, "watermark_updated_at"),
    ).toEqual({
      defaultValue: null,
      notNull: 1,
      pk: 0,
      type: "TEXT",
    });
    expect(readRecordValue(containerSyncWatermarks, "watermark_id")).toEqual({
      defaultValue: null,
      notNull: 1,
      pk: 0,
      type: "TEXT",
    });

    const intentIndexes = await readIndexList(
      execSql,
      "container_create_intents",
    );
    expect(
      readRecordValue(
        intentIndexes,
        "container_create_intents_status_created_idx",
      ),
    ).toEqual({
      partial: 0,
      unique: 0,
    });
    expect(
      await readIndexColumns(
        execSql,
        "container_create_intents_status_created_idx",
      ),
    ).toEqual(["sync_status", "created_at"]);

    const moveIntentIndexes = await readIndexList(
      execSql,
      "container_move_intents",
    );
    expect(
      readRecordValue(
        moveIntentIndexes,
        "container_move_intents_status_created_idx",
      ),
    ).toEqual({
      partial: 0,
      unique: 0,
    });
    expect(
      await readIndexColumns(
        execSql,
        "container_move_intents_status_created_idx",
      ),
    ).toEqual(["sync_status", "created_at"]);

    const containers = await readTableColumns(execSql, "containers");
    expect("created_at" in containers).toBe(false);
    expect("updated_at" in containers).toBe(false);
    expect(readRecordValue(containers, "local_created_at")).toEqual({
      defaultValue: null,
      notNull: 1,
      pk: 0,
      type: "TEXT",
    });
    expect(readRecordValue(containers, "local_updated_at")).toEqual({
      defaultValue: null,
      notNull: 1,
      pk: 0,
      type: "TEXT",
    });
    expect(readRecordValue(containers, "server_created_at")).toEqual({
      defaultValue: null,
      notNull: 0,
      pk: 0,
      type: "TEXT",
    });
    expect(readRecordValue(containers, "server_updated_at")).toEqual({
      defaultValue: null,
      notNull: 0,
      pk: 0,
      type: "TEXT",
    });
    expect(readRecordValue(containers, "system_slot")).toEqual({
      defaultValue: null,
      notNull: 0,
      pk: 0,
      type: "TEXT",
    });
  } finally {
    close();
  }
});

test("client sqlite schema renderer quotes identifiers and table unique constraints", async () => {
  const tableSchema: SqlTableSchema = defineSqlTableSchema(
    sqliteTable(
      "select",
      {
        enabled: integer("enabled", { mode: "boolean" })
          .notNull()
          .default(true),
        from: text("from").notNull(),
      },
      (table) => [unique().on(table.from, table.enabled)],
    ),
  );
  const { close, execSql } = await createTestExecSql(
    "app-schema-renderer-test",
  );

  try {
    expect(tableSchema.createSql).toContain(
      'CREATE TABLE IF NOT EXISTS "select"',
    );
    expect(tableSchema.createSql).toContain(
      '"enabled" INTEGER NOT NULL DEFAULT 1',
    );
    expect(tableSchema.createSql).toContain('"from" TEXT NOT NULL');
    expect(tableSchema.createSql).toContain('UNIQUE ("from", "enabled")');

    await ensureSqlTables(execSql, [tableSchema]);
    const columns = await readTableColumns(execSql, "select");

    expect(readRecordValue(columns, "enabled")).toEqual({
      defaultValue: "1",
      notNull: 1,
      pk: 0,
      type: "INTEGER",
    });
    expect(readRecordValue(columns, "from")).toEqual({
      defaultValue: null,
      notNull: 1,
      pk: 0,
      type: "TEXT",
    });
  } finally {
    close();
  }
});
