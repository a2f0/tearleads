import type { ColumnDefinition, TableDefinition } from '../schema/types.js';
import {
  formatDefaultValue,
  getPostgresTypeInfo
} from '../utils/type-mapping.js';

/**
 * Generate a PostgreSQL column definition.
 */
function generateColumn(
  propertyName: string,
  column: ColumnDefinition
): string {
  const typeInfo = getPostgresTypeInfo(column.type);

  // Build column type expression
  let result: string;
  if (typeInfo.withTimezone) {
    result = `${propertyName}: ${typeInfo.drizzleType}('${column.sqlName}', { withTimezone: true })`;
  } else if (column.enumValues) {
    const enumStr = column.enumValues.map((v) => `'${v}'`).join(', ');
    result = `${propertyName}: ${typeInfo.drizzleType}('${column.sqlName}', {\n      enum: [${enumStr}]\n    })`;
  } else {
    result = `${propertyName}: ${typeInfo.drizzleType}('${column.sqlName}')`;
  }

  // Primary key
  if (column.primaryKey) {
    result += '.primaryKey()';
  }

  // Not null
  if (column.notNull) {
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
 * Generate a PostgreSQL table definition.
 */
function generateTable(table: TableDefinition): string {
  const lines: string[] = [];

  // JSDoc comment
  if (table.comment) {
    lines.push('/**');
    for (const line of table.comment.split('\n')) {
      lines.push(` * ${line}`);
    }
    lines.push(' */');
  }

  // Table definition
  const hasIndexes = table.indexes && table.indexes.length > 0;

  if (hasIndexes) {
    lines.push(`export const ${table.propertyName} = pgTable(`);
    lines.push(`  '${table.name}',`);
    lines.push('  {');
  } else {
    lines.push(
      `export const ${table.propertyName} = pgTable('${table.name}', {`
    );
  }

  // Columns
  const columnEntries = Object.entries(table.columns);
  columnEntries.forEach(([propertyName, column], i) => {
    const columnStr = generateColumn(propertyName, column);
    const indent = hasIndexes ? '    ' : '  ';
    const comma = i < columnEntries.length - 1 ? ',' : '';
    lines.push(`${indent}${columnStr}${comma}`);
  });

  if (hasIndexes && table.indexes) {
    lines.push('  },');
    lines.push('  (table) => [');

    // Indexes
    const indexes = table.indexes;
    indexes.forEach((idx, i) => {
      const columnRefs = idx.columns.map((col) => `table.${col}`).join(', ');
      const comma = i < indexes.length - 1 ? ',' : '';
      const indexFn = idx.unique ? 'uniqueIndex' : 'index';
      lines.push(`    ${indexFn}('${idx.name}').on(${columnRefs})${comma}`);
    });

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
  types.add('pgTable');

  for (const table of tables) {
    if (table.indexes && table.indexes.length > 0) {
      for (const idx of table.indexes) {
        types.add(idx.unique ? 'uniqueIndex' : 'index');
      }
    }
    for (const column of Object.values(table.columns)) {
      const typeInfo = getPostgresTypeInfo(column.type);
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
 * Generate a complete PostgreSQL schema file from table definitions.
 */
export function generatePostgresSchema(tables: TableDefinition[]): string {
  // Build the table name map for reference resolution
  tableNameMap = buildTableNameMap(tables);

  const lines: string[] = [];

  // Imports
  const drizzleTypes = collectDrizzleTypes(tables);
  lines.push(
    `import { ${drizzleTypes.join(', ')} } from 'drizzle-orm/pg-core';`
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

  return lines.join('\n');
}
