import { expect, test } from "bun:test";
import { createTestExecSql } from "@tearleads/test-utils";
import { readTableColumns } from "../../../../test/helpers/sqlitePragma";
import type { ExecSql, SqlRow } from "../sqlSchema";
import { ensureSqlTables } from "../sqlTableSchema";
import {
  clientSqlTables,
  documentTables,
  principalPolicyTables,
} from "./index";

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

// Key columns in order, with " DESC" on descending ones.
async function readIndexKeyColumns(
  execSql: ExecSql,
  indexName: string,
): Promise<string[]> {
  const rows = await execSql(`PRAGMA index_xinfo(${indexName})`);
  return rows
    .filter((row) => readNumber(row, "key") === 1)
    .map(
      (row) =>
        `${readString(row, "name")}${readNumber(row, "desc") === 1 ? " DESC" : ""}`,
    );
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
      "containers_parent_idx",
      "document_attachment_blob_projection_storage_key_idx",
      "document_container_projection_container_idx",
      "document_history_updates_queued_scope_idx",
      "document_history_updates_scope_created_idx",
      "document_history_updates_update_id_idx",
      "document_pending_attachments_storage_key_idx",
      "document_projection_container_idx",
      "document_projection_document_idx",
      "document_projection_orphan_organization_idx",
      "documents_app_document_idx",
      "dormant_container_metadata_organization_idx",
      "local_intents_lane_status_created_idx",
      "principal_history_entries_organization_idx",
      "principal_history_nodes_organization_idx",
      "principal_history_nodes_reclaim_idx",
      "principal_history_prefixes_key_fingerprint_idx",
      "principal_history_prefixes_organization_idx",
      "principal_history_root_owners_organization_idx",
      "principal_history_stages_incomplete_idx",
      "principal_history_stages_key_fingerprint_idx",
      "principal_history_stages_organization_idx",
      "principal_history_stages_scope_idx",
      "principal_key_envelope_archive_fingerprint_idx",
      "principal_policies_key_fingerprint_idx",
      "principal_policy_history_key_fingerprint_idx",
      "security_incidents_trust_last_detected_idx",
      "trusted_user_identity_pins_domain_signing_fingerprint_idx",
      "verified_access_manifest_bundles_eviction_idx",
      "verified_access_manifest_bundles_object_idx",
      "verified_access_manifest_bundles_organization_recent_idx",
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
    expect(readRecordValue(documents, "pull_continuation")).toEqual({
      defaultValue: null,
      notNull: 0,
      pk: 0,
      type: "TEXT",
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
      provenance: {
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

    const updateLog = await readTableColumns(
      execSql,
      "document_history_updates",
    );
    expect(readRecordValue(updateLog, "update_id")).toEqual({
      defaultValue: null,
      notNull: 0,
      pk: 0,
      type: "TEXT",
    });
    expect(readRecordValue(updateLog, "rekey_count")).toEqual({
      defaultValue: "0",
      notNull: 1,
      pk: 0,
      type: "INTEGER",
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

    // Queued update ids are unique while queued; settled rows clear theirs.
    const updateLogIndexes = await readIndexList(
      execSql,
      "document_history_updates",
    );
    expect(
      readRecordValue(
        updateLogIndexes,
        "document_history_updates_update_id_idx",
      ),
    ).toEqual({
      partial: 1,
      unique: 1,
    });
    expect(
      await readIndexColumns(execSql, "document_history_updates_update_id_idx"),
    ).toEqual(["update_id"]);

    // Queued history rows only: pending counts skip settled history.
    expect(
      readRecordValue(
        updateLogIndexes,
        "document_history_updates_queued_scope_idx",
      ),
    ).toEqual({ partial: 1, unique: 0 });
    expect(
      await readIndexKeyColumns(
        execSql,
        "document_history_updates_queued_scope_idx",
      ),
    ).toEqual(["app_kind", "local_id", "created_at"]);

    const indexKeyColumns = {
      containers_parent_idx: ["parent_id"],
      document_container_projection_container_idx: [
        "container_id",
        "document_id",
      ],
      verified_access_manifest_bundles_eviction_idx: [
        "verified_at",
        "manifest_hash",
      ],
      verified_access_manifest_bundles_organization_recent_idx: [
        "organization_id",
        "verified_at DESC",
        "manifest_hash",
      ],
    };
    for (const [indexName, columns] of Object.entries(indexKeyColumns)) {
      expect(await readIndexKeyColumns(execSql, indexName)).toEqual(columns);
    }
    expect(
      readRecordValue(
        await readIndexList(execSql, "containers"),
        "containers_parent_idx",
      ),
    ).toEqual({ partial: 1, unique: 0 });

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
    // A lane checked before any cursor exists keeps a null watermark.
    for (const column of [
      "watermark_updated_at",
      "watermark_id",
      "updated_at",
      "checked_at",
    ]) {
      expect(readRecordValue(containerSyncWatermarks, column)).toEqual({
        defaultValue: null,
        notNull: 0,
        pk: 0,
        type: "TEXT",
      });
    }

    const intentIndexes = await readIndexList(execSql, "local_intents");
    expect(
      readRecordValue(intentIndexes, "local_intents_lane_status_created_idx"),
    ).toEqual({
      partial: 0,
      unique: 0,
    });
    expect(
      await readIndexColumns(execSql, "local_intents_lane_status_created_idx"),
    ).toEqual(["lane", "sync_status", "created_at"]);
    // One intent per subject within a lane; a container may hold a create and
    // a move at once.
    const uniqueIntentColumns = await Promise.all(
      Object.entries(intentIndexes)
        .filter(([, index]) => index.unique === 1)
        .map(([name]) => readIndexColumns(execSql, name)),
    );
    expect(uniqueIntentColumns).toContainEqual(["lane", "subject_id"]);

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

test("principal policy schema rejects a legacy database that cannot authenticate grants", async () => {
  const { close, execSql } = await createTestExecSql(
    "principal-policy-legacy-schema-test",
  );
  try {
    await execSql(`
      CREATE TABLE principal_policies (
        principal_type TEXT NOT NULL,
        principal_id TEXT NOT NULL,
        PRIMARY KEY (principal_type, principal_id)
      )
    `);
    const currentPolicyTable = principalPolicyTables[0];
    if (!currentPolicyTable) {
      throw new Error("Principal policy table schema is missing");
    }
    await expect(
      ensureSqlTables(execSql, [currentPolicyTable]),
    ).rejects.toThrow(
      "Local database schema for principal_policies is obsolete; reset the local database before continuing",
    );
  } finally {
    close();
  }
});

// #2522 flag day: the write queue moved into the update log. A database from
// before it is refused at startup, never migrated; its queue goes with it.
test("document schema rejects a database from before the unified update log", async () => {
  const { close, execSql } = await createTestExecSql(
    "document-update-log-legacy-schema-test",
  );
  try {
    await execSql(`CREATE TABLE document_pending_updates (
      id TEXT PRIMARY KEY, app_kind TEXT NOT NULL, local_id TEXT NOT NULL,
      update_data TEXT NOT NULL, created_at TEXT NOT NULL
    )`);
    await execSql(`CREATE TABLE document_history_updates (
      id TEXT PRIMARY KEY, app_kind TEXT NOT NULL, local_id TEXT NOT NULL,
      update_data TEXT NOT NULL, origin TEXT NOT NULL, created_at TEXT NOT NULL
    )`);
    await expect(ensureSqlTables(execSql, documentTables)).rejects.toThrow(
      "Local database schema for document_history_updates is obsolete; reset the local database before continuing",
    );
  } finally {
    close();
  }
});
