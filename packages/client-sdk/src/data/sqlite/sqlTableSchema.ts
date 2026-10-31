import { SQL } from "drizzle-orm";
import {
  getTableConfig,
  type Index,
  type IndexColumn,
  type SQLiteColumn,
  SQLiteSyncDialect,
  type SQLiteTable,
} from "drizzle-orm/sqlite-core";
import type { ExecSql } from "./sqlExec";
import {
  hasCompletedConnectionOnce,
  markCompletedConnectionOnce,
  runSerializedSqlMutation,
} from "./sqlExec";
import { sqliteRowsPerStatement } from "./sqliteBindBudget";

export interface SqlTableSchema {
  name: string;
  createSql: string;
  indexes?: ReadonlyArray<string>;
  requiredColumns?: ReadonlyArray<string>;
}

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

/**
 * Render a Drizzle SQLite table definition into executable schema SQL.
 *
 * The client runtime creates local tables through `ensureSqlTables`, which works
 * with raw SQL strings rather than Drizzle migrations. This helper keeps the
 * Drizzle table definitions as the source of truth while preserving primary
 * keys, table-level unique constraints, partial indexes, default values, and
 * identifier quoting.
 */
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

function getTableEnsureKey(table: SqlTableSchema): string {
  return `sql-table:${table.name}`;
}

// Two binds per table; the schema has far fewer tables than this.
const REQUIRED_COLUMN_TABLES_PER_STATEMENT = sqliteRowsPerStatement(2);

// One read of every checked table's stored columns. The first obsolete table,
// in ensure order, fails before any index DDL runs.
async function assertRequiredColumns(
  execSql: ExecSql,
  tables: ReadonlyArray<SqlTableSchema>,
): Promise<void> {
  const checked = tables.filter(
    (table) => (table.requiredColumns?.length ?? 0) > 0,
  );
  const storedColumns = new Map<string, Set<string>>();
  for (
    let offset = 0;
    offset < checked.length;
    offset += REQUIRED_COLUMN_TABLES_PER_STATEMENT
  ) {
    const batch = checked.slice(
      offset,
      offset + REQUIRED_COLUMN_TABLES_PER_STATEMENT,
    );
    const rows = await execSql(
      batch
        .map(() => "SELECT ? AS table_name, name FROM pragma_table_info(?)")
        .join(" UNION ALL "),
      batch.flatMap((table) => [table.name, table.name]),
    );
    for (const { name, table_name: tableName } of rows) {
      const tableKey = String(tableName);
      const columns = storedColumns.get(tableKey) ?? new Set<string>();
      columns.add(String(name));
      storedColumns.set(tableKey, columns);
    }
  }
  for (const table of checked) {
    const stored = storedColumns.get(table.name);
    if (table.requiredColumns?.some((column) => !stored?.has(column))) {
      throw new Error(
        `Local database schema for ${table.name} is obsolete; reset the local database before continuing`,
      );
    }
  }
}

// Table ensures run on every query path, so completed ones are
// remembered per connection: a re-ensure of an already-ensured table skips the
// DDL round-trips AND the serialized mutation lock, keeping diagnostic reads
// from queueing behind bulk-import writes just to re-issue CREATE IF NOT
// EXISTS no-ops. `resetConnectionSchemaMemo` forgets the memo when the schema
// is rebuilt out from under the runtime (local backup restore).
export async function ensureSqlTables(
  execSql: ExecSql,
  tables: ReadonlyArray<SqlTableSchema>,
): Promise<void> {
  const pendingByName = new Map<string, SqlTableSchema>();
  for (const table of tables) {
    if (
      !pendingByName.has(table.name) &&
      !hasCompletedConnectionOnce(execSql, getTableEnsureKey(table))
    ) {
      pendingByName.set(table.name, table);
    }
  }
  const pendingTables = [...pendingByName.values()];
  if (pendingTables.length === 0) {
    return;
  }

  // Each statement is a worker message, so the DDL travels in three: every
  // CREATE TABLE, then the required-column read (an obsolete table fails
  // before an index can trip over a missing column), then every CREATE INDEX.
  await runSerializedSqlMutation(execSql, async (lockedExecSql) => {
    await lockedExecSql(
      pendingTables.map((table) => table.createSql).join(";\n"),
    );
    await assertRequiredColumns(lockedExecSql, pendingTables);
    const indexSql = pendingTables.flatMap((table) => table.indexes ?? []);
    if (indexSql.length > 0) {
      await lockedExecSql(indexSql.join(";\n"));
    }
  });
  for (const table of pendingTables) {
    markCompletedConnectionOnce(execSql, getTableEnsureKey(table));
  }
}
