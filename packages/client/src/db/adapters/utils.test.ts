/**
 * Unit tests for database adapter utility functions.
 */

import { describe, expect, it } from 'vitest';
import { convertRowsToArrays, extractSelectColumns, rowToArray } from './utils';

describe('extractSelectColumns', () => {
  describe('basic column extraction', () => {
    it('extracts simple column names', () => {
      const sql = 'SELECT id, name, email FROM users';
      expect(extractSelectColumns(sql)).toEqual(['id', 'name', 'email']);
    });

    it('extracts quoted column names', () => {
      const sql = 'SELECT "id", "name", "email" FROM users';
      expect(extractSelectColumns(sql)).toEqual(['id', 'name', 'email']);
    });

    it('handles mixed quoted and unquoted columns', () => {
      const sql = 'SELECT id, "name", email FROM users';
      expect(extractSelectColumns(sql)).toEqual(['id', 'name', 'email']);
    });
  });

  describe('table.column notation', () => {
    it('extracts column name from table.column', () => {
      const sql = 'SELECT users.id, users.name FROM users';
      expect(extractSelectColumns(sql)).toEqual(['id', 'name']);
    });

    it('extracts column name from "table"."column"', () => {
      const sql = 'SELECT "users"."id", "users"."name" FROM users';
      expect(extractSelectColumns(sql)).toEqual(['id', 'name']);
    });
  });

  describe('aliases', () => {
    it('extracts alias names with AS keyword', () => {
      const sql = 'SELECT id AS user_id, name AS user_name FROM users';
      expect(extractSelectColumns(sql)).toEqual(['user_id', 'user_name']);
    });

    it('extracts quoted alias names', () => {
      const sql = 'SELECT id AS "user_id", name AS "user_name" FROM users';
      expect(extractSelectColumns(sql)).toEqual(['user_id', 'user_name']);
    });

    it('handles case insensitive AS keyword', () => {
      const sql = 'SELECT id as user_id, name As user_name FROM users';
      expect(extractSelectColumns(sql)).toEqual(['user_id', 'user_name']);
    });
  });

  describe('aggregate functions', () => {
    it('extracts alias from count(*)', () => {
      const sql = 'SELECT count(*) as count FROM users';
      expect(extractSelectColumns(sql)).toEqual(['count']);
    });

    it('handles functions without alias (returns function expression)', () => {
      const sql = 'SELECT count(*) FROM users';
      expect(extractSelectColumns(sql)).toEqual(['count(*)']);
    });

    it('handles nested functions', () => {
      const sql = 'SELECT COALESCE(name, email) as display FROM users';
      expect(extractSelectColumns(sql)).toEqual(['display']);
    });
  });

  describe('complex expressions with aliases', () => {
    it('extracts alias from COALESCE with AS alias', () => {
      const sql =
        'select "vfs_registry"."id", COALESCE(NULLIF("vfs_registry"."encrypted_name", \'\'), \'Unknown\') as "name", "vfs_registry"."created_at" from "vfs_registry"';
      expect(extractSelectColumns(sql)).toEqual(['id', 'name', 'created_at']);
    });

    it('extracts alias from multiline COALESCE with AS alias', () => {
      const sql = `select "vfs_registry"."id", COALESCE(
    NULLIF("vfs_registry"."encrypted_name", ''),
    CASE WHEN "vfs_registry"."object_type" = 'folder' THEN 'Unnamed Folder' END,
    NULLIF("files"."name", ''),
    'Unknown'
  ) as "name", "vfs_registry"."created_at" from "vfs_registry"`;
      expect(extractSelectColumns(sql)).toEqual(['id', 'name', 'created_at']);
    });

    it('extracts aliased duplicate column names correctly', () => {
      const sql =
        'select "vfs_registry"."id", "vfs_links"."id" as "linkId", "vfs_registry"."object_type" from "vfs_links"';
      expect(extractSelectColumns(sql)).toEqual([
        'id',
        'linkId',
        'object_type'
      ]);
    });

    it('fails to extract column name from COALESCE without alias', () => {
      const sql =
        'select "vfs_registry"."id", COALESCE(NULLIF("files"."name", \'\'), \'Unknown\'), "vfs_registry"."created_at" from "vfs_registry"';
      const columns = extractSelectColumns(sql);
      // Without an alias, extractSelectColumns cannot determine the correct
      // column name for the COALESCE expression, producing an incorrect value.
      expect(columns).not.toBeNull();
      expect(columns?.[1]).not.toBe('name');
    });
  });

  describe('SELECT * queries', () => {
    it('returns null for SELECT *', () => {
      const sql = 'SELECT * FROM users';
      expect(extractSelectColumns(sql)).toBeNull();
    });

    it('returns null for SELECT * with whitespace', () => {
      const sql = 'SELECT  *  FROM users';
      expect(extractSelectColumns(sql)).toBeNull();
    });
  });

  describe('non-SELECT queries', () => {
    it('returns null for INSERT statements', () => {
      const sql =
        "INSERT INTO users (name, email) VALUES ('John', 'john@test.com')";
      expect(extractSelectColumns(sql)).toBeNull();
    });

    it('returns null for UPDATE statements', () => {
      const sql = "UPDATE users SET name = 'John' WHERE id = 1";
      expect(extractSelectColumns(sql)).toBeNull();
    });

    it('returns null for DELETE statements', () => {
      const sql = 'DELETE FROM users WHERE id = 1';
      expect(extractSelectColumns(sql)).toBeNull();
    });
  });

  describe('case insensitivity', () => {
    it('handles lowercase SELECT and FROM', () => {
      const sql = 'select id, name from users';
      expect(extractSelectColumns(sql)).toEqual(['id', 'name']);
    });

    it('handles uppercase SELECT and FROM', () => {
      const sql = 'SELECT id, name FROM users';
      expect(extractSelectColumns(sql)).toEqual(['id', 'name']);
    });

    it('handles mixed case', () => {
      const sql = 'Select id, name From users';
      expect(extractSelectColumns(sql)).toEqual(['id', 'name']);
    });
  });

  describe('multiline queries', () => {
    it('handles multiline SQL', () => {
      const sql = `
        SELECT
          id,
          name,
          email
        FROM users
      `;
      expect(extractSelectColumns(sql)).toEqual(['id', 'name', 'email']);
    });
  });

  describe('edge cases', () => {
    it('handles single column', () => {
      const sql = 'SELECT id FROM users';
      expect(extractSelectColumns(sql)).toEqual(['id']);
    });

    it('handles columns with dollar signs', () => {
      const sql = 'SELECT $id, name$ FROM users';
      expect(extractSelectColumns(sql)).toEqual(['$id', 'name$']);
    });

    it('ignores trailing comma in select clause', () => {
      const sql = 'SELECT id, FROM users';
      expect(extractSelectColumns(sql)).toEqual(['id']);
    });
    it('falls back when column parts are empty', () => {
      const sql = 'SELECT . FROM users';
      expect(extractSelectColumns(sql)).toEqual(['.']);
    });
  });
});

describe('rowToArray', () => {
  it('converts object to array in specified column order', () => {
    const row = { id: 1, name: 'John', email: 'john@test.com' };
    const columns = ['id', 'name', 'email'];
    expect(rowToArray(row, columns)).toEqual([1, 'John', 'john@test.com']);
  });

  it('respects column order different from object key order', () => {
    const row = { id: 1, name: 'John', email: 'john@test.com' };
    const columns = ['email', 'name', 'id'];
    expect(rowToArray(row, columns)).toEqual(['john@test.com', 'John', 1]);
  });

  it('returns undefined for missing columns', () => {
    const row = { id: 1, name: 'John' };
    const columns = ['id', 'name', 'email'];
    expect(rowToArray(row, columns)).toEqual([1, 'John', undefined]);
  });

  it('handles empty row', () => {
    const row = {};
    const columns = ['id', 'name'];
    expect(rowToArray(row, columns)).toEqual([undefined, undefined]);
  });

  it('handles empty columns', () => {
    const row = { id: 1, name: 'John' };
    const columns: string[] = [];
    expect(rowToArray(row, columns)).toEqual([]);
  });

  it('handles null and undefined values', () => {
    const row = { id: 1, name: null, email: undefined };
    const columns = ['id', 'name', 'email'];
    expect(rowToArray(row, columns)).toEqual([1, null, undefined]);
  });
});

describe('convertRowsToArrays', () => {
  describe('with explicit columns in SQL', () => {
    it('converts rows to arrays using SQL column order', () => {
      const sql = 'SELECT id, name, email FROM users';
      const rows = [
        { id: 1, name: 'John', email: 'john@test.com' },
        { id: 2, name: 'Jane', email: 'jane@test.com' }
      ];
      expect(convertRowsToArrays(sql, rows)).toEqual([
        [1, 'John', 'john@test.com'],
        [2, 'Jane', 'jane@test.com']
      ]);
    });

    it('respects SQL column order even if different from object keys', () => {
      const sql = 'SELECT email, name, id FROM users';
      const rows = [{ id: 1, name: 'John', email: 'john@test.com' }];
      expect(convertRowsToArrays(sql, rows)).toEqual([
        ['john@test.com', 'John', 1]
      ]);
    });

    it('returns undefined values for non-object rows', () => {
      const sql = 'SELECT id, name FROM users';
      const rows = [1];
      expect(convertRowsToArrays(sql, rows)).toEqual([[undefined, undefined]]);
    });
  });

  describe('with SELECT * queries', () => {
    it('uses object key order for SELECT *', () => {
      const sql = 'SELECT * FROM users';
      const rows = [{ id: 1, name: 'John', email: 'john@test.com' }];
      const result = convertRowsToArrays(sql, rows);
      // Order depends on object key insertion order
      expect(result).toEqual([[1, 'John', 'john@test.com']]);
    });
  });

  describe('with empty rows', () => {
    it('returns empty array for empty rows', () => {
      const sql = 'SELECT id, name FROM users';
      const rows: unknown[] = [];
      expect(convertRowsToArrays(sql, rows)).toEqual([]);
    });
  });

  describe('with non-SELECT queries', () => {
    it('converts rows using object keys for INSERT statements', () => {
      // When SQL columns can't be parsed, function uses object key order
      const sql = 'INSERT INTO users (name) VALUES (?)';
      const rows = [{ lastInsertRowId: 1, changes: 1 }];
      expect(convertRowsToArrays(sql, rows)).toEqual([[1, 1]]);
    });

    it('returns empty rows as-is for non-SELECT with no results', () => {
      const sql = 'INSERT INTO users (name) VALUES (?)';
      const rows: unknown[] = [];
      expect(convertRowsToArrays(sql, rows)).toEqual([]);
    });

    it('returns non-object rows as-is when columns cannot be parsed', () => {
      const sql = 'UPDATE users SET name = ?';
      const rows = [1];
      expect(convertRowsToArrays(sql, rows)).toEqual([1]);
    });
  });

  describe('with aliases', () => {
    it('uses alias names in the result', () => {
      const sql = 'SELECT id AS user_id, name AS user_name FROM users';
      const rows = [{ user_id: 1, user_name: 'John' }];
      expect(convertRowsToArrays(sql, rows)).toEqual([[1, 'John']]);
    });
  });

  describe('with aggregate functions', () => {
    it('handles count(*) with alias', () => {
      const sql = 'SELECT count(*) as total FROM users';
      const rows = [{ total: 42 }];
      expect(convertRowsToArrays(sql, rows)).toEqual([[42]]);
    });
  });

  describe('with complex VFS-style queries', () => {
    it('converts rows correctly when COALESCE has AS alias', () => {
      const sql = `select "vfs_registry"."id", "vfs_links"."id" as "linkId", "vfs_registry"."object_type", COALESCE(NULLIF("files"."name", ''), 'Unknown') as "name", "vfs_registry"."created_at" from "vfs_links"`;
      const rows = [
        {
          id: 'reg-1',
          linkId: 'link-1',
          object_type: 'file',
          name: 'document.pdf',
          created_at: 1704067200000
        }
      ];
      expect(convertRowsToArrays(sql, rows)).toEqual([
        ['reg-1', 'link-1', 'file', 'document.pdf', 1704067200000]
      ]);
    });

    it('loses COALESCE value when alias is missing', () => {
      // Without AS "name", extractSelectColumns cannot match the COALESCE
      // expression to the row's "name" key, so the value is lost.
      const sql = `select "vfs_registry"."id", COALESCE(NULLIF("files"."name", ''), 'Unknown'), "vfs_registry"."created_at" from "vfs_registry"`;
      const rows = [
        { id: 'reg-1', name: 'document.pdf', created_at: 1704067200000 }
      ];
      const result = convertRowsToArrays(sql, rows) as unknown[][];
      // Position 1 maps to a garbled column name that doesn't match any row key
      expect(result[0]?.[1]).toBeUndefined();
    });
  });
});
