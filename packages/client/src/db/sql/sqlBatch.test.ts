import { describe, expect, it } from 'vitest';
import { buildSqlBatch, normalizeSqlStatements } from './sqlBatch';

describe('sqlBatch', () => {
  it('normalizes statements by trimming and stripping trailing semicolons', () => {
    const normalized = normalizeSqlStatements([
      '  CREATE TABLE t (id INTEGER);  ',
      '',
      '  ;',
      'INSERT INTO t (id) VALUES (1);;;   '
    ]);

    expect(normalized).toEqual([
      'CREATE TABLE t (id INTEGER)',
      'INSERT INTO t (id) VALUES (1)'
    ]);
  });

  it('builds a semicolon-delimited SQL batch', () => {
    const batch = buildSqlBatch([
      'CREATE TABLE t (id INTEGER)',
      'INSERT INTO t (id) VALUES (1);'
    ]);

    expect(batch).toBe(
      'CREATE TABLE t (id INTEGER);\nINSERT INTO t (id) VALUES (1)'
    );
  });

  it('returns an empty batch for empty or whitespace-only statements', () => {
    const batch = buildSqlBatch([' ', '\n', ' \t ;']);
    expect(batch).toBe('');
  });
});
