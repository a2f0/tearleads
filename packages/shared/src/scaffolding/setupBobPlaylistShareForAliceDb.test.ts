import { describe, expect, it, vi } from 'vitest';
import {
  combinePublicKey,
  generateKeyPair,
  serializePublicKey
} from '../crypto/asymmetric.js';
import type { DbQueryClient } from './setupBobNotesShareForAliceDb.js';
import {
  SCAFFOLD_SYNTHETIC_WAV_BASE64,
  setupBobPlaylistShareForAliceDb
} from './setupBobPlaylistShareForAliceDb.js';

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

describe('setupBobPlaylistShareForAliceDb', () => {
  it('creates playlist+audio scaffolding and shares to Alice in one transaction', async () => {
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

    const result = await setupBobPlaylistShareForAliceDb({
      client,
      bobEmail: 'bob@tearleads.com',
      aliceEmail: 'alice@tearleads.com',
      encryptVfsName,
      hasOrganizationIdColumn: true,
      playlistId: 'playlist-fixed',
      audioId: 'audio-fixed',
      idFactory: (() => {
        const ids = ['id-1', 'id-2', 'id-3', 'id-4', 'id-5', 'id-6', 'id-7'];
        let index = 0;
        return () => ids[index++] ?? `id-${String(index)}`;
      })(),
      now: () => new Date('2026-03-01T00:00:00.000Z')
    });

    expect(result).toEqual({
      bobUserId: 'bob-user-id',
      aliceUserId: 'alice-user-id',
      rootItemId: '__vfs_root__',
      playlistId: 'playlist-fixed',
      audioId: 'audio-fixed',
      playlistShareAclId: 'share:stored-share-id',
      audioShareAclId: 'share:stored-share-id'
    });

    expect(calls[0]?.text).toBe('BEGIN');
    expect(calls[calls.length - 1]?.text).toBe('COMMIT');

    const playlistInsertCall = calls.find(
      (call) =>
        call.text.includes('INSERT INTO vfs_registry') &&
        call.params?.[0] === 'playlist-fixed'
    );
    expect(playlistInsertCall?.params?.[1]).toBe('playlist');
    expect(playlistInsertCall?.params?.[4]).toBe(
      'wrapped:Music shared with Alice'
    );
    expect(playlistInsertCall?.params?.[5]).toBe(
      'cipher:Music shared with Alice'
    );

    const audioInsertCall = calls.find(
      (call) =>
        call.text.includes('INSERT INTO vfs_registry') &&
        call.params?.[0] === 'audio-fixed'
    );
    expect(audioInsertCall?.params?.[1]).toBe('audio');
    expect(audioInsertCall?.params?.[4]).toBe('wrapped:The Blessing.mp3');
    expect(audioInsertCall?.params?.[5]).toBe('cipher:The Blessing.mp3');

    const playlistExtensionCall = calls.find((call) =>
      call.text.includes('INSERT INTO playlists')
    );
    expect(playlistExtensionCall?.params?.[0]).toBe('playlist-fixed');
    expect(playlistExtensionCall?.params?.[1]).toBe(
      'cipher:Music shared with Alice'
    );
    expect(playlistExtensionCall?.text).toContain('shuffle_mode');

    const itemStateInsertCall = calls.find((call) =>
      call.text.includes('INSERT INTO vfs_item_state')
    );
    expect(itemStateInsertCall?.params?.[0]).toBe('audio-fixed');
    expect(itemStateInsertCall?.params?.[1]).toBe(
      SCAFFOLD_SYNTHETIC_WAV_BASE64
    );

    const crdtUpsertCall = calls.find((call) =>
      call.text.includes('INSERT INTO vfs_crdt_ops')
    );
    expect(crdtUpsertCall?.text).toContain('encrypted_payload_bytes');
    expect(crdtUpsertCall?.text).toContain('encryption_nonce_bytes');
    expect(crdtUpsertCall?.text).toContain('encryption_aad_bytes');
    expect(crdtUpsertCall?.text).toContain('encryption_signature_bytes');
    expect(crdtUpsertCall?.params?.[0]).toBe('crdt:item_upsert:audio-fixed');
    expect(crdtUpsertCall?.params?.[1]).toBe('audio-fixed');
    expect(crdtUpsertCall?.params?.[2]).toBe('bob-user-id');
    const audioPayloadBase64 = crdtUpsertCall?.params?.[5];
    expect(typeof audioPayloadBase64).toBe('string');
    if (typeof audioPayloadBase64 !== 'string') {
      throw new Error('Expected CRDT payload base64 string');
    }
    expect(audioPayloadBase64).toBe(SCAFFOLD_SYNTHETIC_WAV_BASE64);

    const linkInserts = calls.filter((call) =>
      call.text.includes('INSERT INTO vfs_links')
    );
    expect(linkInserts).toHaveLength(2);
    expect(linkInserts[0]?.params?.[1]).toBe('__vfs_root__');
    expect(linkInserts[0]?.params?.[2]).toBe('playlist-fixed');
    expect(linkInserts[1]?.params?.[1]).toBe('playlist-fixed');
    expect(linkInserts[1]?.params?.[2]).toBe('audio-fixed');

    const shareCalls = calls.filter((call) =>
      call.text.includes('INSERT INTO vfs_acl_entries')
    );
    expect(shareCalls).toHaveLength(2);
    expect(shareCalls[0]?.params?.[1]).toBe('playlist-fixed');
    expect(shareCalls[0]?.params?.[2]).toBe('alice-user-id');
    expect(shareCalls[1]?.params?.[1]).toBe('audio-fixed');
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
      setupBobPlaylistShareForAliceDb({
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

    await setupBobPlaylistShareForAliceDb({
      client,
      bobEmail: 'bob@tearleads.com',
      aliceEmail: 'alice@tearleads.com',
      hasOrganizationIdColumn: true,
      playlistId: 'playlist-fixed',
      audioId: 'audio-fixed',
      idFactory: (() => {
        const ids = ['id-1', 'id-2', 'id-3', 'id-4', 'id-5', 'id-6', 'id-7'];
        let index = 0;
        return () => ids[index++] ?? `id-${String(index)}`;
      })(),
      now: () => new Date('2026-03-01T00:00:00.000Z')
    });

    const playlistInsertCall = calls.find(
      (call) =>
        call.text.includes('INSERT INTO vfs_registry') &&
        call.params?.[0] === 'playlist-fixed'
    );
    const audioInsertCall = calls.find(
      (call) =>
        call.text.includes('INSERT INTO vfs_registry') &&
        call.params?.[0] === 'audio-fixed'
    );

    const playlistSessionKey = playlistInsertCall?.params?.[4];
    const audioSessionKey = audioInsertCall?.params?.[4];
    expect(typeof playlistSessionKey).toBe('string');
    expect(typeof audioSessionKey).toBe('string');
    expect(String(playlistSessionKey).startsWith('scaffold-unwrapped:')).toBe(
      true
    );
    expect(String(audioSessionKey).startsWith('scaffold-unwrapped:')).toBe(
      true
    );
    expect(calls.some((call) => call.text.includes('FROM user_keys'))).toBe(
      false
    );
  });
});
