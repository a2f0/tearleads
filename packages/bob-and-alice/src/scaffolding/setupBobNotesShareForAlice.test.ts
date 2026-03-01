import { describe, expect, it } from 'vitest';
import {
  type JsonApiActor,
  setupBobNotesShareForAlice
} from './setupBobNotesShareForAlice.js';

interface RequestCall {
  path: string;
  method: string;
  bodyText: string;
}

interface LinkCall {
  parentId: string;
  childId: string;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function createMockBobActor(calls: RequestCall[]): JsonApiActor {
  return {
    async fetchJson(path: string, init?: RequestInit): Promise<unknown> {
      const method = init?.method ?? 'GET';
      const bodyText = typeof init?.body === 'string' ? init.body : '';
      calls.push({ path, method, bodyText });

      if (path === '/vfs/register') {
        return {
          createdAt: '2026-03-01T00:00:00.000Z'
        };
      }

      if (path === '/vfs/crdt/push') {
        const payload = JSON.parse(bodyText);
        if (!isRecord(payload) || !Array.isArray(payload['operations'])) {
          throw new Error('Unexpected crdt payload in test');
        }
        return {
          clientId: payload['clientId'],
          results: payload['operations'].map((operation) => {
            if (!isRecord(operation) || typeof operation['opId'] !== 'string') {
              throw new Error('Unexpected crdt operation payload in test');
            }
            return {
              opId: operation['opId'],
              status: 'applied'
            };
          })
        };
      }

      if (path.startsWith('/vfs/items/') && path.endsWith('/shares')) {
        return {
          share: {
            id: 'share:test-share-id',
            itemId: 'folder-fixed',
            shareType: 'user',
            targetId: 'alice-user-id',
            targetName: 'alice@example.com',
            permissionLevel: 'view',
            createdBy: 'bob-user-id',
            createdByEmail: 'bob@example.com',
            createdAt: '2026-03-01T00:00:03.000Z',
            expiresAt: null
          }
        };
      }

      throw new Error(`Unexpected path: ${path}`);
    }
  };
}

describe('setupBobNotesShareForAlice', () => {
  it('registers folder+note, links under root, and shares folder to Alice', async () => {
    const calls: RequestCall[] = [];
    const linkCalls: LinkCall[] = [];
    const idValues = [
      'folder-suffix',
      'note-suffix',
      'upsert-op',
      'nonce-id',
      'aad-id',
      'sig-id'
    ];
    let idIndex = 0;
    const idFactory = (): string => {
      const value = idValues[idIndex];
      idIndex += 1;
      if (!value) {
        throw new Error('idFactory exhausted');
      }
      return value;
    };

    const bob = createMockBobActor(calls);
    const result = await setupBobNotesShareForAlice({
      bob,
      aliceUserId: 'alice-user-id',
      createLink: async (link) => {
        linkCalls.push(link);
      },
      idFactory,
      now: () => new Date('2026-03-01T00:00:00.000Z'),
      rootItemId: 'root'
    });

    expect(result.folderId).toBe('folder-folder-suffix');
    expect(result.noteId).toBe('note-note-suffix');
    expect(result.share.targetId).toBe('alice-user-id');
    expect(result.crdtResults).toHaveLength(1);
    expect(linkCalls).toEqual([
      { parentId: 'root', childId: 'folder-folder-suffix' },
      {
        parentId: 'folder-folder-suffix',
        childId: 'note-note-suffix'
      }
    ]);

    expect(calls).toHaveLength(4);
    expect(calls[0]?.path).toBe('/vfs/register');
    expect(calls[1]?.path).toBe('/vfs/register');
    expect(calls[2]?.path).toBe('/vfs/crdt/push');
    expect(calls[3]?.path).toBe('/vfs/items/folder-folder-suffix/shares');

    const firstRegisterBody = JSON.parse(calls[0]?.bodyText ?? '');
    expect(firstRegisterBody).toEqual({
      id: 'folder-folder-suffix',
      objectType: 'folder',
      encryptedSessionKey: 'bob-folder-session-key',
      encryptedName: 'Notes shared with Alice'
    });

    const secondRegisterBody = JSON.parse(calls[1]?.bodyText ?? '');
    expect(secondRegisterBody).toEqual({
      id: 'note-note-suffix',
      objectType: 'note',
      encryptedSessionKey: 'bob-note-session-key',
      encryptedName: 'Shared note for Alice'
    });

    const pushBody = JSON.parse(calls[2]?.bodyText ?? '');
    if (!isRecord(pushBody) || !Array.isArray(pushBody['operations'])) {
      throw new Error('Unexpected push body in test');
    }
    expect(pushBody['clientId']).toBe('bob-scaffolding');
    expect(pushBody['operations']).toHaveLength(1);
    expect(pushBody['operations'][0]).toMatchObject({
      opId: 'op-upsert-op',
      opType: 'item_upsert',
      itemId: 'note-note-suffix',
      replicaId: 'bob-scaffolding',
      writeId: 1
    });

    const shareBody = JSON.parse(calls[3]?.bodyText ?? '');
    expect(shareBody).toEqual({
      itemId: 'folder-folder-suffix',
      shareType: 'user',
      targetId: 'alice-user-id',
      permissionLevel: 'view'
    });
  });
});
