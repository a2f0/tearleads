#!/usr/bin/env -S pnpm exec tsx
import { pathToFileURL } from 'node:url';
import pg from 'pg';
import {
  buildCreateAccountInput,
  getPostgresDevDefaults,
  seedHarnessAccount
} from '@tearleads/shared';
import { allTestUsers, type TestUser } from './testUsers.ts';

const { Pool } = pg;

function createPool(): pg.Pool {
  const databaseUrl =
    process.env['DATABASE_URL'] ?? process.env['POSTGRES_URL'];
  if (databaseUrl) {
    return new Pool({ connectionString: databaseUrl });
  }

  const defaults = getPostgresDevDefaults();
  return new Pool({
    host: process.env['PGHOST'] ?? defaults.host,
    port: Number(process.env['PGPORT'] ?? defaults.port ?? 5432),
    user: process.env['PGUSER'] ?? defaults.user,
    password: process.env['PGPASSWORD'],
    database:
      process.env['PGDATABASE'] ?? defaults.database ?? 'tearleads_development'
  });
}

function buildConnectionLabel(pool: pg.Pool): string {
  const opts = pool.options;
  const parts = [
    opts.host ? `host=${opts.host}` : null,
    opts.port ? `port=${opts.port}` : null,
    opts.user ? `user=${opts.user}` : null,
    opts.database ? `database=${opts.database}` : null
  ].filter((v): v is string => Boolean(v));
  return parts.join(', ');
}

async function createTestUser(
  client: pg.PoolClient,
  user: TestUser
): Promise<void> {
  const { email, password } = buildCreateAccountInput(
    user.email,
    user.password
  );

  const existing = await client.query(
    'SELECT id FROM users WHERE email = $1 LIMIT 1',
    [email]
  );

  if (existing.rows[0]) {
    console.log(`Skipping ${user.name} (${email}) — account already exists.`);
    return;
  }

  const result = await seedHarnessAccount(client, {
    email,
    password,
    admin: false,
    emailConfirmed: false,
    includeVfsOnboardingKeys: true
  });

  console.log(`Created ${user.name} (${email}), userId=${result.userId}`);
  if (result.createdVfsOnboardingKeys) {
    console.log(`  Provisioned VFS onboarding keys.`);
  }
}

async function main(): Promise<void> {
  const pool = createPool();
  const label = buildConnectionLabel(pool);
  const client = await pool.connect();

  try {
    await client.query('BEGIN');

    for (const user of allTestUsers) {
      await createTestUser(client, user);
    }

    await client.query('COMMIT');
    console.log(`Postgres connection: ${label}`);
  } catch (error) {
    try {
      await client.query('ROLLBACK');
    } catch (rollbackError) {
      console.error('Failed to rollback transaction:', rollbackError);
    }
    throw error;
  } finally {
    client.release();
    await pool.end();
  }
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  main().catch((error) => {
    console.error('Failed to create test users:', error);
    process.exitCode = 1;
  });
}
