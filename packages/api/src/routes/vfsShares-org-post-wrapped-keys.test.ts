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

describe('VFS Shares routes (POST org-share wrapped keys)', () => {
  beforeEach(() => {
    setupVfsSharesTestEnv();
  });

  afterEach(() => {
    teardownVfsSharesTestEnv();
  });

  it('persists wrapped key metadata for encrypted org shares', async () => {
    const authHeader = await createAuthHeader();
    mockQuery.mockResolvedValueOnce({
      rows: [{ id: 'item-123', owner_id: 'user-1' }]
    });
    mockQuery.mockResolvedValueOnce({
      rows: [{ name: 'Source Org' }]
    });
    mockQuery.mockResolvedValueOnce({
      rows: [{ name: 'Target Org' }]
    });
    mockQuery.mockResolvedValueOnce({
      rows: [
        {
          acl_id: 'org-share:org-source:orgshare-new',
          target_org_id: 'org-target',
          item_id: 'item-123',
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
      recipientOrgId: 'org-target',
      recipientPublicKeyId: 'pk-org-target',
      keyEpoch: 4,
      encryptedKey: 'base64-org-encrypted-key',
      senderSignature: 'base64-org-signature'
    };

    const response = await request(app)
      .post('/v1/vfs/items/item-123/org-shares')
      .set('Authorization', authHeader)
      .send({
        itemId: 'item-123',
        sourceOrgId: 'org-source',
        targetOrgId: 'org-target',
        permissionLevel: 'view',
        wrappedKey
      });

    expect(response.status).toBe(201);
    expect(response.body.orgShare.wrappedKey).toEqual(wrappedKey);

    const aclInsertCall = mockQuery.mock.calls.find(
      (call) =>
        typeof call[0] === 'string' &&
        call[0].includes('INSERT INTO vfs_acl_entries')
    );
    expect(aclInsertCall).toBeDefined();
    expect(aclInsertCall?.[1]?.[5]).toBe('base64-org-encrypted-key');
    expect(aclInsertCall?.[1]?.[6]).toBe(
      JSON.stringify({
        recipientPublicKeyId: 'pk-org-target',
        senderSignature: 'base64-org-signature'
      })
    );
    expect(aclInsertCall?.[1]?.[7]).toBe(4);
  });

  it('returns 400 when wrapped key recipient does not match target org', async () => {
    const authHeader = await createAuthHeader();

    const response = await request(app)
      .post('/v1/vfs/items/item-123/org-shares')
      .set('Authorization', authHeader)
      .send({
        itemId: 'item-123',
        sourceOrgId: 'org-source',
        targetOrgId: 'org-target',
        permissionLevel: 'view',
        wrappedKey: {
          recipientOrgId: 'org-other',
          recipientPublicKeyId: 'pk-org-other',
          keyEpoch: 1,
          encryptedKey: 'encrypted',
          senderSignature: 'signature'
        }
      });

    expect(response.status).toBe(400);
    expect(mockQuery).not.toHaveBeenCalled();
  });

  it('returns 400 when org wrapped key keyEpoch is not a safe integer', async () => {
    const authHeader = await createAuthHeader();

    const response = await request(app)
      .post('/v1/vfs/items/item-123/org-shares')
      .set('Authorization', authHeader)
      .send({
        itemId: 'item-123',
        sourceOrgId: 'org-source',
        targetOrgId: 'org-target',
        permissionLevel: 'view',
        wrappedKey: {
          recipientOrgId: 'org-target',
          recipientPublicKeyId: 'pk-org-target',
          keyEpoch: Number.MAX_SAFE_INTEGER + 1,
          encryptedKey: 'encrypted',
          senderSignature: 'signature'
        }
      });

    expect(response.status).toBe(400);
    expect(mockQuery).not.toHaveBeenCalled();
  });
});
