import { describe, expect, it, vi } from 'vitest';
import {
  combinePublicKey,
  generateKeyPair,
  serializePublicKey
} from '../crypto/asymmetric.js';
import {
  type DbQueryClient,
  setupBobNotesShareForAliceDb
} from './setupBobNotesShareForAliceDb.js';

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
      if (text.includes('RETURNING id')) {
        return { rows: [{ id: 'share:stored-share-id' }] };
      }
      return { rows: [] };
    })
  };
  return { calls, client };
}

describe('setupBobNotesShareForAliceDb', () => {
  it('creates root/folder/note links and share ACL inside one transaction', async () => {
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
    const result = await setupBobNotesShareForAliceDb({
      client,
      bobEmail: 'bob@tearleads.com',
      aliceEmail: 'alice@tearleads.com',
      encryptVfsName,
      hasOrganizationIdColumn: true,
      folderId: 'folder-fixed',
      noteId: 'note-fixed',
      idFactory: (() => {
        const ids = ['id-1', 'id-2', 'id-3', 'share-id'];
        let index = 0;
        return () => ids[index++] ?? `id-${String(index)}`;
      })(),
      now: () => new Date('2026-03-01T00:00:00.000Z')
    });

    expect(result).toEqual({
      bobUserId: 'bob-user-id',
      aliceUserId: 'alice-user-id',
      rootItemId: '__vfs_root__',
      folderId: 'folder-fixed',
      noteId: 'note-fixed',
      shareAclId: 'share:stored-share-id',
      noteShareAclId: 'share:stored-share-id'
    });

    expect(calls[0]?.text).toBe('BEGIN');
    expect(calls[calls.length - 1]?.text).toBe('COMMIT');

    const rootInsertCall = calls.find(
      (call) =>
        call.text.includes('INSERT INTO vfs_registry') &&
        call.params?.[0] === '__vfs_root__'
    );
    expect(rootInsertCall?.params?.[0]).toBe('__vfs_root__');
    expect(rootInsertCall?.params?.[1]).toBe('folder');
    expect(rootInsertCall?.params?.[3]).toBe('bob-org-id');

    const noteInsertCall = calls.find(
      (call) =>
        call.text.includes('INSERT INTO vfs_registry') &&
        call.params?.[0] === 'note-fixed'
    );
    expect(noteInsertCall?.params?.[1]).toBe('note');
    expect(noteInsertCall?.params?.[3]).toBe('bob-org-id');
    expect(noteInsertCall?.params?.[4]).toBe(
      'wrapped:Note for Alice - From Bob'
    );
    expect(noteInsertCall?.params?.[5]).toBe(
      'cipher:Note for Alice - From Bob'
    );

    const noteStateCall = calls.find((call) =>
      call.text.includes('INSERT INTO vfs_item_state')
    );
    expect(noteStateCall?.params?.[1]).toBe(
      Buffer.from('Hello, Alice', 'utf8').toString('base64')
    );

    const noteCrdtUpsertCall = calls.find((call) =>
      call.text.includes('INSERT INTO vfs_crdt_ops')
    );
    expect(noteCrdtUpsertCall?.text).toContain('encrypted_payload_bytes');
    expect(noteCrdtUpsertCall?.text).toContain('encryption_nonce_bytes');
    expect(noteCrdtUpsertCall?.text).toContain('encryption_aad_bytes');
    expect(noteCrdtUpsertCall?.text).toContain('encryption_signature_bytes');
    expect(noteCrdtUpsertCall?.params?.[0]).toBe('crdt:item_upsert:note-fixed');
    expect(noteCrdtUpsertCall?.params?.[1]).toBe('note-fixed');
    expect(noteCrdtUpsertCall?.params?.[2]).toBe('bob-user-id');
    expect(noteCrdtUpsertCall?.params?.[4]).toBe('2026-02-28T23:59:59.000Z');
    const notePayloadBase64 = noteCrdtUpsertCall?.params?.[5];
    expect(typeof notePayloadBase64).toBe('string');
    if (typeof notePayloadBase64 !== 'string') {
      throw new Error('Expected CRDT payload base64 string');
    }
    expect(notePayloadBase64).toBe(
      Buffer.from('Hello, Alice', 'utf8').toString('base64')
    );

    const shareCalls = calls.filter((call) =>
      call.text.includes('INSERT INTO vfs_acl_entries')
    );
    expect(shareCalls).toHaveLength(2);
    expect(shareCalls[0]?.params?.[1]).toBe('folder-fixed');
    expect(shareCalls[0]?.params?.[2]).toBe('alice-user-id');
    expect(shareCalls[0]?.params?.[3]).toBe('write');
    expect(shareCalls[1]?.params?.[1]).toBe('note-fixed');
    expect(shareCalls[1]?.params?.[2]).toBe('alice-user-id');
    expect(shareCalls[1]?.params?.[3]).toBe('write');

    expect(encryptVfsName).toHaveBeenCalledTimes(2);
  });

  it('rolls back transaction on failure', async () => {
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
      setupBobNotesShareForAliceDb({
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
        if (text.includes('RETURNING id')) {
          return { rows: [{ id: 'share:stored-share-id' }] };
        }
        return { rows: [] };
      })
    };

    await setupBobNotesShareForAliceDb({
      client,
      bobEmail: 'bob@tearleads.com',
      aliceEmail: 'alice@tearleads.com',
      hasOrganizationIdColumn: true,
      folderId: 'folder-fixed',
      noteId: 'note-fixed',
      idFactory: (() => {
        const ids = ['id-1', 'id-2', 'id-3', 'share-id'];
        let index = 0;
        return () => ids[index++] ?? `id-${String(index)}`;
      })(),
      now: () => new Date('2026-03-01T00:00:00.000Z')
    });

    const folderInsertCall = calls.find(
      (call) =>
        call.text.includes('INSERT INTO vfs_registry') &&
        call.params?.[0] === 'folder-fixed'
    );
    const noteInsertCall = calls.find(
      (call) =>
        call.text.includes('INSERT INTO vfs_registry') &&
        call.params?.[0] === 'note-fixed'
    );

    const folderSessionKey = folderInsertCall?.params?.[4];
    const noteSessionKey = noteInsertCall?.params?.[4];
    expect(typeof folderSessionKey).toBe('string');
    expect(typeof noteSessionKey).toBe('string');
    expect(String(folderSessionKey).startsWith('scaffold-unwrapped:')).toBe(
      true
    );
    expect(String(noteSessionKey).startsWith('scaffold-unwrapped:')).toBe(true);
    expect(calls.some((call) => call.text.includes('FROM user_keys'))).toBe(
      false
    );
  });

  it('allows overriding share access level to read', async () => {
    const { calls, client } = createMockClient();

    await setupBobNotesShareForAliceDb({
      client,
      bobEmail: 'bob@tearleads.com',
      aliceEmail: 'alice@tearleads.com',
      shareAccessLevel: 'read',
      hasOrganizationIdColumn: true,
      folderId: 'folder-fixed',
      noteId: 'note-fixed',
      idFactory: (() => {
        const ids = ['id-1', 'id-2', 'id-3', 'share-id'];
        let index = 0;
        return () => ids[index++] ?? `id-${String(index)}`;
      })(),
      now: () => new Date('2026-03-01T00:00:00.000Z')
    });

    const shareCalls = calls.filter((call) =>
      call.text.includes('INSERT INTO vfs_acl_entries')
    );
    expect(shareCalls).toHaveLength(2);
    expect(shareCalls[0]?.params?.[3]).toBe('read');
    expect(shareCalls[1]?.params?.[3]).toBe('read');
  });
});
