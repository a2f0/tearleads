import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

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
const PoolMock = vi.fn((config: PoolConfig) => {
  const end = vi.fn().mockResolvedValue(undefined);
  const instance = { config, end };
  poolInstances.push(instance);
  return instance;
});

vi.mock('pg', () => ({
  Pool: PoolMock
}));

const originalEnv = process.env;

async function loadPostgresModule() {
  return import('./postgres.js');
}

describe('postgres lib', () => {
  beforeEach(() => {
    vi.resetModules();
    process.env = { ...originalEnv };
    poolInstances.length = 0;
    PoolMock.mockClear();
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  it('builds connection info from database url', async () => {
    process.env.DATABASE_URL =
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
    process.env.POSTGRES_HOST = 'localhost';
    process.env.POSTGRES_PORT = '5433';
    process.env.POSTGRES_USER = 'rapid';
    process.env.POSTGRES_DATABASE = 'rapid_db';

    const { getPostgresConnectionInfo } = await loadPostgresModule();

    expect(getPostgresConnectionInfo()).toEqual({
      host: 'localhost',
      port: 5433,
      database: 'rapid_db',
      user: 'rapid'
    });
  });

  it('treats invalid ports as null', async () => {
    process.env.POSTGRES_HOST = 'localhost';
    process.env.POSTGRES_PORT = 'not-a-number';

    const { getPostgresConnectionInfo } = await loadPostgresModule();

    expect(getPostgresConnectionInfo()).toEqual({
      host: 'localhost',
      port: null,
      database: null,
      user: null
    });
  });

  it('reuses pool instances for the same config', async () => {
    process.env.DATABASE_URL = 'postgres://user@localhost:5432/db1';

    const { getPostgresPool } = await loadPostgresModule();

    const pool = await getPostgresPool();
    const secondPool = await getPostgresPool();

    expect(pool).toBe(secondPool);
    expect(PoolMock).toHaveBeenCalledTimes(1);
    expect(poolInstances[0]?.config.connectionString).toBe(
      'postgres://user@localhost:5432/db1'
    );
  });

  it('recreates pool when config changes', async () => {
    process.env.DATABASE_URL = 'postgres://user@localhost:5432/db1';

    const { getPostgresPool } = await loadPostgresModule();

    const firstPool = await getPostgresPool();
    process.env.DATABASE_URL = 'postgres://user@localhost:5432/db2';
    const secondPool = await getPostgresPool();

    expect(firstPool).not.toBe(secondPool);
    expect(PoolMock).toHaveBeenCalledTimes(2);
    expect(poolInstances[0]?.end).toHaveBeenCalledTimes(1);
  });

  it('does nothing when closing without a pool', async () => {
    const { closePostgresPool } = await loadPostgresModule();

    await closePostgresPool();

    expect(PoolMock).not.toHaveBeenCalled();
  });

  it('closes the active pool', async () => {
    process.env.DATABASE_URL = 'postgres://user@localhost:5432/db1';

    const { closePostgresPool, getPostgresPool } = await loadPostgresModule();

    await getPostgresPool();
    await closePostgresPool();

    expect(poolInstances[0]?.end).toHaveBeenCalledTimes(1);
  });
});
