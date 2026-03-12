import { describe, expect, it, vi } from 'vitest';
import {
  combinePublicKey,
  generateKeyPair,
  serializePublicKey
} from '../crypto/asymmetric.js';
import { setupBobPhotoAlbumShareForAliceDb } from './setupBobPhotoAlbumShareForAliceDb.js';
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

describe('setupBobPhotoAlbumShareForAliceDb', () => {
  it('creates album+photo scaffolding and shares to Alice in one transaction', async () => {
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

    const result = await setupBobPhotoAlbumShareForAliceDb({
      client,
      bobEmail: 'bob@tearleads.com',
      aliceEmail: 'alice@tearleads.com',
      encryptVfsName,
      hasOrganizationIdColumn: true,
      albumId: '00000000-0000-0000-0000-000000000010',
      photoId: '00000000-0000-0000-0000-000000000011',
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
      albumId: '00000000-0000-0000-0000-000000000010',
      photoId: '00000000-0000-0000-0000-000000000011',
      albumShareAclId: '00000000-0000-0000-0000-000000000005',
      photoShareAclId: '00000000-0000-0000-0000-000000000005'
    });

    expect(calls[0]?.text).toBe('BEGIN');
    expect(calls[calls.length - 1]?.text).toBe('COMMIT');

    const albumInsertCall = calls.find(
      (call) =>
        call.text.includes('INSERT INTO vfs_registry') &&
        call.params?.[0] === '00000000-0000-0000-0000-000000000010'
    );
    expect(albumInsertCall?.params?.[1]).toBe('album');
    expect(albumInsertCall?.params?.[4]).toBe(
      'wrapped:Photos shared with Alice'
    );

    const photoInsertCall = calls.find(
      (call) =>
        call.text.includes('INSERT INTO vfs_registry') &&
        call.params?.[0] === '00000000-0000-0000-0000-000000000011'
    );
    expect(photoInsertCall?.params?.[1]).toBe('photo');

    const itemStateInsertCall = calls.find((call) =>
      call.text.includes('INSERT INTO vfs_item_state')
    );
    expect(itemStateInsertCall?.params?.[0]).toBe(
      '00000000-0000-0000-0000-000000000011'
    );

    const crdtUpsertCall = calls.find((call) =>
      call.text.includes('INSERT INTO vfs_crdt_ops')
    );
    expect(crdtUpsertCall?.text).toContain('root_id');
    expect(crdtUpsertCall?.params?.[1]).toBe(
      '00000000-0000-0000-0000-000000000011'
    );
    expect(crdtUpsertCall?.params?.[9]).toBe(
      '00000000-0000-0000-0000-000000000010'
    ); // root_id (albumId)

    const linkInserts = calls.filter((call) =>
      call.text.includes('INSERT INTO vfs_links')
    );
    expect(linkInserts).toHaveLength(2);
    expect(linkInserts[0]?.params?.[1]).toBe(
      '00000000-0000-0000-0000-000000000000'
    );
    expect(linkInserts[0]?.params?.[2]).toBe(
      '00000000-0000-0000-0000-000000000010'
    );

    expect(encryptVfsName).toHaveBeenCalledTimes(2);
  });

  it('rolls back transaction on missing users', async () => {
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
      setupBobPhotoAlbumShareForAliceDb({
        client,
        bobEmail: 'missing@example.com',
        aliceEmail: 'alice@tearleads.com'
      })
    ).rejects.toThrow('Could not resolve user id');

    expect(calls.some((call) => call.text === 'ROLLBACK')).toBe(true);
    expect(calls.some((call) => call.text === 'COMMIT')).toBe(false);
  });

  it('uses scaffold-unwrapped session keys by default without user_keys lookups', async () => {
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

    await setupBobPhotoAlbumShareForAliceDb({
      client,
      bobEmail: 'bob@tearleads.com',
      aliceEmail: 'alice@tearleads.com',
      hasOrganizationIdColumn: true,
      albumId: '00000000-0000-0000-0000-000000000010',
      photoId: '00000000-0000-0000-0000-000000000011',
      idFactory: (() => {
        const ids = ['id-1', 'id-2', 'id-3', 'id-4', 'id-5', 'id-6'];
        let index = 0;
        return () => ids[index++] ?? `id-${String(index)}`;
      })(),
      now: () => new Date('2026-03-01T00:00:00.000Z')
    });

    const albumInsertCall = calls.find(
      (call) =>
        call.text.includes('INSERT INTO vfs_registry') &&
        call.params?.[0] === '00000000-0000-0000-0000-000000000010'
    );
    const photoInsertCall = calls.find(
      (call) =>
        call.text.includes('INSERT INTO vfs_registry') &&
        call.params?.[0] === '00000000-0000-0000-0000-000000000011'
    );

    const albumSessionKey = albumInsertCall?.params?.[4];
    const photoSessionKey = photoInsertCall?.params?.[4];
    expect(typeof albumSessionKey).toBe('string');
    expect(typeof photoSessionKey).toBe('string');
    expect(String(albumSessionKey).startsWith('scaffold-unwrapped:')).toBe(
      true
    );
    expect(String(photoSessionKey).startsWith('scaffold-unwrapped:')).toBe(
      true
    );
    expect(calls.some((call) => call.text.includes('FROM user_keys'))).toBe(
      false
    );
  });
});
