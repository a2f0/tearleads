import {
  decodeVfsSyncCursor,
  encodeVfsSyncCursor
} from '@tearleads/vfs-sync/vfs';
import request from 'supertest';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createAuthHeader } from '../../test/auth.js';
import { mockConsoleError } from '../../test/consoleMocks.js';
import {
  mockClientRelease,
  mockQuery,
  setupCrdtPushRouteTestEnv,
  teardownCrdtPushRouteTestEnv
} from './crdtPushTestSupport.js';

describe('VFS CRDT sync session route edge cases', { timeout: 15_000 }, () => {
  beforeEach(() => {
    setupCrdtPushRouteTestEnv();
  });

  afterEach(() => {
    teardownCrdtPushRouteTestEnv();
  });

  it('defaults missing write ids and computes next cursor from pull page', async () => {
    const { app } = await import('../../index.js');
    const authHeader = await createAuthHeader();
    const cursor = encodeVfsSyncCursor({
      changedAt: '2026-02-14T20:10:00.000Z',
      changeId: 'desktop-1'
    });

    mockQuery
      .mockResolvedValueOnce({}) // BEGIN
      .mockResolvedValueOnce({
        rows: [
          {
            op_id: 'op-1',
            item_id: 'item-1',
            op_type: 'acl_add',
            principal_type: 'user',
            principal_id: 'user-2',
            access_level: 'write',
            parent_id: null,
            child_id: null,
            actor_id: 'user-1',
            source_table: 'vfs_crdt_client_push',
            source_id: 'share-1',
            occurred_at: new Date('2026-02-14T20:10:01.000Z')
          },
          {
            op_id: 'op-2',
            item_id: 'item-1',
            op_type: 'acl_remove',
            principal_type: 'user',
            principal_id: 'user-2',
            access_level: null,
            parent_id: null,
            child_id: null,
            actor_id: 'user-1',
            source_table: 'vfs_crdt_client_push',
            source_id: 'share-2',
            occurred_at: new Date('2026-02-14T20:10:02.000Z')
          }
        ]
      }) // pull query
      .mockResolvedValueOnce({
        rows: [
          { replica_id: ' desktop ', max_write_id: 2 },
          { replica_id: 'mobile', max_write_id: '7' },
          { replica_id: '', max_write_id: 4 },
          { replica_id: null, max_write_id: '3' },
          { replica_id: 'nan', max_write_id: 'abc' },
          { replica_id: 'zero', max_write_id: '0' },
          { replica_id: 'null-write', max_write_id: null },
          { replica_id: 'fraction', max_write_id: 1.5 },
          { replica_id: 'infinite', max_write_id: Number.POSITIVE_INFINITY },
          { replica_id: 'low', max_write_id: 0 }
        ]
      }) // replica write ids query
      .mockResolvedValueOnce({
        rows: [
          {
            last_reconciled_at: '2026-02-14T20:10:01.000Z',
            last_reconciled_change_id: 'op-1',
            last_reconciled_write_ids: { desktop: 2, mobile: 7 }
          }
        ]
      }) // reconcile upsert
      .mockResolvedValueOnce({}); // COMMIT

    const response = await request(app)
      .post('/v1/vfs/crdt/session')
      .set('Authorization', authHeader)
      .send({
        clientId: 'desktop',
        cursor,
        limit: 1,
        operations: [],
        rootId: 123
      });

    expect(response.status).toBe(200);
    expect(response.body.pull.hasMore).toBe(true);
    expect(response.body.pull.items).toHaveLength(1);
    expect(response.body.pull.lastReconciledWriteIds).toEqual({
      desktop: 2,
      mobile: 7
    });
    expect(typeof response.body.pull.nextCursor).toBe('string');
    expect(decodeVfsSyncCursor(response.body.pull.nextCursor)).toEqual({
      changedAt: '2026-02-14T20:10:01.000Z',
      changeId: 'op-1'
    });
    expect(response.body.reconcile).toEqual({
      clientId: 'desktop',
      cursor: response.body.pull.nextCursor,
      lastReconciledWriteIds: { desktop: 2, mobile: 7 }
    });
    expect(mockQuery.mock.calls[1]?.[1]).toContain(null);
    expect(mockClientRelease).toHaveBeenCalledTimes(1);
  });

  it('returns 500 when reconcile row timestamp cannot be parsed', async () => {
    const { app } = await import('../../index.js');
    const authHeader = await createAuthHeader();
    const cursor = encodeVfsSyncCursor({
      changedAt: '2026-02-14T20:10:00.000Z',
      changeId: 'desktop-1'
    });

    mockQuery
      .mockResolvedValueOnce({}) // BEGIN
      .mockResolvedValueOnce({ rows: [] }) // pull query
      .mockResolvedValueOnce({ rows: [] }) // replica write ids query
      .mockResolvedValueOnce({
        rows: [
          {
            last_reconciled_at: 'invalid-date',
            last_reconciled_change_id: 'desktop-1',
            last_reconciled_write_ids: { desktop: 1 }
          }
        ]
      }) // reconcile upsert
      .mockResolvedValueOnce({}); // ROLLBACK

    const consoleErrorSpy = mockConsoleError();
    const response = await request(app)
      .post('/v1/vfs/crdt/session')
      .set('Authorization', authHeader)
      .send({
        clientId: 'desktop',
        cursor,
        limit: 10,
        operations: [],
        lastReconciledWriteIds: { desktop: 1 }
      });

    expect(response.status).toBe(500);
    expect(response.body).toEqual({
      error: 'Failed to run CRDT sync session'
    });
    expect(mockQuery.mock.calls.map((entry) => entry[0])).toContain('ROLLBACK');
    expect(mockClientRelease).toHaveBeenCalledTimes(1);
    expect(consoleErrorSpy).toHaveBeenCalled();
    consoleErrorSpy.mockRestore();
  });

  it('returns 500 without rollback when BEGIN fails', async () => {
    const { app } = await import('../../index.js');
    const authHeader = await createAuthHeader();
    const cursor = encodeVfsSyncCursor({
      changedAt: '2026-02-14T20:10:00.000Z',
      changeId: 'desktop-1'
    });

    mockQuery.mockRejectedValueOnce(new Error('begin failed'));

    const consoleErrorSpy = mockConsoleError();
    const response = await request(app)
      .post('/v1/vfs/crdt/session')
      .set('Authorization', authHeader)
      .send({
        clientId: 'desktop',
        cursor,
        limit: 10,
        operations: []
      });

    expect(response.status).toBe(500);
    expect(response.body).toEqual({
      error: 'Failed to run CRDT sync session'
    });
    expect(mockQuery).toHaveBeenCalledTimes(1);
    expect(mockQuery.mock.calls.map((entry) => entry[0])).not.toContain(
      'ROLLBACK'
    );
    expect(mockClientRelease).toHaveBeenCalledTimes(1);
    expect(consoleErrorSpy).toHaveBeenCalled();
    consoleErrorSpy.mockRestore();
  });
});
