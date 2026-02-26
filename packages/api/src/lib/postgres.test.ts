import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  expectedDevHost,
  loadPostgresModule,
  poolInstances,
  resetPostgresTestEnv,
  restorePostgresTestEnv,
  setupDevEnvWithoutVars
} from './postgresTestHarness.js';

describe('postgres lib', () => {
  beforeEach(() => {
    resetPostgresTestEnv();
  });

  afterEach(() => {
    restorePostgresTestEnv();
  });

  it('builds connection info from database url', async () => {
    process.env['NODE_ENV'] = 'development';
    process.env['DATABASE_URL'] =
      'postgres://user%20name:pass@db.example.com:5432/my%20db';

    const { getPostgresConnectionInfo } = await loadPostgresModule();

    expect(getPostgresConnectionInfo()).toEqual({
      host: 'db.example.com',
      port: 5432,
      database: 'my db',
      user: 'user name'
    });
  });

  it('builds connection info from discrete env vars', async () => {
    process.env['POSTGRES_HOST'] = 'localhost';
    process.env['POSTGRES_PORT'] = '5433';
    process.env['POSTGRES_USER'] = 'tearleads';
    process.env['POSTGRES_PASSWORD'] = 'secret';
    process.env['POSTGRES_DATABASE'] = 'tearleads_db';

    const { getPostgresConnectionInfo } = await loadPostgresModule();

    expect(getPostgresConnectionInfo()).toEqual({
      host: 'localhost',
      port: 5433,
      database: 'tearleads_db',
      user: 'tearleads'
    });
  });

  it('builds connection info from PG* env vars', async () => {
    process.env['NODE_ENV'] = 'development';
    process.env['PGHOST'] = 'localhost';
    process.env['PGPORT'] = '5434';
    process.env['PGUSER'] = 'tearleads_pg';
    process.env['PGDATABASE'] = 'tearleads_db';

    const { getPostgresConnectionInfo } = await loadPostgresModule();

    expect(getPostgresConnectionInfo()).toEqual({
      host: 'localhost',
      port: 5434,
      database: 'tearleads_db',
      user: 'tearleads_pg'
    });
  });

  it('throws when required release env vars are missing', async () => {
    process.env['POSTGRES_HOST'] = 'localhost';

    const { getPostgresConnectionInfo } = await loadPostgresModule();

    expect(() => getPostgresConnectionInfo()).toThrow(
      'Missing required Postgres environment variables: POSTGRES_PORT, POSTGRES_USER, POSTGRES_PASSWORD, POSTGRES_DATABASE'
    );
  });

  it('throws when POSTGRES_PORT is invalid in release mode', async () => {
    process.env['POSTGRES_HOST'] = 'localhost';
    process.env['POSTGRES_PORT'] = 'not-a-number';
    process.env['POSTGRES_USER'] = 'tearleads';
    process.env['POSTGRES_PASSWORD'] = 'secret';
    process.env['POSTGRES_DATABASE'] = 'tearleads_db';

    const { getPostgresConnectionInfo } = await loadPostgresModule();

    expect(() => getPostgresConnectionInfo()).toThrow(
      'POSTGRES_PORT must be a valid number'
    );
  });

  it('ignores database url in release mode when required vars are missing', async () => {
    process.env['DATABASE_URL'] = 'postgres://user@localhost:5432/db1';

    const { getPostgresConnectionInfo } = await loadPostgresModule();

    expect(() => getPostgresConnectionInfo()).toThrow(
      'Missing required Postgres environment variables: POSTGRES_HOST, POSTGRES_PORT, POSTGRES_USER, POSTGRES_PASSWORD, POSTGRES_DATABASE'
    );
  });

  it('uses development defaults when no env vars are set', async () => {
    setupDevEnvWithoutVars();

    const { getPostgresConnectionInfo } = await loadPostgresModule();

    expect(getPostgresConnectionInfo()).toEqual({
      host: expectedDevHost(),
      port: 5432,
      database: 'tearleads_development',
      user: 'tearleads_os_user'
    });
  });

  it('uses dev defaults for pool config when no env vars are set', async () => {
    setupDevEnvWithoutVars();

    const { getPostgresPool } = await loadPostgresModule();

    await getPostgresPool();

    expect(poolInstances[0]?.config).toEqual({
      host: expectedDevHost(),
      port: 5432,
      user: 'tearleads_os_user',
      database: 'tearleads_development',
      max: 15,
      idleTimeoutMillis: 30_000,
      connectionTimeoutMillis: 5_000
    });
  });

  it('builds pool config from required release env vars with pool sizing', async () => {
    process.env['POSTGRES_HOST'] = 'db.example.com';
    process.env['POSTGRES_PORT'] = '5432';
    process.env['POSTGRES_USER'] = 'tearleads';
    process.env['POSTGRES_PASSWORD'] = 'secret';
    process.env['POSTGRES_DATABASE'] = 'tearleads_db';

    const { getPostgresPool } = await loadPostgresModule();

    await getPostgresPool();

    expect(poolInstances[0]?.config).toEqual({
      host: 'db.example.com',
      port: 5432,
      user: 'tearleads',
      password: 'secret',
      database: 'tearleads_db',
      max: 15,
      idleTimeoutMillis: 30_000,
      connectionTimeoutMillis: 5_000
    });
  });

  it('enables SSL with cert verification by default when POSTGRES_SSL is set', async () => {
    process.env['POSTGRES_HOST'] = 'db.example.com';
    process.env['POSTGRES_PORT'] = '5432';
    process.env['POSTGRES_USER'] = 'tearleads';
    process.env['POSTGRES_PASSWORD'] = 'secret';
    process.env['POSTGRES_DATABASE'] = 'tearleads_db';
    process.env['POSTGRES_SSL'] = '1';

    const { getPostgresPool } = await loadPostgresModule();

    await getPostgresPool();

    expect(poolInstances[0]?.config).toMatchObject({
      ssl: { rejectUnauthorized: true }
    });
  });

  it('allows explicit insecure SSL opt-out for self-signed setups', async () => {
    process.env['POSTGRES_HOST'] = 'db.example.com';
    process.env['POSTGRES_PORT'] = '5432';
    process.env['POSTGRES_USER'] = 'tearleads';
    process.env['POSTGRES_PASSWORD'] = 'secret';
    process.env['POSTGRES_DATABASE'] = 'tearleads_db';
    process.env['POSTGRES_SSL'] = '1';
    process.env['POSTGRES_SSL_REJECT_UNAUTHORIZED'] = 'false';

    const { getPostgresPool } = await loadPostgresModule();

    await getPostgresPool();

    expect(poolInstances[0]?.config).toMatchObject({
      ssl: { rejectUnauthorized: false }
    });
  });

  it('throws when required release env vars are missing for pool config', async () => {
    process.env['POSTGRES_HOST'] = 'db.example.com';

    const { getPostgresPool } = await loadPostgresModule();

    await expect(getPostgresPool()).rejects.toThrow(
      'Missing required Postgres environment variables: POSTGRES_PORT, POSTGRES_USER, POSTGRES_PASSWORD, POSTGRES_DATABASE'
    );
  });

  it('reuses pool instances for the same config', async () => {
    process.env['NODE_ENV'] = 'development';
    process.env['DATABASE_URL'] = 'postgres://user@localhost:5432/db1';

    const { getPostgresPool } = await loadPostgresModule();

    const pool = await getPostgresPool();
    const secondPool = await getPostgresPool();

    expect(pool).toBe(secondPool);
    expect(poolInstances).toHaveLength(1);
    expect(poolInstances[0]?.config.connectionString).toBe(
      'postgres://user@localhost:5432/db1'
    );
  });

  it('recreates pool when config changes', async () => {
    process.env['NODE_ENV'] = 'development';
    process.env['DATABASE_URL'] = 'postgres://user@localhost:5432/db1';

    const { getPostgresPool } = await loadPostgresModule();

    const firstPool = await getPostgresPool();
    process.env['DATABASE_URL'] = 'postgres://user@localhost:5432/db2';
    const secondPool = await getPostgresPool();

    expect(firstPool).not.toBe(secondPool);
    expect(poolInstances).toHaveLength(2);
    expect(poolInstances[0]?.end).toHaveBeenCalledTimes(1);
  });

  it('does nothing when closing without a pool', async () => {
    const { closePostgresPool } = await loadPostgresModule();

    await closePostgresPool();

    expect(poolInstances).toHaveLength(0);
  });

  it('closes the active pool', async () => {
    process.env['NODE_ENV'] = 'development';
    process.env['DATABASE_URL'] = 'postgres://user@localhost:5432/db1';

    const { closePostgresPool, getPostgresPool } = await loadPostgresModule();

    await getPostgresPool();
    await closePostgresPool();

    expect(poolInstances[0]?.end).toHaveBeenCalledTimes(1);
  });
});
