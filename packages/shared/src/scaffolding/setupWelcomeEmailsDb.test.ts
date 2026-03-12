import { describe, expect, it, vi } from 'vitest';
import {
  SCAFFOLD_INLINE_EMAIL_BODY_PREFIX,
  SCAFFOLD_WELCOME_EMAIL_BODY_TEXT,
  setupWelcomeEmailsDb
} from './setupWelcomeEmailsDb.js';
import type { DbQueryClient } from './vfsScaffoldHelpers.js';

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
      if (text.includes('FROM users WHERE email = $1')) {
        const email = params?.[0];
        if (email === 'bob@tearleads.com') {
          return {
            rows: [
              {
                id: '00000000-0000-0000-0000-000000000001',
                personal_organization_id: '00000000-0000-0000-0000-000000000002'
              }
            ]
          };
        }
        if (email === 'alice@tearleads.com') {
          return {
            rows: [
              {
                id: '00000000-0000-0000-0000-000000000003',
                personal_organization_id: '00000000-0000-0000-0000-000000000004'
              }
            ]
          };
        }
        return { rows: [] };
      }
      return { rows: [] };
    })
  };
  return { calls, client };
}

function buildExpectedRawMime(recipientEmail: string): string {
  return [
    'From: system@tearleads.com',
    `To: ${recipientEmail}`,
    'Subject: Welcome to Tearleads',
    'MIME-Version: 1.0',
    'Content-Type: text/plain; charset=UTF-8',
    'Content-Transfer-Encoding: 8bit',
    '',
    SCAFFOLD_WELCOME_EMAIL_BODY_TEXT,
    ''
  ].join('\r\n');
}

describe('setupWelcomeEmailsDb', () => {
  it('inserts welcome emails for both users inside one transaction', async () => {
    const { calls, client } = createMockClient();
    const encryptVfsName = vi.fn(
      async ({
        plaintextName
      }: {
        client: DbQueryClient;
        ownerUserId: string;
        plaintextName: string;
      }) => ({
        encryptedSessionKey: `wrapped:${plaintextName}`,
        encryptedName: `cipher:${plaintextName}`
      })
    );
    const result = await setupWelcomeEmailsDb({
      client,
      bobEmail: 'bob@tearleads.com',
      aliceEmail: 'alice@tearleads.com',
      encryptVfsName,
      hasOrganizationIdColumn: true,
      idFactory: (() => {
        const ids = [
          'id-1',
          'id-2',
          'id-3',
          'id-4',
          'id-5',
          'id-6',
          'id-7',
          'id-8'
        ];
        let index = 0;
        return () => ids[index++] ?? `id-${String(index)}`;
      })(),
      now: () => new Date('2026-03-01T00:00:00.000Z')
    });

    expect(result).toEqual({
      bob: {
        userId: '00000000-0000-0000-0000-000000000001',
        inboxFolderId: 'id-1',
        emailItemId: 'id-2'
      },
      alice: {
        userId: '00000000-0000-0000-0000-000000000003',
        inboxFolderId: 'id-3',
        emailItemId: 'id-4'
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
    expect(inboxFolderInserts[0]?.params?.[0]).toBe('id-1');
    expect(inboxFolderInserts[1]?.params?.[0]).toBe('id-3');

    const emailRegistryInserts = calls.filter(
      (call) =>
        call.text.includes('INSERT INTO vfs_registry') &&
        call.text.includes("'email'")
    );
    expect(emailRegistryInserts).toHaveLength(2);
    expect(emailRegistryInserts[0]?.params?.[0]).toBe('id-2');
    expect(emailRegistryInserts[1]?.params?.[0]).toBe('id-4');

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
    const bobEncryptedBodyPath = emailInserts[0]?.params?.[5];
    expect(typeof bobEncryptedBodyPath).toBe('string');
    if (typeof bobEncryptedBodyPath !== 'string') {
      throw new Error('Expected scaffolded encrypted body path for Bob');
    }
    expect(
      bobEncryptedBodyPath.startsWith(SCAFFOLD_INLINE_EMAIL_BODY_PREFIX)
    ).toBe(true);
    const bobCiphertext = bobEncryptedBodyPath.slice(
      SCAFFOLD_INLINE_EMAIL_BODY_PREFIX.length
    );
    expect(Buffer.from(bobCiphertext, 'base64').toString('utf8')).toBe(
      buildExpectedRawMime('bob@tearleads.com')
    );
    expect(emailInserts[0]?.params?.[6]).toBe(
      Buffer.byteLength(buildExpectedRawMime('bob@tearleads.com'), 'utf8')
    );
    expect(emailInserts[1]?.params?.[1]).toBe(expectedSubject);
    const aliceEncryptedBodyPath = emailInserts[1]?.params?.[5];
    expect(typeof aliceEncryptedBodyPath).toBe('string');
    if (typeof aliceEncryptedBodyPath !== 'string') {
      throw new Error('Expected scaffolded encrypted body path for Alice');
    }
    expect(
      aliceEncryptedBodyPath.startsWith(SCAFFOLD_INLINE_EMAIL_BODY_PREFIX)
    ).toBe(true);
    const aliceCiphertext = aliceEncryptedBodyPath.slice(
      SCAFFOLD_INLINE_EMAIL_BODY_PREFIX.length
    );
    expect(Buffer.from(aliceCiphertext, 'base64').toString('utf8')).toBe(
      buildExpectedRawMime('alice@tearleads.com')
    );

    const linkInserts = calls.filter((call) =>
      call.text.includes('INSERT INTO vfs_links')
    );
    expect(linkInserts).toHaveLength(2);
    expect(linkInserts[0]?.params?.[1]).toBe('id-1');
    expect(linkInserts[0]?.params?.[2]).toBe('id-2');
    expect(linkInserts[1]?.params?.[1]).toBe('id-3');
    expect(linkInserts[1]?.params?.[2]).toBe('id-4');

    const aclInserts = calls.filter((call) =>
      call.text.includes('INSERT INTO vfs_acl_entries')
    );
    expect(aclInserts).toHaveLength(2);
    expect(aclInserts[0]?.params?.[1]).toBe('id-2');
    expect(aclInserts[0]?.params?.[2]).toBe(
      '00000000-0000-0000-0000-000000000001'
    );
    expect(aclInserts[1]?.params?.[1]).toBe('id-4');
    expect(aclInserts[1]?.params?.[2]).toBe(
      '00000000-0000-0000-0000-000000000003'
    );

    expect(encryptVfsName).toHaveBeenCalledTimes(2);
  });

  it('rolls back transaction when a user is missing', async () => {
    const calls: Call[] = [];
    const client: DbQueryClient = {
      query: vi.fn(async (text: string, params?: readonly unknown[]) => {
        calls.push({ text, params });
        if (text === 'BEGIN' || text === 'ROLLBACK') {
          return { rows: [] };
        }
        if (text.includes('FROM users WHERE email = $1')) {
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

  it('uses scaffold-unwrapped session keys by default even when owner key exists', async () => {
    const { calls, client } = createMockClient();

    await setupWelcomeEmailsDb({
      client,
      bobEmail: 'bob@tearleads.com',
      aliceEmail: 'alice@tearleads.com',
      hasOrganizationIdColumn: true,
      idFactory: (() => {
        const ids = [
          'id-1',
          'id-2',
          'id-3',
          'id-4',
          'id-5',
          'id-6',
          'id-7',
          'id-8'
        ];
        let index = 0;
        return () => ids[index++] ?? `id-${String(index)}`;
      })(),
      now: () => new Date('2026-03-01T00:00:00.000Z')
    });

    const inboxFolderInsert = calls.find(
      (call) =>
        call.text.includes('INSERT INTO vfs_registry') &&
        call.text.includes("'emailFolder'")
    );
    // params are [id, userId, organizationId, encrypted_session_key, ...]
    const inboxSessionKey = inboxFolderInsert?.params?.[3];
    expect(typeof inboxSessionKey).toBe('string');
    expect(String(inboxSessionKey).startsWith('scaffold-unwrapped:')).toBe(
      true
    );
    expect(calls.some((call) => call.text.includes('FROM user_keys'))).toBe(
      false
    );
  });
});
