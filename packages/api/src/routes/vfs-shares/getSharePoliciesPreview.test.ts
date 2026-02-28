import './testSupport.js';
import request from 'supertest';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { app } from '../../index.js';
import { createAuthHeader } from '../../test/auth.js';
import { mockConsoleError } from '../../test/consoleMocks.js';
import {
  mockQuery,
  setupVfsSharesTestEnv,
  teardownVfsSharesTestEnv
} from './testSupport.js';

describe('VFS Shares routes (GET/share policy preview)', () => {
  beforeEach(() => {
    setupVfsSharesTestEnv();
  });

  afterEach(() => {
    teardownVfsSharesTestEnv();
  });

  it('returns 401 when not authenticated', async () => {
    const response = await request(app).get('/v1/vfs/share-policies/preview');

    expect(response.status).toBe(401);
    expect(response.body).toEqual({ error: 'Unauthorized' });
  });

  it('returns 400 for missing required query params', async () => {
    const authHeader = await createAuthHeader();

    const response = await request(app)
      .get('/v1/vfs/share-policies/preview?principalType=user')
      .set('Authorization', authHeader);

    expect(response.status).toBe(400);
    expect(response.body).toEqual({
      error: 'rootItemId and principalId are required'
    });
  });

  it('returns 403 when user is not the root item owner', async () => {
    const authHeader = await createAuthHeader();
    mockQuery.mockResolvedValueOnce({
      rows: [{ owner_id: 'different-user', object_type: 'contact' }]
    });

    const response = await request(app)
      .get(
        '/v1/vfs/share-policies/preview?rootItemId=root-1&principalType=user&principalId=target-1'
      )
      .set('Authorization', authHeader);

    expect(response.status).toBe(403);
    expect(response.body).toEqual({
      error: 'Not authorized to preview this root container'
    });
  });

  it('returns effective preview tree with summary and pagination cursor', async () => {
    const authHeader = await createAuthHeader();
    mockQuery.mockResolvedValueOnce({
      rows: [{ owner_id: 'user-1', object_type: 'contact' }]
    });
    mockQuery.mockResolvedValueOnce({
      rows: [
        {
          item_id: 'root-1',
          object_type: 'contact',
          depth: 0,
          node_path: 'root-1'
        },
        {
          item_id: 'wallet-1',
          object_type: 'walletItem',
          depth: 1,
          node_path: 'root-1/wallet-1'
        },
        {
          item_id: 'workout-1',
          object_type: 'healthWorkoutEntry',
          depth: 1,
          node_path: 'root-1/workout-1'
        }
      ]
    });
    mockQuery.mockResolvedValueOnce({
      rows: [{ total_count: '3' }]
    });
    mockQuery.mockResolvedValueOnce({
      rows: [
        {
          id: 'share:share-root',
          item_id: 'root-1',
          access_level: 'read',
          revoked_at: null
        },
        {
          id: 'policy-compiled:user:target-1:wallet-1',
          item_id: 'wallet-1',
          access_level: 'write',
          revoked_at: null
        }
      ]
    });
    mockQuery.mockResolvedValueOnce({
      rows: [
        {
          acl_entry_id: 'policy-compiled:user:target-1:wallet-1',
          policy_id: 'policy-1'
        }
      ]
    });

    const response = await request(app)
      .get(
        '/v1/vfs/share-policies/preview?rootItemId=root-1&principalType=user&principalId=target-1&limit=2&objectType=walletItem,contact'
      )
      .set('Authorization', authHeader);

    expect(response.status).toBe(200);
    expect(response.body.nextCursor).toBe('root-1/wallet-1');
    expect(response.body.nodes).toEqual([
      {
        itemId: 'root-1',
        objectType: 'contact',
        depth: 0,
        path: 'root-1',
        state: 'direct',
        effectiveAccessLevel: 'read',
        sourcePolicyIds: []
      },
      {
        itemId: 'wallet-1',
        objectType: 'walletItem',
        depth: 1,
        path: 'root-1/wallet-1',
        state: 'derived',
        effectiveAccessLevel: 'write',
        sourcePolicyIds: ['policy-1']
      }
    ]);
    expect(response.body.summary).toEqual({
      totalMatchingNodes: 3,
      returnedNodes: 2,
      directCount: 1,
      derivedCount: 1,
      deniedCount: 0,
      includedCount: 2,
      excludedCount: 0
    });

    const treeQuerySql = mockQuery.mock.calls[1]?.[0];
    if (typeof treeQuerySql !== 'string') {
      throw new Error('expected tree query SQL');
    }
    expect(treeQuerySql).toContain('WITH RECURSIVE tree AS');
    expect(treeQuerySql).toContain('JOIN vfs_links');

    const treeQueryValues = mockQuery.mock.calls[1]?.[1];
    expect(treeQueryValues?.[3]).toEqual(['contact', 'walletItem']);
  });

  it('returns 500 on preview query errors', async () => {
    const restoreConsole = mockConsoleError();
    const authHeader = await createAuthHeader();
    mockQuery.mockRejectedValueOnce(new Error('db blew up'));

    const response = await request(app)
      .get(
        '/v1/vfs/share-policies/preview?rootItemId=root-1&principalType=user&principalId=target-1'
      )
      .set('Authorization', authHeader);

    expect(response.status).toBe(500);
    expect(response.body).toEqual({ error: 'Failed to build share preview' });
    restoreConsole();
  });

  it('returns 400 when root item is not a supported container type', async () => {
    const authHeader = await createAuthHeader();
    mockQuery.mockResolvedValueOnce({
      rows: [{ owner_id: 'user-1', object_type: 'note' }]
    });

    const response = await request(app)
      .get(
        '/v1/vfs/share-policies/preview?rootItemId=root-1&principalType=user&principalId=target-1'
      )
      .set('Authorization', authHeader);

    expect(response.status).toBe(400);
    expect(response.body).toEqual({
      error: 'Root item must be a container object type'
    });
  });
});
