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
});
