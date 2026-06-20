import type { BlobBytes, BlobStore } from "@tearleads/client-sdk";
import {
  type ExecSql,
  runSerializedSqlMutation,
  type SqlRow,
  type SqlRowValue,
} from "@tearleads/client-sdk/sqlite";
import { base64ToBytes, bytesToBase64 } from "@tearleads/encoding";
import {
  BACKUP_FORMAT_VERSION,
  BACKUP_PAYLOAD_FORMAT,
  type BackupBlob,
  type BackupIndex,
  type BackupPayload,
  type BackupSqlValue,
  type BackupSummary,
  type BackupTable,
} from "./localBackupFormat";

export type BackupProgressPhase =
  | "blobs"
  | "database"
  | "decrypting"
  | "encrypting"
  | "preparing"
  | "restoring";

export interface BackupProgress {
  readonly current: number;
  readonly item?: string | undefined;
  readonly phase: BackupProgressPhase;
  readonly total: number;
}

type BackupProgressCallback = (progress: BackupProgress) => void;

interface CreateBackupPayloadInput {
  readonly blobStore: BlobStore;
  readonly databaseId: string | null;
  readonly execSql: ExecSql;
  readonly onProgress?: BackupProgressCallback | undefined;
  readonly signingFingerprint: string | null;
}

interface RestoreBackupPayloadInput {
  readonly blobStore: BlobStore;
  readonly execSql: ExecSql;
  readonly onProgress?: BackupProgressCallback | undefined;
  readonly payload: BackupPayload;
}

interface UserTableDefinition {
  readonly name: string;
  readonly sql: string;
}

interface UserIndexDefinition {
  readonly name: string;
  readonly sql: string;
  readonly tableName: string;
}

const SYSTEM_TABLE_NAMES = new Set(["__drizzle_migrations"]);
const ATTACHMENT_BLOB_TABLES = [
  "document_pending_attachments",
  "document_attachment_blob_projection",
] as const;

function readString(row: SqlRow, key: string): string {
  const value = row[key];
  return typeof value === "string" ? value : "";
}

function quoteSqlIdentifier(identifier: string): string {
  return `"${identifier.replaceAll('"', '""')}"`;
}

function normalizeSqlValue(value: SqlRowValue | undefined): BackupSqlValue {
  if (value === undefined) {
    return null;
  }

  return value;
}

function normalizeBackupSqlValue(value: BackupSqlValue): SqlRowValue {
  return value;
}

function asBlobBytes(bytes: Uint8Array): BlobBytes {
  const copy: BlobBytes = new Uint8Array(bytes.byteLength);
  copy.set(bytes);
  return copy;
}

function readUserAgent(): string | null {
  if (typeof navigator !== "object") {
    return null;
  }

  return navigator.userAgent;
}

async function listUserTableDefinitions(
  execSql: ExecSql,
): Promise<UserTableDefinition[]> {
  const rows = await execSql(`
    SELECT name, sql
    FROM sqlite_master
    WHERE type = 'table'
      AND name NOT LIKE 'sqlite_%'
      AND sql IS NOT NULL
    ORDER BY name ASC
  `);

  return rows
    .map((row) => ({
      name: readString(row, "name"),
      sql: readString(row, "sql"),
    }))
    .filter((table) => table.name && !SYSTEM_TABLE_NAMES.has(table.name));
}

async function listUserIndexDefinitions(
  execSql: ExecSql,
): Promise<UserIndexDefinition[]> {
  const rows = await execSql(`
    SELECT name, tbl_name, sql
    FROM sqlite_master
    WHERE type = 'index'
      AND name NOT LIKE 'sqlite_%'
      AND sql IS NOT NULL
    ORDER BY name ASC
  `);

  return rows
    .map((row) => ({
      name: readString(row, "name"),
      sql: readString(row, "sql"),
      tableName: readString(row, "tbl_name"),
    }))
    .filter(
      (index) =>
        index.name && index.sql && !SYSTEM_TABLE_NAMES.has(index.tableName),
    );
}

async function readTableColumns(
  execSql: ExecSql,
  tableName: string,
): Promise<string[]> {
  const rows = await execSql(
    `PRAGMA table_info(${quoteSqlIdentifier(tableName)})`,
  );

  return rows.map((row) => readString(row, "name")).filter(Boolean);
}

async function readTableBackup(
  execSql: ExecSql,
  table: UserTableDefinition,
): Promise<BackupTable> {
  const columns = await readTableColumns(execSql, table.name);
  const columnSql = columns.map(quoteSqlIdentifier).join(", ");
  const rows =
    columns.length === 0
      ? []
      : await execSql(
          `SELECT ${columnSql} FROM ${quoteSqlIdentifier(table.name)}`,
        );

  return {
    columns,
    name: table.name,
    rows: rows.map((row) =>
      Object.fromEntries(
        columns.map((column) => [column, normalizeSqlValue(row[column])]),
      ),
    ),
    sql: table.sql,
  };
}

async function listReferencedBlobStorageKeys(input: {
  readonly execSql: ExecSql;
  readonly tableNames: ReadonlySet<string>;
}): Promise<string[]> {
  const sourceQueries = ATTACHMENT_BLOB_TABLES.filter((tableName) =>
    input.tableNames.has(tableName),
  ).map(
    (tableName) =>
      `SELECT storage_key FROM ${quoteSqlIdentifier(tableName)} WHERE storage_key <> ''`,
  );

  if (sourceQueries.length === 0) {
    return [];
  }

  const rows = await input.execSql(`
    SELECT DISTINCT storage_key
    FROM (${sourceQueries.join(" UNION ALL ")})
    ORDER BY storage_key ASC
  `);

  return rows.map((row) => readString(row, "storage_key")).filter(Boolean);
}

async function readBackupBlobs(input: {
  readonly blobStore: BlobStore;
  readonly onProgress?: BackupProgressCallback | undefined;
  readonly storageKeys: ReadonlyArray<string>;
}): Promise<{
  readonly blobs: BackupBlob[];
  readonly missingBlobStorageKeys: string[];
}> {
  const blobs: BackupBlob[] = [];
  const missingBlobStorageKeys: string[] = [];

  for (const [index, storageKey] of input.storageKeys.entries()) {
    input.onProgress?.({
      current: index + 1,
      item: storageKey,
      phase: "blobs",
      total: input.storageKeys.length,
    });
    const bytes = await input.blobStore.readBytes(storageKey);
    if (!bytes) {
      missingBlobStorageKeys.push(storageKey);
      continue;
    }

    blobs.push({
      byteLength: bytes.byteLength,
      bytesBase64: bytesToBase64(bytes),
      storageKey,
    });
  }

  return { blobs, missingBlobStorageKeys };
}

function summarizeBackup(input: {
  readonly blobs: ReadonlyArray<BackupBlob>;
  readonly missingBlobStorageKeys: ReadonlyArray<string>;
  readonly tables: ReadonlyArray<BackupTable>;
}): BackupSummary {
  return {
    blobBytes: input.blobs.reduce((total, blob) => total + blob.byteLength, 0),
    blobCount: input.blobs.length,
    missingBlobCount: input.missingBlobStorageKeys.length,
    rowCount: input.tables.reduce(
      (total, table) => total + table.rows.length,
      0,
    ),
    tableCount: input.tables.length,
  };
}

export async function createBackupPayload({
  blobStore,
  databaseId,
  execSql,
  onProgress,
  signingFingerprint,
}: CreateBackupPayloadInput): Promise<BackupPayload> {
  onProgress?.({ current: 0, phase: "preparing", total: 1 });
  const tableDefinitions = await listUserTableDefinitions(execSql);
  const indexDefinitions = await listUserIndexDefinitions(execSql);
  const tableNames = new Set(tableDefinitions.map((table) => table.name));
  const tables: BackupTable[] = [];

  for (const [index, table] of tableDefinitions.entries()) {
    onProgress?.({
      current: index + 1,
      item: table.name,
      phase: "database",
      total: tableDefinitions.length,
    });
    tables.push(await readTableBackup(execSql, table));
  }

  const storageKeys = await listReferencedBlobStorageKeys({
    execSql,
    tableNames,
  });
  const { blobs, missingBlobStorageKeys } = await readBackupBlobs({
    blobStore,
    onProgress,
    storageKeys,
  });
  const summary = summarizeBackup({ blobs, missingBlobStorageKeys, tables });

  return {
    blobs,
    createdAt: new Date().toISOString(),
    database: {
      indexes: indexDefinitions.map((index): BackupIndex => ({ ...index })),
      tables,
    },
    format: BACKUP_PAYLOAD_FORMAT,
    missingBlobStorageKeys,
    source: {
      databaseId,
      signingFingerprint,
      userAgent: readUserAgent(),
    },
    summary,
    version: BACKUP_FORMAT_VERSION,
  };
}

async function insertBackupTable(input: {
  readonly execSql: ExecSql;
  readonly table: BackupTable;
}): Promise<void> {
  if (input.table.rows.length === 0 || input.table.columns.length === 0) {
    return;
  }

  const tableName = quoteSqlIdentifier(input.table.name);
  const columns = input.table.columns.map(quoteSqlIdentifier).join(", ");
  const placeholders = input.table.columns.map(() => "?").join(", ");
  const sql = `INSERT INTO ${tableName} (${columns}) VALUES (${placeholders})`;

  for (const row of input.table.rows) {
    const values = input.table.columns.map((column) =>
      normalizeBackupSqlValue(row[column] ?? null),
    );
    await input.execSql(sql, values);
  }
}

async function restoreDatabaseTables(input: {
  readonly execSql: ExecSql;
  readonly indexes: ReadonlyArray<BackupIndex>;
  readonly tables: ReadonlyArray<BackupTable>;
}): Promise<void> {
  await runSerializedSqlMutation(input.execSql, async (execSql) => {
    await execSql("BEGIN IMMEDIATE");
    try {
      const currentTables = await listUserTableDefinitions(execSql);
      for (const table of [...currentTables].reverse()) {
        await execSql(`DROP TABLE IF EXISTS ${quoteSqlIdentifier(table.name)}`);
      }

      for (const table of input.tables) {
        await execSql(table.sql);
      }

      for (const table of input.tables) {
        await insertBackupTable({ execSql, table });
      }

      for (const index of input.indexes) {
        await execSql(index.sql);
      }

      await execSql("COMMIT");
    } catch (error) {
      await execSql("ROLLBACK").catch(() => undefined);
      throw error;
    }
  });
}

export async function restoreBackupPayload({
  blobStore,
  execSql,
  onProgress,
  payload,
}: RestoreBackupPayloadInput): Promise<BackupSummary> {
  for (const [index, blob] of payload.blobs.entries()) {
    onProgress?.({
      current: index + 1,
      item: blob.storageKey,
      phase: "blobs",
      total: payload.blobs.length,
    });
    await blobStore.writeBytes(
      blob.storageKey,
      asBlobBytes(base64ToBytes(blob.bytesBase64)),
    );
  }

  onProgress?.({
    current: 0,
    phase: "restoring",
    total: payload.database.tables.length,
  });
  await restoreDatabaseTables({
    execSql,
    indexes: payload.database.indexes,
    tables: payload.database.tables,
  });

  return payload.summary;
}
