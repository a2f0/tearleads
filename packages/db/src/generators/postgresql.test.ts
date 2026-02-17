import { describe, expect, it } from 'vitest';
import type { TableDefinition } from '../schema/types.js';
import { generatePostgresSchema } from './postgresql.js';

describe('generatePostgresSchema', () => {
  it('generates correct import statement with used types', () => {
    const tables: TableDefinition[] = [
      {
        name: 'users',
        propertyName: 'users',
        columns: {
          id: { type: 'text', sqlName: 'id', primaryKey: true },
          count: { type: 'integer', sqlName: 'count', notNull: true },
          isActive: { type: 'boolean', sqlName: 'is_active', notNull: true },
          createdAt: { type: 'timestamp', sqlName: 'created_at', notNull: true }
        },
        indexes: [{ name: 'id_idx', columns: ['id'] }]
      }
    ];
    const result = generatePostgresSchema(tables);
    expect(result).toContain(
      "import { boolean, index, integer, pgTable, text, timestamp } from 'drizzle-orm/pg-core';"
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
    const result = generatePostgresSchema(tables);
    expect(result).toContain("export const users = pgTable('users', {");
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
    const result = generatePostgresSchema(tables);
    expect(result).toContain('export const users = pgTable(');
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
    const result = generatePostgresSchema(tables);
    expect(result).toContain(
      "index('cat_status_idx').on(table.category, table.status)"
    );
  });

  it('generates foreign key references', () => {
    const tables: TableDefinition[] = [
      {
        name: 'users',
        propertyName: 'users',
        columns: {
          id: { type: 'text', sqlName: 'id', primaryKey: true }
        }
      },
      {
        name: 'user_credentials',
        propertyName: 'userCredentials',
        columns: {
          userId: {
            type: 'text',
            sqlName: 'user_id',
            primaryKey: true,
            references: {
              table: 'users',
              column: 'id',
              onDelete: 'cascade'
            }
          }
        }
      }
    ];
    const result = generatePostgresSchema(tables);
    expect(result).toContain(
      "userId: text('user_id').primaryKey().references(() => users.id, { onDelete: 'cascade' })"
    );
  });

  it('generates boolean columns as native boolean', () => {
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
    const result = generatePostgresSchema(tables);
    expect(result).toContain(
      "isActive: boolean('is_active').notNull().default(false)"
    );
  });

  it('generates timestamp columns with timezone', () => {
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
    const result = generatePostgresSchema(tables);
    expect(result).toContain(
      "createdAt: timestamp('created_at', { withTimezone: true }).notNull()"
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
    const result = generatePostgresSchema(tables);
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
    const result = generatePostgresSchema(tables);
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
    const result = generatePostgresSchema(tables);
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
    const result = generatePostgresSchema(tables);
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
    const result = generatePostgresSchema(tables);
    expect(result).toContain("export const users = pgTable('users'");
    expect(result).toContain("export const posts = pgTable('posts'");
  });

  it('handles empty tables array', () => {
    const tables: TableDefinition[] = [];
    const result = generatePostgresSchema(tables);
    expect(result).toContain("import { pgTable } from 'drizzle-orm/pg-core';");
    expect(result.trim().endsWith(';')).toBe(true);
  });

  it('generates json columns as jsonb', () => {
    const tables: TableDefinition[] = [
      {
        name: 'documents',
        propertyName: 'documents',
        columns: {
          id: { type: 'text', sqlName: 'id', primaryKey: true },
          data: { type: 'json', sqlName: 'data', notNull: true }
        }
      }
    ];
    const result = generatePostgresSchema(tables);
    expect(result).toContain("data: jsonb('data').notNull()");
    expect(result).toContain('jsonb');
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
    const result = generatePostgresSchema(tables);
    expect(result).toContain("index('name_idx').on(table.name),");
    expect(result).toContain("index('category_idx').on(table.category)");
  });

  it('handles composite primary keys, unique indexes, and self references', () => {
    const tables: TableDefinition[] = [
      {
        name: 'nodes',
        propertyName: 'nodes',
        columns: {
          id: { type: 'text', sqlName: 'id', primaryKey: true },
          workspaceId: {
            type: 'text',
            sqlName: 'workspace_id',
            primaryKey: true
          },
          parentId: {
            type: 'text',
            sqlName: 'parent_id',
            references: { table: 'nodes', column: 'id' }
          }
        },
        indexes: [
          {
            name: 'nodes_workspace_unique',
            columns: ['workspaceId'],
            unique: true
          }
        ]
      }
    ];

    const result = generatePostgresSchema(tables);
    expect(result).toContain('type AnyPgColumn');
    expect(result).toContain(
      'primaryKey({ columns: [table.id, table.workspaceId] })'
    );
    expect(result).toContain(
      "uniqueIndex('nodes_workspace_unique').on(table.workspaceId)"
    );
    expect(result).toContain(
      "parentId: text('parent_id').references((): AnyPgColumn => nodes.id)"
    );
  });

  it('throws for unknown table references', () => {
    const tables: TableDefinition[] = [
      {
        name: 'child',
        propertyName: 'child',
        columns: {
          id: { type: 'text', sqlName: 'id', primaryKey: true },
          parentId: {
            type: 'text',
            sqlName: 'parent_id',
            references: { table: 'missing_table', column: 'id' }
          }
        }
      }
    ];

    expect(() => generatePostgresSchema(tables)).toThrow(
      /Unknown table reference: missing_table/
    );
  });

  it('supports composite primary keys without secondary indexes', () => {
    const tables: TableDefinition[] = [
      {
        name: 'memberships',
        propertyName: 'memberships',
        columns: {
          userId: { type: 'text', sqlName: 'user_id', primaryKey: true },
          teamId: { type: 'text', sqlName: 'team_id', primaryKey: true }
        }
      }
    ];

    const result = generatePostgresSchema(tables);
    expect(result).toContain(
      'primaryKey({ columns: [table.userId, table.teamId] })'
    );
    expect(result).not.toContain("index('");
    expect(result).not.toContain("uniqueIndex('");
  });
});
