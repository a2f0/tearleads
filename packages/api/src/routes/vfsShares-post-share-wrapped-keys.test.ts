import './vfsShares-test-support.js';
import request from 'supertest';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { app } from '../index.js';
import { createAuthHeader } from '../test/auth.js';
import {
  mockQuery,
  setupVfsSharesTestEnv,
  teardownVfsSharesTestEnv
} from './vfsShares-test-support.js';

describe('VFS Shares routes (POST share wrapped keys)', () => {
  beforeEach(() => {
    setupVfsSharesTestEnv();
  });

  afterEach(() => {
    teardownVfsSharesTestEnv();
  });

  it('persists wrapped key metadata for encrypted user shares', async () => {
    const authHeader = await createAuthHeader();
    mockQuery.mockResolvedValueOnce({
      rows: [{ id: 'item-123', owner_id: 'user-1' }]
    });
    mockQuery.mockResolvedValueOnce({
      rows: [{ email: 'target@test.com' }]
    });
    mockQuery.mockResolvedValueOnce({
      rows: [
        {
          acl_id: 'share:share-new',
          item_id: 'item-123',
          share_type: 'user',
          target_id: 'user-456',
          access_level: 'read',
          created_by: 'user-001',
          created_at: new Date('2024-01-01'),
          expires_at: null
        }
      ]
    });
    mockQuery.mockResolvedValueOnce({
      rows: [{ email: 'creator@test.com' }]
    });

    const wrappedKey = {
      recipientUserId: 'user-456',
      recipientPublicKeyId: 'pk-user-456',
      keyEpoch: 3,
      encryptedKey: 'base64-encrypted-key',
      senderSignature: 'base64-signature'
    };

    const response = await request(app)
      .post('/v1/vfs/items/item-123/shares')
      .set('Authorization', authHeader)
      .send({
        itemId: 'item-123',
        shareType: 'user',
        targetId: 'user-456',
        permissionLevel: 'view',
        wrappedKey
      });

    expect(response.status).toBe(201);
    expect(response.body.share.wrappedKey).toEqual(wrappedKey);

    const aclInsertCall = mockQuery.mock.calls.find(
      (call) =>
        typeof call[0] === 'string' &&
        call[0].includes('INSERT INTO vfs_acl_entries')
    );
    expect(aclInsertCall).toBeDefined();
    expect(aclInsertCall?.[1]?.[5]).toBe('base64-encrypted-key');
    expect(aclInsertCall?.[1]?.[6]).toBe(
      JSON.stringify({
        recipientPublicKeyId: 'pk-user-456',
        senderSignature: 'base64-signature'
      })
    );
    expect(aclInsertCall?.[1]?.[7]).toBe(3);
  });

  it('returns 400 when wrapped key recipient does not match target user', async () => {
    const authHeader = await createAuthHeader();

    const response = await request(app)
      .post('/v1/vfs/items/item-123/shares')
      .set('Authorization', authHeader)
      .send({
        itemId: 'item-123',
        shareType: 'user',
        targetId: 'user-456',
        permissionLevel: 'view',
        wrappedKey: {
          recipientUserId: 'user-other',
          recipientPublicKeyId: 'pk-user-other',
          keyEpoch: 1,
          encryptedKey: 'encrypted',
          senderSignature: 'signature'
        }
      });

    expect(response.status).toBe(400);
    expect(mockQuery).not.toHaveBeenCalled();
  });

  it('returns 400 when wrapped key keyEpoch is not a safe integer', async () => {
    const authHeader = await createAuthHeader();

    const response = await request(app)
      .post('/v1/vfs/items/item-123/shares')
      .set('Authorization', authHeader)
      .send({
        itemId: 'item-123',
        shareType: 'user',
        targetId: 'user-456',
        permissionLevel: 'view',
        wrappedKey: {
          recipientUserId: 'user-456',
          recipientPublicKeyId: 'pk-user-456',
          keyEpoch: Number.MAX_SAFE_INTEGER + 1,
          encryptedKey: 'encrypted',
          senderSignature: 'signature'
        }
      });

    expect(response.status).toBe(400);
    expect(mockQuery).not.toHaveBeenCalled();
  });
});
