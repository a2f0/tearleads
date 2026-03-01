#!/usr/bin/env -S pnpm exec tsx
import { pathToFileURL } from 'node:url';
import { buildCreateAccountInput } from '../../../packages/shared/src/account.ts';
import type { SeedHarnessAccountResult } from '../../../packages/shared/src/seedAccount.ts';
import { seedHarnessAccount } from '../../../packages/shared/src/seedAccount.ts';
import {
  buildConnectionLabel,
  createPool,
  type PoolClient
} from '../../postgres/lib/pool.ts';
import { allTestUsers, type TestUser } from './testUsers.ts';

async function createTestUser(
  client: PoolClient,
  user: TestUser
): Promise<SeedHarnessAccountResult> {
  const { email, password } = buildCreateAccountInput(
    user.email,
    user.password
  );

  const existing = await client.query<{
    id: string;
    personal_organization_id: string | null;
  }>(
    `SELECT id, personal_organization_id
       FROM users
      WHERE email = $1
      LIMIT 1`,
    [email]
  );

  if (existing.rows[0]) {
    const personalOrganizationId = existing.rows[0].personal_organization_id;
    if (!personalOrganizationId) {
      throw new Error(
        `Existing user ${email} is missing personal_organization_id`
      );
    }
    console.log(`Skipping ${user.name} (${email}) — account already exists.`);
    return {
      userId: existing.rows[0].id,
      personalOrganizationId,
      createdVfsOnboardingKeys: false
    };
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
  return result;
}

async function crossLinkOrganizations(
  client: PoolClient,
  results: Map<string, SeedHarnessAccountResult>
): Promise<void> {
  const entries = [...results.entries()];
  for (const [name, result] of entries) {
    for (const [otherName, otherResult] of entries) {
      if (name === otherName) continue;

      const existing = await client.query(
        `SELECT 1 FROM user_organizations
         WHERE user_id = $1 AND organization_id = $2 LIMIT 1`,
        [result.userId, otherResult.personalOrganizationId]
      );
      if (existing.rows[0]) {
        console.log(
          `Skipping ${name} membership in ${otherName}'s org — already exists.`
        );
        continue;
      }

      await client.query(
        `INSERT INTO user_organizations (user_id, organization_id, joined_at, is_admin)
         VALUES ($1, $2, $3, false)`,
        [
          result.userId,
          otherResult.personalOrganizationId,
          new Date().toISOString()
        ]
      );
      console.log(`Added ${name} as member of ${otherName}'s personal org.`);
    }
  }
}

export async function runCreateTestUsers(): Promise<void> {
  const pool = await createPool();
  const label = buildConnectionLabel(pool);
  const client = await pool.connect();

  try {
    await client.query('BEGIN');

    const results = new Map<string, SeedHarnessAccountResult>();
    for (const user of allTestUsers) {
      const result = await createTestUser(client, user);
      results.set(user.name, result);
    }

    if (results.size > 1) {
      await crossLinkOrganizations(client, results);
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
  runCreateTestUsers().catch((error) => {
    console.error('Failed to create test users:', error);
    process.exitCode = 1;
  });
}
