import { describe, expect, it } from 'vitest';
import type { VfsCrdtSyncTransport } from './sync-client-test-support.js';
import {
  buildAclAddSyncItem,
  captureExportedSyncClientState,
  createGuardrailViolationCollector,
  expectExportedSyncClientStateUnchanged,
  InMemoryVfsCrdtSyncServer,
  InMemoryVfsCrdtSyncTransport,
  toStageCodeSignatures,
  VfsBackgroundSyncClient
} from './sync-client-test-support.js';

describe('VfsBackgroundSyncClient state preservation on guardrail violations', () => {
  it('preserves all state when duplicate op replay is detected across pages', async () => {
    // Seed initial state
    const seedServer = new InMemoryVfsCrdtSyncServer();
    await seedServer.pushOperations({
      operations: [
        {
          opId: 'seed-op-1',
          opType: 'acl_add',
          itemId: 'item-seed',
          replicaId: 'remote',
          writeId: 1,
          occurredAt: '2026-02-20T10:00:00.000Z',
          principalType: 'group',
          principalId: 'group-seed',
          accessLevel: 'read'
        }
      ]
    });
    const seedClient = new VfsBackgroundSyncClient(
      'user-1',
      'desktop',
      new InMemoryVfsCrdtSyncTransport(seedServer),
      { pullLimit: 10 }
    );
    await seedClient.sync();
    const seedState = seedClient.snapshot();
    expect(seedState.cursor).toBeDefined();
    expect(seedState.acl).toHaveLength(1);

    // Create transport that returns duplicate opId across pages
    let pullCount = 0;
    const guardrailCollector = createGuardrailViolationCollector();
    const duplicateTransport: VfsCrdtSyncTransport = {
      pushOperations: async () => ({ results: [] }),
      pullOperations: async () => {
        pullCount += 1;
        if (pullCount === 1) {
          return {
            items: [
              buildAclAddSyncItem({
                opId: 'duplicate-op',
                occurredAt: '2026-02-20T10:01:00.000Z',
                itemId: 'item-page-1'
              })
            ],
            hasMore: true,
            nextCursor: {
              changedAt: '2026-02-20T10:01:00.000Z',
              changeId: 'duplicate-op'
            },
            lastReconciledWriteIds: { desktop: 1 }
          };
        }

        // Second page returns same opId - should trigger guardrail
        return {
          items: [
            buildAclAddSyncItem({
              opId: 'duplicate-op',
              occurredAt: '2026-02-20T10:02:00.000Z',
              itemId: 'item-page-2-should-not-apply'
            })
          ],
          hasMore: false,
          nextCursor: {
            changedAt: '2026-02-20T10:02:00.000Z',
            changeId: 'duplicate-op'
          },
          lastReconciledWriteIds: { desktop: 2 }
        };
      }
    };

    const targetClient = new VfsBackgroundSyncClient(
      'user-1',
      'desktop',
      duplicateTransport,
      {
        pullLimit: 1,
        onGuardrailViolation: guardrailCollector.onGuardrailViolation
      }
    );
    targetClient.hydrateState(seedClient.exportState());

    // Trigger guardrail
    // Note: first page IS applied before second page triggers the guardrail,
    // so we verify cursor is at first page tail and second page items weren't applied
    await expect(targetClient.sync()).rejects.toThrow(
      /replayed opId duplicate-op during pull pagination/
    );

    // Verify guardrail was emitted
    expect(toStageCodeSignatures(guardrailCollector.violations)).toEqual([
      'pull:pullDuplicateOpReplay'
    ]);

    // Verify ALL state is preserved - cursor should be at first page tail
    // (first page was applied before second page triggered the guardrail)
    const finalState = targetClient.snapshot();
    expect(finalState.cursor).toEqual({
      changedAt: '2026-02-20T10:01:00.000Z',
      changeId: 'duplicate-op'
    });

    // ACL should contain seed item and first page item, but NOT second page item
    expect(finalState.acl).toContainEqual(
      expect.objectContaining({ itemId: 'item-seed' })
    );
    expect(finalState.acl).toContainEqual(
      expect.objectContaining({ itemId: 'item-page-1' })
    );
    expect(finalState.acl).not.toContainEqual(
      expect.objectContaining({ itemId: 'item-page-2-should-not-apply' })
    );
  });

  it('preserves all state when hasMore=true with empty items is received', async () => {
    // Seed initial state
    const seedServer = new InMemoryVfsCrdtSyncServer();
    await seedServer.pushOperations({
      operations: [
        {
          opId: 'seed-op-1',
          opType: 'acl_add',
          itemId: 'item-seed',
          replicaId: 'remote',
          writeId: 1,
          occurredAt: '2026-02-20T11:00:00.000Z',
          principalType: 'group',
          principalId: 'group-seed',
          accessLevel: 'read'
        }
      ]
    });
    const seedClient = new VfsBackgroundSyncClient(
      'user-1',
      'desktop',
      new InMemoryVfsCrdtSyncTransport(seedServer),
      { pullLimit: 10 }
    );
    await seedClient.sync();
    const seedState = seedClient.snapshot();
    expect(seedState.cursor).toBeDefined();
    expect(seedState.acl).toHaveLength(1);

    // Create transport that returns hasMore=true with empty items
    const guardrailCollector = createGuardrailViolationCollector();
    const malformedTransport: VfsCrdtSyncTransport = {
      pushOperations: async () => ({ results: [] }),
      pullOperations: async () => ({
        items: [],
        hasMore: true,
        nextCursor: null,
        lastReconciledWriteIds: {}
      })
    };

    const targetClient = new VfsBackgroundSyncClient(
      'user-1',
      'desktop',
      malformedTransport,
      {
        pullLimit: 10,
        onGuardrailViolation: guardrailCollector.onGuardrailViolation
      }
    );
    targetClient.hydrateState(seedClient.exportState());
    const stateBeforeViolation = captureExportedSyncClientState(targetClient);

    // Trigger guardrail
    await expect(targetClient.sync()).rejects.toThrow(
      /hasMore=true with an empty pull page/
    );

    // Verify guardrail was emitted
    expect(toStageCodeSignatures(guardrailCollector.violations)).toEqual([
      'pull:pullPageInvariantViolation'
    ]);

    // Verify ALL state is preserved - should be identical to before violation
    expectExportedSyncClientStateUnchanged({
      client: targetClient,
      before: stateBeforeViolation
    });

    // Double-check snapshot matches seed state
    const finalState = targetClient.snapshot();
    expect(finalState.cursor).toEqual(seedState.cursor);
    expect(finalState.lastReconciledWriteIds).toEqual(
      seedState.lastReconciledWriteIds
    );
    expect(finalState.acl).toEqual(seedState.acl);
  });

  it('preserves all state when cursor regression is detected across pages', async () => {
    // Seed initial state
    const seedServer = new InMemoryVfsCrdtSyncServer();
    await seedServer.pushOperations({
      operations: [
        {
          opId: 'seed-op-1',
          opType: 'acl_add',
          itemId: 'item-seed',
          replicaId: 'remote',
          writeId: 1,
          occurredAt: '2026-02-20T12:00:00.000Z',
          principalType: 'group',
          principalId: 'group-seed',
          accessLevel: 'read'
        }
      ]
    });
    const seedClient = new VfsBackgroundSyncClient(
      'user-1',
      'desktop',
      new InMemoryVfsCrdtSyncTransport(seedServer),
      { pullLimit: 10 }
    );
    await seedClient.sync();
    const seedState = seedClient.snapshot();
    expect(seedState.cursor).toBeDefined();
    expect(seedState.acl).toHaveLength(1);

    // Create transport that returns regressing cursor
    let pullCount = 0;
    const guardrailCollector = createGuardrailViolationCollector();
    const regressingTransport: VfsCrdtSyncTransport = {
      pushOperations: async () => ({ results: [] }),
      pullOperations: async () => {
        pullCount += 1;
        if (pullCount === 1) {
          return {
            items: [
              buildAclAddSyncItem({
                opId: 'forward-op',
                occurredAt: '2026-02-20T12:01:00.000Z',
                itemId: 'item-page-1'
              })
            ],
            hasMore: true,
            nextCursor: {
              changedAt: '2026-02-20T12:01:00.000Z',
              changeId: 'forward-op'
            },
            lastReconciledWriteIds: { desktop: 1 }
          };
        }

        // Second page returns cursor that regresses (earlier timestamp)
        return {
          items: [],
          hasMore: false,
          nextCursor: {
            changedAt: '2026-02-20T12:00:30.000Z',
            changeId: 'regressed-cursor'
          },
          lastReconciledWriteIds: { desktop: 1 }
        };
      }
    };

    const targetClient = new VfsBackgroundSyncClient(
      'user-1',
      'desktop',
      regressingTransport,
      {
        pullLimit: 1,
        onGuardrailViolation: guardrailCollector.onGuardrailViolation
      }
    );
    targetClient.hydrateState(seedClient.exportState());

    // Trigger guardrail
    await expect(targetClient.sync()).rejects.toThrow(
      /transport returned regressing sync cursor/
    );

    // Verify guardrail was emitted
    expect(toStageCodeSignatures(guardrailCollector.violations)).toEqual([
      'pull:pullCursorRegression'
    ]);

    // Verify cursor is at first page tail (first page was applied before regression detected)
    const finalState = targetClient.snapshot();
    expect(finalState.cursor).toEqual({
      changedAt: '2026-02-20T12:01:00.000Z',
      changeId: 'forward-op'
    });

    // ACL should contain seed item and first page item
    expect(finalState.acl).toContainEqual(
      expect.objectContaining({ itemId: 'item-seed' })
    );
    expect(finalState.acl).toContainEqual(
      expect.objectContaining({ itemId: 'item-page-1' })
    );
  });

  it('preserves all state when nextCursor mismatches page tail cursor', async () => {
    // Seed initial state
    const seedServer = new InMemoryVfsCrdtSyncServer();
    await seedServer.pushOperations({
      operations: [
        {
          opId: 'seed-op-1',
          opType: 'acl_add',
          itemId: 'item-seed',
          replicaId: 'remote',
          writeId: 1,
          occurredAt: '2026-02-20T13:00:00.000Z',
          principalType: 'group',
          principalId: 'group-seed',
          accessLevel: 'read'
        }
      ]
    });
    const seedClient = new VfsBackgroundSyncClient(
      'user-1',
      'desktop',
      new InMemoryVfsCrdtSyncTransport(seedServer),
      { pullLimit: 10 }
    );
    await seedClient.sync();
    const seedState = seedClient.snapshot();
    expect(seedState.cursor).toBeDefined();

    // Create transport that returns nextCursor mismatching page tail
    const guardrailCollector = createGuardrailViolationCollector();
    const mismatchedTransport: VfsCrdtSyncTransport = {
      pushOperations: async () => ({ results: [] }),
      pullOperations: async () => ({
        items: [
          buildAclAddSyncItem({
            opId: 'page-op',
            occurredAt: '2026-02-20T13:01:00.000Z',
            itemId: 'item-should-not-apply'
          })
        ],
        hasMore: true,
        // nextCursor doesn't match the item's cursor
        nextCursor: {
          changedAt: '2026-02-20T13:02:00.000Z',
          changeId: 'mismatched-cursor'
        },
        lastReconciledWriteIds: { desktop: 1 }
      })
    };

    const targetClient = new VfsBackgroundSyncClient(
      'user-1',
      'desktop',
      mismatchedTransport,
      {
        pullLimit: 10,
        onGuardrailViolation: guardrailCollector.onGuardrailViolation
      }
    );
    targetClient.hydrateState(seedClient.exportState());
    const stateBeforeViolation = captureExportedSyncClientState(targetClient);

    // Trigger guardrail
    await expect(targetClient.sync()).rejects.toThrow(
      /nextCursor that does not match pull page tail/
    );

    // Verify guardrail was emitted
    expect(toStageCodeSignatures(guardrailCollector.violations)).toEqual([
      'pull:pullPageInvariantViolation'
    ]);

    // Verify ALL state is preserved - should be identical to before violation
    expectExportedSyncClientStateUnchanged({
      client: targetClient,
      before: stateBeforeViolation
    });

    // Double-check that invalid item was NOT applied
    const finalState = targetClient.snapshot();
    expect(finalState.acl).not.toContainEqual(
      expect.objectContaining({ itemId: 'item-should-not-apply' })
    );
    expect(finalState.cursor).toEqual(seedState.cursor);
  });
});
