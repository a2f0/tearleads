import { beforeEach, describe, expect, it, vi } from 'vitest';
import { loadOrgShares, loadUserShares } from './vfsSharesDirectQueries.js';

const queryMock =
  vi.fn<(text: string, values?: unknown[]) => Promise<{ rows: unknown[] }>>();

const pool = {
  query: (text: string, values?: unknown[]) => queryMock(text, values)
};

describe('vfsSharesDirectQueries', () => {
  beforeEach(() => {
    queryMock.mockReset();
  });

  it('maps user and group shares with canonical share ids', async () => {
    const createdAt = new Date('2026-03-02T00:00:00.000Z');
    queryMock.mockResolvedValueOnce({
      rows: [
        {
          acl_id: 'share:share-1',
          item_id: 'item-1',
          share_type: 'user',
          target_id: 'user-2',
          access_level: 'read',
          created_by: 'user-1',
          created_at: createdAt,
          expires_at: null,
          target_name: 'target@example.com',
          created_by_email: 'creator@example.com',
          wrapped_session_key: 'enc-key-1',
          wrapped_hierarchical_key:
            '{"recipientPublicKeyId":"pub-1","senderSignature":"sig-1"}',
          key_epoch: 2
        },
        {
          acl_id: 'share:share-2',
          item_id: 'item-1',
          share_type: 'group',
          target_id: 'group-1',
          access_level: 'write',
          created_by: null,
          created_at: createdAt,
          expires_at: createdAt,
          target_name: null,
          created_by_email: null,
          wrapped_session_key: 'ignored-for-group',
          wrapped_hierarchical_key:
            '{"recipientPublicKeyId":"pub-2","senderSignature":"sig-2"}',
          key_epoch: 3
        }
      ]
    });

    const shares = await loadUserShares(pool, 'item-1');
    expect(shares).toHaveLength(2);
    const [firstShare, secondShare] = shares;

    if (!firstShare || !secondShare) {
      throw new Error('Expected two user shares');
    }

    expect(firstShare).toMatchObject({
      id: 'share-1',
      itemId: 'item-1',
      shareType: 'user',
      targetId: 'user-2',
      targetName: 'target@example.com',
      permissionLevel: 'view',
      createdBy: 'user-1',
      createdByEmail: 'creator@example.com',
      createdAt: createdAt.toISOString(),
      expiresAt: null,
      wrappedKey: {
        recipientUserId: 'user-2',
        recipientPublicKeyId: 'pub-1',
        keyEpoch: 2,
        encryptedKey: 'enc-key-1',
        senderSignature: 'sig-1'
      }
    });
    expect(secondShare).toMatchObject({
      id: 'share-2',
      targetName: 'Unknown',
      permissionLevel: 'edit',
      createdBy: 'unknown',
      createdByEmail: 'Unknown',
      expiresAt: createdAt.toISOString()
    });
    expect('wrappedKey' in secondShare).toBe(false);
  });

  it('maps org shares with canonical share ids', async () => {
    const createdAt = new Date('2026-03-02T00:00:00.000Z');
    queryMock.mockResolvedValueOnce({
      rows: [
        {
          acl_id: 'org-share:source-org:org-share-1',
          source_org_id: 'source-org',
          target_org_id: 'target-org',
          item_id: 'item-1',
          access_level: 'read',
          created_by: 'user-1',
          created_at: createdAt,
          expires_at: null,
          source_org_name: 'Source Org',
          target_org_name: 'Target Org',
          created_by_email: 'creator@example.com',
          wrapped_session_key: 'org-enc-key',
          wrapped_hierarchical_key:
            '{"recipientPublicKeyId":"pub-org","senderSignature":"sig-org"}',
          key_epoch: 5
        }
      ]
    });

    const orgShares = await loadOrgShares(pool, 'item-1');
    expect(orgShares).toHaveLength(1);
    const [firstOrgShare] = orgShares;

    if (!firstOrgShare) {
      throw new Error('Expected one org share');
    }

    expect(firstOrgShare).toMatchObject({
      id: 'org-share-1',
      sourceOrgId: 'source-org',
      sourceOrgName: 'Source Org',
      targetOrgId: 'target-org',
      targetOrgName: 'Target Org',
      itemId: 'item-1',
      permissionLevel: 'view',
      createdBy: 'user-1',
      createdByEmail: 'creator@example.com',
      createdAt: createdAt.toISOString(),
      expiresAt: null,
      wrappedKey: {
        recipientOrgId: 'target-org',
        recipientPublicKeyId: 'pub-org',
        keyEpoch: 5,
        encryptedKey: 'org-enc-key',
        senderSignature: 'sig-org'
      }
    });
  });

  it('omits malformed wrapped-key metadata and applies fallback names', async () => {
    const createdAt = new Date('2026-03-02T00:00:00.000Z');
    queryMock
      .mockResolvedValueOnce({
        rows: [
          {
            acl_id: 'share:share-1',
            item_id: 'item-1',
            share_type: 'user',
            target_id: 'user-2',
            access_level: 'read',
            created_by: 'user-1',
            created_at: createdAt,
            expires_at: null,
            target_name: 'target@example.com',
            created_by_email: 'creator@example.com',
            wrapped_session_key: 'enc-key-1',
            wrapped_hierarchical_key:
              '{"recipientPublicKeyId":"","senderSignature":"sig"}',
            key_epoch: 2
          }
        ]
      })
      .mockResolvedValueOnce({
        rows: [
          {
            acl_id: 'org-share:source-org:org-share-1',
            source_org_id: 'source-org',
            target_org_id: 'target-org',
            item_id: 'item-1',
            access_level: 'read',
            created_by: null,
            created_at: createdAt,
            expires_at: null,
            source_org_name: null,
            target_org_name: null,
            created_by_email: null,
            wrapped_session_key: 'org-enc-key',
            wrapped_hierarchical_key: 'not-json',
            key_epoch: 5
          }
        ]
      });

    const shares = await loadUserShares(pool, 'item-1');
    const orgShares = await loadOrgShares(pool, 'item-1');
    expect(shares).toHaveLength(1);
    expect(orgShares).toHaveLength(1);

    const [firstShare] = shares;
    const [firstOrgShare] = orgShares;

    if (!firstShare || !firstOrgShare) {
      throw new Error('Expected wrapped-key fallback rows');
    }

    expect('wrappedKey' in firstShare).toBe(false);
    expect(firstOrgShare).toMatchObject({
      id: 'org-share-1',
      sourceOrgName: 'Unknown',
      targetOrgName: 'Unknown',
      createdBy: 'unknown',
      createdByEmail: 'Unknown'
    });
    expect('wrappedKey' in firstOrgShare).toBe(false);
  });
});
