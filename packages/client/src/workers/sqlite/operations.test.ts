import { describe, expect, it } from 'vitest';
import { executeMany } from './operations';
import type { SQLiteDatabase } from './types';

interface MockDatabaseOptions {
  throwOnSql?: string;
  error?: Error;
}

class MockDatabase implements SQLiteDatabase {
  pointer = 1;
  readonly calls: string[] = [];
  private readonly throwOnSql: string | undefined;
  private readonly error: Error;

  constructor(options: MockDatabaseOptions = {}) {
    this.throwOnSql = options.throwOnSql;
    this.error = options.error ?? new Error('Mock execution error');
  }

  exec(options: {
    sql: string;
    bind?: unknown[];
    rowMode?: 'object' | 'array';
    callback?: (row: Record<string, unknown>) => boolean | undefined;
    returnValue?: 'resultRows';
  }): unknown[][];
  exec(sql: string): void;
  exec(
    input:
      | string
      | {
          sql: string;
          bind?: unknown[];
          rowMode?: 'object' | 'array';
          callback?: (row: Record<string, unknown>) => boolean | undefined;
          returnValue?: 'resultRows';
        }
  ): unknown[][] | undefined {
    const sql = typeof input === 'string' ? input : input.sql;
    this.calls.push(sql);
    if (this.throwOnSql && sql === this.throwOnSql) {
      throw this.error;
    }
    return [];
  }

  changes(): number {
    return 0;
  }

  close(): void {
    return;
  }
}

describe('executeMany', () => {
  it('wraps statements in a transaction', () => {
    const db = new MockDatabase();
    executeMany(db, [
      'CREATE TABLE test_table (id INTEGER PRIMARY KEY)',
      'CREATE INDEX test_idx ON test_table (id)'
    ]);

    expect(db.calls).toEqual([
      'BEGIN TRANSACTION',
      'CREATE TABLE test_table (id INTEGER PRIMARY KEY)',
      'CREATE INDEX test_idx ON test_table (id)',
      'COMMIT'
    ]);
  });

  it('rolls back when a statement fails', () => {
    const expectedError = new Error('boom');
    const db = new MockDatabase({
      throwOnSql: 'CREATE INDEX test_idx ON test_table (id)',
      error: expectedError
    });

    expect(() =>
      executeMany(db, [
        'CREATE TABLE test_table (id INTEGER PRIMARY KEY)',
        'CREATE INDEX test_idx ON test_table (id)'
      ])
    ).toThrow(expectedError);

    expect(db.calls).toEqual([
      'BEGIN TRANSACTION',
      'CREATE TABLE test_table (id INTEGER PRIMARY KEY)',
      'CREATE INDEX test_idx ON test_table (id)',
      'ROLLBACK'
    ]);
  });
});
