import { describe, expect, it } from 'vitest';
import type { HarnessSqlClient } from './accountSeed.js';
import { createHarnessActors, seedVfsScenario } from './vfsScenarioHarness.js';

function createSqlRecorder(): {
  client: HarnessSqlClient;
  calls: Array<{ text: string; values: readonly unknown[] | undefined }>;
} {
  const calls: Array<{ text: string; values: readonly unknown[] | undefined }> =
    [];
  const client: HarnessSqlClient = {
    async query(
      text: string,
      values?: readonly unknown[]
    ): Promise<{ rows: Record<string, unknown>[] }> {
      calls.push({ text, values });
      if (text.includes('SELECT id FROM users WHERE email = $1')) {
        return { rows: [] };
      }
      return { rows: [] };
    }
  };
  return { client, calls };
}

describe('createHarnessActors', () => {
  it('seeds multiple actors and returns alias lookup', async () => {
    const { client } = createSqlRecorder();

    const result = await createHarnessActors(client, [
      {
        alias: 'alice',
        email: 'alice@example.com',
        password: 'ComplexPassword123!'
      },
      {
        alias: 'bob',
        email: 'bob@example.com',
        password: 'AnotherPassword123!'
      }
    ]);

    expect(result.actors).toHaveLength(2);
    expect(result.byAlias['alice']?.email).toBe('alice@example.com');
    expect(result.byAlias['bob']?.email).toBe('bob@example.com');
    expect(result.byAlias['alice']?.createdVfsOnboardingKeys).toBe(true);
  });

  it('rejects duplicate actor aliases', async () => {
    const { client } = createSqlRecorder();

    await expect(
      createHarnessActors(client, [
        {
          alias: 'alice',
          email: 'alice1@example.com',
          password: 'ComplexPassword123!'
        },
        {
          alias: 'alice',
          email: 'alice2@example.com',
          password: 'ComplexPassword123!'
        }
      ])
    ).rejects.toThrow('Duplicate actor alias values are not allowed.');
  });
});

describe('seedVfsScenario', () => {
  it('creates actors, organizations, and groups with alias-based membership', async () => {
    const { client, calls } = createSqlRecorder();

    const result = await seedVfsScenario(client, {
      actors: [
        {
          alias: 'alice',
          email: 'alice@example.com',
          password: 'ComplexPassword123!'
        },
        {
          alias: 'bob',
          email: 'bob@example.com',
          password: 'AnotherPassword123!'
        }
      ],
      organizations: [
        {
          key: 'org-main',
          name: 'Main Org',
          admins: ['alice'],
          members: ['bob']
        }
      ],
      groups: [
        {
          key: 'ops',
          organizationKey: 'org-main',
          name: 'Ops Group',
          members: ['alice', 'bob']
        }
      ]
    });

    expect(result.organizationsByKey['org-main']).toBeDefined();
    expect(result.groupsByKey['ops']).toBeDefined();
    expect(result.actors.byAlias['alice']).toBeDefined();
    expect(result.actors.byAlias['bob']).toBeDefined();

    const insertedGroups = calls.filter((call) =>
      call.text.includes('INSERT INTO groups')
    );
    expect(insertedGroups).toHaveLength(1);
    const insertedUserGroups = calls.filter((call) =>
      call.text.includes('INSERT INTO user_groups')
    );
    expect(insertedUserGroups.length).toBeGreaterThanOrEqual(2);
  });

  it('rejects unknown actor aliases in organization membership', async () => {
    const { client } = createSqlRecorder();

    await expect(
      seedVfsScenario(client, {
        actors: [
          {
            alias: 'alice',
            email: 'alice@example.com',
            password: 'ComplexPassword123!'
          }
        ],
        organizations: [
          {
            key: 'org-main',
            name: 'Main Org',
            members: ['bob']
          }
        ]
      })
    ).rejects.toThrow(
      'Unknown actor alias "bob" in organization "org-main" members.'
    );
  });
});
