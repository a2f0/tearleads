import { describe, expect, it, vi } from 'vitest';
import {
  combinePublicKey,
  generateKeyPair,
  serializePublicKey
} from '../crypto/asymmetric.js';
import type { DbQueryClient } from './setupBobNotesShareForAliceDb.js';
import {
  SCAFFOLD_INLINE_EMAIL_BODY_PREFIX,
  SCAFFOLD_WELCOME_EMAIL_BODY_TEXT,
  setupWelcomeEmailsDb
} from './setupWelcomeEmailsDb.js';

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
                id: 'bob-user-id',
                personal_organization_id: 'bob-org-id'
              }
            ]
          };
        }
        if (email === 'alice@tearleads.com') {
          return {
            rows: [
              {
                id: 'alice-user-id',
                personal_organization_id: 'alice-org-id'
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
    let idCounter = 0;
    const result = await setupWelcomeEmailsDb({
      client,
      bobEmail: 'bob@tearleads.com',
      aliceEmail: 'alice@tearleads.com',
      encryptVfsName,
      hasOrganizationIdColumn: true,
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
        call.params?.[1] === 'emailFolder'
    );
    expect(inboxFolderInserts).toHaveLength(2);
    expect(inboxFolderInserts[0]?.params?.[0]).toBe('email-inbox:bob-user-id');
    expect(inboxFolderInserts[0]?.params?.[2]).toBe('bob-user-id');
    expect(inboxFolderInserts[0]?.params?.[3]).toBe('bob-org-id');
    expect(inboxFolderInserts[0]?.params?.[4]).toBe('wrapped:Inbox');
    expect(inboxFolderInserts[0]?.params?.[5]).toBe('cipher:Inbox');
    expect(inboxFolderInserts[1]?.params?.[0]).toBe(
      'email-inbox:alice-user-id'
    );
    expect(inboxFolderInserts[1]?.params?.[2]).toBe('alice-user-id');
    expect(inboxFolderInserts[1]?.params?.[3]).toBe('alice-org-id');
    expect(inboxFolderInserts[1]?.params?.[4]).toBe('wrapped:Inbox');
    expect(inboxFolderInserts[1]?.params?.[5]).toBe('cipher:Inbox');

    const emailRegistryInserts = calls.filter(
      (call) =>
        call.text.includes('INSERT INTO vfs_registry') &&
        call.params?.[1] === 'email'
    );
    expect(emailRegistryInserts).toHaveLength(2);
    expect(emailRegistryInserts[0]?.params?.[0]).toBe('email:id-1');
    expect(emailRegistryInserts[0]?.params?.[2]).toBe('bob-user-id');
    expect(emailRegistryInserts[0]?.params?.[3]).toBe('bob-org-id');
    expect(emailRegistryInserts[1]?.params?.[0]).toBe('email:id-4');
    expect(emailRegistryInserts[1]?.params?.[2]).toBe('alice-user-id');
    expect(emailRegistryInserts[1]?.params?.[3]).toBe('alice-org-id');

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
    expect(bobEncryptedBodyPath.startsWith(SCAFFOLD_INLINE_EMAIL_BODY_PREFIX)).toBe(
      true
    );
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
    const ownerKeyPair = generateKeyPair();
    const ownerPublicKey = combinePublicKey(
      serializePublicKey({
        x25519PublicKey: ownerKeyPair.x25519PublicKey,
        mlKemPublicKey: ownerKeyPair.mlKemPublicKey
      })
    );
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
                  id: 'bob-user-id',
                  personal_organization_id: 'bob-org-id'
                }
              ]
            };
          }
          if (email === 'alice@tearleads.com') {
            return {
              rows: [
                {
                  id: 'alice-user-id',
                  personal_organization_id: 'alice-org-id'
                }
              ]
            };
          }
        }
        if (text.includes('FROM user_keys')) {
          return {
            rows: [{ public_encryption_key: ownerPublicKey }]
          };
        }
        return { rows: [] };
      })
    };

    await setupWelcomeEmailsDb({
      client,
      bobEmail: 'bob@tearleads.com',
      aliceEmail: 'alice@tearleads.com',
      hasOrganizationIdColumn: true,
      idFactory: (() => {
        const ids = ['id-1', 'id-2', 'id-3', 'id-4', 'id-5', 'id-6'];
        let index = 0;
        return () => ids[index++] ?? `id-${String(index)}`;
      })(),
      now: () => new Date('2026-03-01T00:00:00.000Z')
    });

    const inboxFolderInsert = calls.find(
      (call) =>
        call.text.includes('INSERT INTO vfs_registry') &&
        call.params?.[1] === 'emailFolder'
    );
    const inboxSessionKey = inboxFolderInsert?.params?.[4];
    expect(typeof inboxSessionKey).toBe('string');
    expect(String(inboxSessionKey).startsWith('scaffold-unwrapped:')).toBe(
      true
    );
    expect(calls.some((call) => call.text.includes('FROM user_keys'))).toBe(
      false
    );
  });
});
