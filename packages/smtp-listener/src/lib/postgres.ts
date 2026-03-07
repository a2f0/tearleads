import {
  getPostgresDevDefaults,
  isDevMode,
  type PostgresDevDefaults
} from '@tearleads/shared';
import type { Pool as PgPool, PoolConfig } from 'pg';
import pg from 'pg';

const { Pool } = pg;

interface PoolWithEnd {
  end: () => Promise<void>;
}

export interface PostgresPoolRuntimeDependencies<TPool extends PoolWithEnd> {
  createPool: (config: PoolConfig) => TPool;
  getPostgresDevDefaults: () => PostgresDevDefaults;
  isDevMode: () => boolean;
}

export interface PostgresPoolRuntime<TPool extends PoolWithEnd> {
  closePostgresPool: () => Promise<void>;
  getPostgresPool: () => Promise<TPool>;
}

function getEnv(name: string): string | null {
  const value = process.env[name];
  if (!value) {
    return null;
  }
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function parsePort(value: string | null): number | null {
  if (!value) {
    return null;
  }
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) {
    return null;
  }
  return parsed;
}

function buildPoolConfig(
  dependencies: Pick<
    PostgresPoolRuntimeDependencies<PoolWithEnd>,
    'getPostgresDevDefaults' | 'isDevMode'
  >
): { config: PoolConfig; key: string } {
  const databaseUrl = getEnv('DATABASE_URL') ?? getEnv('POSTGRES_URL');
  if (databaseUrl) {
    return {
      config: { connectionString: databaseUrl },
      key: `url:${databaseUrl}`
    };
  }

  const host = getEnv('POSTGRES_HOST') ?? getEnv('PGHOST');
  const user = getEnv('POSTGRES_USER') ?? getEnv('PGUSER');
  const password = getEnv('POSTGRES_PASSWORD') ?? getEnv('PGPASSWORD');
  const database = getEnv('POSTGRES_DATABASE') ?? getEnv('PGDATABASE');
  const port = parsePort(getEnv('POSTGRES_PORT') ?? getEnv('PGPORT'));

  const config: PoolConfig = {
    ...(host ? { host } : {}),
    ...(user ? { user } : {}),
    ...(password ? { password } : {}),
    ...(database ? { database } : {}),
    ...(port ? { port } : {})
  };

  if (
    !config.host &&
    !config.user &&
    !config.password &&
    !config.database &&
    !config.port
  ) {
    if (!dependencies.isDevMode()) {
      throw new Error(
        'Missing Postgres connection info. Set DATABASE_URL or PGDATABASE/POSTGRES_DATABASE (plus PGHOST/PGPORT/PGUSER as needed).'
      );
    }
    const defaults = dependencies.getPostgresDevDefaults();
    const devConfig: PoolConfig = {
      ...(defaults.host ? { host: defaults.host } : {}),
      ...(defaults.port ? { port: defaults.port } : {}),
      ...(defaults.user ? { user: defaults.user } : {}),
      ...(defaults.database ? { database: defaults.database } : {})
    };
    return {
      config: devConfig,
      key: JSON.stringify({
        host: defaults.host ?? null,
        user: defaults.user ?? null,
        database: defaults.database ?? null,
        port: defaults.port ?? null
      })
    };
  }

  return {
    config,
    key: JSON.stringify({
      host: config.host ?? null,
      user: config.user ?? null,
      database: config.database ?? null,
      port: config.port ?? null
    })
  };
}

export async function getPostgresPool(): Promise<PgPool> {
  return defaultRuntime.getPostgresPool();
}

export async function closePostgresPool(): Promise<void> {
  await defaultRuntime.closePostgresPool();
}

export function createPostgresPoolRuntime<TPool extends PoolWithEnd>(
  dependencies: PostgresPoolRuntimeDependencies<TPool>
): PostgresPoolRuntime<TPool> {
  let pool: TPool | null = null;
  let poolConfigKey: string | null = null;

  async function getPostgresPoolRuntime(): Promise<TPool> {
    const { config, key } = buildPoolConfig(dependencies);
    if (pool && poolConfigKey === key) {
      return pool;
    }
    if (pool) {
      await pool.end();
      pool = null;
      poolConfigKey = null;
    }
    pool = dependencies.createPool(config);
    poolConfigKey = key;
    return pool;
  }

  async function closePostgresPoolRuntime(): Promise<void> {
    if (!pool) {
      return;
    }
    const poolToClose = pool;
    pool = null;
    poolConfigKey = null;
    await poolToClose.end();
  }

  return {
    getPostgresPool: getPostgresPoolRuntime,
    closePostgresPool: closePostgresPoolRuntime
  };
}

const defaultRuntime = createPostgresPoolRuntime<PgPool>({
  createPool: (config) => new Pool(config),
  getPostgresDevDefaults,
  isDevMode
});
