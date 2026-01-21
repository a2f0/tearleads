#!/usr/bin/env -S pnpm exec tsx
import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  DATABASE_KEYS,
  DATABASE_URL_KEYS,
  HOST_KEYS,
  PASSWORD_KEYS,
  PORT_KEYS,
  USER_KEYS,
  getDevDefaults,
  getEnvValue,
  parsePort
} from './lib/pg-helpers.ts';

const __dirname = dirname(fileURLToPath(import.meta.url));
const rootDir = join(__dirname, '..');
const schemaPath = join(rootDir, 'packages/db/src/generated/postgresql/schema.ts');

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
