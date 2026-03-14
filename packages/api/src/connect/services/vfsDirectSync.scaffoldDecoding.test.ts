import { encrypt, importKey } from '@tearleads/shared';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const getPostgresPoolMock = vi.fn();
const queryMock = vi.fn();
const requireVfsClaimsMock = vi.fn();

vi.mock('../../lib/postgres.js', () => ({
  getPostgresPool: (...args: unknown[]) => getPostgresPoolMock(...args)
}));

vi.mock('./vfsDirectAuth.js', () => ({
  requireVfsClaims: (...args: unknown[]) => requireVfsClaimsMock(...args)
}));

import { getSyncDirect } from './vfsDirectSync.js';

const TEST_USER_ID = '00000000-0000-0000-0000-000000000001';
const CHANGE_ID_1 = '00000000-0000-0000-0000-000000000001';

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
      sub: TEST_USER_ID
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
            change_id: CHANGE_ID_1,
            item_id: 'item-1',
            change_type: 'upsert',
            changed_at: '2026-03-03T00:00:00.000Z',
            object_type: 'folder',
            encrypted_name: encryptedName,
            owner_id: TEST_USER_ID,
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

    expect(response).toEqual({
      items: [
        {
          accessLevel: 'admin',
          changeId: CHANGE_ID_1,
          changeType: 'upsert',
          changedAtMs: 1772496000000,
          createdAtMs: 1772496000000,
          encryptedName: 'Notes shared with Alice',
          itemId: 'item-1',
          objectType: 'folder',
          ownerId: TEST_USER_ID
        }
      ],
      hasMore: false
    });
  });
});
