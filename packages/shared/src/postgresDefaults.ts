import os from 'node:os';

export interface PostgresDevDefaults {
  host?: string;
  port?: number;
  user?: string;
  database?: string;
}

export function isDevMode(): boolean {
  const nodeEnv = process.env['NODE_ENV'];
  return nodeEnv === 'development' || !nodeEnv;
}

export function getPostgresDevDefaults(): PostgresDevDefaults {
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
  const baseDefaults: PostgresDevDefaults = {
    host: process.platform === 'linux' ? '/var/run/postgresql' : 'localhost',
    port: 5432,
    database: 'tearleads_development'
  };
  if (user && user.trim().length > 0) {
    return { ...baseDefaults, user };
  }
  return baseDefaults;
}
