#!/usr/bin/env -S pnpm exec tsx
import { execFileSync } from 'node:child_process';
import {
  DATABASE_KEYS,
  DATABASE_URL_KEYS,
  DEV_DATABASE_NAME,
  HOST_KEYS,
  PASSWORD_KEYS,
  PORT_KEYS,
  USER_KEYS,
  getDevDefaults,
  getEnvValue,
  parsePort
} from './lib/pg-helpers.ts';

type ConnectionParts = {
  host: string | null;
  port: number | null;
  user: string | null;
  password: string | null;
  database: string | null;
};

type CliOptions = {
  yes: boolean;
  database?: string;
  databaseUrl?: string;
};

const ALLOWED_DATABASE = DEV_DATABASE_NAME;
const DENIED_DATABASE = 'tearleads_production';

function parseArgs(args: string[]): CliOptions {
  const options: CliOptions = {
    yes: false
  };

  for (let i = 0; i < args.length; i += 1) {
    const arg = args[i];
    if (arg === '--yes') {
      options.yes = true;
      continue;
    }
    if (arg === '--database') {
      options.database = args[i + 1];
      i += 1;
      continue;
    }
    if (arg?.startsWith('--database=')) {
      options.database = arg.split('=', 2)[1];
      continue;
    }
    if (arg === '--database-url') {
      options.databaseUrl = args[i + 1];
      i += 1;
      continue;
    }
    if (arg?.startsWith('--database-url=')) {
      options.databaseUrl = arg.split('=', 2)[1];
      continue;
    }
  }

  return options;
}

function parseDatabaseUrl(databaseUrl: string): ConnectionParts {
  const parsed = new URL(databaseUrl);
  const databaseName = parsed.pathname
    ? decodeURIComponent(parsed.pathname.replace(/^\//, ''))
    : null;
  const portValue = parsed.port ? Number(parsed.port) : null;
  return {
    host: parsed.hostname || null,
    port: Number.isFinite(portValue ?? NaN) ? portValue : null,
    user: parsed.username ? decodeURIComponent(parsed.username) : null,
    password: parsed.password ? decodeURIComponent(parsed.password) : null,
    database: databaseName || null
  };
}

function buildDatabaseUrl(parts: ConnectionParts): string {
  if (!parts.database) {
    throw new Error('Database must be specified in connection parts.');
  }
  const encodedUser = parts.user ? encodeURIComponent(parts.user) : '';
  const encodedPassword = parts.password
    ? encodeURIComponent(parts.password)
    : '';
  const auth = encodedUser
    ? encodedPassword
      ? `${encodedUser}:${encodedPassword}`
      : encodedUser
    : '';
  const host = parts.host ?? 'localhost';
  const port = parts.port ?? 5432;
  return `postgres://${auth ? `${auth}@` : ''}${host}:${port}/${parts.database}`;
}

const options = parseArgs(process.argv.slice(2));
const databaseUrl = options.databaseUrl ?? getEnvValue(DATABASE_URL_KEYS);
const databaseEnvValue = getEnvValue(DATABASE_KEYS);
const defaults = getDevDefaults();

const baseParts: ConnectionParts = databaseUrl
  ? parseDatabaseUrl(databaseUrl)
  : {
      host: getEnvValue(HOST_KEYS) ?? defaults.host ?? null,
      port: parsePort(getEnvValue(PORT_KEYS)) ?? defaults.port ?? null,
      user: getEnvValue(USER_KEYS) ?? defaults.user ?? null,
      password: getEnvValue(PASSWORD_KEYS) ?? null,
      database: databaseEnvValue ?? defaults.database ?? null
    };

const targetDatabase = options.database ?? baseParts.database;

if (!targetDatabase) {
  console.error(
    'Missing database name. Set DATABASE_URL or PGDATABASE/POSTGRES_DATABASE (or pass --database).',
  );
  process.exit(1);
}

if (targetDatabase === DENIED_DATABASE) {
  console.error(
    `Refusing to drop database "${targetDatabase}". This database is explicitly denied.`,
  );
  process.exit(1);
}

if (targetDatabase !== ALLOWED_DATABASE) {
  console.error(
    `Refusing to drop database "${targetDatabase}". Only "${ALLOWED_DATABASE}" is allowed.`,
  );
  process.exit(1);
}

if (!options.yes) {
  console.error(
    `Refusing to drop database "${targetDatabase}" without --yes confirmation.`,
  );
  process.exit(1);
}

const adminDatabase = 'postgres';
const adminUrl = buildDatabaseUrl({
  ...baseParts,
  database: adminDatabase
});

const safeDatabaseLiteral = targetDatabase.replace(/'/g, "''");
const safeDatabaseIdentifier = targetDatabase.replace(/"/g, '""');
const sql =
  `SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = '${safeDatabaseLiteral}' ` +
  'AND pid <> pg_backend_pid(); ' +
  `DROP DATABASE IF EXISTS "${safeDatabaseIdentifier}";`;

try {
  execFileSync(
    'psql',
    ['--set=ON_ERROR_STOP=1', '--dbname', adminUrl, '-c', sql],
    { stdio: 'inherit' },
  );
} catch (error) {
  console.error('Failed to drop database. Ensure psql is installed and reachable.');
  throw error;
}
