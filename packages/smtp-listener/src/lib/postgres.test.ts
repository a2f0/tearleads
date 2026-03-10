import type { PostgresDevDefaults } from '@tearleads/shared/server';
import type { PoolConfig } from 'pg';
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';

import { createPostgresPoolRuntime } from './postgres.js';

interface MockPool {
  config: PoolConfig;
  end: () => Promise<void>;
  endMock: ReturnType<typeof vi.fn<() => Promise<void>>>;
}

function createRuntime(
  options: { defaults?: PostgresDevDefaults; devMode?: boolean } = {}
) {
  const createdPools: MockPool[] = [];
  const createPool = vi.fn((config: PoolConfig) => {
    const endMock = vi.fn<() => Promise<void>>(async () => undefined);
    const pool: MockPool = {
      config,
      end: endMock,
      endMock
    };
    createdPools.push(pool);
    return pool;
  });

  const runtime = createPostgresPoolRuntime<MockPool>({
    createPool,
    getPostgresDevDefaults: () => options.defaults ?? {},
    isDevMode: () => options.devMode ?? true
  });

  return { createPool, createdPools, runtime };
}

const savedNodeEnv = process.env['NODE_ENV'];

function clearPostgresEnv(): void {
  delete process.env['NODE_ENV'];
  delete process.env['DATABASE_URL'];
  delete process.env['POSTGRES_URL'];
  delete process.env['POSTGRES_HOST'];
  delete process.env['PGHOST'];
  delete process.env['POSTGRES_USER'];
  delete process.env['PGUSER'];
  delete process.env['POSTGRES_PASSWORD'];
  delete process.env['PGPASSWORD'];
  delete process.env['POSTGRES_DATABASE'];
  delete process.env['PGDATABASE'];
  delete process.env['POSTGRES_PORT'];
  delete process.env['PGPORT'];
}

describe('postgres pool runtime', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    clearPostgresEnv();
  });

  afterAll(() => {
    if (savedNodeEnv !== undefined) {
      process.env['NODE_ENV'] = savedNodeEnv;
    }
  });

  it('uses dev defaults when no env vars are set in dev mode', async () => {
    const expectedHost =
      process.platform === 'linux' ? '/var/run/postgresql' : 'localhost';
    const { createdPools, runtime } = createRuntime({
      defaults: {
        host: expectedHost,
        port: 5432,
        user: 'smtp_os_user',
        database: 'tearleads_development'
      },
      devMode: true
    });

    await runtime.getPostgresPool();

    expect(createdPools[0]?.config).toEqual({
      host: expectedHost,
      port: 5432,
      user: 'smtp_os_user',
      database: 'tearleads_development'
    });
  });

  it('omits missing dev defaults from config', async () => {
    const { createdPools, runtime } = createRuntime({
      defaults: {
        host: 'localhost',
        database: 'tearleads_development'
      },
      devMode: true
    });

    await runtime.getPostgresPool();

    expect(createdPools[0]?.config).toEqual({
      host: 'localhost',
      database: 'tearleads_development'
    });
  });

  it('handles fully empty dev defaults', async () => {
    const { createdPools, runtime } = createRuntime({
      defaults: {},
      devMode: true
    });

    await runtime.getPostgresPool();

    expect(createdPools[0]?.config).toEqual({});
  });

  it('throws when no env vars are set in release mode', async () => {
    const { runtime } = createRuntime({
      devMode: false
    });

    await expect(runtime.getPostgresPool()).rejects.toThrow(
      'Missing Postgres connection info. Set DATABASE_URL or PGDATABASE/POSTGRES_DATABASE (plus PGHOST/PGPORT/PGUSER as needed).'
    );
  });

  it('uses DATABASE_URL and reuses the pool for the same key', async () => {
    process.env['DATABASE_URL'] = 'postgres://db-one';
    const { createPool, createdPools, runtime } = createRuntime({
      devMode: false
    });

    const first = await runtime.getPostgresPool();
    const second = await runtime.getPostgresPool();

    expect(createPool).toHaveBeenCalledOnce();
    expect(first).toBe(second);
    expect(createdPools[0]?.config).toEqual({
      connectionString: 'postgres://db-one'
    });
  });

  it('rebuilds and closes previous pool when config key changes', async () => {
    process.env['DATABASE_URL'] = 'postgres://db-one';
    const { createPool, createdPools, runtime } = createRuntime({
      devMode: false
    });

    const first = await runtime.getPostgresPool();

    process.env['DATABASE_URL'] = 'postgres://db-two';
    const second = await runtime.getPostgresPool();

    expect(first).not.toBe(second);
    expect(createPool).toHaveBeenCalledTimes(2);
    expect(createdPools[0]?.endMock).toHaveBeenCalledOnce();
    expect(createdPools[1]?.config).toEqual({
      connectionString: 'postgres://db-two'
    });
  });

  it('builds field-based config and ignores invalid port values', async () => {
    process.env['POSTGRES_HOST'] = '127.0.0.1';
    process.env['POSTGRES_USER'] = 'mailer';
    process.env['POSTGRES_PASSWORD'] = 'secret';
    process.env['POSTGRES_DATABASE'] = 'maildb';
    process.env['POSTGRES_PORT'] = 'not-a-number';
    const { createdPools, runtime } = createRuntime({
      devMode: false
    });

    await runtime.getPostgresPool();

    expect(createdPools[0]?.config).toEqual({
      host: '127.0.0.1',
      user: 'mailer',
      password: 'secret',
      database: 'maildb'
    });
  });

  it('treats blank env strings as unset when building config key', async () => {
    process.env['PGHOST'] = '   ';
    process.env['PGUSER'] = 'mailer';
    const { createdPools, runtime } = createRuntime({
      devMode: false
    });

    await runtime.getPostgresPool();

    expect(createdPools[0]?.config).toEqual({
      user: 'mailer'
    });
  });

  it('closes pool and resets runtime cache', async () => {
    process.env['PGHOST'] = 'localhost';
    process.env['PGDATABASE'] = 'maildb';
    process.env['PGPORT'] = '5433';
    const { createdPools, runtime } = createRuntime({
      devMode: false
    });

    const first = await runtime.getPostgresPool();
    await runtime.closePostgresPool();
    await runtime.closePostgresPool();
    const second = await runtime.getPostgresPool();

    expect(createdPools[0]?.endMock).toHaveBeenCalledOnce();
    expect(first).not.toBe(second);
  });

  it('module-level wrappers delegate to the default runtime', async () => {
    process.env['DATABASE_URL'] = 'postgres://wrapper-runtime';
    const { closePostgresPool, getPostgresPool } = await import(
      './postgres.js'
    );

    const first = await getPostgresPool();
    const second = await getPostgresPool();
    expect(first).toBe(second);

    await closePostgresPool();
    const third = await getPostgresPool();
    expect(third).toBeTruthy();
    await closePostgresPool();
  });
});
