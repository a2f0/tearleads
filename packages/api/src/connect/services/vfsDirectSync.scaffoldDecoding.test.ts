import { encrypt, importKey } from '@tearleads/shared';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { getPostgresPoolMock, queryMock, requireVfsClaimsMock } = vi.hoisted(
  () => ({
    getPostgresPoolMock: vi.fn(),
    queryMock: vi.fn(),
    requireVfsClaimsMock: vi.fn()
  })
);

vi.mock('../../lib/postgres.js', () => ({
  getPostgresPool: (...args: unknown[]) => getPostgresPoolMock(...args)
}));

vi.mock('./vfsDirectAuth.js', () => ({
  requireVfsClaims: (...args: unknown[]) => requireVfsClaimsMock(...args)
}));

import { getSyncDirect } from './vfsDirectSync.js';

function parseJson(json: string): unknown {
  return JSON.parse(json);
}

async function encryptNameForScaffold(
  plaintextName: string,
  sessionKey: Uint8Array
): Promise<string> {
  const cryptoKey = await importKey(sessionKey);
  const encryptedBytes = await encrypt(
    new TextEncoder().encode(plaintextName),
    cryptoKey
  );
  return Buffer.from(encryptedBytes).toString('base64');
}

describe('vfsDirectSync scaffold decryption', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    queryMock.mockReset();
    requireVfsClaimsMock.mockResolvedValue({
      sub: 'user-1'
    });
    getPostgresPoolMock.mockResolvedValue({
      query: queryMock
    });
  });

  it('decrypts scaffold-unwrapped encrypted_name values in sync payload', async () => {
    const sessionKey = Uint8Array.from({ length: 32 }, () => 7);
    const encryptedName = await encryptNameForScaffold(
      'Notes shared with Alice',
      sessionKey
    );

    queryMock
      .mockResolvedValueOnce({
        rows: [
          {
            change_id: 'change-1',
            item_id: 'item-1',
            change_type: 'upsert',
            changed_at: '2026-03-03T00:00:00.000Z',
            object_type: 'folder',
            encrypted_name: encryptedName,
            owner_id: 'user-1',
            created_at: '2026-03-03T00:00:00.000Z',
            access_level: 'admin'
          }
        ]
      })
      .mockResolvedValueOnce({
        rows: [
          {
            id: 'item-1',
            encrypted_session_key: `scaffold-unwrapped:${Buffer.from(
              sessionKey
            ).toString('base64')}`
          }
        ]
      });

    const response = await getSyncDirect(
      {
        cursor: '',
        limit: 10,
        rootId: ''
      },
      {
        requestHeader: new Headers()
      }
    );

    expect(parseJson(response.json)).toEqual({
      items: [
        {
          accessLevel: 'admin',
          changeId: 'change-1',
          changeType: 'upsert',
          changedAt: '2026-03-03T00:00:00.000Z',
          createdAt: '2026-03-03T00:00:00.000Z',
          encryptedName: 'Notes shared with Alice',
          itemId: 'item-1',
          objectType: 'folder',
          ownerId: 'user-1'
        }
      ],
      nextCursor: null,
      hasMore: false
    });
  });
});
