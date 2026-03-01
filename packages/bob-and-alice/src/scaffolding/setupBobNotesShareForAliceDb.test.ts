import { describe, expect, it, vi } from 'vitest';
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
    const result = await setupBobNotesShareForAliceDb({
      client,
      bobEmail: 'bob@tearleads.com',
      aliceEmail: 'alice@tearleads.com',
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

    const rootInsertCall = calls.find((call) =>
      call.text.includes("VALUES ($1, 'folder', NULL, NULL, 'VFS Root'")
    );
    expect(rootInsertCall?.params?.[0]).toBe('__vfs_root__');

    const shareCalls = calls.filter((call) =>
      call.text.includes('INSERT INTO vfs_acl_entries')
    );
    expect(shareCalls).toHaveLength(2);
    expect(shareCalls[0]?.params?.[1]).toBe('folder-fixed');
    expect(shareCalls[0]?.params?.[2]).toBe('alice-user-id');
    expect(shareCalls[0]?.params?.[3]).toBe('read');
    expect(shareCalls[1]?.params?.[1]).toBe('note-fixed');
    expect(shareCalls[1]?.params?.[2]).toBe('alice-user-id');
    expect(shareCalls[1]?.params?.[3]).toBe('read');
  });

  it('rolls back transaction on failure', async () => {
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
      setupBobNotesShareForAliceDb({
        client,
        bobEmail: 'missing@example.com',
        aliceEmail: 'alice@tearleads.com'
      })
    ).rejects.toThrow('Could not resolve user id');

    expect(calls.some((call) => call.text === 'ROLLBACK')).toBe(true);
    expect(calls.some((call) => call.text === 'COMMIT')).toBe(false);
  });
});
