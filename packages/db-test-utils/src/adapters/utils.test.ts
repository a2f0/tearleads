import { describe, expect, it } from 'vitest';
import {
  convertRowsToArrays,
  extractSelectColumns,
  rowToArray
} from './utils.js';

describe('extractSelectColumns', () => {
  it('extracts simple column names', () => {
    const sql = 'SELECT id, name, email FROM users';
    expect(extractSelectColumns(sql)).toEqual(['id', 'name', 'email']);
  });

  it('handles quoted column names', () => {
    const sql = 'SELECT "id", "name" FROM users';
    expect(extractSelectColumns(sql)).toEqual(['id', 'name']);
  });

  it('handles table.column format', () => {
    const sql = 'SELECT users.id, users.name FROM users';
    expect(extractSelectColumns(sql)).toEqual(['id', 'name']);
  });

  it('handles quoted table.column format', () => {
    const sql = 'SELECT "users"."id", "users"."name" FROM users';
    expect(extractSelectColumns(sql)).toEqual(['id', 'name']);
  });

  it('handles aliases', () => {
    const sql = 'SELECT id as user_id, name as user_name FROM users';
    expect(extractSelectColumns(sql)).toEqual(['user_id', 'user_name']);
  });

  it('handles quoted aliases', () => {
    const sql = 'SELECT id as "userId", name as "userName" FROM users';
    expect(extractSelectColumns(sql)).toEqual(['userId', 'userName']);
  });

  it('handles functions with aliases', () => {
    const sql = 'SELECT count(*) as total FROM users';
    expect(extractSelectColumns(sql)).toEqual(['total']);
  });

  it('returns null for SELECT *', () => {
    const sql = 'SELECT * FROM users';
    expect(extractSelectColumns(sql)).toBeNull();
  });

  it('returns null for non-SELECT statements', () => {
    const sql = 'INSERT INTO users (name) VALUES (?)';
    expect(extractSelectColumns(sql)).toBeNull();
  });

  it('handles case insensitivity', () => {
    const sql = 'select ID, NAME from USERS';
    expect(extractSelectColumns(sql)).toEqual(['ID', 'NAME']);
  });

  it('handles nested parentheses in functions', () => {
    const sql = 'SELECT coalesce(max(id), 0) as max_id, name FROM users';
    expect(extractSelectColumns(sql)).toEqual(['max_id', 'name']);
  });
});

describe('rowToArray', () => {
  it('converts row to array in column order', () => {
    const row = { id: 1, name: 'John', email: 'john@test.com' };
    const columns = ['id', 'name', 'email'];
    expect(rowToArray(row, columns)).toEqual([1, 'John', 'john@test.com']);
  });

  it('handles different column order', () => {
    const row = { id: 1, name: 'John', email: 'john@test.com' };
    const columns = ['email', 'name', 'id'];
    expect(rowToArray(row, columns)).toEqual(['john@test.com', 'John', 1]);
  });

  it('returns undefined for missing columns', () => {
    const row = { id: 1 };
    const columns = ['id', 'missing'];
    expect(rowToArray(row, columns)).toEqual([1, undefined]);
  });
});

describe('convertRowsToArrays', () => {
  it('returns empty array for empty rows', () => {
    const sql = 'SELECT id, name FROM users';
    expect(convertRowsToArrays(sql, [])).toEqual([]);
  });

  it('converts rows using extracted columns', () => {
    const sql = 'SELECT id, name FROM users';
    const rows = [
      { id: 1, name: 'John' },
      { id: 2, name: 'Jane' }
    ];
    expect(convertRowsToArrays(sql, rows)).toEqual([
      [1, 'John'],
      [2, 'Jane']
    ]);
  });

  it('uses object keys for SELECT *', () => {
    const sql = 'SELECT * FROM users';
    const rows = [{ id: 1, name: 'John' }];
    const result = convertRowsToArrays(sql, rows);
    expect(result).toEqual([[1, 'John']]);
  });

  it('handles non-SELECT queries', () => {
    const sql = 'INSERT INTO users (name) VALUES (?)';
    const rows = [{ id: 1 }];
    expect(convertRowsToArrays(sql, rows)).toEqual([[1]]);
  });

  it('handles non-record rows gracefully', () => {
    const sql = 'SELECT id FROM users';
    const rows = [null, undefined, 'invalid'];
    const result = convertRowsToArrays(sql, rows as unknown[]);
    expect(result).toEqual([[undefined], [undefined], [undefined]]);
  });
});
