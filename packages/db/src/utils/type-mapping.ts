import type { ColumnType } from '../schema/types.js';

/**
 * SQLite type information for code generation.
 */
export interface SqliteTypeInfo {
  /** The Drizzle function name (e.g., 'text', 'integer') */
  drizzleType: string;
  /** Mode option for the column (e.g., 'timestamp_ms', 'boolean') */
  mode?: 'timestamp_ms' | 'boolean';
}

/**
 * PostgreSQL type information for code generation.
 */
export interface PostgresTypeInfo {
  /** The Drizzle function name (e.g., 'text', 'integer', 'boolean') */
  drizzleType: string;
  /** Whether to use withTimezone option for timestamps */
  withTimezone?: boolean;
}

/**
 * SQLite type mappings for each column type.
 */
export const SQLITE_TYPE_MAP: Record<ColumnType, SqliteTypeInfo> = {
  text: { drizzleType: 'text' },
  integer: { drizzleType: 'integer' },
  boolean: { drizzleType: 'integer', mode: 'boolean' },
  timestamp: { drizzleType: 'integer', mode: 'timestamp_ms' },
  json: { drizzleType: 'text' }
};

/**
 * PostgreSQL type mappings for each column type.
 */
export const POSTGRES_TYPE_MAP: Record<ColumnType, PostgresTypeInfo> = {
  text: { drizzleType: 'text' },
  integer: { drizzleType: 'integer' },
  boolean: { drizzleType: 'boolean' },
  timestamp: { drizzleType: 'timestamp', withTimezone: true },
  json: { drizzleType: 'jsonb' }
};

/**
 * Get SQLite type info for a column type.
 */
export function getSqliteTypeInfo(columnType: ColumnType): SqliteTypeInfo {
  return SQLITE_TYPE_MAP[columnType];
}

/**
 * Get PostgreSQL type info for a column type.
 */
export function getPostgresTypeInfo(columnType: ColumnType): PostgresTypeInfo {
  return POSTGRES_TYPE_MAP[columnType];
}

/**
 * Format a default value for code generation.
 * Works for both SQLite and PostgreSQL.
 */
export function formatDefaultValue(
  value: string | number | boolean,
  columnType: ColumnType
): string {
  if (columnType === 'boolean') {
    return String(value);
  }
  if (typeof value === 'string') {
    return `'${value}'`;
  }
  return String(value);
}
