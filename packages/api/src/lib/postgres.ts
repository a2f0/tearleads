import os from 'node:os';
import type { PostgresConnectionInfo } from '@rapid/shared';
import type { Pool as PgPool, PoolConfig } from 'pg';
import pg from 'pg';

const { Pool } = pg;

let pool: PgPool | null = null;
let poolConfigKey: string | null = null;
let poolMutex: Promise<void> = Promise.resolve();

const DATABASE_URL_KEYS = ['DATABASE_URL', 'POSTGRES_URL'];
const HOST_KEYS = ['POSTGRES_HOST', 'PGHOST'];
const PORT_KEYS = ['POSTGRES_PORT', 'PGPORT'];
const USER_KEYS = ['POSTGRES_USER', 'PGUSER'];
const PASSWORD_KEYS = ['POSTGRES_PASSWORD', 'PGPASSWORD'];
const DATABASE_KEYS = ['POSTGRES_DATABASE', 'PGDATABASE'];
const RELEASE_ENV_KEYS = {
  host: 'POSTGRES_HOST',
  port: 'POSTGRES_PORT',
  user: 'POSTGRES_USER',
  password: 'POSTGRES_PASSWORD',
  database: 'POSTGRES_DATABASE'
};

function getEnvValue(keys: string[]): string | undefined {
  for (const key of keys) {
    const value = process.env[key];
    if (value && value.trim().length > 0) {
      return value;
    }
  }
  return undefined;
}

function getRequiredEnvValue(key: string, missing: string[]): string {
  const value = getEnvValue([key]);
  if (!value) {
    missing.push(key);
    return '';
  }
  return value;
}

function parsePort(value: string | undefined): number | null {
  if (!value) return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function isDevMode(): boolean {
  const nodeEnv = process.env['NODE_ENV'];
  return nodeEnv === 'development' || !nodeEnv;
}

function getDevDefaults(): {
  host?: string;
  port?: number;
  user?: string;
  database?: string;
} {
  if (!isDevMode()) {
    return {};
  }
  let user = process.env['USER'] ?? process.env['LOGNAME'];
  if (!user) {
    try {
      const osUser = os.userInfo().username;
      user = osUser && osUser.trim().length > 0 ? osUser : undefined;
    } catch {
      user = undefined;
    }
  }
  const baseDefaults = {
    host: 'localhost',
    port: 5432,
    database: 'tearleads_development'
  };
  if (user && user.trim().length > 0) {
    return { ...baseDefaults, user };
  }
  return baseDefaults;
}

function requireReleaseConfig(): {
  host: string;
  port: number;
  user: string;
  password: string;
  database: string;
} {
  const missing: string[] = [];

  const host = getRequiredEnvValue(RELEASE_ENV_KEYS.host, missing);
  const portValue = getRequiredEnvValue(RELEASE_ENV_KEYS.port, missing);
  const user = getRequiredEnvValue(RELEASE_ENV_KEYS.user, missing);
  const password = getRequiredEnvValue(RELEASE_ENV_KEYS.password, missing);
  const database = getRequiredEnvValue(RELEASE_ENV_KEYS.database, missing);

  if (missing.length > 0) {
    throw new Error(
      `Missing required Postgres environment variables: ${missing.join(', ')}`
    );
  }

  const port = parsePort(portValue);
  if (port === null) {
    throw new Error('POSTGRES_PORT must be a valid number');
  }

  return { host, port, user, password, database };
}

function buildConnectionInfo(): PostgresConnectionInfo {
  if (!isDevMode()) {
    const config = requireReleaseConfig();
    return {
      host: config.host,
      port: config.port,
      database: config.database,
      user: config.user
    };
  }

  const databaseUrl = getEnvValue(DATABASE_URL_KEYS);
  if (databaseUrl) {
    const parsed = new URL(databaseUrl);
    const username = parsed.username
      ? decodeURIComponent(parsed.username)
      : null;
    const databaseName = parsed.pathname
      ? decodeURIComponent(parsed.pathname.replace(/^\//, ''))
      : null;
    const portValue = parsed.port ? Number(parsed.port) : null;
    return {
      host: parsed.hostname || null,
      port: Number.isFinite(portValue ?? NaN) ? portValue : null,
      database: databaseName || null,
      user: username || null
    };
  }

  const defaults = getDevDefaults();
  const host = getEnvValue(HOST_KEYS) ?? defaults.host ?? null;
  const port = parsePort(getEnvValue(PORT_KEYS)) ?? defaults.port ?? null;
  const user = getEnvValue(USER_KEYS) ?? defaults.user ?? null;
  const database = getEnvValue(DATABASE_KEYS) ?? defaults.database ?? null;

  return { host, port, database, user };
}

function buildPoolConfig(): { config: PoolConfig; configKey: string } {
  if (!isDevMode()) {
    const config = requireReleaseConfig();
    return {
      config,
      configKey: JSON.stringify({
        host: config.host,
        port: config.port,
        user: config.user,
        database: config.database
      })
    };
  }

  const databaseUrl = getEnvValue(DATABASE_URL_KEYS);
  if (databaseUrl) {
    return {
      config: { connectionString: databaseUrl },
      configKey: `url:${databaseUrl}`
    };
  }

  const defaults = getDevDefaults();
  const host = getEnvValue(HOST_KEYS) ?? defaults.host;
  const port = parsePort(getEnvValue(PORT_KEYS)) ?? defaults.port;
  const user = getEnvValue(USER_KEYS) ?? defaults.user;
  const password = getEnvValue(PASSWORD_KEYS);
  const database = getEnvValue(DATABASE_KEYS) ?? defaults.database;

  const config: PoolConfig = {
    ...(host ? { host } : {}),
    ...(port ? { port } : {}),
    ...(user ? { user } : {}),
    ...(password ? { password } : {}),
    ...(database ? { database } : {})
  };

  const configKey = JSON.stringify({
    host: host ?? null,
    port: port ?? null,
    user: user ?? null,
    database: database ?? null
  });

  return { config, configKey };
}

export function getPostgresConnectionInfo(): PostgresConnectionInfo {
  return buildConnectionInfo();
}

export async function getPostgresPool(): Promise<PgPool> {
  const { config, configKey } = buildPoolConfig();

  if (pool && poolConfigKey === configKey) {
    return pool;
  }

  let resolve: () => void = () => {};
  const prevMutex = poolMutex;
  poolMutex = new Promise<void>((r) => {
    resolve = r;
  });

  try {
    await prevMutex;

    if (pool && poolConfigKey === configKey) {
      return pool;
    }

    if (pool && poolConfigKey && poolConfigKey !== configKey) {
      const poolToClose = pool;
      pool = null;
      poolConfigKey = null;
      await poolToClose.end();
    }

    poolConfigKey = configKey;
    pool = new Pool(config);
    return pool;
  } finally {
    resolve();
  }
}

export async function closePostgresPool(): Promise<void> {
  let resolve: () => void = () => {};
  const prevMutex = poolMutex;
  poolMutex = new Promise<void>((r) => {
    resolve = r;
  });

  try {
    await prevMutex;

    if (!pool) {
      return;
    }
    const poolToClose = pool;
    pool = null;
    poolConfigKey = null;
    await poolToClose.end();
  } finally {
    resolve();
  }
}
