import type { ColumnDefinition, TableDefinition } from '../schema/types.js';
import {
  formatDefaultValue,
  getSqliteTypeInfo
} from '../utils/type-mapping.js';

/**
 * Generate a SQLite column definition.
 */
function generateColumn(
  propertyName: string,
  column: ColumnDefinition,
  tableNameToPropertyName: Map<string, string>
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
    const refPropertyName = tableNameToPropertyName.get(table) ?? table;
    const options = onDelete ? `, { onDelete: '${onDelete}' }` : '';
    result += `.references(() => ${refPropertyName}.${columnName}${options})`;
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
function generateTable(
  table: TableDefinition,
  tableNameToPropertyName: Map<string, string>
): string {
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
    const columnStr = generateColumn(propertyName, column, tableNameToPropertyName);
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
  types.add('sqliteTable');

  for (const table of tables) {
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
 * Generate a complete SQLite schema file from table definitions.
 */
export function generateSqliteSchema(tables: TableDefinition[]): string {
  const lines: string[] = [];

  // Build table name to property name mapping for references
  const tableNameToPropertyName = new Map<string, string>();
  for (const table of tables) {
    tableNameToPropertyName.set(table.name, table.propertyName);
  }

  // Imports
  const drizzleTypes = collectDrizzleTypes(tables);
  lines.push(
    `import { ${drizzleTypes.join(', ')} } from 'drizzle-orm/sqlite-core';`
  );
  lines.push('');

  // Tables
  tables.forEach((table, i) => {
    lines.push(generateTable(table, tableNameToPropertyName));
    if (i < tables.length - 1) {
      lines.push('');
    }
  });

  lines.push('');

  return lines.join('\n');
}
