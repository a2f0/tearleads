import { describe, expect, it, vi } from 'vitest';
import type { HarnessSqlClient } from '../seedAccount.js';
import { createTestUsersDb } from './createTestUsersDb.js';

vi.mock('../seedAccount.js', () => ({
  seedHarnessAccount: vi.fn(
    async (_client: HarnessSqlClient, input: { email: string }) => {
      const userId =
        input.email === 'bob@tearleads.com' ? 'bob-user-id' : 'alice-user-id';
      const orgId = `personal-org-${userId}`;
      return {
        userId,
        personalOrganizationId: orgId,
        createdVfsOnboardingKeys: true
      };
    }
  )
}));

interface Call {
  text: string;
  params: readonly unknown[] | undefined;
}

function createMockClient(options?: {
  existingUsers?: Map<string, { id: string; personal_organization_id: string }>;
  existingMemberships?: Set<string>;
}): { calls: Call[]; client: HarnessSqlClient } {
  const calls: Call[] = [];
  const existingUsers = options?.existingUsers ?? new Map();
  const existingMemberships = options?.existingMemberships ?? new Set();

  const client: HarnessSqlClient = {
    query: vi.fn(async (text: string, params?: readonly unknown[]) => {
      calls.push({ text, params });

      if (text === 'BEGIN' || text === 'COMMIT' || text === 'ROLLBACK') {
        return { rows: [] };
      }

      if (text.includes('SELECT id, personal_organization_id')) {
        const email = params?.[0];
        if (typeof email === 'string' && existingUsers.has(email)) {
          return { rows: [existingUsers.get(email)] };
        }
        return { rows: [] };
      }

      if (text.includes('SELECT 1 FROM user_organizations')) {
        const key = `${String(params?.[0])}:${String(params?.[1])}`;
        if (existingMemberships.has(key)) {
          return { rows: [{ '?column?': 1 }] };
        }
        return { rows: [] };
      }

      return { rows: [] };
    })
  };
  return { calls, client };
}

describe('createTestUsersDb', () => {
  it('creates users and cross-links organizations in a transaction', async () => {
    const { calls, client } = createMockClient();

    await createTestUsersDb(client);

    expect(calls[0]?.text).toBe('BEGIN');
    expect(calls[calls.length - 1]?.text).toBe('COMMIT');

    const insertCalls = calls.filter((c) =>
      c.text.includes('INSERT INTO user_organizations')
    );
    expect(insertCalls).toHaveLength(2);
  });

  it('skips existing users and existing memberships', async () => {
    const existingUsers = new Map([
      [
        'bob@tearleads.com',
        { id: 'bob-existing', personal_organization_id: 'bob-org-existing' }
      ],
      [
        'alice@tearleads.com',
        { id: 'alice-existing', personal_organization_id: 'alice-org-existing' }
      ]
    ]);
    const existingMemberships = new Set([
      'bob-existing:alice-org-existing',
      'alice-existing:bob-org-existing'
    ]);

    const { calls, client } = createMockClient({
      existingUsers,
      existingMemberships
    });

    await createTestUsersDb(client);

    expect(calls[0]?.text).toBe('BEGIN');
    expect(calls[calls.length - 1]?.text).toBe('COMMIT');

    const insertCalls = calls.filter((c) =>
      c.text.includes('INSERT INTO user_organizations')
    );
    expect(insertCalls).toHaveLength(0);
  });

  it('rolls back on failure', async () => {
    const calls: Call[] = [];
    const client: HarnessSqlClient = {
      query: vi.fn(async (text: string, params?: readonly unknown[]) => {
        calls.push({ text, params });
        if (text === 'BEGIN' || text === 'ROLLBACK') {
          return { rows: [] };
        }
        if (text.includes('SELECT id, personal_organization_id')) {
          return {
            rows: [{ id: 'user-missing-org', personal_organization_id: null }]
          };
        }
        return { rows: [] };
      })
    };

    await expect(createTestUsersDb(client)).rejects.toThrow(
      'missing personal_organization_id'
    );

    expect(calls.some((c) => c.text === 'ROLLBACK')).toBe(true);
    expect(calls.some((c) => c.text === 'COMMIT')).toBe(false);
  });
});
