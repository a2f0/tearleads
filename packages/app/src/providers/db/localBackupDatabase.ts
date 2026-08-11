import {
  type ExecSql,
  resetConnectionSchemaMemo,
  runSerializedSqlMutation,
  type SqlRow,
  type SqlRowValue,
} from "@tearleads/client-sdk/sqlite";
import type {
  BackupIndex,
  BackupSqlValue,
  BackupTable,
} from "./localBackupFormat";
import {
  isSecurityAnchorTableName,
  mergeSecurityAnchorBackupTables,
} from "./securityAnchorBackupMerge";

interface UserTableDefinition {
  readonly name: string;
  readonly sql: string;
}

interface UserIndexDefinition {
  readonly name: string;
  readonly sql: string;
  readonly tableName: string;
}

interface DatabaseBackupProgress {
  readonly current: number;
  readonly item: string;
  readonly phase: "database";
  readonly total: number;
}

function readString(row: SqlRow, key: string): string {
  const value = row[key];
  return typeof value === "string" ? value : "";
}

function readNumber(row: SqlRow | undefined, key: string): number {
  const value = row?.[key];
  return typeof value === "number" ? value : 0;
}

export function quoteSqlIdentifier(identifier: string): string {
  return `"${identifier.replaceAll('"', '""')}"`;
}

function normalizeSqlValue(value: SqlRowValue | undefined): BackupSqlValue {
  return value === undefined ? null : value;
}

function normalizeBackupSqlValue(value: BackupSqlValue): SqlRowValue {
  return value;
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
    .filter((table) => table.name);
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
    .filter((index) => index.name && index.sql);
}

async function readTableBackup(
  execSql: ExecSql,
  table: UserTableDefinition,
): Promise<BackupTable> {
  const columnRows = await execSql(
    `PRAGMA table_info(${quoteSqlIdentifier(table.name)})`,
  );
  const columns = columnRows
    .map((row) => readString(row, "name"))
    .filter(Boolean);
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

async function readSecurityAnchorTableBackups(input: {
  readonly execSql: ExecSql;
  readonly tables: ReadonlyArray<UserTableDefinition>;
}): Promise<BackupTable[]> {
  const backups: BackupTable[] = [];
  for (const table of input.tables) {
    if (isSecurityAnchorTableName(table.name)) {
      backups.push(await readTableBackup(input.execSql, table));
    }
  }
  return backups;
}

export async function readBackupDatabase(input: {
  readonly execSql: ExecSql;
  readonly onProgress?:
    | ((progress: DatabaseBackupProgress) => void)
    | undefined;
}): Promise<{
  readonly indexes: BackupIndex[];
  readonly tableNames: ReadonlySet<string>;
  readonly tables: BackupTable[];
}> {
  const tableDefinitions = await listUserTableDefinitions(input.execSql);
  const indexDefinitions = await listUserIndexDefinitions(input.execSql);
  const tables: BackupTable[] = [];
  for (const [index, table] of tableDefinitions.entries()) {
    input.onProgress?.({
      current: index + 1,
      item: table.name,
      phase: "database",
      total: tableDefinitions.length,
    });
    tables.push(await readTableBackup(input.execSql, table));
  }

  return {
    indexes: indexDefinitions.map((index): BackupIndex => ({ ...index })),
    tableNames: new Set(tableDefinitions.map((table) => table.name)),
    tables,
  };
}

export async function preflightSecurityAnchorRestore(input: {
  readonly execSql: ExecSql;
  readonly restoredTables: ReadonlyArray<BackupTable>;
}): Promise<void> {
  await runSerializedSqlMutation(input.execSql, async (execSql) => {
    await execSql("BEGIN");
    try {
      const currentDefinitions = await listUserTableDefinitions(execSql);
      const current = await readSecurityAnchorTableBackups({
        execSql,
        tables: currentDefinitions,
      });
      mergeSecurityAnchorBackupTables({
        current,
        restored: input.restoredTables,
      });
      await execSql("COMMIT");
    } catch (error) {
      await execSql("ROLLBACK").catch(() => undefined);
      throw error;
    }
  });
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

export async function restoreBackupDatabase(input: {
  readonly execSql: ExecSql;
  readonly indexes: ReadonlyArray<BackupIndex>;
  readonly tables: ReadonlyArray<BackupTable>;
}): Promise<void> {
  await runSerializedSqlMutation(input.execSql, async (execSql) => {
    const wasForeignKeysEnabled =
      readNumber((await execSql("PRAGMA foreign_keys"))[0], "foreign_keys") ===
      1;
    if (wasForeignKeysEnabled) {
      await execSql("PRAGMA foreign_keys = OFF");
    }

    try {
      await execSql("BEGIN IMMEDIATE");
      try {
        const currentTables = await listUserTableDefinitions(execSql);
        const currentSecurityAnchors = await readSecurityAnchorTableBackups({
          execSql,
          tables: currentTables,
        });
        // Repeating the merge under the write transaction closes the gap
        // between the side-effect-free preflight and the authoritative write.
        const restoredTables = mergeSecurityAnchorBackupTables({
          current: currentSecurityAnchors,
          restored: input.tables,
        });
        for (const table of [...currentTables].reverse()) {
          await execSql(
            `DROP TABLE IF EXISTS ${quoteSqlIdentifier(table.name)}`,
          );
        }
        for (const table of restoredTables) {
          await execSql(table.sql);
        }
        for (const table of restoredTables) {
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
    } finally {
      if (wasForeignKeysEnabled) {
        await execSql("PRAGMA foreign_keys = ON").catch(() => undefined);
      }
      // The restore rebuilt every user table, so completed schema-ensure memos
      // for this connection are stale. Forget them so the next query re-runs
      // its schema ensures.
      resetConnectionSchemaMemo(input.execSql);
    }
  });
}
