import type { BlobBytes, BlobStore } from "@symcrypt/client-sdk";
import {
  type ExecSql,
  runSerializedSqlMutation,
} from "@symcrypt/client-sdk/sqlite";
import { base64ToBytes, bytesToBase64 } from "@symcrypt/encoding";
import {
  preflightSecurityAnchorRestore,
  quoteSqlIdentifier,
  readBackupDatabase,
  restoreBackupDatabase,
} from "./localBackupDatabase";
import {
  BACKUP_FORMAT_VERSION,
  BACKUP_PAYLOAD_FORMAT,
  type BackupBlob,
  type BackupPayload,
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

interface BlobRestoreUndo {
  readonly previousBytes: BlobBytes | null;
  readonly storageKey: string;
}

const ATTACHMENT_BLOB_TABLES = [
  "document_pending_attachments",
  "document_attachment_blob_projection",
] as const;

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

  return rows.flatMap((row) => {
    const { storage_key: storageKey } = row;
    return typeof storageKey === "string" && storageKey ? [storageKey] : [];
  });
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
  const { indexes, tableNames, tables } = await readBackupDatabase({
    execSql,
    onProgress,
  });

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
      indexes,
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

async function rollbackBlobWrites(
  blobStore: BlobStore,
  undo: ReadonlyArray<BlobRestoreUndo>,
): Promise<unknown[]> {
  const errors: unknown[] = [];
  for (const entry of [...undo].reverse()) {
    try {
      if (entry.previousBytes) {
        await blobStore.writeBytes(entry.storageKey, entry.previousBytes);
      } else {
        await blobStore.deleteBytes(entry.storageKey);
      }
    } catch (error) {
      errors.push(error);
    }
  }
  return errors;
}

async function writeBackupBlobs(input: {
  readonly blobStore: BlobStore;
  readonly blobs: ReadonlyArray<BackupBlob>;
  readonly onProgress?: BackupProgressCallback | undefined;
  readonly undo: BlobRestoreUndo[];
}): Promise<void> {
  for (const [index, blob] of input.blobs.entries()) {
    input.onProgress?.({
      current: index + 1,
      item: blob.storageKey,
      phase: "blobs",
      total: input.blobs.length,
    });
    const previousBytes = await input.blobStore.readBytes(blob.storageKey);
    input.undo.push({ previousBytes, storageKey: blob.storageKey });
    await input.blobStore.writeBytes(
      blob.storageKey,
      asBlobBytes(base64ToBytes(blob.bytesBase64)),
    );
  }
}

export async function restoreBackupPayload({
  blobStore,
  execSql,
  onProgress,
  payload,
}: RestoreBackupPayloadInput): Promise<BackupSummary> {
  return runSerializedSqlMutation(execSql, async (lockedExecSql) => {
    await preflightSecurityAnchorRestore({
      execSql: lockedExecSql,
      restoredTables: payload.database.tables,
    });

    const blobUndo: BlobRestoreUndo[] = [];
    try {
      await writeBackupBlobs({
        blobStore,
        blobs: payload.blobs,
        onProgress,
        undo: blobUndo,
      });
      onProgress?.({
        current: 0,
        phase: "restoring",
        total: payload.database.tables.length,
      });
      await restoreBackupDatabase({
        execSql: lockedExecSql,
        indexes: payload.database.indexes,
        tables: payload.database.tables,
      });
      return payload.summary;
    } catch (error) {
      const rollbackErrors = await rollbackBlobWrites(blobStore, blobUndo);
      if (rollbackErrors.length > 0) {
        throw new AggregateError(
          [error, ...rollbackErrors],
          `Backup restore failed and ${rollbackErrors.length} blob rollback operation(s) failed`,
        );
      }
      throw error;
    }
  });
}
