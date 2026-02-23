import { describe, expect, it } from 'vitest';
import {
  InMemoryVfsCrdtSyncServer,
  InMemoryVfsCrdtSyncTransport,
  VfsBackgroundSyncClient
} from './sync-client-test-support.js';

describe('VfsBackgroundSyncClient bidirectional contract: local queue + sync', () => {
  it('propagates local operations to server and receives reconcile checkpoint update', async () => {
    const server = new InMemoryVfsCrdtSyncServer();
    const client = new VfsBackgroundSyncClient(
      'user-1',
      'desktop',
      new InMemoryVfsCrdtSyncTransport(server),
      { pullLimit: 10 }
    );

    // Queue local operation
    client.queueLocalOperation({
      opType: 'acl_add',
      itemId: 'item-local-1',
      principalType: 'group',
      principalId: 'group-1',
      accessLevel: 'read',
      occurredAt: '2026-02-20T14:00:00.000Z'
    });

    // Flush to server
    const flushResult = await client.flush();
    expect(flushResult.pushedOperations).toBe(1);

    // Verify server received the operation
    const serverSnapshot = server.snapshot();
    expect(serverSnapshot.acl).toContainEqual(
      expect.objectContaining({ itemId: 'item-local-1' })
    );

    // Verify client state has updated reconcile checkpoint
    const clientSnapshot = client.snapshot();
    expect(clientSnapshot.cursor).toBeDefined();
    expect(clientSnapshot.acl).toContainEqual(
      expect.objectContaining({ itemId: 'item-local-1' })
    );
  });

  it('receives remote operations during sync and updates client reconcile state', async () => {
    const server = new InMemoryVfsCrdtSyncServer();

    // Seed server with remote operations
    await server.pushOperations({
      operations: [
        {
          opId: 'remote-op-1',
          opType: 'acl_add',
          itemId: 'item-remote-1',
          replicaId: 'mobile',
          writeId: 1,
          occurredAt: '2026-02-20T14:01:00.000Z',
          principalType: 'group',
          principalId: 'group-remote',
          accessLevel: 'write'
        },
        {
          opId: 'remote-op-2',
          opType: 'acl_add',
          itemId: 'item-remote-2',
          replicaId: 'mobile',
          writeId: 2,
          occurredAt: '2026-02-20T14:02:00.000Z',
          principalType: 'user',
          principalId: 'user-remote',
          accessLevel: 'admin'
        }
      ]
    });

    // Client syncs and receives remote operations
    const client = new VfsBackgroundSyncClient(
      'user-1',
      'desktop',
      new InMemoryVfsCrdtSyncTransport(server),
      { pullLimit: 10 }
    );

    const syncResult = await client.sync();
    expect(syncResult.pulledOperations).toBe(2);

    // Verify client has both remote operations
    const clientSnapshot = client.snapshot();
    expect(clientSnapshot.acl).toContainEqual(
      expect.objectContaining({ itemId: 'item-remote-1' })
    );
    expect(clientSnapshot.acl).toContainEqual(
      expect.objectContaining({ itemId: 'item-remote-2' })
    );

    // Verify cursor advanced to last operation
    expect(clientSnapshot.cursor).toEqual({
      changedAt: '2026-02-20T14:02:00.000Z',
      changeId: 'remote-op-2'
    });
  });

  it('handles interleaved local and remote operations with checkpoint convergence', async () => {
    const server = new InMemoryVfsCrdtSyncServer();
    const transport = new InMemoryVfsCrdtSyncTransport(server);

    // Client A pushes first
    const clientA = new VfsBackgroundSyncClient(
      'user-1',
      'desktop',
      transport,
      { pullLimit: 10 }
    );
    clientA.queueLocalOperation({
      opType: 'acl_add',
      itemId: 'item-A',
      principalType: 'group',
      principalId: 'group-A',
      accessLevel: 'read',
      occurredAt: '2026-02-20T14:05:00.000Z'
    });
    await clientA.flush();

    // Inject remote operation directly to server (simulating another client)
    await server.pushOperations({
      operations: [
        {
          opId: 'remote-B',
          opType: 'acl_add',
          itemId: 'item-B',
          replicaId: 'mobile',
          writeId: 1,
          occurredAt: '2026-02-20T14:06:00.000Z',
          principalType: 'user',
          principalId: 'user-B',
          accessLevel: 'write'
        }
      ]
    });

    // Client A syncs again - should pull remote-B
    const syncResult = await clientA.sync();
    expect(syncResult.pulledOperations).toBe(1);

    // Verify client A has both items
    const snapshot = clientA.snapshot();
    expect(snapshot.acl).toHaveLength(2);
    expect(snapshot.acl).toContainEqual(
      expect.objectContaining({ itemId: 'item-A' })
    );
    expect(snapshot.acl).toContainEqual(
      expect.objectContaining({ itemId: 'item-B' })
    );

    // Cursor should be at remote-B (latest)
    expect(snapshot.cursor).toEqual({
      changedAt: '2026-02-20T14:06:00.000Z',
      changeId: 'remote-B'
    });
  });
});
