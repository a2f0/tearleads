import { describe, expect, it } from 'vitest';
import type { VfsCrdtSyncTransport } from './sync-client-test-support.js';
import {
  InMemoryVfsCrdtSyncServer,
  InMemoryVfsCrdtSyncTransport,
  VfsBackgroundSyncClient
} from './sync-client-test-support.js';

describe('VfsBackgroundSyncClient bidirectional contract: blob visibility', () => {
  it('client reconcile state gates visibility for staged blob attach', async () => {
    const server = new InMemoryVfsCrdtSyncServer();

    // Seed server with operations that establish visibility baseline
    await server.pushOperations({
      operations: [
        {
          opId: 'baseline-op-1',
          opType: 'acl_add',
          itemId: 'item-baseline',
          replicaId: 'remote',
          writeId: 1,
          occurredAt: '2026-02-20T15:00:00.000Z',
          principalType: 'group',
          principalId: 'group-baseline',
          accessLevel: 'read'
        }
      ]
    });

    // Client syncs to establish reconcile state
    const client = new VfsBackgroundSyncClient(
      'user-1',
      'desktop',
      new InMemoryVfsCrdtSyncTransport(server),
      { pullLimit: 10 }
    );
    await client.sync();

    const stateAfterSync = client.snapshot();
    expect(stateAfterSync.cursor).toEqual({
      changedAt: '2026-02-20T15:00:00.000Z',
      changeId: 'baseline-op-1'
    });

    // Client's reconcile state can be used as visibility gate for blob attach
    // This verifies the bidirectional contract: client cursor >= required cursor
    const requiredCursor = {
      changedAt: '2026-02-20T14:59:59.000Z',
      changeId: 'earlier-op'
    };

    // Client cursor is ahead of required - would allow attach
    const clientCursor = stateAfterSync.cursor;
    expect(clientCursor).toBeDefined();
    expect((clientCursor?.changedAt ?? '') >= requiredCursor.changedAt).toBe(
      true
    );
  });

  it('client behind required visibility fails attach precondition', async () => {
    const server = new InMemoryVfsCrdtSyncServer();
    const client = new VfsBackgroundSyncClient(
      'user-1',
      'desktop',
      new InMemoryVfsCrdtSyncTransport(server),
      { pullLimit: 10 }
    );

    // Client has no sync yet - cursor is null
    const stateBeforeSync = client.snapshot();
    expect(stateBeforeSync.cursor).toBeNull();

    // Required cursor from server - client would fail visibility check
    const requiredCursor = {
      changedAt: '2026-02-20T15:00:00.000Z',
      changeId: 'required-op'
    };

    // Client cursor is null/behind - would block attach
    const clientCursor = stateBeforeSync.cursor;
    const meetsVisibility =
      clientCursor !== null &&
      clientCursor.changedAt >= requiredCursor.changedAt;
    expect(meetsVisibility).toBe(false);

    // Now seed server and sync
    await server.pushOperations({
      operations: [
        {
          opId: 'required-op',
          opType: 'acl_add',
          itemId: 'item-required',
          replicaId: 'remote',
          writeId: 1,
          occurredAt: '2026-02-20T15:00:00.000Z',
          principalType: 'group',
          principalId: 'group-required',
          accessLevel: 'read'
        }
      ]
    });

    await client.sync();

    // Now client meets visibility
    const stateAfterSync = client.snapshot();
    const updatedCursor = stateAfterSync.cursor;
    expect(updatedCursor).toBeDefined();
    const nowMeetsVisibility =
      updatedCursor !== null &&
      updatedCursor.changedAt >= requiredCursor.changedAt;
    expect(nowMeetsVisibility).toBe(true);
  });

  it('lastReconciledWriteIds tracks per-replica visibility for attach gating', async () => {
    const server = new InMemoryVfsCrdtSyncServer();

    // Create transport with reconcileState support
    const transport: VfsCrdtSyncTransport = {
      pushOperations: (input) =>
        server.pushOperations({ operations: input.operations }),
      pullOperations: (input) =>
        server.pullOperations({ cursor: input.cursor, limit: input.limit }),
      reconcileState: async (input) => ({
        cursor: input.cursor,
        lastReconciledWriteIds: { ...input.lastReconciledWriteIds }
      })
    };

    // Seed server with operations from multiple replicas
    await server.pushOperations({
      operations: [
        {
          opId: 'desktop-op-1',
          opType: 'acl_add',
          itemId: 'item-desktop',
          replicaId: 'desktop',
          writeId: 5,
          occurredAt: '2026-02-20T15:10:00.000Z',
          principalType: 'group',
          principalId: 'group-desktop',
          accessLevel: 'read'
        },
        {
          opId: 'mobile-op-1',
          opType: 'acl_add',
          itemId: 'item-mobile',
          replicaId: 'mobile',
          writeId: 3,
          occurredAt: '2026-02-20T15:11:00.000Z',
          principalType: 'user',
          principalId: 'user-mobile',
          accessLevel: 'write'
        }
      ]
    });

    const client = new VfsBackgroundSyncClient('user-1', 'desktop', transport, {
      pullLimit: 10
    });
    await client.sync();

    const snapshot = client.snapshot();

    // Verify per-replica write IDs are tracked
    expect(snapshot.lastReconciledWriteIds).toEqual(
      expect.objectContaining({
        desktop: expect.any(Number),
        mobile: expect.any(Number)
      })
    );

    // Required visibility: desktop >= 5, mobile >= 3
    const requiredWriteIds = { desktop: 5, mobile: 3 };
    const clientWriteIds = snapshot.lastReconciledWriteIds;

    const meetsAllReplicaVisibility = Object.entries(requiredWriteIds).every(
      ([replicaId, requiredWriteId]) =>
        (clientWriteIds[replicaId] ?? 0) >= requiredWriteId
    );
    expect(meetsAllReplicaVisibility).toBe(true);
  });
});
