import {
  buildVfsSharesV2ConnectMethodPath,
  buildVfsV2ConnectMethodPath
} from '@tearleads/shared';
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

      if (path === buildVfsV2ConnectMethodPath('Register')) {
        return {
          createdAt: '2026-03-01T00:00:00.000Z'
        };
      }

      if (path === buildVfsV2ConnectMethodPath('PushCrdtOps')) {
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

      if (path === buildVfsSharesV2ConnectMethodPath('CreateShare')) {
        return {
          share: {
            id: '00000000-0000-0000-0000-000000000004',
            itemId: '00000000-0000-0000-0000-000000000005',
            shareType: 'user',
            targetId: '00000000-0000-0000-0000-000000000002',
            targetName: 'alice@example.com',
            permissionLevel: 'view',
            createdBy: '00000000-0000-0000-0000-000000000001',
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
      '00000000-0000-0000-0000-000000000005', // folder
      '00000000-0000-0000-0000-000000000006', // note
      '00000000-0000-0000-0000-000000000007', // 00000000-0000-0000-0000-000000000007
      '00000000-0000-0000-0000-000000000008', // nonce
      '00000000-0000-0000-0000-000000000009', // aad
      '00000000-0000-0000-0000-000000000010' // sig
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
      aliceUserId: '00000000-0000-0000-0000-000000000002',
      createLink: async (link) => {
        linkCalls.push(link);
      },
      idFactory,
      now: () => new Date('2026-03-01T00:00:00.000Z'),
      rootItemId: '00000000-0000-0000-0000-000000000000'
    });

    expect(result.folderId).toBe('00000000-0000-0000-0000-000000000005');
    expect(result.noteId).toBe('00000000-0000-0000-0000-000000000006');
    expect(result.share.targetId).toBe('00000000-0000-0000-0000-000000000002');
    expect(result.crdtResults).toHaveLength(1);
    expect(linkCalls).toEqual([
      {
        parentId: '00000000-0000-0000-0000-000000000000',
        childId: '00000000-0000-0000-0000-000000000005'
      },
      {
        parentId: '00000000-0000-0000-0000-000000000005',
        childId: '00000000-0000-0000-0000-000000000006'
      }
    ]);

    expect(calls).toHaveLength(4);
    expect(calls[0]?.path).toBe(buildVfsV2ConnectMethodPath('Register'));
    expect(calls[1]?.path).toBe(buildVfsV2ConnectMethodPath('Register'));
    expect(calls[2]?.path).toBe(buildVfsV2ConnectMethodPath('PushCrdtOps'));
    expect(calls[3]?.path).toBe(
      buildVfsSharesV2ConnectMethodPath('CreateShare')
    );

    const firstRegisterBody = JSON.parse(calls[0]?.bodyText ?? '');
    expect(firstRegisterBody).toEqual({
      id: '00000000-0000-0000-0000-000000000005',
      objectType: 'folder',
      encryptedSessionKey: 'bob-session-key',
      encryptedName: 'Notes shared with Alice'
    });

    const secondRegisterBody = JSON.parse(calls[1]?.bodyText ?? '');
    expect(secondRegisterBody).toEqual({
      id: '00000000-0000-0000-0000-000000000006',
      objectType: 'note',
      encryptedSessionKey: 'bob-session-key',
      encryptedName: 'Note for Alice - From Bob'
    });

    const pushBody = JSON.parse(calls[2]?.bodyText ?? '');
    if (!isRecord(pushBody) || !Array.isArray(pushBody['operations'])) {
      throw new Error('Unexpected push body in test');
    }
    expect(pushBody['clientId']).toBe('bob-scaffolding');
    expect(pushBody['operations']).toHaveLength(1);
    expect(pushBody['operations'][0]).toMatchObject({
      opId: '00000000-0000-0000-0000-000000000007',
      opType: 'item_upsert',
      itemId: '00000000-0000-0000-0000-000000000006',
      replicaId: 'bob-scaffolding',
      writeId: 1
    });

    const shareBody = JSON.parse(calls[3]?.bodyText ?? '');
    expect(shareBody).toEqual({
      itemId: '00000000-0000-0000-0000-000000000005',
      shareType: 'user',
      targetId: '00000000-0000-0000-0000-000000000002',
      permissionLevel: 'view'
    });
  });
});
