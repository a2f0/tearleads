import { type SQL, sql } from "drizzle-orm";
import type { SQLiteColumn } from "drizzle-orm/sqlite-core";

/**
 * The value a multi-row upsert proposed for `column`. A `set` clause needs it
 * to apply each conflicting row's own value rather than one shared value.
 */
export function excludedValue(column: SQLiteColumn): SQL {
  return sql`excluded.${sql.identifier(column.name)}`;
}
