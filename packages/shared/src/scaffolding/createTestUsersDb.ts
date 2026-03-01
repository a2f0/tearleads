import { buildCreateAccountInput } from '../account.js';
import type {
  HarnessSqlClient,
  SeedHarnessAccountResult
} from '../seedAccount.js';
import { seedHarnessAccount } from '../seedAccount.js';
import { allTestUsers, type TestUser } from './testUsers.js';

interface ExistingUserRow {
  id: string;
  personal_organization_id: string | null;
}

function parseExistingUserRows(
  rows: Record<string, unknown>[]
): ExistingUserRow[] {
  const parsedRows: ExistingUserRow[] = [];
  for (const row of rows) {
    const id = row['id'];
    const personalOrganizationId = row['personal_organization_id'];
    if (
      typeof id === 'string' &&
      (typeof personalOrganizationId === 'string' ||
        personalOrganizationId === null)
    ) {
      parsedRows.push({
        id,
        personal_organization_id: personalOrganizationId
      });
    }
  }
  return parsedRows;
}

async function createTestUser(
  client: HarnessSqlClient,
  user: TestUser
): Promise<SeedHarnessAccountResult> {
  const { email, password } = buildCreateAccountInput(
    user.email,
    user.password
  );

  const existing = await client.query(
    `SELECT id, personal_organization_id
       FROM users
      WHERE email = $1
      LIMIT 1`,
    [email]
  );
  const existingRows = parseExistingUserRows(existing.rows);

  if (existingRows[0]) {
    const personalOrganizationId = existingRows[0].personal_organization_id;
    if (!personalOrganizationId) {
      throw new Error(
        `Existing user ${email} is missing personal_organization_id`
      );
    }
    console.log(`Skipping ${user.name} (${email}) — account already exists.`);
    return {
      userId: existingRows[0].id,
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
  client: HarnessSqlClient,
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

export async function createTestUsersDb(
  client: HarnessSqlClient
): Promise<void> {
  await client.query('BEGIN');

  try {
    const results = new Map<string, SeedHarnessAccountResult>();
    for (const user of allTestUsers) {
      const result = await createTestUser(client, user);
      results.set(user.name, result);
    }

    if (results.size > 1) {
      await crossLinkOrganizations(client, results);
    }

    await client.query('COMMIT');
  } catch (error) {
    try {
      await client.query('ROLLBACK');
    } catch (rollbackError) {
      console.error('Failed to rollback transaction:', rollbackError);
    }
    throw error;
  }
}
