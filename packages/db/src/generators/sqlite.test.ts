import { describe, expect, it } from 'vitest';
import type { TableDefinition } from '../schema/types.js';
import { generateSqliteSchema } from './sqlite.js';

describe('generateSqliteSchema', () => {
  it('generates correct import statement with dynamic types', () => {
    // With a table that uses text and integer columns, both should be imported
    const tables: TableDefinition[] = [
      {
        name: 'test',
        propertyName: 'test',
        columns: {
          id: { type: 'text', sqlName: 'id', primaryKey: true },
          count: { type: 'integer', sqlName: 'count', notNull: true }
        },
        indexes: [{ name: 'count_idx', columns: ['count'] }]
      }
    ];
    const result = generateSqliteSchema(tables);
    // Imports are sorted alphabetically
    expect(result).toContain(
      "import { index, integer, sqliteTable, text } from 'drizzle-orm/sqlite-core';"
    );
  });

  it('generates a simple table without indexes', () => {
    const tables: TableDefinition[] = [
      {
        name: 'users',
        propertyName: 'users',
        columns: {
          id: { type: 'text', sqlName: 'id', primaryKey: true },
          name: { type: 'text', sqlName: 'name', notNull: true }
        }
      }
    ];
    const result = generateSqliteSchema(tables);
    expect(result).toContain("export const users = sqliteTable('users', {");
    expect(result).toContain("id: text('id').primaryKey()");
    expect(result).toContain("name: text('name').notNull()");
    expect(result).toContain('});');
  });

  it('generates a table with indexes', () => {
    const tables: TableDefinition[] = [
      {
        name: 'users',
        propertyName: 'users',
        columns: {
          id: { type: 'text', sqlName: 'id', primaryKey: true },
          email: { type: 'text', sqlName: 'email', notNull: true }
        },
        indexes: [{ name: 'email_idx', columns: ['email'] }]
      }
    ];
    const result = generateSqliteSchema(tables);
    expect(result).toContain('export const users = sqliteTable(');
    expect(result).toContain("  'users',");
    expect(result).toContain('  {');
    expect(result).toContain("    id: text('id').primaryKey()");
    expect(result).toContain('  },');
    expect(result).toContain('  (table) => [');
    expect(result).toContain("    index('email_idx').on(table.email)");
    expect(result).toContain('  ]');
    expect(result).toContain(');');
  });

  it('generates composite indexes correctly', () => {
    const tables: TableDefinition[] = [
      {
        name: 'items',
        propertyName: 'items',
        columns: {
          id: { type: 'text', sqlName: 'id', primaryKey: true },
          category: { type: 'text', sqlName: 'category', notNull: true },
          status: { type: 'text', sqlName: 'status', notNull: true }
        },
        indexes: [{ name: 'cat_status_idx', columns: ['category', 'status'] }]
      }
    ];
    const result = generateSqliteSchema(tables);
    expect(result).toContain(
      "index('cat_status_idx').on(table.category, table.status)"
    );
  });

  it('generates boolean columns with mode', () => {
    const tables: TableDefinition[] = [
      {
        name: 'settings',
        propertyName: 'settings',
        columns: {
          id: { type: 'text', sqlName: 'id', primaryKey: true },
          isActive: {
            type: 'boolean',
            sqlName: 'is_active',
            notNull: true,
            defaultValue: false
          }
        }
      }
    ];
    const result = generateSqliteSchema(tables);
    expect(result).toContain(
      "isActive: integer('is_active', { mode: 'boolean' }).notNull().default(false)"
    );
  });

  it('generates timestamp columns with mode', () => {
    const tables: TableDefinition[] = [
      {
        name: 'events',
        propertyName: 'events',
        columns: {
          id: { type: 'text', sqlName: 'id', primaryKey: true },
          createdAt: {
            type: 'timestamp',
            sqlName: 'created_at',
            notNull: true
          }
        }
      }
    ];
    const result = generateSqliteSchema(tables);
    expect(result).toContain(
      "createdAt: integer('created_at', { mode: 'timestamp_ms' }).notNull()"
    );
  });

  it('generates enum columns correctly', () => {
    const tables: TableDefinition[] = [
      {
        name: 'tasks',
        propertyName: 'tasks',
        columns: {
          id: { type: 'text', sqlName: 'id', primaryKey: true },
          status: {
            type: 'text',
            sqlName: 'status',
            notNull: true,
            defaultValue: 'pending',
            enumValues: ['pending', 'active', 'completed']
          }
        }
      }
    ];
    const result = generateSqliteSchema(tables);
    expect(result).toContain("status: text('status', {");
    expect(result).toContain("enum: ['pending', 'active', 'completed']");
    expect(result).toContain("}).notNull().default('pending')");
  });

  it('generates integer columns correctly', () => {
    const tables: TableDefinition[] = [
      {
        name: 'counters',
        propertyName: 'counters',
        columns: {
          id: { type: 'text', sqlName: 'id', primaryKey: true },
          count: {
            type: 'integer',
            sqlName: 'count',
            notNull: true,
            defaultValue: 0
          }
        }
      }
    ];
    const result = generateSqliteSchema(tables);
    expect(result).toContain("count: integer('count').notNull().default(0)");
  });

  it('generates nullable columns correctly', () => {
    const tables: TableDefinition[] = [
      {
        name: 'profiles',
        propertyName: 'profiles',
        columns: {
          id: { type: 'text', sqlName: 'id', primaryKey: true },
          bio: { type: 'text', sqlName: 'bio' }
        }
      }
    ];
    const result = generateSqliteSchema(tables);
    expect(result).toContain("bio: text('bio')");
    expect(result).not.toContain("bio: text('bio').notNull()");
  });

  it('generates JSDoc comments', () => {
    const tables: TableDefinition[] = [
      {
        name: 'users',
        propertyName: 'users',
        comment: 'User accounts table.\nStores user information.',
        columns: {
          id: { type: 'text', sqlName: 'id', primaryKey: true }
        }
      }
    ];
    const result = generateSqliteSchema(tables);
    expect(result).toContain('/**');
    expect(result).toContain(' * User accounts table.');
    expect(result).toContain(' * Stores user information.');
    expect(result).toContain(' */');
  });

  it('generates multiple tables with blank lines between', () => {
    const tables: TableDefinition[] = [
      {
        name: 'users',
        propertyName: 'users',
        columns: {
          id: { type: 'text', sqlName: 'id', primaryKey: true }
        }
      },
      {
        name: 'posts',
        propertyName: 'posts',
        columns: {
          id: { type: 'text', sqlName: 'id', primaryKey: true }
        }
      }
    ];
    const result = generateSqliteSchema(tables);
    expect(result).toContain("export const users = sqliteTable('users'");
    expect(result).toContain("export const posts = sqliteTable('posts'");
  });

  it('handles empty tables array', () => {
    const tables: TableDefinition[] = [];
    const result = generateSqliteSchema(tables);
    // With dynamic imports, only sqliteTable is imported for empty tables
    expect(result).toContain(
      "import { sqliteTable } from 'drizzle-orm/sqlite-core';"
    );
    expect(result.trim().endsWith(';')).toBe(true);
  });

  it('generates multiple indexes correctly', () => {
    const tables: TableDefinition[] = [
      {
        name: 'items',
        propertyName: 'items',
        columns: {
          id: { type: 'text', sqlName: 'id', primaryKey: true },
          name: { type: 'text', sqlName: 'name', notNull: true },
          category: { type: 'text', sqlName: 'category', notNull: true }
        },
        indexes: [
          { name: 'name_idx', columns: ['name'] },
          { name: 'category_idx', columns: ['category'] }
        ]
      }
    ];
    const result = generateSqliteSchema(tables);
    expect(result).toContain("index('name_idx').on(table.name),");
    expect(result).toContain("index('category_idx').on(table.category)");
  });
});
