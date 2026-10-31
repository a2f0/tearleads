import {
  clientSQLiteSchema,
  createExecSql,
} from "@tearleads/client-sdk/sqlite";
import { getTableColumns, getTableName } from "drizzle-orm";

const columnsByTable = new Map<string, readonly string[]>(
  Object.values(clientSQLiteSchema).map((table) => [
    getTableName(table),
    Object.values(getTableColumns(table)).map((column) => column.name),
  ]),
);

/**
 * A database with no rows whose table probes report the current schema, so
 * the SDK's table ensures (and their obsolete-schema check) pass. Every other
 * statement returns nothing.
 */
export const emptyDatabaseExecSql = createExecSql({
  exec: async ({ sql, bind }) => ({
    rows: sql.includes("pragma_table_info")
      ? // The probe binds (table name, table name) per table.
        (Array.isArray(bind) ? bind : []).flatMap((name: unknown, index) =>
          index % 2 === 0
            ? (columnsByTable.get(String(name)) ?? []).map((column) => ({
                table_name: String(name),
                name: column,
              }))
            : [],
        )
      : [],
  }),
});
