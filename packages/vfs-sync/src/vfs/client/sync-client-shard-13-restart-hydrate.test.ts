import { describe, expect, it } from 'vitest';
import type { VfsCrdtSyncTransport } from './sync-client-test-support.js';
import {
  buildAclAddSyncItem,
  captureExportedSyncClientState,
  createGuardrailViolationCollector,
  expectExportedSyncClientStateUnchanged,
  InMemoryVfsCrdtSyncServer,
  InMemoryVfsCrdtSyncTransport,
  VfsBackgroundSyncClient
} from './sync-client-test-support.js';

describe('VfsBackgroundSyncClient bidirectional contract: restart/hydrate', () => {
  it('hydrated client with pending queue converges after flush', async () => {
    const server = new InMemoryVfsCrdtSyncServer();

    // Create seed client and establish state
    const seedClient = new VfsBackgroundSyncClient(
      'user-1',
      'desktop',
      new InMemoryVfsCrdtSyncTransport(server),
      { pullLimit: 10 }
    );

    // Seed server with initial operations
    await server.pushOperations({
      operations: [
        {
          opId: 'seed-op-1',
          opType: 'acl_add',
          itemId: 'item-seed',
          replicaId: 'remote',
          writeId: 1,
          occurredAt: '2026-02-20T16:00:00.000Z',
          principalType: 'group',
          principalId: 'group-seed',
          accessLevel: 'read'
        }
      ]
    });

    await seedClient.sync();

    // Queue a pending operation (simulating pre-restart state)
    seedClient.queueLocalOperation({
      opType: 'acl_add',
      itemId: 'item-pending',
      principalType: 'user',
      principalId: 'user-pending',
      accessLevel: 'write',
      occurredAt: '2026-02-20T16:01:00.000Z'
    });

    const seedState = seedClient.exportState();
    expect(seedState.pendingOperations).toHaveLength(1);

    // Simulate restart: create new client and hydrate
    const resumedClient = new VfsBackgroundSyncClient(
      'user-1',
      'desktop',
      new InMemoryVfsCrdtSyncTransport(server),
      { pullLimit: 10 }
    );
    resumedClient.hydrateState(seedState);

    // Verify pending operation was hydrated
    const hydratedSnapshot = resumedClient.snapshot();
    expect(hydratedSnapshot.pendingOperations).toBe(1);

    // Flush to push pending operation
    const flushResult = await resumedClient.flush();
    expect(flushResult.pushedOperations).toBe(1);

    // Verify convergence - both items present
    const finalSnapshot = resumedClient.snapshot();
    expect(finalSnapshot.pendingOperations).toBe(0);
    expect(finalSnapshot.acl).toContainEqual(
      expect.objectContaining({ itemId: 'item-seed' })
    );
    expect(finalSnapshot.acl).toContainEqual(
      expect.objectContaining({ itemId: 'item-pending' })
    );
  });

  it('hydrated client pulls new remote operations after restart', async () => {
    const server = new InMemoryVfsCrdtSyncServer();

    // Create and sync seed client
    const seedClient = new VfsBackgroundSyncClient(
      'user-1',
      'desktop',
      new InMemoryVfsCrdtSyncTransport(server),
      { pullLimit: 10 }
    );

    await server.pushOperations({
      operations: [
        {
          opId: 'initial-op',
          opType: 'acl_add',
          itemId: 'item-initial',
          replicaId: 'remote',
          writeId: 1,
          occurredAt: '2026-02-20T16:10:00.000Z',
          principalType: 'group',
          principalId: 'group-initial',
          accessLevel: 'read'
        }
      ]
    });

    await seedClient.sync();
    const seedState = seedClient.exportState();

    // Inject new operations to server (simulating changes while client offline)
    await server.pushOperations({
      operations: [
        {
          opId: 'new-remote-op',
          opType: 'acl_add',
          itemId: 'item-new-remote',
          replicaId: 'mobile',
          writeId: 1,
          occurredAt: '2026-02-20T16:11:00.000Z',
          principalType: 'user',
          principalId: 'user-new',
          accessLevel: 'admin'
        }
      ]
    });

    // Simulate restart with hydration
    const resumedClient = new VfsBackgroundSyncClient(
      'user-1',
      'desktop',
      new InMemoryVfsCrdtSyncTransport(server),
      { pullLimit: 10 }
    );
    resumedClient.hydrateState(seedState);

    // Verify hydrated state only has initial item
    const hydratedSnapshot = resumedClient.snapshot();
    expect(hydratedSnapshot.acl).toHaveLength(1);
    expect(hydratedSnapshot.acl).toContainEqual(
      expect.objectContaining({ itemId: 'item-initial' })
    );

    // Sync to pull new remote operations
    const syncResult = await resumedClient.sync();
    expect(syncResult.pulledOperations).toBe(1);

    // Verify both items present after sync
    const finalSnapshot = resumedClient.snapshot();
    expect(finalSnapshot.acl).toHaveLength(2);
    expect(finalSnapshot.acl).toContainEqual(
      expect.objectContaining({ itemId: 'item-initial' })
    );
    expect(finalSnapshot.acl).toContainEqual(
      expect.objectContaining({ itemId: 'item-new-remote' })
    );
  });

  it('preserves exported state through hydration roundtrip', async () => {
    const server = new InMemoryVfsCrdtSyncServer();

    // Create client with complex state
    const originalClient = new VfsBackgroundSyncClient(
      'user-1',
      'desktop',
      new InMemoryVfsCrdtSyncTransport(server),
      { pullLimit: 10 }
    );

    await server.pushOperations({
      operations: [
        {
          opId: 'op-1',
          opType: 'acl_add',
          itemId: 'item-1',
          replicaId: 'remote',
          writeId: 1,
          occurredAt: '2026-02-20T16:20:00.000Z',
          principalType: 'group',
          principalId: 'group-1',
          accessLevel: 'read'
        },
        {
          opId: 'op-2',
          opType: 'acl_add',
          itemId: 'item-2',
          replicaId: 'mobile',
          writeId: 2,
          occurredAt: '2026-02-20T16:21:00.000Z',
          principalType: 'user',
          principalId: 'user-2',
          accessLevel: 'write'
        }
      ]
    });

    await originalClient.sync();

    // Add pending operation
    originalClient.queueLocalOperation({
      opType: 'acl_add',
      itemId: 'item-pending',
      principalType: 'organization',
      principalId: 'org-1',
      accessLevel: 'admin',
      occurredAt: '2026-02-20T16:22:00.000Z'
    });

    const exportedState = captureExportedSyncClientState(originalClient);

    // Hydrate into new client
    const hydratedClient = new VfsBackgroundSyncClient(
      'user-1',
      'desktop',
      new InMemoryVfsCrdtSyncTransport(server),
      { pullLimit: 10 }
    );
    hydratedClient.hydrateState(originalClient.exportState());

    // Verify state is preserved through roundtrip
    expectExportedSyncClientStateUnchanged({
      client: hydratedClient,
      before: exportedState
    });
  });

  it('handles guardrail failure during resumed sync without corrupting state', async () => {
    const server = new InMemoryVfsCrdtSyncServer();

    // Seed initial state
    await server.pushOperations({
      operations: [
        {
          opId: 'seed-op',
          opType: 'acl_add',
          itemId: 'item-seed',
          replicaId: 'remote',
          writeId: 1,
          occurredAt: '2026-02-20T16:30:00.000Z',
          principalType: 'group',
          principalId: 'group-seed',
          accessLevel: 'read'
        }
      ]
    });

    const seedClient = new VfsBackgroundSyncClient(
      'user-1',
      'desktop',
      new InMemoryVfsCrdtSyncTransport(server),
      { pullLimit: 10 }
    );
    await seedClient.sync();
    const seedState = seedClient.exportState();

    // Create malformed transport that triggers guardrail
    let pullCount = 0;
    const guardrailCollector = createGuardrailViolationCollector();
    const malformedTransport: VfsCrdtSyncTransport = {
      pushOperations: async () => ({ results: [] }),
      pullOperations: async () => {
        pullCount += 1;
        if (pullCount === 1) {
          return {
            items: [
              buildAclAddSyncItem({
                opId: 'new-op',
                occurredAt: '2026-02-20T16:31:00.000Z',
                itemId: 'item-new'
              })
            ],
            hasMore: true,
            nextCursor: {
              changedAt: '2026-02-20T16:31:00.000Z',
              changeId: 'new-op'
            },
            lastReconciledWriteIds: { desktop: 1 }
          };
        }
        // Second page triggers cursor regression guardrail
        return {
          items: [],
          hasMore: false,
          nextCursor: {
            changedAt: '2026-02-20T16:30:30.000Z',
            changeId: 'regressed-cursor'
          },
          lastReconciledWriteIds: { desktop: 1 }
        };
      }
    };

    // Hydrate and attempt sync with malformed transport
    const resumedClient = new VfsBackgroundSyncClient(
      'user-1',
      'desktop',
      malformedTransport,
      {
        pullLimit: 1,
        onGuardrailViolation: guardrailCollector.onGuardrailViolation
      }
    );
    resumedClient.hydrateState(seedState);

    // Sync should fail with guardrail
    await expect(resumedClient.sync()).rejects.toThrow(
      /transport returned regressing sync cursor/
    );

    // Guardrail was emitted
    expect(guardrailCollector.violations).toContainEqual(
      expect.objectContaining({ code: 'pullCursorRegression' })
    );

    // State is at first page tail (first page applied before failure)
    const stateAfterFailure = resumedClient.snapshot();
    expect(stateAfterFailure.cursor).toEqual({
      changedAt: '2026-02-20T16:31:00.000Z',
      changeId: 'new-op'
    });

    // ACL contains seed item and first page item, but not corrupted
    expect(stateAfterFailure.acl).toContainEqual(
      expect.objectContaining({ itemId: 'item-seed' })
    );
    expect(stateAfterFailure.acl).toContainEqual(
      expect.objectContaining({ itemId: 'item-new' })
    );
  });
});
