import { Buffer } from 'node:buffer';
import { VfsBloomFilter, encodeVfsSyncCursor } from '@tearleads/vfs-sync/vfs';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const applyCrdtPushOperationsMock = vi.fn();
const clientQueryMock = vi.fn();
const clientReleaseMock = vi.fn();
const connectMock = vi.fn();
const getPostgresPoolMock = vi.fn();
const invalidateReplicaWriteIdRowsForUserMock = vi.fn();
const loadReplicaWriteIdRowsMock = vi.fn();
const publishVfsContainerCursorBumpMock = vi.fn();
const requireVfsClaimsMock = vi.fn();

vi.mock('../../lib/postgres.js', () => ({
  getPostgresPool: (...args: unknown[]) => getPostgresPoolMock(...args)
}));

vi.mock('../../lib/vfsCrdtReplicaWriteIds.js', () => ({
  invalidateReplicaWriteIdRowsForUser: (...args: unknown[]) =>
    invalidateReplicaWriteIdRowsForUserMock(...args),
  loadReplicaWriteIdRows: (...args: unknown[]) =>
    loadReplicaWriteIdRowsMock(...args)
}));

vi.mock('../../lib/vfsSyncChannels.js', () => ({
  publishVfsContainerCursorBump: (...args: unknown[]) =>
    publishVfsContainerCursorBumpMock(...args)
}));

vi.mock('./vfsDirectCrdtPushApply.js', () => ({
  applyCrdtPushOperations: (...args: unknown[]) =>
    applyCrdtPushOperationsMock(...args)
}));

vi.mock('./vfsDirectAuth.js', () => ({
  requireVfsClaims: (...args: unknown[]) => requireVfsClaimsMock(...args)
}));

import { runCrdtSessionDirect } from './vfsDirectCrdtSession.js';

const REQUEST_CONTEXT = {
  requestHeader: new Headers()
};

function toBase64(value: string): string {
  return Buffer.from(value, 'utf8').toString('base64');
}

function toBloomFilterPayload(opIds: string[]): {
  data: string;
  capacity: number;
  errorRate: number;
} {
  const capacity = 64;
  const errorRate = 0.01;
  const filter = new VfsBloomFilter({
    capacity,
    errorRate
  });
  for (const opId of opIds) {
    filter.add(opId);
  }

  return {
    data: Buffer.from(filter.toUint8Array()).toString('base64'),
    capacity,
    errorRate
  };
}

let consoleErrorSpy: ReturnType<typeof vi.spyOn> | null = null;

describe('vfsDirectCrdtSession compact pruning', () => {
  beforeEach(() => {
    vi.clearAllMocks();

    connectMock.mockResolvedValue({
      query: clientQueryMock,
      release: clientReleaseMock
    });
    getPostgresPoolMock.mockResolvedValue({
      connect: connectMock
    });
    requireVfsClaimsMock.mockResolvedValue({
      sub: 'user-1',
      organizationId: 'org-1'
    });
    applyCrdtPushOperationsMock.mockResolvedValue({
      results: [],
      notifications: [],
      queryMetrics: {
        totalQueries: 0,
        totalDurationMs: 0,
        perQuery: {}
      }
    });
    loadReplicaWriteIdRowsMock.mockResolvedValue([]);
    invalidateReplicaWriteIdRowsForUserMock.mockResolvedValue(undefined);
    publishVfsContainerCursorBumpMock.mockResolvedValue(undefined);
    consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    consoleErrorSpy?.mockRestore();
    consoleErrorSpy = null;
  });

  it('accepts compact ids and prunes bloom-matched replay rows', async () => {
    const op1 = '00000000-0000-0000-0000-000000000001';
    const op2 = '00000000-0000-0000-0000-000000000002';
    const op3 = '00000000-0000-0000-0000-000000000003';

    clientQueryMock
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({
        rows: [
          {
            op_id: op1,
            item_id: 'item-1',
            replica_id: 'client-1',
            write_id: 1,
            op_type: 'acl_add',
            principal_type: 'user',
            principal_id: 'user-2',
            access_level: 'read',
            parent_id: null,
            child_id: null,
            actor_id: 'user-1',
            source_table: 'vfs_acl_entries',
            source_id: 'row-1',
            occurred_at: new Date('2026-03-03T00:00:00.000Z')
          },
          {
            op_id: op2,
            item_id: 'item-2',
            replica_id: 'client-1',
            write_id: 3,
            op_type: 'acl_add',
            principal_type: 'user',
            principal_id: 'user-2',
            access_level: 'read',
            parent_id: null,
            child_id: null,
            actor_id: 'user-1',
            source_table: 'vfs_acl_entries',
            source_id: 'row-2',
            occurred_at: new Date('2026-03-03T00:00:01.000Z')
          },
          {
            op_id: op3,
            item_id: 'item-3',
            replica_id: 'client-1',
            write_id: 4,
            op_type: 'acl_add',
            principal_type: 'user',
            principal_id: 'user-2',
            access_level: 'read',
            parent_id: null,
            child_id: null,
            actor_id: 'user-1',
            source_table: 'vfs_acl_entries',
            source_id: 'row-3',
            occurred_at: new Date('2026-03-03T00:00:02.000Z')
          }
        ]
      })
      .mockResolvedValueOnce({
        rows: [
          {
            last_reconciled_at: new Date('2026-03-03T00:00:01.000Z'),
            last_reconciled_change_id: op2,
            last_reconciled_write_ids: { 'client-1': 4 }
          }
        ]
      })
      .mockResolvedValueOnce({ rows: [] });

    const inputCursor = encodeVfsSyncCursor({
      changedAt: '2026-03-03T00:00:00.000Z',
      changeId: 'seed-change-1'
    });
    const response = await runCrdtSessionDirect(
      {
        organizationIdBytes: toBase64('org-1'),
        clientIdBytes: toBase64('client-1'),
        operations: [],
        cursor: inputCursor,
        limit: 2,
        rootIdBytes: toBase64('root-compact-1'),
        lastReconciledWriteIds: {
          'client-1': 2
        },
        bloomFilter: toBloomFilterPayload([op1])
      },
      REQUEST_CONTEXT
    );

    expect(requireVfsClaimsMock).toHaveBeenCalledWith(
      '/connect/tearleads.v2.VfsService/RunCrdtSession',
      expect.any(Headers),
      {
        requireDeclaredOrganization: true,
        declaredOrganizationId: 'org-1'
      }
    );
    expect(clientQueryMock).toHaveBeenNthCalledWith(
      2,
      expect.any(String),
      expect.arrayContaining(['root-compact-1'])
    );
    expect(response.pull.hasMore).toBe(true);
    expect(response.pull.items.map((item) => item.opId)).toEqual([op2]);
  });
});
