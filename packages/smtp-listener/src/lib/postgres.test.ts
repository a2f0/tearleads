import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';

interface MockPool {
  config: unknown;
  end: ReturnType<typeof vi.fn>;
}

const { poolCtorSpy, createdPools } = vi.hoisted(() => ({
  poolCtorSpy: vi.fn(),
  createdPools: [] as MockPool[]
}));

vi.mock('pg', () => ({
  default: {
    Pool: class MockPoolCtor {
      config: unknown;
      end: ReturnType<typeof vi.fn>;

      constructor(config: unknown) {
        this.config = config;
        this.end = vi.fn(async () => undefined);
        const pool: MockPool = {
          config: this.config,
          end: this.end
        };
        createdPools.push(pool);
        poolCtorSpy(config);
      }
    }
  }
}));

vi.mock('node:os', () => ({
  default: {
    userInfo: () => ({ username: 'smtp_os_user' })
  }
}));

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
    vi.resetModules();
    vi.clearAllMocks();
    createdPools.length = 0;
    clearPostgresEnv();
  });

  afterAll(() => {
    if (savedNodeEnv !== undefined) {
      process.env['NODE_ENV'] = savedNodeEnv;
    }
  });

  it('uses dev defaults when no env vars are set in dev mode', async () => {
    process.env['NODE_ENV'] = 'development';
    delete process.env['USER'];
    delete process.env['LOGNAME'];
    const { getPostgresPool } = await import('./postgres.js');

    await getPostgresPool();

    const expectedHost =
      process.platform === 'linux' ? '/var/run/postgresql' : 'localhost';
    expect(createdPools[0]?.config).toEqual({
      host: expectedHost,
      port: 5432,
      user: 'smtp_os_user',
      database: 'tearleads_development'
    });
  });

  it('omits missing dev defaults from config', async () => {
    process.env['NODE_ENV'] = 'development';
    vi.doMock('@tearleads/shared', () => ({
      isDevMode: () => true,
      getPostgresDevDefaults: () => ({
        host: 'localhost',
        port: null,
        user: null,
        database: 'tearleads_development'
      })
    }));
    const { getPostgresPool } = await import('./postgres.js');

    await getPostgresPool();

    expect(createdPools[0]?.config).toEqual({
      host: 'localhost',
      database: 'tearleads_development'
    });
    vi.doUnmock('@tearleads/shared');
  });

  it('handles fully empty dev defaults', async () => {
    process.env['NODE_ENV'] = 'development';
    vi.doMock('@tearleads/shared', () => ({
      isDevMode: () => true,
      getPostgresDevDefaults: () => ({})
    }));
    const { getPostgresPool } = await import('./postgres.js');

    await getPostgresPool();

    expect(createdPools[0]?.config).toEqual({});
    vi.doUnmock('@tearleads/shared');
  });

  it('throws when no env vars are set in release mode', async () => {
    process.env['NODE_ENV'] = 'production';
    const { getPostgresPool } = await import('./postgres.js');

    await expect(getPostgresPool()).rejects.toThrow(
      'Missing Postgres connection info. Set DATABASE_URL or PGDATABASE/POSTGRES_DATABASE (plus PGHOST/PGPORT/PGUSER as needed).'
    );
  });

  it('uses DATABASE_URL and reuses the pool for the same key', async () => {
    process.env['DATABASE_URL'] = 'postgres://db-one';
    const { getPostgresPool } = await import('./postgres.js');

    const first = await getPostgresPool();
    const second = await getPostgresPool();

    expect(poolCtorSpy).toHaveBeenCalledOnce();
    expect(first).toBe(second);
    expect(createdPools[0]?.config).toEqual({
      connectionString: 'postgres://db-one'
    });
  });

  it('rebuilds and closes previous pool when config key changes', async () => {
    process.env['DATABASE_URL'] = 'postgres://db-one';
    const { getPostgresPool } = await import('./postgres.js');

    const first = await getPostgresPool();

    process.env['DATABASE_URL'] = 'postgres://db-two';
    const second = await getPostgresPool();

    expect(first).not.toBe(second);
    expect(poolCtorSpy).toHaveBeenCalledTimes(2);
    expect(createdPools[0]?.end).toHaveBeenCalledOnce();
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
    const { getPostgresPool } = await import('./postgres.js');

    await getPostgresPool();

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
    const { getPostgresPool } = await import('./postgres.js');

    await getPostgresPool();

    expect(createdPools[0]?.config).toEqual({
      user: 'mailer'
    });
  });

  it('closes pool and resets runtime cache', async () => {
    process.env['PGHOST'] = 'localhost';
    process.env['PGDATABASE'] = 'maildb';
    process.env['PGPORT'] = '5433';
    const { closePostgresPool, getPostgresPool } = await import(
      './postgres.js'
    );

    const first = await getPostgresPool();
    await closePostgresPool();
    await closePostgresPool();
    const second = await getPostgresPool();

    expect(createdPools[0]?.end).toHaveBeenCalledOnce();
    expect(first).not.toBe(second);
    expect(createdPools[1]?.config).toEqual({
      host: 'localhost',
      database: 'maildb',
      port: 5433
    });
  });
});
