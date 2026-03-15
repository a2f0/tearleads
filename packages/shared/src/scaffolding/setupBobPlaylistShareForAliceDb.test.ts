import { describe, expect, it, vi } from 'vitest';
import { isValidSyncIdentifier } from '../vfsSyncIdentifiers.js';
import {
  SCAFFOLD_SYNTHETIC_WAV_BASE64,
  setupBobPlaylistShareForAliceDb
} from './setupBobPlaylistShareForAliceDb.js';
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
      playlistId: '00000000-0000-0000-0000-000000000010',
      audioId: '00000000-0000-0000-0000-000000000011',
      idFactory: (() => {
        const ids = ['id-1', 'id-2', 'id-3', 'id-4', 'id-5', 'id-6', 'id-7'];
        let index = 0;
        return () => ids[index++] ?? `id-${String(index)}`;
      })(),
      now: () => new Date('2026-03-01T00:00:00.000Z')
    });

    expect(result).toEqual({
      bobUserId: '00000000-0000-0000-0000-000000000001',
      aliceUserId: '00000000-0000-0000-0000-000000000003',
      rootItemId: '00000000-0000-0000-0000-000000000000',
      playlistId: '00000000-0000-0000-0000-000000000010',
      audioId: '00000000-0000-0000-0000-000000000011',
      playlistShareAclId: '00000000-0000-0000-0000-000000000005',
      audioShareAclId: '00000000-0000-0000-0000-000000000005'
    });

    expect(calls[0]?.text).toBe('BEGIN');
    expect(calls[calls.length - 1]?.text).toBe('COMMIT');

    const playlistInsertCall = calls.find(
      (call) =>
        call.text.includes('INSERT INTO vfs_registry') &&
        call.params?.[0] === '00000000-0000-0000-0000-000000000010'
    );
    expect(playlistInsertCall?.params?.[1]).toBe('playlist');

    const audioInsertCall = calls.find(
      (call) =>
        call.text.includes('INSERT INTO vfs_registry') &&
        call.params?.[0] === '00000000-0000-0000-0000-000000000011'
    );
    expect(audioInsertCall?.params?.[1]).toBe('audio');

    const playlistExtensionCall = calls.find((call) =>
      call.text.includes('INSERT INTO playlists')
    );
    expect(playlistExtensionCall?.params?.[0]).toBe(
      '00000000-0000-0000-0000-000000000010'
    );

    const itemStateInsertCall = calls.find((call) =>
      call.text.includes('INSERT INTO vfs_item_state')
    );
    expect(itemStateInsertCall?.params?.[0]).toBe(
      '00000000-0000-0000-0000-000000000011'
    );
    expect(itemStateInsertCall?.params?.[1]).toBe(
      SCAFFOLD_SYNTHETIC_WAV_BASE64
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
    ); // root_id (playlistId)

    const audioSourceId = crdtUpsertCall?.params?.[3];
    expect(typeof audioSourceId).toBe('string');
    expect(isValidSyncIdentifier(String(audioSourceId))).toBe(true);

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
    const { calls, client } = createMockClient();

    await setupBobPlaylistShareForAliceDb({
      client,
      bobEmail: 'bob@tearleads.com',
      aliceEmail: 'alice@tearleads.com',
      hasOrganizationIdColumn: true,
      playlistId: '00000000-0000-0000-0000-000000000010',
      audioId: '00000000-0000-0000-0000-000000000011',
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
        call.params?.[0] === '00000000-0000-0000-0000-000000000010'
    );
    const audioInsertCall = calls.find(
      (call) =>
        call.text.includes('INSERT INTO vfs_registry') &&
        call.params?.[0] === '00000000-0000-0000-0000-000000000011'
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
