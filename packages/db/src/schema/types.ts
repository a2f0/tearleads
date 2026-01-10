import { isRecord } from '@rapid/shared';

/**
 * Supported column types that can be mapped to both SQLite and PostgreSQL.
 *
 * Type mappings:
 * - text: TEXT in both databases
 * - integer: INTEGER in both databases
 * - boolean: INTEGER (0/1) in SQLite, BOOLEAN in PostgreSQL
 * - timestamp: INTEGER (milliseconds) in SQLite, TIMESTAMP WITH TIME ZONE in PostgreSQL
 * - json: TEXT in SQLite, JSONB in PostgreSQL
 */
export type ColumnType = 'text' | 'integer' | 'boolean' | 'timestamp' | 'json';

/**
 * Column definition with database-agnostic properties.
 */
export interface ColumnDefinition {
  /** The column type */
  type: ColumnType;
  /** Column name in snake_case (used in SQL) */
  sqlName: string;
  /** Whether this column is the primary key */
  primaryKey?: boolean;
  /** Whether this column requires a value (NOT NULL constraint) */
  notNull?: boolean;
  /** Default value (JavaScript value, converted per database) */
  defaultValue?: string | number | boolean;
  /** Enum values for text columns with restricted values */
  enumValues?: readonly string[];
}

/**
 * Index definition for a table.
 */
export interface IndexDefinition {
  /** Index name */
  name: string;
  /** Column property names (camelCase) to include in index */
  columns: string[];
  /** Whether this is a unique index */
  unique?: boolean;
}

/**
 * Complete table definition.
 */
export interface TableDefinition {
  /** Table name in snake_case */
  name: string;
  /** Property name in camelCase (used for export name) */
  propertyName: string;
  /** Column definitions keyed by camelCase property name */
  columns: Record<string, ColumnDefinition>;
  /** Index definitions */
  indexes?: IndexDefinition[];
  /** JSDoc comment for the table */
  comment?: string;
}

/**
 * Type guard to check if a value is a valid ColumnType.
 */
export function isColumnType(value: unknown): value is ColumnType {
  return (
    typeof value === 'string' &&
    ['text', 'integer', 'boolean', 'timestamp', 'json'].includes(value)
  );
}

/**
 * Type guard to check if a value is a valid ColumnDefinition.
 */
export function isColumnDefinition(value: unknown): value is ColumnDefinition {
  if (!isRecord(value)) {
    return false;
  }
  const sqlName = value['sqlName'];
  return (
    isColumnType(value['type']) &&
    typeof sqlName === 'string' &&
    sqlName.length > 0
  );
}

/**
 * Type guard to check if a value is a valid IndexDefinition.
 */
export function isIndexDefinition(value: unknown): value is IndexDefinition {
  if (!isRecord(value)) {
    return false;
  }
  const name = value['name'];
  const columns = value['columns'];
  return (
    typeof name === 'string' &&
    name.length > 0 &&
    Array.isArray(columns) &&
    columns.length > 0 &&
    columns.every((col) => typeof col === 'string')
  );
}

/**
 * Type guard to check if a value is a valid TableDefinition.
 */
export function isTableDefinition(value: unknown): value is TableDefinition {
  if (!isRecord(value)) {
    return false;
  }
  const name = value['name'];
  const propertyName = value['propertyName'];
  const columnsVal = value['columns'];
  const indexesVal = value['indexes'];

  if (
    typeof name !== 'string' ||
    name.length === 0 ||
    typeof propertyName !== 'string' ||
    propertyName.length === 0
  ) {
    return false;
  }
  if (!isRecord(columnsVal)) {
    return false;
  }
  for (const col of Object.values(columnsVal)) {
    if (!isColumnDefinition(col)) {
      return false;
    }
  }
  if (indexesVal !== undefined) {
    if (!Array.isArray(indexesVal)) {
      return false;
    }
    for (const idx of indexesVal) {
      if (!isIndexDefinition(idx)) {
        return false;
      }
    }
  }
  return true;
}
