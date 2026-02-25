import {
  getPostgresDevDefaults,
  isDevMode,
  type PostgresConnectionInfo
} from '@tearleads/shared';
import type { Pool as PgPool, PoolConfig } from 'pg';
import pg from 'pg';

const { Pool } = pg;

type QueryIntent = 'read' | 'write';

let pool: PgPool | null = null;
let poolConfigKey: string | null = null;
let poolMutex: Promise<void> = Promise.resolve();

let replicaPool: PgPool | null = null;
let replicaPoolConfigKey: string | null = null;
let replicaPoolMutex: Promise<void> = Promise.resolve();
let replicaHealthy = true;
let replicaHealthTimer: ReturnType<typeof setInterval> | null = null;

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

  const defaults = getPostgresDevDefaults();
  const host = getEnvValue(HOST_KEYS) ?? defaults.host ?? null;
  const port = parsePort(getEnvValue(PORT_KEYS)) ?? defaults.port ?? null;
  const user = getEnvValue(USER_KEYS) ?? defaults.user ?? null;
  const database = getEnvValue(DATABASE_KEYS) ?? defaults.database ?? null;

  return { host, port, database, user };
}

function parseSslConfig(): PoolConfig['ssl'] | undefined {
  const sslEnv = process.env['POSTGRES_SSL'];
  if (!sslEnv || sslEnv === '0' || sslEnv === 'false') return undefined;
  return { rejectUnauthorized: false };
}

function buildPoolConfig(): { config: PoolConfig; configKey: string } {
  const poolSizing = {
    max: 15,
    idleTimeoutMillis: 30_000,
    connectionTimeoutMillis: 5_000
  };

  if (!isDevMode()) {
    const config = requireReleaseConfig();
    const ssl = parseSslConfig();
    return {
      config: { ...config, ...poolSizing, ...(ssl ? { ssl } : {}) },
      configKey: JSON.stringify({
        host: config.host,
        port: config.port,
        user: config.user,
        database: config.database,
        ssl: !!ssl
      })
    };
  }

  const databaseUrl = getEnvValue(DATABASE_URL_KEYS);
  if (databaseUrl) {
    return {
      config: { connectionString: databaseUrl, ...poolSizing },
      configKey: `url:${databaseUrl}`
    };
  }

  const defaults = getPostgresDevDefaults();
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
    ...(database ? { database } : {}),
    ...poolSizing
  };

  const configKey = JSON.stringify({
    host: host ?? null,
    port: port ?? null,
    user: user ?? null,
    database: database ?? null
  });

  return { config, configKey };
}

function buildReplicaPoolConfig(): {
  config: PoolConfig;
  configKey: string;
} | null {
  if (isDevMode()) return null;

  const replicaHost = getEnvValue(['POSTGRES_REPLICA_HOST']);
  if (!replicaHost) return null;

  const primaryConfig = requireReleaseConfig();
  const ssl = parseSslConfig();
  const replicaSizing = {
    max: 20,
    idleTimeoutMillis: 30_000,
    connectionTimeoutMillis: 5_000
  };

  return {
    config: {
      host: replicaHost,
      port: primaryConfig.port,
      user: primaryConfig.user,
      password: primaryConfig.password,
      database: primaryConfig.database,
      ...replicaSizing,
      ...(ssl ? { ssl } : {})
    },
    configKey: JSON.stringify({
      replica: true,
      host: replicaHost,
      port: primaryConfig.port,
      user: primaryConfig.user,
      database: primaryConfig.database,
      ssl: !!ssl
    })
  };
}

function startReplicaHealthCheck(
  replicaPoolInstance: PgPool,
  intervalMs = 30_000
): void {
  if (replicaHealthTimer) {
    clearInterval(replicaHealthTimer);
  }
  replicaHealthTimer = setInterval(async () => {
    try {
      const result = await replicaPoolInstance.query<{
        pg_is_in_recovery: boolean;
      }>('SELECT pg_is_in_recovery()');
      replicaHealthy = result.rows[0]?.pg_is_in_recovery === true;
    } catch {
      replicaHealthy = false;
    }
  }, intervalMs);
}

async function getReplicaPool(): Promise<PgPool | null> {
  const replicaConfig = buildReplicaPoolConfig();
  if (!replicaConfig) return null;

  const { config, configKey } = replicaConfig;

  if (replicaPool && replicaPoolConfigKey === configKey) {
    return replicaPool;
  }

  let resolve: () => void = () => {};
  const prevMutex = replicaPoolMutex;
  replicaPoolMutex = new Promise<void>((r) => {
    resolve = r;
  });

  try {
    await prevMutex;

    if (replicaPool && replicaPoolConfigKey === configKey) {
      return replicaPool;
    }

    if (
      replicaPool &&
      replicaPoolConfigKey &&
      replicaPoolConfigKey !== configKey
    ) {
      if (replicaHealthTimer) {
        clearInterval(replicaHealthTimer);
        replicaHealthTimer = null;
      }
      const poolToClose = replicaPool;
      replicaPool = null;
      replicaPoolConfigKey = null;
      await poolToClose.end();
    }

    replicaPoolConfigKey = configKey;
    replicaPool = new Pool(config);
    replicaHealthy = true;
    startReplicaHealthCheck(replicaPool);
    return replicaPool;
  } finally {
    resolve();
  }
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

export async function getPool(intent: QueryIntent): Promise<PgPool> {
  if (intent === 'write') {
    return getPostgresPool();
  }

  if (replicaHealthy) {
    const replica = await getReplicaPool();
    if (replica) return replica;
  }

  return getPostgresPool();
}

export async function closePostgresPool(): Promise<void> {
  let replicaResolve: () => void = () => {};
  const prevReplicaMutex = replicaPoolMutex;
  replicaPoolMutex = new Promise<void>((r) => {
    replicaResolve = r;
  });

  try {
    await prevReplicaMutex;
    if (replicaHealthTimer) {
      clearInterval(replicaHealthTimer);
      replicaHealthTimer = null;
    }
    if (replicaPool) {
      const poolToClose = replicaPool;
      replicaPool = null;
      replicaPoolConfigKey = null;
      replicaHealthy = true;
      await poolToClose.end();
    }
  } finally {
    replicaResolve();
  }

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
