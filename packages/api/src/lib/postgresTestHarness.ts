import { type Mock, vi } from 'vitest';

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

export const poolInstances: PoolInstance[] = [];
export const poolQueryMock: Mock = vi.fn();

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

const RESET_ENV_KEYS = [
  'USER',
  'LOGNAME',
  'DATABASE_URL',
  'POSTGRES_URL',
  'POSTGRES_HOST',
  'POSTGRES_PORT',
  'POSTGRES_USER',
  'POSTGRES_PASSWORD',
  'POSTGRES_DATABASE',
  'POSTGRES_REPLICA_HOST',
  'POSTGRES_REPLICA_MAX_LAG_SECONDS',
  'POSTGRES_SSL',
  'POSTGRES_SSL_REJECT_UNAUTHORIZED',
  'PGHOST',
  'PGPORT',
  'PGUSER',
  'PGPASSWORD',
  'PGDATABASE'
];

function clearResetEnvKeys(): void {
  for (const key of RESET_ENV_KEYS) {
    delete process.env[key];
  }
}

export function resetPostgresTestEnv(): void {
  vi.resetModules();
  poolQueryMock.mockReset();
  poolQueryMock.mockResolvedValue({
    rows: [{ pg_is_in_recovery: true, replay_lag_seconds: 0 }]
  });
  process.env = { ...originalEnv };
  clearResetEnvKeys();
  if (!process.env['NODE_ENV']) {
    process.env['NODE_ENV'] = 'test';
  }
  poolInstances.length = 0;
}

export function restorePostgresTestEnv(): void {
  process.env = originalEnv;
}

export async function loadPostgresModule() {
  return import('./postgres.js');
}

export function setupDevEnvWithoutVars(): void {
  process.env['NODE_ENV'] = 'development';
  clearResetEnvKeys();
}

export function expectedDevHost(): string {
  return process.platform === 'linux' ? '/var/run/postgresql' : 'localhost';
}

export function setReleaseEnv(): void {
  process.env['POSTGRES_HOST'] = 'primary.db';
  process.env['POSTGRES_PORT'] = '5432';
  process.env['POSTGRES_USER'] = 'app';
  process.env['POSTGRES_PASSWORD'] = 'secret';
  process.env['POSTGRES_DATABASE'] = 'tearleads';
}
