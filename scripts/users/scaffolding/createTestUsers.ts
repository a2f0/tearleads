#!/usr/bin/env -S pnpm exec tsx
import { pathToFileURL } from 'node:url';
import { buildCreateAccountInput } from '../../../packages/api/src/lib/createAccount.ts';
import { buildPostgresConnectionLabel } from '../../../packages/api/src/lib/cliPostgres.ts';
import {
  closePostgresPool,
  getPostgresPool
} from '../../../packages/api/src/lib/postgres.ts';
import { seedHarnessAccount } from '../../../packages/api/src/cli/seedAccount.ts';
import { type TestUser, allTestUsers } from './testUsers.ts';

async function createTestUser(
  client: import('pg').PoolClient,
  user: TestUser
): Promise<void> {
  const { email, password } = buildCreateAccountInput(user.email, user.password);

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
  const label = buildPostgresConnectionLabel();
  const pool = await getPostgresPool();
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
  }
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  main()
    .catch((error) => {
      console.error('Failed to create test users:', error);
      process.exitCode = 1;
    })
    .finally(() => closePostgresPool());
}
