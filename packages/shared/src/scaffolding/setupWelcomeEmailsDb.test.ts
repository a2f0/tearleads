import { describe, expect, it, vi } from 'vitest';
import type { DbQueryClient } from './setupBobNotesShareForAliceDb.js';
import { setupWelcomeEmailsDb } from './setupWelcomeEmailsDb.js';

interface Call {
  text: string;
  params: readonly unknown[] | undefined;
}

function createMockClient(): {
  calls: Call[];
  client: DbQueryClient;
} {
  const calls: Call[] = [];
  const client: DbQueryClient = {
    query: vi.fn(async (text: string, params?: readonly unknown[]) => {
      calls.push({ text, params });
      if (text.includes('SELECT id FROM users WHERE email = $1')) {
        const email = params?.[0];
        if (email === 'bob@tearleads.com') {
          return { rows: [{ id: 'bob-user-id' }] };
        }
        if (email === 'alice@tearleads.com') {
          return { rows: [{ id: 'alice-user-id' }] };
        }
        return { rows: [] };
      }
      return { rows: [] };
    })
  };
  return { calls, client };
}

describe('setupWelcomeEmailsDb', () => {
  it('inserts welcome emails for both users inside one transaction', async () => {
    const { calls, client } = createMockClient();
    let idCounter = 0;
    const result = await setupWelcomeEmailsDb({
      client,
      bobEmail: 'bob@tearleads.com',
      aliceEmail: 'alice@tearleads.com',
      idFactory: () => `id-${String(++idCounter)}`,
      now: () => new Date('2026-03-01T00:00:00.000Z')
    });

    // idFactory calls: id-1 (bob email), id-2 (bob link), id-3 (bob acl),
    //                  id-4 (alice email), id-5 (alice link), id-6 (alice acl)
    expect(result).toEqual({
      bob: {
        userId: 'bob-user-id',
        inboxFolderId: 'email-inbox:bob-user-id',
        emailItemId: 'email:id-1'
      },
      alice: {
        userId: 'alice-user-id',
        inboxFolderId: 'email-inbox:alice-user-id',
        emailItemId: 'email:id-4'
      }
    });

    expect(calls[0]?.text).toBe('BEGIN');
    expect(calls[calls.length - 1]?.text).toBe('COMMIT');

    const inboxFolderInserts = calls.filter(
      (call) =>
        call.text.includes('INSERT INTO vfs_registry') &&
        call.text.includes("'emailFolder'")
    );
    expect(inboxFolderInserts).toHaveLength(2);
    expect(inboxFolderInserts[0]?.params?.[0]).toBe('email-inbox:bob-user-id');
    expect(inboxFolderInserts[0]?.params?.[1]).toBe('bob-user-id');
    expect(inboxFolderInserts[1]?.params?.[0]).toBe(
      'email-inbox:alice-user-id'
    );
    expect(inboxFolderInserts[1]?.params?.[1]).toBe('alice-user-id');

    const emailRegistryInserts = calls.filter(
      (call) =>
        call.text.includes('INSERT INTO vfs_registry') &&
        call.text.includes("'email'")
    );
    expect(emailRegistryInserts).toHaveLength(2);
    expect(emailRegistryInserts[0]?.params?.[0]).toBe('email:id-1');
    expect(emailRegistryInserts[0]?.params?.[1]).toBe('bob-user-id');
    expect(emailRegistryInserts[1]?.params?.[0]).toBe('email:id-4');
    expect(emailRegistryInserts[1]?.params?.[1]).toBe('alice-user-id');

    const emailInserts = calls.filter((call) =>
      call.text.includes('INSERT INTO emails')
    );
    expect(emailInserts).toHaveLength(2);
    const expectedSubject = Buffer.from(
      'Welcome to Tearleads',
      'utf8'
    ).toString('base64');
    const expectedFrom = Buffer.from('system@tearleads.com', 'utf8').toString(
      'base64'
    );
    expect(emailInserts[0]?.params?.[1]).toBe(expectedSubject);
    expect(emailInserts[0]?.params?.[2]).toBe(expectedFrom);
    expect(emailInserts[0]?.params?.[5]).toBe(
      'scaffolding://welcome-email-body'
    );
    expect(emailInserts[0]?.params?.[6]).toBe(0);
    expect(emailInserts[1]?.params?.[1]).toBe(expectedSubject);

    const linkInserts = calls.filter((call) =>
      call.text.includes('INSERT INTO vfs_links')
    );
    expect(linkInserts).toHaveLength(2);
    expect(linkInserts[0]?.params?.[1]).toBe('email-inbox:bob-user-id');
    expect(linkInserts[0]?.params?.[2]).toBe('email:id-1');
    expect(linkInserts[1]?.params?.[1]).toBe('email-inbox:alice-user-id');
    expect(linkInserts[1]?.params?.[2]).toBe('email:id-4');

    const aclInserts = calls.filter((call) =>
      call.text.includes('INSERT INTO vfs_acl_entries')
    );
    expect(aclInserts).toHaveLength(2);
    expect(aclInserts[0]?.params?.[1]).toBe('email:id-1');
    expect(aclInserts[0]?.params?.[2]).toBe('bob-user-id');
    expect(aclInserts[1]?.params?.[1]).toBe('email:id-4');
    expect(aclInserts[1]?.params?.[2]).toBe('alice-user-id');
  });

  it('rolls back transaction when a user is missing', async () => {
    const calls: Call[] = [];
    const client: DbQueryClient = {
      query: vi.fn(async (text: string, params?: readonly unknown[]) => {
        calls.push({ text, params });
        if (text === 'BEGIN' || text === 'ROLLBACK') {
          return { rows: [] };
        }
        if (text.includes('SELECT id FROM users WHERE email = $1')) {
          return { rows: [] };
        }
        return { rows: [] };
      })
    };

    await expect(
      setupWelcomeEmailsDb({
        client,
        bobEmail: 'missing@example.com',
        aliceEmail: 'alice@tearleads.com'
      })
    ).rejects.toThrow('Could not resolve user id');

    expect(calls.some((call) => call.text === 'ROLLBACK')).toBe(true);
    expect(calls.some((call) => call.text === 'COMMIT')).toBe(false);
  });
});
