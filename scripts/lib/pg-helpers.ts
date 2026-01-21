import os from 'node:os';

export const DATABASE_URL_KEYS = ['DATABASE_URL', 'POSTGRES_URL'];
export const HOST_KEYS = ['POSTGRES_HOST', 'PGHOST'];
export const PORT_KEYS = ['POSTGRES_PORT', 'PGPORT'];
export const USER_KEYS = ['POSTGRES_USER', 'PGUSER'];
export const PASSWORD_KEYS = ['POSTGRES_PASSWORD', 'PGPASSWORD'];
export const DATABASE_KEYS = ['POSTGRES_DATABASE', 'PGDATABASE'];
export const DEV_DATABASE_NAME = 'tearleads_development';

export function getEnvValue(keys: string[]): string | undefined {
  for (const key of keys) {
    const value = process.env[key];
    if (value && value.trim().length > 0) {
      return value;
    }
  }
  return undefined;
}

export function parsePort(value: string | undefined): number | null {
  if (!value) return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function isDevMode(): boolean {
  const nodeEnv = process.env.NODE_ENV;
  return nodeEnv === 'development' || !nodeEnv;
}

export function getDevDefaults(): {
  host?: string;
  port?: number;
  user?: string;
  database?: string;
} {
  if (!isDevMode()) {
    return {};
  }
  let user = process.env.USER ?? process.env.LOGNAME;
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
    database: DEV_DATABASE_NAME
  };
  if (user && user.trim().length > 0) {
    return { ...baseDefaults, user };
  }
  return baseDefaults;
}
