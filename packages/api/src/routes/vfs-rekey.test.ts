import './vfs-test-support.js';
import request from 'supertest';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { app } from '../index.js';
import { createAuthHeader } from '../test/auth.js';
import {
  mockQuery,
  setupVfsTestEnv,
  teardownVfsTestEnv
} from './vfs-test-support.js';

// Default mock user ID from test/auth.ts
const mockUserId = 'user-1';

describe('VFS routes (rekey)', () => {
  beforeEach(() => {
    setupVfsTestEnv();
  });

  afterEach(() => {
    teardownVfsTestEnv();
  });

  describe('POST /vfs/items/:itemId/rekey', () => {
    const validPayload = {
      reason: 'unshare',
      newEpoch: 2,
      wrappedKeys: [
        {
          recipientUserId: 'user-alice',
          recipientPublicKeyId: 'pk-alice',
          keyEpoch: 2,
          encryptedKey: 'base64-encrypted-key',
          senderSignature: 'base64-signature'
        }
      ]
    };

    it('returns 401 when not authenticated', async () => {
      const response = await request(app)
        .post('/v1/vfs/items/item-123/rekey')
        .send(validPayload);

      expect(response.status).toBe(401);
      expect(response.body).toEqual({ error: 'Unauthorized' });
    });

    it('returns 400 when payload is invalid', async () => {
      const authHeader = await createAuthHeader();

      const response = await request(app)
        .post('/v1/vfs/items/item-123/rekey')
        .set('Authorization', authHeader)
        .send({ reason: 'unshare' }); // missing newEpoch and wrappedKeys

      expect(response.status).toBe(400);
      expect(response.body.error).toContain('Invalid request payload');
    });

    it('returns 400 when reason is invalid', async () => {
      const authHeader = await createAuthHeader();

      const response = await request(app)
        .post('/v1/vfs/items/item-123/rekey')
        .set('Authorization', authHeader)
        .send({
          reason: 'invalid-reason',
          newEpoch: 2,
          wrappedKeys: []
        });

      expect(response.status).toBe(400);
    });

    it('returns 400 when newEpoch is less than 1', async () => {
      const authHeader = await createAuthHeader();

      const response = await request(app)
        .post('/v1/vfs/items/item-123/rekey')
        .set('Authorization', authHeader)
        .send({
          reason: 'manual',
          newEpoch: 0,
          wrappedKeys: []
        });

      expect(response.status).toBe(400);
    });

    it('returns 400 when newEpoch is not a safe integer', async () => {
      const authHeader = await createAuthHeader();

      const response = await request(app)
        .post('/v1/vfs/items/item-123/rekey')
        .set('Authorization', authHeader)
        .send({
          reason: 'manual',
          newEpoch: Number.MAX_SAFE_INTEGER + 1,
          wrappedKeys: []
        });

      expect(response.status).toBe(400);
    });

    it('returns 400 when wrapped key epoch does not match newEpoch', async () => {
      const authHeader = await createAuthHeader();

      const response = await request(app)
        .post('/v1/vfs/items/item-123/rekey')
        .set('Authorization', authHeader)
        .send({
          reason: 'manual',
          newEpoch: 2,
          wrappedKeys: [
            {
              recipientUserId: 'user-alice',
              recipientPublicKeyId: 'pk-alice',
              keyEpoch: 3,
              encryptedKey: 'base64-encrypted-key',
              senderSignature: 'base64-signature'
            }
          ]
        });

      expect(response.status).toBe(400);
    });

    it('returns 400 when wrapped key epoch is not a safe integer', async () => {
      const authHeader = await createAuthHeader();

      const response = await request(app)
        .post('/v1/vfs/items/item-123/rekey')
        .set('Authorization', authHeader)
        .send({
          reason: 'manual',
          newEpoch: 2,
          wrappedKeys: [
            {
              recipientUserId: 'user-alice',
              recipientPublicKeyId: 'pk-alice',
              keyEpoch: Number.MAX_SAFE_INTEGER + 1,
              encryptedKey: 'base64-encrypted-key',
              senderSignature: 'base64-signature'
            }
          ]
        });

      expect(response.status).toBe(400);
    });

    it('returns 404 when item does not exist', async () => {
      const authHeader = await createAuthHeader();
      mockQuery.mockResolvedValueOnce({ rows: [] }); // no item found

      const response = await request(app)
        .post('/v1/vfs/items/nonexistent-item/rekey')
        .set('Authorization', authHeader)
        .send(validPayload);

      expect(response.status).toBe(404);
      expect(response.body).toEqual({ error: 'Item not found' });
    });

    it('returns 403 when user is not the item owner', async () => {
      const authHeader = await createAuthHeader();
      mockQuery.mockResolvedValueOnce({
        rows: [{ id: 'item-123', owner_id: 'different-user' }]
      });

      const response = await request(app)
        .post('/v1/vfs/items/item-123/rekey')
        .set('Authorization', authHeader)
        .send(validPayload);

      expect(response.status).toBe(403);
      expect(response.body).toEqual({
        error: 'Not authorized to rekey this item'
      });
    });

    it('returns 200 and updates wrapped keys for owner', async () => {
      const authHeader = await createAuthHeader();

      // Item lookup - user is owner
      mockQuery.mockResolvedValueOnce({
        rows: [{ id: 'item-123', owner_id: mockUserId }]
      });

      // Update wrapped key for recipient
      mockQuery.mockResolvedValueOnce({
        rows: [{ id: 'acl-entry-1' }],
        rowCount: 1
      });

      const response = await request(app)
        .post('/v1/vfs/items/item-123/rekey')
        .set('Authorization', authHeader)
        .send(validPayload);

      expect(response.status).toBe(200);
      expect(response.body).toEqual({
        itemId: 'item-123',
        newEpoch: 2,
        wrapsApplied: 1
      });
      const updateCall = mockQuery.mock.calls[1];
      expect(updateCall?.[1]?.[0]).toBe('base64-encrypted-key');
      expect(updateCall?.[1]?.[1]).toBe(
        JSON.stringify({
          recipientPublicKeyId: 'pk-alice',
          senderSignature: 'base64-signature'
        })
      );
      expect(updateCall?.[1]?.[2]).toBe(2);
      expect(updateCall?.[1]?.[3]).toBe('item-123');
      expect(updateCall?.[1]?.[4]).toBe('user-alice');
    });

    it('returns 200 with zero wraps when no ACL entries match', async () => {
      const authHeader = await createAuthHeader();

      // Item lookup - user is owner
      mockQuery.mockResolvedValueOnce({
        rows: [{ id: 'item-123', owner_id: mockUserId }]
      });

      // Update finds no matching ACL entry
      mockQuery.mockResolvedValueOnce({
        rows: [],
        rowCount: 0
      });

      const response = await request(app)
        .post('/v1/vfs/items/item-123/rekey')
        .set('Authorization', authHeader)
        .send(validPayload);

      expect(response.status).toBe(200);
      expect(response.body).toEqual({
        itemId: 'item-123',
        newEpoch: 2,
        wrapsApplied: 0
      });
    });

    it('applies multiple wrapped keys for multiple recipients', async () => {
      const authHeader = await createAuthHeader();
      const multiRecipientPayload = {
        reason: 'expiry',
        newEpoch: 3,
        wrappedKeys: [
          {
            recipientUserId: 'user-alice',
            recipientPublicKeyId: 'pk-alice',
            keyEpoch: 3,
            encryptedKey: 'encrypted-for-alice',
            senderSignature: 'sig-alice'
          },
          {
            recipientUserId: 'user-bob',
            recipientPublicKeyId: 'pk-bob',
            keyEpoch: 3,
            encryptedKey: 'encrypted-for-bob',
            senderSignature: 'sig-bob'
          }
        ]
      };

      // Item lookup - user is owner
      mockQuery.mockResolvedValueOnce({
        rows: [{ id: 'item-456', owner_id: mockUserId }]
      });

      // Update for alice
      mockQuery.mockResolvedValueOnce({
        rows: [{ id: 'acl-alice' }],
        rowCount: 1
      });

      // Update for bob
      mockQuery.mockResolvedValueOnce({
        rows: [{ id: 'acl-bob' }],
        rowCount: 1
      });

      const response = await request(app)
        .post('/v1/vfs/items/item-456/rekey')
        .set('Authorization', authHeader)
        .send(multiRecipientPayload);

      expect(response.status).toBe(200);
      expect(response.body).toEqual({
        itemId: 'item-456',
        newEpoch: 3,
        wrapsApplied: 2
      });
    });

    it('accepts all valid reason values', async () => {
      const authHeader = await createAuthHeader();
      const reasons = ['unshare', 'expiry', 'manual'];

      for (const reason of reasons) {
        mockQuery.mockResolvedValueOnce({
          rows: [{ id: 'item-123', owner_id: mockUserId }]
        });

        const response = await request(app)
          .post('/v1/vfs/items/item-123/rekey')
          .set('Authorization', authHeader)
          .send({
            reason,
            newEpoch: 2,
            wrappedKeys: []
          });

        expect(response.status).toBe(200);
      }
    });
  });
});
