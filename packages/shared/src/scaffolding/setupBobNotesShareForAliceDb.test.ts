import { describe, expect, it, vi } from 'vitest';
import {
  combinePublicKey,
  generateKeyPair,
  serializePublicKey
} from '../crypto/asymmetric.js';
import { setupBobNotesShareForAliceDb } from './setupBobNotesShareForAliceDb.js';
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
      if (text.includes('RETURNING id')) {
        return { rows: [{ id: '00000000-0000-0000-0000-000000000005' }] };
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
      folderId: '00000000-0000-0000-0000-000000000010',
      noteId: '00000000-0000-0000-0000-000000000011',
      idFactory: (() => {
        const ids = ['id-1', 'id-2', 'id-3', 'id-4', 'id-5', 'id-6'];
        let index = 0;
        return () => ids[index++] ?? `id-${String(index)}`;
      })(),
      now: () => new Date('2026-03-01T00:00:00.000Z')
    });

    expect(result).toEqual({
      bobUserId: '00000000-0000-0000-0000-000000000001',
      aliceUserId: '00000000-0000-0000-0000-000000000003',
      rootItemId: '00000000-0000-0000-0000-000000000000',
      folderId: '00000000-0000-0000-0000-000000000010',
      noteId: '00000000-0000-0000-0000-000000000011',
      shareAclId: '00000000-0000-0000-0000-000000000005',
      noteShareAclId: '00000000-0000-0000-0000-000000000005'
    });

    expect(calls[0]?.text).toBe('BEGIN');
    expect(calls[calls.length - 1]?.text).toBe('COMMIT');

    const rootInsertCall = calls.find(
      (call) =>
        call.text.includes('INSERT INTO vfs_registry') &&
        call.params?.[0] === '00000000-0000-0000-0000-000000000000'
    );
    expect(rootInsertCall?.params?.[0]).toBe(
      '00000000-0000-0000-0000-000000000000'
    );
    expect(rootInsertCall?.params?.[1]).toBe(
      '00000000-0000-0000-0000-000000000002'
    ); // organization_id

    const noteInsertCall = calls.find(
      (call) =>
        call.text.includes('INSERT INTO vfs_registry') &&
        call.params?.[0] === '00000000-0000-0000-0000-000000000011'
    );
    expect(noteInsertCall?.params?.[1]).toBe('note');
    expect(noteInsertCall?.params?.[2]).toBe(
      '00000000-0000-0000-0000-000000000001'
    ); // owner_id
    expect(noteInsertCall?.params?.[3]).toBe(
      '00000000-0000-0000-0000-000000000002'
    ); // organization_id

    const noteStateCall = calls.find((call) =>
      call.text.includes('INSERT INTO vfs_item_state')
    );
    expect(noteStateCall?.params?.[1]).toBe(
      Buffer.from('Hello, Alice', 'utf8').toString('base64')
    );

    const noteCrdtUpsertCall = calls.find((call) =>
      call.text.includes('INSERT INTO vfs_crdt_ops')
    );
    expect(noteCrdtUpsertCall?.text).toContain('root_id');
    expect(noteCrdtUpsertCall?.params?.[1]).toBe(
      '00000000-0000-0000-0000-000000000011'
    ); // item_id
    expect(noteCrdtUpsertCall?.params?.[2]).toBe(
      '00000000-0000-0000-0000-000000000001'
    ); // actor_id
    expect(noteCrdtUpsertCall?.params?.[9]).toBe(
      '00000000-0000-0000-0000-000000000010'
    ); // root_id (folderId)

    const shareCalls = calls.filter((call) =>
      call.text.includes('INSERT INTO vfs_acl_entries')
    );
    expect(shareCalls).toHaveLength(2);
    expect(shareCalls[0]?.params?.[1]).toBe(
      '00000000-0000-0000-0000-000000000010'
    );
    expect(shareCalls[0]?.params?.[2]).toBe(
      '00000000-0000-0000-0000-000000000003'
    );
    expect(shareCalls[0]?.params?.[3]).toBe('write');

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
                  id: '00000000-0000-0000-0000-000000000001',
                  personal_organization_id:
                    '00000000-0000-0000-0000-000000000002'
                }
              ]
            };
          }
          if (email === 'alice@tearleads.com') {
            return {
              rows: [
                {
                  id: '00000000-0000-0000-0000-000000000003',
                  personal_organization_id:
                    '00000000-0000-0000-0000-000000000004'
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
          return { rows: [{ id: '00000000-0000-0000-0000-000000000005' }] };
        }
        return { rows: [] };
      })
    };

    await setupBobNotesShareForAliceDb({
      client,
      bobEmail: 'bob@tearleads.com',
      aliceEmail: 'alice@tearleads.com',
      hasOrganizationIdColumn: true,
      folderId: '00000000-0000-0000-0000-000000000010',
      noteId: '00000000-0000-0000-0000-000000000011',
      idFactory: (() => {
        const ids = ['id-1', 'id-2', 'id-3', 'id-4', 'id-5', 'id-6'];
        let index = 0;
        return () => ids[index++] ?? `id-${String(index)}`;
      })(),
      now: () => new Date('2026-03-01T00:00:00.000Z')
    });

    const folderInsertCall = calls.find(
      (call) =>
        call.text.includes('INSERT INTO vfs_registry') &&
        call.params?.[0] === '00000000-0000-0000-0000-000000000010'
    );
    const noteInsertCall = calls.find(
      (call) =>
        call.text.includes('INSERT INTO vfs_registry') &&
        call.params?.[0] === '00000000-0000-0000-0000-000000000011'
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
      folderId: '00000000-0000-0000-0000-000000000010',
      noteId: '00000000-0000-0000-0000-000000000011',
      idFactory: (() => {
        const ids = ['id-1', 'id-2', 'id-3', 'id-4', 'id-5', 'id-6'];
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
