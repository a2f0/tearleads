#!/usr/bin/env -S pnpm exec tsx
import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const rootDir = join(__dirname, '..');
const schemaPath = join(rootDir, 'packages/db/src/generated/postgresql/schema.ts');

const DATABASE_URL_KEYS = ['DATABASE_URL', 'POSTGRES_URL'];
const HOST_KEYS = ['POSTGRES_HOST', 'PGHOST'];
const PORT_KEYS = ['POSTGRES_PORT', 'PGPORT'];
const USER_KEYS = ['POSTGRES_USER', 'PGUSER'];
const PASSWORD_KEYS = ['POSTGRES_PASSWORD', 'PGPASSWORD'];
const DATABASE_KEYS = ['POSTGRES_DATABASE', 'PGDATABASE'];

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

function isDevMode(): boolean {
  const nodeEnv = process.env.NODE_ENV;
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
    database: 'tearleads_development'
  };
  if (user && user.trim().length > 0) {
    return { ...baseDefaults, user };
  }
  return baseDefaults;
}

function buildDatabaseUrl(): string | null {
  const databaseUrl = getEnvValue(DATABASE_URL_KEYS);
  if (databaseUrl) {
    return databaseUrl;
  }

  const defaults = getDevDefaults();
  const host = getEnvValue(HOST_KEYS) ?? defaults.host ?? null;
  const port = parsePort(getEnvValue(PORT_KEYS)) ?? defaults.port ?? null;
  const user = getEnvValue(USER_KEYS) ?? defaults.user ?? null;
  const password = getEnvValue(PASSWORD_KEYS);
  const database = getEnvValue(DATABASE_KEYS) ?? defaults.database ?? null;

  if (!database) {
    return null;
  }

  const encodedUser = user ? encodeURIComponent(user) : '';
  const encodedPassword = password ? encodeURIComponent(password) : '';
  const auth = encodedUser
    ? encodedPassword
      ? `${encodedUser}:${encodedPassword}`
      : encodedUser
    : '';
  const hostValue = host ?? 'localhost';
  const portValue = port ?? 5432;

  return `postgres://${auth ? `${auth}@` : ''}${hostValue}:${portValue}/${database}`;
}

const databaseUrl = buildDatabaseUrl();

if (!databaseUrl) {
  console.error(
    'Missing Postgres connection info. Set DATABASE_URL or PGDATABASE/POSTGRES_DATABASE (plus PGHOST/PGPORT/PGUSER as needed).',
  );
  process.exit(1);
}

const tempDir = mkdtempSync(join(tmpdir(), 'rapid-drizzle-'));
const configPath = join(tempDir, 'drizzle.postgres.config.ts');

try {
  writeFileSync(
    configPath,
    `import type { Config } from 'drizzle-kit';\n\nexport default {\n  schema: '${schemaPath.replace(/\\/g, '\\\\')}',\n  dialect: 'postgresql',\n  dbCredentials: { url: ${JSON.stringify(databaseUrl)} }\n} satisfies Config;\n`,
  );

  execFileSync('pnpm', ['--filter', '@rapid/db', 'generate:postgresql'], {
    cwd: rootDir,
    stdio: 'inherit'
  });

  execFileSync(
    'pnpm',
    [
      '--filter',
      '@rapid/db',
      'exec',
      'drizzle-kit',
      'push',
      '--config',
      configPath,
      ...process.argv.slice(2)
    ],
    {
      cwd: rootDir,
      stdio: 'inherit',
      env: {
        ...process.env,
        DATABASE_URL: databaseUrl
      }
    },
  );
} finally {
  rmSync(tempDir, { force: true, recursive: true });
}
