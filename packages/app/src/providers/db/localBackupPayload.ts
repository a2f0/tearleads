export const BACKUP_PAYLOAD_FORMAT = "tearleads.local-backup.payload";
// v3: greenfield reset (2026-07). Backups written before the reset carry the
// pre-reset schema (row-blob content, no durable-history tables) and are
// rejected outright rather than restored into a shape the runtime no longer
// understands.
// v4: history tail rows gained a NOT NULL `origin` provenance column; a v3
// backup would restore the table without it and break every subsequent
// history write.
// v5: container create intents gained a `last_attempted_at` column; a v4
// backup would restore the table without it and break every create-intent
// write, whose INSERT/UPDATE statements name the column.
// v6: the organization read-model group-members cache replaced its
// `member_principal_type`/`member_principal_id` columns with a single `user_id`
// when group nesting was removed; a v5 backup would restore the table with the
// old NOT NULL columns and break every read-model write, whose INSERT
// statements no longer name them.
// v7: document rows gained the durable `pull_continuation` column. A v6
// backup would restore the table without it and break every full record read.
export const BACKUP_FORMAT_VERSION = 7;

export type BackupSqlValue = string | number | null;
export type BackupSqlRow = Record<string, BackupSqlValue>;

export interface BackupSummary {
  readonly blobBytes: number;
  readonly blobCount: number;
  readonly missingBlobCount: number;
  readonly rowCount: number;
  readonly tableCount: number;
}

export interface BackupTable {
  readonly columns: ReadonlyArray<string>;
  readonly name: string;
  readonly rows: ReadonlyArray<BackupSqlRow>;
  readonly sql: string;
}

export interface BackupIndex {
  readonly name: string;
  readonly sql: string;
  readonly tableName: string;
}

export interface BackupBlob {
  readonly byteLength: number;
  readonly bytesBase64: string;
  readonly storageKey: string;
}

export interface BackupPayload {
  readonly blobs: ReadonlyArray<BackupBlob>;
  readonly createdAt: string;
  readonly database: {
    readonly indexes: ReadonlyArray<BackupIndex>;
    readonly tables: ReadonlyArray<BackupTable>;
  };
  readonly format: typeof BACKUP_PAYLOAD_FORMAT;
  readonly missingBlobStorageKeys: ReadonlyArray<string>;
  readonly source: {
    readonly databaseId: string | null;
    readonly signingFingerprint: string | null;
    readonly userAgent: string | null;
  };
  readonly summary: BackupSummary;
  readonly version: typeof BACKUP_FORMAT_VERSION;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function readRecord(
  value: unknown,
  label: string,
): Record<string, unknown> {
  if (!isRecord(value)) {
    throw new Error(`${label} must be an object.`);
  }

  return value;
}

export function readProperty(
  record: Record<string, unknown>,
  key: string,
): unknown {
  return record[key];
}

function readArray(value: unknown, label: string): unknown[] {
  if (!Array.isArray(value)) {
    throw new Error(`${label} must be an array.`);
  }

  return value;
}

export function readString(value: unknown, label: string): string {
  if (typeof value !== "string") {
    throw new Error(`${label} must be a string.`);
  }

  return value;
}

function readNullableString(value: unknown, label: string): string | null {
  if (value === null) {
    return null;
  }

  return readString(value, label);
}

export function readNumber(value: unknown, label: string): number {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw new Error(`${label} must be a finite number.`);
  }

  return value;
}

function readBackupSqlValue(value: unknown, label: string): BackupSqlValue {
  if (value === null || typeof value === "string") {
    return value;
  }

  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }

  throw new Error(`${label} must be a string, number, or null.`);
}

function readStringArray(value: unknown, label: string): string[] {
  return readArray(value, label).map((item, index) =>
    readString(item, `${label}[${index}]`),
  );
}

export function parseJson(text: string): unknown {
  try {
    const parsed: unknown = JSON.parse(text);
    return parsed;
  } catch (error) {
    throw new Error("Backup file must be valid JSON.", { cause: error });
  }
}

function validateBackupTable(value: unknown, index: number): BackupTable {
  const table = readRecord(value, `Backup table ${index + 1}`);
  const columns = readStringArray(
    readProperty(table, "columns"),
    `Backup table ${index + 1} columns`,
  );
  const rows = readArray(
    readProperty(table, "rows"),
    `Backup table ${index + 1} rows`,
  ).map((rowValue, rowIndex) => {
    const row = readRecord(
      rowValue,
      `Backup table ${index + 1} row ${rowIndex + 1}`,
    );

    return Object.fromEntries(
      columns.map((column) => [
        column,
        readBackupSqlValue(
          row[column],
          `Backup table ${index + 1} row ${rowIndex + 1} column ${column}`,
        ),
      ]),
    );
  });

  return {
    columns,
    name: readString(
      readProperty(table, "name"),
      `Backup table ${index + 1} name`,
    ),
    rows,
    sql: readString(
      readProperty(table, "sql"),
      `Backup table ${index + 1} SQL`,
    ),
  };
}

function validateBackupIndex(value: unknown, index: number): BackupIndex {
  const backupIndex = readRecord(value, `Backup index ${index + 1}`);

  return {
    name: readString(
      readProperty(backupIndex, "name"),
      `Backup index ${index + 1} name`,
    ),
    sql: readString(
      readProperty(backupIndex, "sql"),
      `Backup index ${index + 1} SQL`,
    ),
    tableName: readString(
      readProperty(backupIndex, "tableName"),
      `Backup index ${index + 1} table name`,
    ),
  };
}

function validateBackupBlob(value: unknown, index: number): BackupBlob {
  const blob = readRecord(value, `Backup blob ${index + 1}`);

  return {
    byteLength: readNumber(
      readProperty(blob, "byteLength"),
      `Backup blob ${index + 1} size`,
    ),
    bytesBase64: readString(
      readProperty(blob, "bytesBase64"),
      `Backup blob ${index + 1} bytes`,
    ),
    storageKey: readString(
      readProperty(blob, "storageKey"),
      `Backup blob ${index + 1} storage key`,
    ),
  };
}

export function validateBackupPayload(value: unknown): BackupPayload {
  const payload = readRecord(value, "Backup payload");
  if (readProperty(payload, "format") !== BACKUP_PAYLOAD_FORMAT) {
    throw new Error("Backup payload format is not supported.");
  }
  if (readProperty(payload, "version") !== BACKUP_FORMAT_VERSION) {
    throw new Error("Backup payload version is not supported.");
  }

  const database = readRecord(
    readProperty(payload, "database"),
    "Backup database",
  );
  const source = readRecord(readProperty(payload, "source"), "Backup source");
  const summary = readRecord(
    readProperty(payload, "summary"),
    "Backup summary",
  );

  return {
    blobs: readArray(readProperty(payload, "blobs"), "Backup blobs").map(
      validateBackupBlob,
    ),
    createdAt: readString(
      readProperty(payload, "createdAt"),
      "Backup creation date",
    ),
    database: {
      indexes: readArray(
        readProperty(database, "indexes"),
        "Backup database indexes",
      ).map(validateBackupIndex),
      tables: readArray(
        readProperty(database, "tables"),
        "Backup database tables",
      ).map(validateBackupTable),
    },
    format: BACKUP_PAYLOAD_FORMAT,
    missingBlobStorageKeys: readStringArray(
      readProperty(payload, "missingBlobStorageKeys"),
      "Backup missing blob keys",
    ),
    source: {
      databaseId: readNullableString(
        readProperty(source, "databaseId"),
        "Backup database ID",
      ),
      signingFingerprint: readNullableString(
        readProperty(source, "signingFingerprint"),
        "Backup signing fingerprint",
      ),
      userAgent: readNullableString(
        readProperty(source, "userAgent"),
        "Backup user agent",
      ),
    },
    summary: {
      blobBytes: readNumber(
        readProperty(summary, "blobBytes"),
        "Backup blob bytes",
      ),
      blobCount: readNumber(
        readProperty(summary, "blobCount"),
        "Backup blob count",
      ),
      missingBlobCount: readNumber(
        readProperty(summary, "missingBlobCount"),
        "Backup missing blob count",
      ),
      rowCount: readNumber(
        readProperty(summary, "rowCount"),
        "Backup row count",
      ),
      tableCount: readNumber(
        readProperty(summary, "tableCount"),
        "Backup table count",
      ),
    },
    version: BACKUP_FORMAT_VERSION,
  };
}
