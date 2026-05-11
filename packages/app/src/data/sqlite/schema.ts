import { SQL, sql } from "drizzle-orm";
import {
  getTableConfig,
  type Index,
  type IndexColumn,
  index,
  integer,
  primaryKey,
  type SQLiteColumn,
  SQLiteSyncDialect,
  type SQLiteTable,
  sqliteTable,
  text,
  uniqueIndex,
} from "drizzle-orm/sqlite-core";
import type { ExecSql, SqlTableSchema } from "./sqlSchema";

const sqliteDialect = new SQLiteSyncDialect();

function renderIdentifier(name: string): string {
  return `"${name.replaceAll('"', '""')}"`;
}

function renderDefaultValue(value: unknown): string {
  if (value === null) {
    return "NULL";
  }

  if (typeof value === "boolean") {
    return value ? "1" : "0";
  }

  if (value instanceof SQL) {
    return sqliteDialect.sqlToQuery(value).sql;
  }

  if (typeof value === "number") {
    return String(value);
  }

  if (typeof value === "string") {
    return `'${value.replaceAll("'", "''")}'`;
  }

  throw new Error(`Unsupported SQLite default value: ${String(value)}`);
}

function renderColumn(
  column: SQLiteColumn,
  inlinePrimaryKeyColumnName?: string,
): string {
  const parts = [
    renderIdentifier(column.name),
    column.getSQLType().toUpperCase(),
  ];

  if (column.notNull) {
    parts.push("NOT NULL");
  }

  if (column.hasDefault) {
    parts.push("DEFAULT", renderDefaultValue(column.default));
  }

  if (column.primary || column.name === inlinePrimaryKeyColumnName) {
    parts.push("PRIMARY KEY");
  }

  if (column.isUnique) {
    parts.push("UNIQUE");
  }

  return parts.join(" ");
}

function renderPrimaryKey(columns: ReadonlyArray<SQLiteColumn>): string {
  const columnNames = columns.map((column) => renderIdentifier(column.name));
  return `PRIMARY KEY (${columnNames.join(", ")})`;
}

function renderUniqueConstraint(columns: ReadonlyArray<SQLiteColumn>): string {
  const columnNames = columns.map((column) => renderIdentifier(column.name));
  return `UNIQUE (${columnNames.join(", ")})`;
}

function isSQLiteColumn(value: IndexColumn): value is SQLiteColumn {
  return (
    "name" in value && typeof value.name === "string" && "getSQLType" in value
  );
}

function renderIndexColumn(column: IndexColumn): string {
  if (isSQLiteColumn(column)) {
    return renderIdentifier(column.name);
  }

  return sqliteDialect.sqlToQuery(column.getSQL(), "indexes").sql;
}

function renderIndex(indexDefinition: Index): string {
  const config = indexDefinition.config;
  const unique = config.unique ? "UNIQUE " : "";
  const columns = config.columns.map(renderIndexColumn).join(", ");
  const where = config.where
    ? ` WHERE ${sqliteDialect.sqlToQuery(config.where, "indexes").sql}`
    : "";

  return `CREATE ${unique}INDEX IF NOT EXISTS ${renderIdentifier(
    config.name,
  )} ON ${renderIdentifier(getTableConfig(config.table).name)} (${columns})${where}`;
}

export function defineSqlTableSchema(table: SQLiteTable): SqlTableSchema {
  const config = getTableConfig(table);
  const inlinePrimaryKeyColumnName =
    config.primaryKeys.length === 1 &&
    config.primaryKeys[0]?.columns.length === 1
      ? config.primaryKeys[0].columns[0]?.name
      : undefined;
  const columns = config.columns.map((column) =>
    renderColumn(column, inlinePrimaryKeyColumnName),
  );
  const primaryKeys = inlinePrimaryKeyColumnName
    ? []
    : config.primaryKeys.map((key) => renderPrimaryKey(key.columns));
  const uniqueConstraints = config.uniqueConstraints.map((constraint) =>
    renderUniqueConstraint(constraint.columns),
  );
  const columnDefinitions = [...columns, ...primaryKeys, ...uniqueConstraints];

  return {
    name: config.name,
    createSql: `CREATE TABLE IF NOT EXISTS ${renderIdentifier(config.name)} (
  ${columnDefinitions.join(",\n  ")}
)`,
    indexes: config.indexes.map(renderIndex),
  };
}

function readSqlRowString(
  row: Record<string, string | number | null>,
  key: string,
): string {
  const value = row[key];
  return typeof value === "string" ? value : "";
}

async function ensureDocumentProjectionMetadataColumns(execSql: ExecSql) {
  const columns = new Set(
    (await execSql('PRAGMA table_info("document_projection")')).map((row) =>
      readSqlRowString(row, "name"),
    ),
  );

  if (!columns.has("document_kind")) {
    await execSql(
      'ALTER TABLE "document_projection" ADD COLUMN "document_kind" TEXT NOT NULL DEFAULT \'note\'',
    );
  }

  if (!columns.has("title")) {
    await execSql(
      'ALTER TABLE "document_projection" ADD COLUMN "title" TEXT NOT NULL DEFAULT \'Untitled note\'',
    );
    await execSql(`
      UPDATE "document_projection"
      SET "title" = CASE
        WHEN trim("text") = '' THEN 'Untitled note'
        WHEN ltrim("text") LIKE '{%' THEN 'Untitled note'
        ELSE COALESCE(
          NULLIF(trim(substr(
            "text",
            1,
            CASE
              WHEN instr("text", char(10)) = 0
                AND instr("text", char(13)) = 0
                THEN length("text")
              WHEN instr("text", char(10)) = 0
                THEN instr("text", char(13)) - 1
              WHEN instr("text", char(13)) = 0
                THEN instr("text", char(10)) - 1
              WHEN instr("text", char(10)) < instr("text", char(13))
                THEN instr("text", char(10)) - 1
              ELSE instr("text", char(13)) - 1
            END
          )), ''),
          'Untitled note'
        )
      END
    `);
  }
}

export const documents = sqliteTable(
  "documents",
  {
    appKind: text("app_kind").notNull(),
    localId: text("local_id").notNull(),
    documentId: text("document_id"),
    loroSnapshot: text("loro_snapshot").notNull(),
    accessEpoch: integer("access_epoch").notNull().default(1),
    accessStateHash: text("access_state_hash"),
    lastCommitLsn: text("last_commit_lsn"),
    documentManifestBundle: text("document_manifest_bundle"),
    contentKeyBundle: text("content_key_bundle"),
    documentKekTargets: text("document_kek_targets"),
    updatedAt: text("updated_at").notNull(),
  },
  (table) => [
    primaryKey({ columns: [table.appKind, table.localId] }),
    index("documents_app_document_idx")
      .on(table.appKind, table.documentId)
      .where(sql`${table.documentId} IS NOT NULL`),
  ],
);

export const documentPendingUpdates = sqliteTable(
  "document_pending_updates",
  {
    id: text("id"),
    appKind: text("app_kind").notNull(),
    localId: text("local_id").notNull(),
    updateData: text("update_data").notNull(),
    partialStartVersionVector: text("partial_start_version_vector").notNull(),
    partialEndVersionVector: text("partial_end_version_vector").notNull(),
    sourceVersionVector: text("source_version_vector"),
    createdAt: text("created_at").notNull(),
  },
  (table) => [
    primaryKey({ columns: [table.id] }),
    index("document_pending_updates_scope_created_idx").on(
      table.appKind,
      table.localId,
      table.createdAt,
    ),
  ],
);

export const principalPolicies = sqliteTable(
  "principal_policies",
  {
    principalType: text("principal_type").notNull(),
    principalId: text("principal_id").notNull(),
    stateHash: text("state_hash").notNull(),
    currentStateJson: text("current_state_json").notNull(),
    currentPayloadJson: text("current_payload_json").notNull(),
    currentProjectionJson: text("current_projection_json").notNull(),
    currentMemberEnvelopesJson: text("current_member_envelopes_json").notNull(),
    previousStatesJson: text("previous_states_json").notNull(),
    updatedAt: text("updated_at").notNull(),
  },
  (table) => [
    primaryKey({ columns: [table.principalType, table.principalId] }),
  ],
);

export const containers = sqliteTable(
  "containers",
  {
    id: text("id"),
    organizationId: text("organization_id").notNull(),
    parentId: text("parent_id"),
    metadataDocumentId: text("metadata_document_id"),
    updatedAt: text("updated_at").notNull(),
  },
  (table) => [primaryKey({ columns: [table.id] })],
);

export const containerProjection = sqliteTable(
  "container_projection",
  {
    containerId: text("container_id"),
    displayName: text("display_name"),
    icon: text("icon"),
    updatedAt: text("updated_at").notNull(),
  },
  (table) => [primaryKey({ columns: [table.containerId] })],
);

export const documentContainerProjection = sqliteTable(
  "document_container_projection",
  {
    documentId: text("document_id").notNull(),
    containerId: text("container_id").notNull(),
    updatedAt: text("updated_at").notNull(),
  },
  (table) => [primaryKey({ columns: [table.documentId, table.containerId] })],
);

export const documentProjection = sqliteTable(
  "document_projection",
  {
    localId: text("local_id"),
    documentId: text("document_id"),
    containerId: text("container_id"),
    documentKind: text("document_kind", {
      enum: ["note", "drivers_license", "credit_card"],
    })
      .notNull()
      .default("note"),
    text: text("text").notNull(),
    title: text("title").notNull().default("Untitled note"),
    updatedAt: text("updated_at").notNull(),
  },
  (table) => [primaryKey({ columns: [table.localId] })],
);

export const documentPendingAttachments = sqliteTable(
  "document_pending_attachments",
  {
    localId: text("local_id").notNull(),
    slotId: text("slot_id").notNull(),
    name: text("name").notNull(),
    mimeType: text("mime_type"),
    storageKey: text("storage_key").notNull(),
    byteLength: integer("byte_length").notNull(),
    createdAt: text("created_at").notNull(),
  },
  (table) => [primaryKey({ columns: [table.localId, table.slotId] })],
);

export const documentAttachmentBlobProjection = sqliteTable(
  "document_attachment_blob_projection",
  {
    localId: text("local_id").notNull(),
    slotId: text("slot_id").notNull(),
    blobId: text("blob_id"),
    storageKey: text("storage_key").notNull(),
    mimeType: text("mime_type"),
    byteLength: integer("byte_length").notNull(),
    updatedAt: text("updated_at").notNull(),
  },
  (table) => [primaryKey({ columns: [table.localId, table.slotId] })],
);

export const addressBookProjection = sqliteTable(
  "address_book_projection",
  {
    addressBookId: text("address_book_id").notNull(),
    userId: text("user_id").notNull(),
    encapsulationPublicKey: text("encapsulation_public_key").notNull(),
    isSelf: integer("is_self").notNull().default(0),
    updatedAt: text("updated_at").notNull(),
  },
  (table) => [
    primaryKey({ columns: [table.addressBookId, table.userId] }),
    uniqueIndex("address_book_projection_self_idx")
      .on(table.addressBookId)
      .where(sql`${table.isSelf} = 1`),
  ],
);

export const containerCreateIntents = sqliteTable(
  "container_create_intents",
  {
    id: text("id"),
    containerId: text("container_id").notNull().unique(),
    parentContainerId: text("parent_container_id").notNull(),
    intentType: text("intent_type").notNull(),
    syncStatus: text("sync_status").notNull(),
    remoteContainerId: text("remote_container_id"),
    remoteMetadataDocumentId: text("remote_metadata_document_id"),
    remoteMetadataAccessStateHash: text("remote_metadata_access_state_hash"),
    lastError: text("last_error"),
    createdAt: text("created_at").notNull(),
    updatedAt: text("updated_at").notNull(),
  },
  (table) => [
    primaryKey({ columns: [table.id] }),
    index("container_create_intents_status_created_idx").on(
      table.syncStatus,
      table.createdAt,
    ),
  ],
);

export const containerSyncWatermarks = sqliteTable(
  "container_sync_watermarks",
  {
    laneKind: text("lane_kind").notNull(),
    laneId: text("lane_id").notNull(),
    watermarkUpdatedAt: text("watermark_updated_at").notNull(),
    watermarkId: text("watermark_id").notNull(),
    updatedAt: text("updated_at").notNull(),
  },
  (table) => [primaryKey({ columns: [table.laneKind, table.laneId] })],
);

export const documentTables = [
  defineSqlTableSchema(documents),
  defineSqlTableSchema(documentPendingUpdates),
];

export const principalPolicyTables = [defineSqlTableSchema(principalPolicies)];

export const containerTables = [
  defineSqlTableSchema(containers),
  defineSqlTableSchema(containerProjection),
];

export const documentContainerProjectionTables = [
  defineSqlTableSchema(documentContainerProjection),
];

export const documentProjectionTables = [
  {
    ...defineSqlTableSchema(documentProjection),
    migrations: [ensureDocumentProjectionMetadataColumns],
  },
  defineSqlTableSchema(documentPendingAttachments),
  defineSqlTableSchema(documentAttachmentBlobProjection),
];

export const addressBookProjectionTables = [
  defineSqlTableSchema(addressBookProjection),
];

export const containerCreateIntentTables = [
  defineSqlTableSchema(containerCreateIntents),
];

export const containerSyncWatermarkTables = [
  defineSqlTableSchema(containerSyncWatermarks),
];

export const appSqlTables = [
  ...documentTables,
  ...principalPolicyTables,
  ...containerTables,
  ...documentContainerProjectionTables,
  ...documentProjectionTables,
  ...addressBookProjectionTables,
  ...containerCreateIntentTables,
  ...containerSyncWatermarkTables,
];

export const appSQLiteSchema = {
  documents,
  documentPendingUpdates,
  principalPolicies,
  containers,
  containerProjection,
  documentContainerProjection,
  documentProjection,
  documentPendingAttachments,
  documentAttachmentBlobProjection,
  addressBookProjection,
  containerCreateIntents,
  containerSyncWatermarks,
};
