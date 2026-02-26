import type { Pool as PgPool } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createPglitePool } from './pglitePool.js';

describe('PglitePool', () => {
  let pool: PgPool;

  beforeAll(async () => {
    const result = await createPglitePool();
    pool = result.pool;
  });

  afterAll(async () => {
    await pool.end();
  });

  it('should execute a basic query', async () => {
    const result = await pool.query('SELECT 1 AS num');
    expect(result.rows).toEqual([{ num: 1 }]);
    expect(result.rowCount).toBe(1);
  });

  it('should execute parameterized queries', async () => {
    const result = await pool.query('SELECT $1::text AS greeting', ['hello']);
    expect(result.rows).toEqual([{ greeting: 'hello' }]);
  });

  it('should create and query tables', async () => {
    await pool.query(
      'CREATE TABLE test_items (id SERIAL PRIMARY KEY, name TEXT NOT NULL)'
    );
    await pool.query("INSERT INTO test_items (name) VALUES ('alpha')");
    await pool.query("INSERT INTO test_items (name) VALUES ('beta')");

    const result = await pool.query('SELECT name FROM test_items ORDER BY id');
    expect(result.rows).toEqual([{ name: 'alpha' }, { name: 'beta' }]);
    expect(result.rowCount).toBe(2);
  });

  it('should support transactions via BEGIN/COMMIT', async () => {
    await pool.query(
      'CREATE TABLE tx_test (id SERIAL PRIMARY KEY, val INT NOT NULL)'
    );
    await pool.query('BEGIN');
    await pool.query('INSERT INTO tx_test (val) VALUES (10)');
    await pool.query('INSERT INTO tx_test (val) VALUES (20)');
    await pool.query('COMMIT');

    const result = await pool.query('SELECT val FROM tx_test ORDER BY id');
    expect(result.rows).toEqual([{ val: 10 }, { val: 20 }]);
  });

  it('should support connect/release pattern', async () => {
    const client = await pool.connect();
    const result = await client.query('SELECT 42 AS answer');
    expect(result.rows).toEqual([{ answer: 42 }]);
    client.release();
  });
});
