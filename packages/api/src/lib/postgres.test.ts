import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('node:os', () => ({
  default: {
    userInfo: () => ({ username: 'rapid_os_user' })
  }
}));

type PoolConfig = {
  connectionString?: string;
  host?: string;
  port?: number;
  user?: string;
  password?: string;
  database?: string;
};

type PoolInstance = {
  config: PoolConfig;
  end: ReturnType<typeof vi.fn>;
};

const poolInstances: PoolInstance[] = [];

class PoolMock {
  config: PoolConfig;
  end: ReturnType<typeof vi.fn>;

  constructor(config: PoolConfig) {
    this.config = config;
    this.end = vi.fn().mockResolvedValue(undefined);
    poolInstances.push(this);
  }
}

vi.mock('pg', () => ({
  default: { Pool: PoolMock },
  Pool: PoolMock
}));

const originalEnv = process.env;

async function loadPostgresModule() {
  return import('./postgres.js');
}

const DEV_ENV_KEYS = [
  'USER',
  'LOGNAME',
  'DATABASE_URL',
  'POSTGRES_URL',
  'POSTGRES_HOST',
  'POSTGRES_PORT',
  'POSTGRES_USER',
  'POSTGRES_PASSWORD',
  'POSTGRES_DATABASE',
  'PGHOST',
  'PGPORT',
  'PGUSER',
  'PGPASSWORD',
  'PGDATABASE'
];

function setupDevEnvWithoutVars() {
  process.env['NODE_ENV'] = 'development';
  for (const key of DEV_ENV_KEYS) {
    delete process.env[key];
  }
}

describe('postgres lib', () => {
  beforeEach(() => {
    vi.resetModules();
    process.env = { ...originalEnv };
    for (const key of DEV_ENV_KEYS) {
      delete process.env[key];
    }
    if (!process.env['NODE_ENV']) {
      process.env['NODE_ENV'] = 'test';
    }
    poolInstances.length = 0;
  });

  afterEach(() => {
    process.env = originalEnv;
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
    process.env['POSTGRES_USER'] = 'rapid';
    process.env['POSTGRES_PASSWORD'] = 'secret';
    process.env['POSTGRES_DATABASE'] = 'rapid_db';

    const { getPostgresConnectionInfo } = await loadPostgresModule();

    expect(getPostgresConnectionInfo()).toEqual({
      host: 'localhost',
      port: 5433,
      database: 'rapid_db',
      user: 'rapid'
    });
  });

  it('builds connection info from PG* env vars', async () => {
    process.env['NODE_ENV'] = 'development';
    process.env['PGHOST'] = 'localhost';
    process.env['PGPORT'] = '5434';
    process.env['PGUSER'] = 'rapid_pg';
    process.env['PGDATABASE'] = 'rapid_db';

    const { getPostgresConnectionInfo } = await loadPostgresModule();

    expect(getPostgresConnectionInfo()).toEqual({
      host: 'localhost',
      port: 5434,
      database: 'rapid_db',
      user: 'rapid_pg'
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
    process.env['POSTGRES_USER'] = 'rapid';
    process.env['POSTGRES_PASSWORD'] = 'secret';
    process.env['POSTGRES_DATABASE'] = 'rapid_db';

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
      host: 'localhost',
      port: 5432,
      database: 'tearleads_development',
      user: 'rapid_os_user'
    });
  });

  it('uses dev defaults for pool config when no env vars are set', async () => {
    setupDevEnvWithoutVars();

    const { getPostgresPool } = await loadPostgresModule();

    await getPostgresPool();

    expect(poolInstances[0]?.config).toEqual({
      host: 'localhost',
      port: 5432,
      user: 'rapid_os_user',
      database: 'tearleads_development'
    });
  });

  it('builds pool config from required release env vars', async () => {
    process.env['POSTGRES_HOST'] = 'db.example.com';
    process.env['POSTGRES_PORT'] = '5432';
    process.env['POSTGRES_USER'] = 'rapid';
    process.env['POSTGRES_PASSWORD'] = 'secret';
    process.env['POSTGRES_DATABASE'] = 'rapid_db';

    const { getPostgresPool } = await loadPostgresModule();

    await getPostgresPool();

    expect(poolInstances[0]?.config).toEqual({
      host: 'db.example.com',
      port: 5432,
      user: 'rapid',
      password: 'secret',
      database: 'rapid_db'
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
