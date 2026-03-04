import { describe, expect, it, vi } from 'vitest';
import {
  combinePublicKey,
  generateKeyPair,
  serializePublicKey
} from '../crypto/asymmetric.js';
import type { DbQueryClient } from './setupBobNotesShareForAliceDb.js';
import {
  SCAFFOLD_SHARED_LOGO_SVG,
  setupBobPhotoAlbumShareForAliceDb
} from './setupBobPhotoAlbumShareForAliceDb.js';

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
      albumId: 'album-fixed',
      photoId: 'photo-fixed',
      idFactory: (() => {
        const ids = ['id-1', 'id-2', 'id-3', 'id-4', 'id-5'];
        let index = 0;
        return () => ids[index++] ?? `id-${String(index)}`;
      })(),
      now: () => new Date('2026-03-01T00:00:00.000Z')
    });

    expect(result).toEqual({
      bobUserId: 'bob-user-id',
      aliceUserId: 'alice-user-id',
      rootItemId: '__vfs_root__',
      albumId: 'album-fixed',
      photoId: 'photo-fixed',
      albumShareAclId: 'share:stored-share-id',
      photoShareAclId: 'share:stored-share-id'
    });

    expect(calls[0]?.text).toBe('BEGIN');
    expect(calls[calls.length - 1]?.text).toBe('COMMIT');

    const albumInsertCall = calls.find(
      (call) =>
        call.text.includes('INSERT INTO vfs_registry') &&
        call.params?.[0] === 'album-fixed'
    );
    expect(albumInsertCall?.params?.[1]).toBe('album');
    expect(albumInsertCall?.params?.[4]).toBe('wrapped:Photos shared with Alice');
    expect(albumInsertCall?.params?.[5]).toBe('cipher:Photos shared with Alice');

    const photoInsertCall = calls.find(
      (call) =>
        call.text.includes('INSERT INTO vfs_registry') &&
        call.params?.[0] === 'photo-fixed'
    );
    expect(photoInsertCall?.params?.[1]).toBe('photo');
    expect(photoInsertCall?.params?.[4]).toBe('wrapped:Tearleads logo.svg');
    expect(photoInsertCall?.params?.[5]).toBe('cipher:Tearleads logo.svg');

    const itemStateInsertCall = calls.find((call) =>
      call.text.includes('INSERT INTO vfs_item_state')
    );
    expect(itemStateInsertCall?.params?.[0]).toBe('photo-fixed');
    expect(itemStateInsertCall?.params?.[1]).toBe(
      Buffer.from(SCAFFOLD_SHARED_LOGO_SVG, 'utf8').toString('base64')
    );

    const crdtUpsertCall = calls.find((call) =>
      call.text.includes('INSERT INTO vfs_crdt_ops')
    );
    expect(crdtUpsertCall?.params?.[0]).toBe('crdt:item_upsert:photo-fixed');
    expect(crdtUpsertCall?.params?.[1]).toBe('photo-fixed');
    expect(crdtUpsertCall?.params?.[2]).toBe('bob-user-id');
    expect(crdtUpsertCall?.params?.[5]).toBe(
      Buffer.from(SCAFFOLD_SHARED_LOGO_SVG, 'utf8').toString('base64')
    );

    const linkInserts = calls.filter((call) =>
      call.text.includes('INSERT INTO vfs_links')
    );
    expect(linkInserts).toHaveLength(2);
    expect(linkInserts[0]?.params?.[1]).toBe('__vfs_root__');
    expect(linkInserts[0]?.params?.[2]).toBe('album-fixed');
    expect(linkInserts[1]?.params?.[1]).toBe('album-fixed');
    expect(linkInserts[1]?.params?.[2]).toBe('photo-fixed');

    const shareCalls = calls.filter((call) =>
      call.text.includes('INSERT INTO vfs_acl_entries')
    );
    expect(shareCalls).toHaveLength(2);
    expect(shareCalls[0]?.params?.[1]).toBe('album-fixed');
    expect(shareCalls[0]?.params?.[2]).toBe('alice-user-id');
    expect(shareCalls[1]?.params?.[1]).toBe('photo-fixed');
    expect(shareCalls[1]?.params?.[2]).toBe('alice-user-id');

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

  it('uses scaffold-unwrapped session keys by default when owner key exists', async () => {
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

    await setupBobPhotoAlbumShareForAliceDb({
      client,
      bobEmail: 'bob@tearleads.com',
      aliceEmail: 'alice@tearleads.com',
      hasOrganizationIdColumn: true,
      albumId: 'album-fixed',
      photoId: 'photo-fixed',
      idFactory: (() => {
        const ids = ['id-1', 'id-2', 'id-3', 'id-4', 'id-5'];
        let index = 0;
        return () => ids[index++] ?? `id-${String(index)}`;
      })(),
      now: () => new Date('2026-03-01T00:00:00.000Z')
    });

    const albumInsertCall = calls.find(
      (call) =>
        call.text.includes('INSERT INTO vfs_registry') &&
        call.params?.[0] === 'album-fixed'
    );
    const photoInsertCall = calls.find(
      (call) =>
        call.text.includes('INSERT INTO vfs_registry') &&
        call.params?.[0] === 'photo-fixed'
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
