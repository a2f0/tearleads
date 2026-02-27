import {
  getPostgresDevDefaults,
  isDevMode,
  type PostgresConnectionInfo
} from '@tearleads/shared';
import {
  getPoolOverride,
  setPoolOverrideForTesting
} from '@tearleads/shared/testing';
import type { Pool as PgPool, PoolConfig } from 'pg';
import pg from 'pg';
import {
  logPoolStats,
  validateReplicaHealth
} from './postgresPoolObservability.js';

export { setPoolOverrideForTesting };

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
let replicaValidationPromise: Promise<boolean> | null = null;
let replicaLastValidationMs = 0;

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
const REPLICA_HEALTH_CHECK_INTERVAL_MS = 30_000;
const REPLICA_VALIDATE_MIN_INTERVAL_MS = 2_000;

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
  const normalizedSslEnv = sslEnv?.trim().toLowerCase();
  if (
    !normalizedSslEnv ||
    normalizedSslEnv === '0' ||
    normalizedSslEnv === 'false'
  ) {
    return undefined;
  }

  const rejectUnauthorizedEnv = process.env['POSTGRES_SSL_REJECT_UNAUTHORIZED']
    ?.trim()
    .toLowerCase();
  if (rejectUnauthorizedEnv === '0' || rejectUnauthorizedEnv === 'false') {
    return { rejectUnauthorized: false };
  }

  // Default to certificate verification unless explicitly disabled.
  return { rejectUnauthorized: true };
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
  intervalMs = REPLICA_HEALTH_CHECK_INTERVAL_MS
): void {
  if (replicaHealthTimer) {
    clearInterval(replicaHealthTimer);
  }
  replicaHealthTimer = setInterval(async () => {
    replicaHealthy = await validateReplicaHealth(replicaPoolInstance);
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
    replicaPool.on('error', (error) => {
      replicaHealthy = false;
      console.error('postgres_replica_pool_error', { error });
    });
    replicaHealthy = true;
    replicaLastValidationMs = 0;
    replicaValidationPromise = null;
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
  const override = getPoolOverride();
  if (override) return override;

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
    pool.on('error', (error) => {
      console.error('postgres_primary_pool_error', { error });
    });
    logPoolStats(pool, 'primary');
    return pool;
  } finally {
    resolve();
  }
}

async function getHealthyReplicaPool(): Promise<PgPool | null> {
  const replica = await getReplicaPool();
  if (!replica) {
    return null;
  }

  const now = Date.now();
  if (
    replicaHealthy &&
    now - replicaLastValidationMs < REPLICA_VALIDATE_MIN_INTERVAL_MS
  ) {
    return replica;
  }

  if (!replicaValidationPromise) {
    const validationPromise = (async () => {
      const isHealthy = await validateReplicaHealth(replica);
      replicaHealthy = isHealthy;
      replicaLastValidationMs = Date.now();
      return isHealthy;
    })();
    void validationPromise.finally(() => {
      if (replicaValidationPromise === validationPromise) {
        replicaValidationPromise = null;
      }
    });
    replicaValidationPromise = validationPromise;
  }

  const isHealthy = await replicaValidationPromise;
  return isHealthy ? replica : null;
}

export async function getPool(intent: QueryIntent): Promise<PgPool> {
  const override = getPoolOverride();
  if (override) return override;

  if (intent === 'write') {
    return getPostgresPool();
  }

  const replica = await getHealthyReplicaPool();
  if (replica) {
    return replica;
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
      replicaLastValidationMs = 0;
      replicaValidationPromise = null;
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
