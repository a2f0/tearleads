import type { ColumnDefinition, TableDefinition } from '../schema/types.js';
import {
  formatDefaultValue,
  getSqliteTypeInfo
} from '../utils/type-mapping.js';

/**
 * Get primary key columns from a table definition.
 */
function getPrimaryKeyColumns(table: TableDefinition): string[] {
  return Object.entries(table.columns)
    .filter(([, col]) => col.primaryKey)
    .map(([name]) => name);
}

/**
 * Check if a table has a composite primary key (multiple PK columns).
 */
function hasCompositePrimaryKey(table: TableDefinition): boolean {
  return getPrimaryKeyColumns(table).length > 1;
}

/**
 * Generate a SQLite column definition.
 */
function generateColumn(
  propertyName: string,
  column: ColumnDefinition,
  isCompositePk: boolean
): string {
  const typeInfo = getSqliteTypeInfo(column.type);

  // Build column type expression
  let result: string;
  if (typeInfo.mode) {
    result = `${propertyName}: ${typeInfo.drizzleType}('${column.sqlName}', { mode: '${typeInfo.mode}' })`;
  } else if (column.enumValues) {
    const enumStr = column.enumValues.map((v) => `'${v}'`).join(', ');
    result = `${propertyName}: ${typeInfo.drizzleType}('${column.sqlName}', {\n      enum: [${enumStr}]\n    })`;
  } else {
    result = `${propertyName}: ${typeInfo.drizzleType}('${column.sqlName}')`;
  }

  // Primary key - only add .primaryKey() for single-column PKs
  // Composite PKs are handled in the table config block
  if (column.primaryKey && !isCompositePk) {
    result += '.primaryKey()';
  }

  // Not null - composite PK columns are implicitly NOT NULL
  if (column.notNull || (column.primaryKey && isCompositePk)) {
    result += '.notNull()';
  }

  // References
  if (column.references) {
    const { table, column: columnName, onDelete } = column.references;
    const tablePropertyName = getPropertyName(table);
    const options = onDelete ? `, { onDelete: '${onDelete}' }` : '';
    result += `.references(() => ${tablePropertyName}.${columnName}${options})`;
  }

  // Default value
  if (column.defaultValue !== undefined) {
    const formattedValue = formatDefaultValue(column.defaultValue, column.type);
    result += `.default(${formattedValue})`;
  }

  return result;
}

/**
 * Generate a SQLite table definition.
 */
function generateTable(table: TableDefinition): string {
  const lines: string[] = [];
  const isCompositePk = hasCompositePrimaryKey(table);
  const pkColumns = getPrimaryKeyColumns(table);

  // JSDoc comment
  if (table.comment) {
    lines.push('/**');
    for (const line of table.comment.split('\n')) {
      lines.push(` * ${line}`);
    }
    lines.push(' */');
  }

  // Determine if we need a table config block (for indexes or composite PK)
  const hasIndexes = table.indexes && table.indexes.length > 0;
  const needsConfigBlock = hasIndexes || isCompositePk;

  if (needsConfigBlock) {
    lines.push(`export const ${table.propertyName} = sqliteTable(`);
    lines.push(`  '${table.name}',`);
    lines.push('  {');
  } else {
    lines.push(
      `export const ${table.propertyName} = sqliteTable('${table.name}', {`
    );
  }

  // Columns
  const columnEntries = Object.entries(table.columns);
  columnEntries.forEach(([propertyName, column], i) => {
    const columnStr = generateColumn(propertyName, column, isCompositePk);
    const indent = needsConfigBlock ? '    ' : '  ';
    const comma = i < columnEntries.length - 1 ? ',' : '';
    lines.push(`${indent}${columnStr}${comma}`);
  });

  if (needsConfigBlock) {
    lines.push('  },');
    lines.push('  (table) => [');

    const configItems: string[] = [];

    // Add composite primary key first
    if (isCompositePk) {
      const columnRefs = pkColumns.map((col) => `table.${col}`).join(', ');
      configItems.push(`    primaryKey({ columns: [${columnRefs}] })`);
    }

    // Add indexes
    if (table.indexes) {
      for (const idx of table.indexes) {
        const columnRefs = idx.columns.map((col) => `table.${col}`).join(', ');
        const indexFn = idx.unique ? 'uniqueIndex' : 'index';
        configItems.push(`    ${indexFn}('${idx.name}').on(${columnRefs})`);
      }
    }

    // Join with commas
    lines.push(configItems.join(',\n'));

    lines.push('  ]');
    lines.push(');');
  } else {
    lines.push('});');
  }

  return lines.join('\n');
}

/**
 * Collect all unique Drizzle type functions needed for the schema.
 */
function collectDrizzleTypes(tables: TableDefinition[]): string[] {
  const types = new Set<string>();
  types.add('sqliteTable');

  for (const table of tables) {
    // Check for composite primary key
    if (hasCompositePrimaryKey(table)) {
      types.add('primaryKey');
    }

    if (table.indexes && table.indexes.length > 0) {
      for (const idx of table.indexes) {
        types.add(idx.unique ? 'uniqueIndex' : 'index');
      }
    }
    for (const column of Object.values(table.columns)) {
      const typeInfo = getSqliteTypeInfo(column.type);
      types.add(typeInfo.drizzleType);
    }
  }

  // Sort for consistent output
  return Array.from(types).sort();
}

/**
 * Build a mapping from SQL table names to JavaScript property names.
 */
function buildTableNameMap(tables: TableDefinition[]): Map<string, string> {
  const map = new Map<string, string>();
  for (const table of tables) {
    map.set(table.name, table.propertyName);
  }
  return map;
}

// Module-level variable to hold the table name map during generation
let tableNameMap: Map<string, string> = new Map();

/**
 * Get the JavaScript property name for a SQL table name.
 */
function getPropertyName(sqlTableName: string): string {
  const propertyName = tableNameMap.get(sqlTableName);
  if (!propertyName) {
    throw new Error(
      `Unknown table reference: ${sqlTableName}. Make sure the referenced table is defined in allTables.`
    );
  }
  return propertyName;
}

/**
 * Generate a complete SQLite schema file from table definitions.
 */
export function generateSqliteSchema(tables: TableDefinition[]): string {
  // Build the table name map for reference resolution
  tableNameMap = buildTableNameMap(tables);

  const lines: string[] = [];

  // Imports
  const drizzleTypes = collectDrizzleTypes(tables);
  lines.push(
    `import { ${drizzleTypes.join(', ')} } from 'drizzle-orm/sqlite-core';`
  );
  lines.push(
    "import type { SqliteRemoteDatabase } from 'drizzle-orm/sqlite-proxy';"
  );
  lines.push('');

  // Tables
  tables.forEach((table, i) => {
    lines.push(generateTable(table));
    if (i < tables.length - 1) {
      lines.push('');
    }
  });

  lines.push('');

  // Schema object collecting all tables
  const tableNames = tables.map((t) => t.propertyName);
  lines.push('/**');
  lines.push(' * Schema object containing all table definitions.');
  lines.push(' */');
  lines.push('export const schema = {');
  tableNames.forEach((name, i) => {
    const comma = i < tableNames.length - 1 ? ',' : '';
    lines.push(`  ${name}${comma}`);
  });
  lines.push('};');
  lines.push('');

  // Database type
  lines.push('/**');
  lines.push(' * Database type for SQLite with full schema.');
  lines.push(' */');
  lines.push('export type Database = SqliteRemoteDatabase<typeof schema>;');
  lines.push('');

  return lines.join('\n');
}
