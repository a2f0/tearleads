#!/usr/bin/env -S pnpm exec tsx
import { execFileSync } from 'node:child_process';
import {
  DATABASE_KEYS,
  DATABASE_URL_KEYS,
  DEV_DATABASE_NAME,
  getDevDefaults,
  getEnvValue,
  HOST_KEYS,
  PASSWORD_KEYS,
  PORT_KEYS,
  parsePort,
  USER_KEYS
} from './lib/pgHelpers.ts';

type ConnectionParts = {
  host: string | null;
  port: number | null;
  user: string | null;
  password: string | null;
  database: string | null;
};

type CliOptions = {
  yes: boolean;
  database: string | undefined;
  databaseUrl: string | undefined;
};

const ALLOWED_DATABASE = DEV_DATABASE_NAME;
const DENIED_DATABASE = 'tearleads_production';

function parseArgs(args: string[]): CliOptions {
  const options: CliOptions = {
    yes: false,
    database: undefined,
    databaseUrl: undefined
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

function buildPsqlEnv(
  parts: ConnectionParts,
  database: string
): Record<string, string> {
  const env: Record<string, string> = { PGDATABASE: database };
  if (parts.host != null) env['PGHOST'] = parts.host;
  if (parts.port != null) env['PGPORT'] = String(parts.port);
  if (parts.user != null) env['PGUSER'] = parts.user;
  if (parts.password != null) env['PGPASSWORD'] = parts.password;
  return env;
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
    'Missing database name. Set DATABASE_URL or PGDATABASE/POSTGRES_DATABASE (or pass --database).'
  );
  process.exit(1);
}

if (targetDatabase === DENIED_DATABASE) {
  console.error(
    `Refusing to drop database "${targetDatabase}". This database is explicitly denied.`
  );
  process.exit(1);
}

if (targetDatabase !== ALLOWED_DATABASE) {
  console.error(
    `Refusing to drop database "${targetDatabase}". Only "${ALLOWED_DATABASE}" is allowed.`
  );
  process.exit(1);
}

if (!options.yes) {
  console.error(
    `Refusing to drop database "${targetDatabase}" without --yes confirmation.`
  );
  process.exit(1);
}

const adminDatabase = 'postgres';
const psqlEnv = buildPsqlEnv(baseParts, adminDatabase);

const safeDatabaseLiteral = targetDatabase.replace(/'/g, "''");
const safeDatabaseIdentifier = targetDatabase.replace(/"/g, '""');
const terminateSql =
  `SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = '${safeDatabaseLiteral}' ` +
  'AND pid <> pg_backend_pid();';
const dropSql = `DROP DATABASE IF EXISTS "${safeDatabaseIdentifier}";`;

try {
  execFileSync('psql', ['--set=ON_ERROR_STOP=1', '-c', terminateSql], {
    stdio: 'inherit',
    env: { ...process.env, ...psqlEnv }
  });
  execFileSync('psql', ['--set=ON_ERROR_STOP=1', '-c', dropSql], {
    stdio: 'inherit',
    env: { ...process.env, ...psqlEnv }
  });
} catch (error) {
  console.error(
    'Failed to drop database. Ensure psql is installed and reachable.'
  );
  throw error;
}
