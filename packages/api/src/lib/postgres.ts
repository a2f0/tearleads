import type { PostgresConnectionInfo } from '@rapid/shared';
import { Pool, type PoolConfig } from 'pg';

let pool: Pool | null = null;
let poolConfigKey: string | null = null;
let poolPromise: Promise<Pool> | null = null;

function getEnvValue(keys: string[]): string | undefined {
  for (const key of keys) {
    const value = process.env[key];
    if (value && value.trim().length > 0) {
      return value;
    }
  }
  return undefined;
}

function parsePort(value: string | undefined): number | null {
  if (!value) return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function buildConnectionInfo(): PostgresConnectionInfo {
  const databaseUrl = getEnvValue(['DATABASE_URL', 'POSTGRES_URL']);
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

  const host = getEnvValue(['POSTGRES_HOST']) ?? null;
  const port = parsePort(getEnvValue(['POSTGRES_PORT']));
  const user = getEnvValue(['POSTGRES_USER']) ?? null;
  const database = getEnvValue(['POSTGRES_DATABASE']) ?? null;

  return { host, port, database, user };
}

function buildPoolConfig(): { config: PoolConfig; configKey: string } {
  const databaseUrl = getEnvValue(['DATABASE_URL', 'POSTGRES_URL']);
  if (databaseUrl) {
    return {
      config: { connectionString: databaseUrl },
      configKey: `url:${databaseUrl}`
    };
  }

  const host = getEnvValue(['POSTGRES_HOST']);
  const port = parsePort(getEnvValue(['POSTGRES_PORT']));
  const user = getEnvValue(['POSTGRES_USER']);
  const password = getEnvValue(['POSTGRES_PASSWORD']);
  const database = getEnvValue(['POSTGRES_DATABASE']);

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

export async function getPostgresPool(): Promise<Pool> {
  const { config, configKey } = buildPoolConfig();

  if (pool && poolConfigKey === configKey) {
    return pool;
  }

  if (poolPromise && poolConfigKey === configKey) {
    return poolPromise;
  }

  if (pool && poolConfigKey && poolConfigKey !== configKey) {
    await closePostgresPool();
  }

  poolConfigKey = configKey;
  poolPromise = Promise.resolve(new Pool(config));
  pool = await poolPromise;
  return pool;
}

export async function closePostgresPool(): Promise<void> {
  if (!pool) {
    return;
  }
  const poolToClose = pool;
  pool = null;
  poolPromise = null;
  poolConfigKey = null;
  await poolToClose.end();
}
