import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('node:os', () => ({
  default: {
    userInfo: () => ({ username: 'tearleads_os_user' })
  }
}));

type PoolConfig = {
  connectionString?: string;
  host?: string;
  port?: number;
  user?: string;
  password?: string;
  database?: string;
  ssl?: {
    rejectUnauthorized: boolean;
  };
  max?: number;
  idleTimeoutMillis?: number;
  connectionTimeoutMillis?: number;
};

type PoolInstance = {
  config: PoolConfig;
  end: ReturnType<typeof vi.fn>;
  query: ReturnType<typeof vi.fn>;
  on: ReturnType<typeof vi.fn>;
  totalCount: number;
  idleCount: number;
  waitingCount: number;
};

const poolInstances: PoolInstance[] = [];
const poolQueryMock = vi.fn();

class PoolMock {
  config: PoolConfig;
  end: ReturnType<typeof vi.fn>;
  query: ReturnType<typeof vi.fn>;
  on: ReturnType<typeof vi.fn>;
  totalCount: number;
  idleCount: number;
  waitingCount: number;

  constructor(config: PoolConfig) {
    this.config = config;
    this.end = vi.fn().mockResolvedValue(undefined);
    this.query = vi.fn(async (...args: unknown[]) => {
      return poolQueryMock(...args);
    });
    this.on = vi.fn();
    this.totalCount = 1;
    this.idleCount = 1;
    this.waitingCount = 0;
    poolInstances.push(this);
  }
}

vi.mock('pg', () => ({
  default: { Pool: PoolMock },
  Pool: PoolMock
}));

const originalEnv = process.env;

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

async function loadPostgresModule() {
  return import('./postgres.js');
}

function setReleaseEnv() {
  process.env['POSTGRES_HOST'] = 'primary.db';
  process.env['POSTGRES_PORT'] = '5432';
  process.env['POSTGRES_USER'] = 'app';
  process.env['POSTGRES_PASSWORD'] = 'secret';
  process.env['POSTGRES_DATABASE'] = 'tearleads';
}

describe('replica pool', () => {
  beforeEach(() => {
    vi.resetModules();
    poolQueryMock.mockReset();
    poolQueryMock.mockResolvedValue({
      rows: [{ pg_is_in_recovery: true, replay_lag_seconds: 0 }]
    });
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

  it('getPool("write") returns primary pool', async () => {
    setReleaseEnv();
    const { getPool, getPostgresPool } = await loadPostgresModule();

    const writePool = await getPool('write');
    const primaryPool = await getPostgresPool();
    expect(writePool).toBe(primaryPool);
  });

  it('getPool("read") falls back to primary when POSTGRES_REPLICA_HOST is absent', async () => {
    setReleaseEnv();
    const { getPool, getPostgresPool } = await loadPostgresModule();

    const readPool = await getPool('read');
    const primaryPool = await getPostgresPool();
    expect(readPool).toBe(primaryPool);
    expect(poolInstances).toHaveLength(1);
  });

  it('getPool("read") returns replica pool when POSTGRES_REPLICA_HOST is set', async () => {
    setReleaseEnv();
    process.env['POSTGRES_REPLICA_HOST'] = 'replica.db';
    const { getPool } = await loadPostgresModule();

    const readPool = await getPool('read');
    const writePool = await getPool('write');
    expect(readPool).not.toBe(writePool);
    expect(poolInstances).toHaveLength(2);
  });

  it('replica pool uses correct config with replica sizing', async () => {
    setReleaseEnv();
    process.env['POSTGRES_REPLICA_HOST'] = 'replica.db';
    const { getPool } = await loadPostgresModule();

    await getPool('read');

    const replicaInstance = poolInstances.find(
      (p) => p.config.host === 'replica.db'
    );
    expect(replicaInstance).toBeDefined();
    expect(replicaInstance?.config).toEqual({
      host: 'replica.db',
      port: 5432,
      user: 'app',
      password: 'secret',
      database: 'tearleads',
      max: 20,
      idleTimeoutMillis: 30_000,
      connectionTimeoutMillis: 5_000
    });
  });

  it('primary pool has explicit pool sizing', async () => {
    setReleaseEnv();
    const { getPostgresPool } = await loadPostgresModule();

    await getPostgresPool();

    const primaryInstance = poolInstances.find(
      (p) => p.config.host === 'primary.db'
    );
    expect(primaryInstance).toBeDefined();
    expect(primaryInstance?.config).toMatchObject({
      max: 15,
      idleTimeoutMillis: 30_000,
      connectionTimeoutMillis: 5_000
    });
  });

  it('closePostgresPool closes both pools', async () => {
    setReleaseEnv();
    process.env['POSTGRES_REPLICA_HOST'] = 'replica.db';
    const { closePostgresPool, getPool } = await loadPostgresModule();

    await getPool('read');
    await getPool('write');
    expect(poolInstances).toHaveLength(2);

    await closePostgresPool();

    for (const instance of poolInstances) {
      expect(instance.end).toHaveBeenCalledTimes(1);
    }
  });

  it('reuses replica pool on repeated calls', async () => {
    setReleaseEnv();
    process.env['POSTGRES_REPLICA_HOST'] = 'replica.db';
    const { getPool } = await loadPostgresModule();

    const pool1 = await getPool('read');
    const pool2 = await getPool('read');
    expect(pool1).toBe(pool2);

    const replicaInstances = poolInstances.filter(
      (p) => p.config.host === 'replica.db'
    );
    expect(replicaInstances).toHaveLength(1);
  });

  it('replica pool not created in dev mode', async () => {
    process.env['NODE_ENV'] = 'development';
    process.env['DATABASE_URL'] = 'postgres://user@localhost:5432/db1';
    process.env['POSTGRES_REPLICA_HOST'] = 'replica.db';
    const { getPool } = await loadPostgresModule();

    const readPool = await getPool('read');
    const writePool = await getPool('write');
    expect(readPool).toBe(writePool);
    expect(poolInstances).toHaveLength(1);
  });

  it('recreates replica pool when POSTGRES_REPLICA_HOST changes', async () => {
    setReleaseEnv();
    process.env['POSTGRES_REPLICA_HOST'] = 'replica-a.db';
    const { getPool } = await loadPostgresModule();

    const firstRead = await getPool('read');
    expect(firstRead).toBeDefined();
    const firstReplica = poolInstances.find(
      (p) => p.config.host === 'replica-a.db'
    );
    expect(firstReplica).toBeDefined();

    process.env['POSTGRES_REPLICA_HOST'] = 'replica-b.db';
    const secondRead = await getPool('read');
    expect(secondRead).not.toBe(firstRead);

    expect(firstReplica?.end).toHaveBeenCalledTimes(1);
    const secondReplica = poolInstances.find(
      (p) => p.config.host === 'replica-b.db'
    );
    expect(secondReplica).toBeDefined();
  });

  it('revalidates a recreated replica pool before routing reads to it', async () => {
    setReleaseEnv();
    process.env['POSTGRES_REPLICA_HOST'] = 'replica-a.db';
    const { getPool } = await loadPostgresModule();

    await getPool('read');

    process.env['POSTGRES_REPLICA_HOST'] = 'replica-b.db';
    poolQueryMock.mockRejectedValueOnce(new Error('replica-b down'));
    const consoleErrorSpy = vi
      .spyOn(console, 'error')
      .mockImplementation(() => {});

    const readPool = await getPool('read');
    const primaryPool = await getPool('write');

    expect(readPool).toBe(primaryPool);
    consoleErrorSpy.mockRestore();
  });

  it('replica pool includes SSL config when POSTGRES_SSL is set', async () => {
    setReleaseEnv();
    process.env['POSTGRES_REPLICA_HOST'] = 'replica.db';
    process.env['POSTGRES_SSL'] = '1';
    const { getPool } = await loadPostgresModule();

    await getPool('read');

    const replicaInstance = poolInstances.find(
      (p) => p.config.host === 'replica.db'
    );
    expect(replicaInstance?.config).toMatchObject({
      ssl: { rejectUnauthorized: false }
    });
  });

  it('getPool("read") falls back to primary when replica health validation fails', async () => {
    setReleaseEnv();
    process.env['POSTGRES_REPLICA_HOST'] = 'replica.db';
    poolQueryMock.mockRejectedValueOnce(new Error('replica down'));
    const consoleErrorSpy = vi
      .spyOn(console, 'error')
      .mockImplementation(() => {});
    const { getPool } = await loadPostgresModule();

    const readPool = await getPool('read');
    const primaryPool = await getPool('write');

    expect(readPool).toBe(primaryPool);
    consoleErrorSpy.mockRestore();
  });

  it('getPool("read") falls back to primary when replica lag exceeds threshold', async () => {
    setReleaseEnv();
    process.env['POSTGRES_REPLICA_HOST'] = 'replica.db';
    process.env['POSTGRES_REPLICA_MAX_LAG_SECONDS'] = '5';
    poolQueryMock.mockResolvedValueOnce({
      rows: [{ pg_is_in_recovery: true, replay_lag_seconds: 12 }]
    });
    const consoleWarnSpy = vi
      .spyOn(console, 'warn')
      .mockImplementation(() => {});
    const { getPool } = await loadPostgresModule();

    const readPool = await getPool('read');
    const primaryPool = await getPool('write');

    expect(readPool).toBe(primaryPool);
    consoleWarnSpy.mockRestore();
  });

  it('keeps routing reads to replica when LSN replay is caught up', async () => {
    setReleaseEnv();
    process.env['POSTGRES_REPLICA_HOST'] = 'replica.db';
    process.env['POSTGRES_REPLICA_MAX_LAG_SECONDS'] = '5';
    poolQueryMock.mockResolvedValueOnce({
      rows: [
        {
          pg_is_in_recovery: true,
          replay_lag_seconds: 30,
          receive_lsn: '0/16B6A78',
          replay_lsn: '0/16B6A78'
        }
      ]
    });
    const { getPool } = await loadPostgresModule();

    const readPool = await getPool('read');
    const writePool = await getPool('write');

    expect(readPool).not.toBe(writePool);
  });

  it('shares a single in-flight validation for concurrent read pool lookups', async () => {
    setReleaseEnv();
    process.env['POSTGRES_REPLICA_HOST'] = 'replica.db';
    let releaseValidation: () => void = () => {
      throw new Error('expected validation resolver');
    };
    poolQueryMock.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          releaseValidation = () => {
            resolve({
              rows: [
                {
                  pg_is_in_recovery: true,
                  replay_lag_seconds: 0,
                  receive_lsn: '0/16B6A78',
                  replay_lsn: '0/16B6A78'
                }
              ]
            });
          };
        })
    );

    const { getPool } = await loadPostgresModule();

    const read1 = getPool('read');
    const read2 = getPool('read');
    const read3 = getPool('read');

    for (let i = 0; i < 5 && poolQueryMock.mock.calls.length === 0; i += 1) {
      await Promise.resolve();
    }
    expect(poolQueryMock).toHaveBeenCalledTimes(1);

    releaseValidation();

    const [pool1, pool2, pool3] = await Promise.all([read1, read2, read3]);
    expect(pool1).toBe(pool2);
    expect(pool2).toBe(pool3);
  });
});
