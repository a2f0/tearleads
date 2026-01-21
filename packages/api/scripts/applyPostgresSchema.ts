#!/usr/bin/env -S pnpm exec tsx
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import pg from 'pg';
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
} from '../../../scripts/lib/pg-helpers.ts';

const __dirname = dirname(fileURLToPath(import.meta.url));
const rootDir = join(__dirname, '..', '..', '..');
const schemaPath = join(rootDir, 'packages/db/src/generated/postgresql/schema.ts');
const migrationsDir = join(rootDir, 'packages/client/src/db/migrations');

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

function getLatestMigrationVersion(): number {
  const entries = readdirSync(migrationsDir, { withFileTypes: true });
  const versions = entries
    .filter(
      (entry) =>
        entry.isFile() &&
        entry.name.startsWith('v') &&
        entry.name.endsWith('.ts')
    )
    .map((entry) => {
      const match = entry.name.match(/^v(\d+)\.ts$/);
      if (!match) {
        return 0;
      }
      return Number.parseInt(match[1], 10);
    })
    .filter((value) => Number.isFinite(value));
  return versions.length > 0 ? Math.max(...versions) : 0;
}

async function recordSchemaVersion(
  connectionString: string,
  version: number
): Promise<void> {
  if (version <= 0) {
    return;
  }

  const client = new pg.Client({ connectionString });
  await client.connect();
  try {
    await client.query(
      `CREATE TABLE IF NOT EXISTS "schema_migrations" (
        "version" INTEGER PRIMARY KEY NOT NULL,
        "applied_at" TIMESTAMP WITH TIME ZONE NOT NULL
      )`
    );
    const result = await client.query<{ version: number | null }>(
      'SELECT MAX(version) AS version FROM schema_migrations'
    );
    const current = result.rows[0]?.version ?? 0;
    if (current < version) {
      await client.query(
        'INSERT INTO schema_migrations (version, applied_at) VALUES ($1, NOW())',
        [version]
      );
    }
  } finally {
    await client.end();
  }
}

const tempDir = mkdtempSync(join(tmpdir(), 'rapid-drizzle-'));
const configPath = join(tempDir, 'drizzle.postgres.config.ts');

async function main(): Promise<void> {
  try {
    writeFileSync(
      configPath,
      `import type { Config } from 'drizzle-kit';\n\nexport default {\n  schema: '${schemaPath.replace(/\\/g, '\\\\')}',\n  dialect: 'postgresql',\n  dbCredentials: { url: ${JSON.stringify(databaseUrl)} }\n} satisfies Config;\n`
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
      }
    );

    const latestVersion = getLatestMigrationVersion();
    await recordSchemaVersion(databaseUrl, latestVersion);
  } finally {
    rmSync(tempDir, { force: true, recursive: true });
  }
}

main().catch((error) => {
  console.error('Failed to apply Postgres schema:', error);
  process.exitCode = 1;
});
