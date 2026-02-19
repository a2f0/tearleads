import { describe, expect, it } from 'vitest';
import type { VfsCrdtSyncTransport } from './sync-client-test-support.js';
import {
  buildAclAddSyncItem,
  createGuardrailViolationCollector,
  toStageCodeSignatures,
  VfsBackgroundSyncClient,
  VfsCrdtSyncPushRejectedError
} from './sync-client-test-support.js';

describe('VfsBackgroundSyncClient guardrail telemetry signatures', () => {
  it('emits deterministic pull guardrail signatures for malformed pagination payloads', async () => {
    const guardrailCollector = createGuardrailViolationCollector();
    const transport: VfsCrdtSyncTransport = {
      pushOperations: async () => ({ results: [] }),
      pullOperations: async () => ({
        items: [],
        hasMore: true,
        nextCursor: null,
        lastReconciledWriteIds: {}
      })
    };

    const client = new VfsBackgroundSyncClient('user-1', 'desktop', transport, {
      onGuardrailViolation: guardrailCollector.onGuardrailViolation
    });

    await expect(client.sync()).rejects.toThrowError(
      /hasMore=true with an empty pull page/
    );
    expect(toStageCodeSignatures(guardrailCollector.violations)).toEqual([
      'pull:pullPageInvariantViolation'
    ]);
  });

  it('emits deterministic reconcile guardrail signatures for regressing acknowledgements', async () => {
    const guardrailCollector = createGuardrailViolationCollector();
    const transport: VfsCrdtSyncTransport = {
      pushOperations: async () => ({ results: [] }),
      pullOperations: async () => ({
        items: [
          buildAclAddSyncItem({
            opId: 'desktop-1',
            occurredAt: '2026-02-16T02:00:00.000Z'
          })
        ],
        hasMore: false,
        nextCursor: {
          changedAt: '2026-02-16T02:00:00.000Z',
          changeId: 'desktop-1'
        },
        lastReconciledWriteIds: {
          desktop: 1
        }
      }),
      reconcileState: async () => ({
        cursor: {
          changedAt: '2026-02-16T01:59:59.000Z',
          changeId: 'desktop-stale'
        },
        lastReconciledWriteIds: {
          desktop: 1
        }
      })
    };

    const client = new VfsBackgroundSyncClient('user-1', 'desktop', transport, {
      onGuardrailViolation: guardrailCollector.onGuardrailViolation
    });

    await expect(client.sync()).rejects.toThrowError(
      /reconcile regressed sync cursor/
    );
    expect(toStageCodeSignatures(guardrailCollector.violations)).toEqual([
      'reconcile:reconcileCursorRegression'
    ]);
  });

  it('emits deterministic flush guardrail signatures when stale-write recovery exhausts retries', async () => {
    let pullAttempts = 0;
    const guardrailCollector = createGuardrailViolationCollector();
    const transport: VfsCrdtSyncTransport = {
      pushOperations: async (input) => ({
        results: input.operations.map((operation) => ({
          opId: operation.opId,
          status: 'staleWriteId'
        }))
      }),
      pullOperations: async () => {
        pullAttempts += 1;
        return {
          items: [],
          hasMore: false,
          nextCursor: null,
          lastReconciledWriteIds: {}
        };
      }
    };

    const client = new VfsBackgroundSyncClient('user-1', 'desktop', transport, {
      onGuardrailViolation: guardrailCollector.onGuardrailViolation
    });
    client.queueLocalOperation({
      opType: 'acl_add',
      itemId: 'item-1',
      principalType: 'group',
      principalId: 'group-1',
      accessLevel: 'read',
      occurredAt: '2026-02-16T02:05:00.000Z'
    });

    await expect(client.flush()).rejects.toBeInstanceOf(
      VfsCrdtSyncPushRejectedError
    );
    expect(pullAttempts).toBeGreaterThan(0);
    expect(toStageCodeSignatures(guardrailCollector.violations)).toEqual([
      'flush:staleWriteRecoveryExhausted'
    ]);
  });

  it('emits deterministic pull duplicate-replay guardrail signatures', async () => {
    let pullCalls = 0;
    const guardrailCollector = createGuardrailViolationCollector();
    const transport: VfsCrdtSyncTransport = {
      pushOperations: async () => ({ results: [] }),
      pullOperations: async () => {
        pullCalls += 1;
        if (pullCalls === 1) {
          return {
            items: [
              buildAclAddSyncItem({
                opId: 'desktop-dup',
                occurredAt: '2026-02-16T02:10:00.000Z'
              })
            ],
            hasMore: true,
            nextCursor: {
              changedAt: '2026-02-16T02:10:00.000Z',
              changeId: 'desktop-dup'
            },
            lastReconciledWriteIds: {
              desktop: 1
            }
          };
        }

        return {
          items: [
            buildAclAddSyncItem({
              opId: 'desktop-dup',
              occurredAt: '2026-02-16T02:10:01.000Z'
            })
          ],
          hasMore: false,
          nextCursor: {
            changedAt: '2026-02-16T02:10:01.000Z',
            changeId: 'desktop-dup'
          },
          lastReconciledWriteIds: {
            desktop: 2
          }
        };
      }
    };

    const client = new VfsBackgroundSyncClient('user-1', 'desktop', transport, {
      onGuardrailViolation: guardrailCollector.onGuardrailViolation
    });

    await expect(client.sync()).rejects.toThrowError(
      /transport replayed opId desktop-dup during pull pagination/
    );
    expect(toStageCodeSignatures(guardrailCollector.violations)).toEqual([
      'pull:pullDuplicateOpReplay'
    ]);
  });

  it('emits deterministic pull cursor-regression guardrail signatures', async () => {
    let pullCalls = 0;
    const guardrailCollector = createGuardrailViolationCollector();
    const transport: VfsCrdtSyncTransport = {
      pushOperations: async () => ({ results: [] }),
      pullOperations: async () => {
        pullCalls += 1;
        if (pullCalls === 1) {
          return {
            items: [
              buildAclAddSyncItem({
                opId: 'desktop-1',
                occurredAt: '2026-02-16T02:11:00.000Z'
              })
            ],
            hasMore: true,
            nextCursor: {
              changedAt: '2026-02-16T02:11:00.000Z',
              changeId: 'desktop-1'
            },
            lastReconciledWriteIds: {
              desktop: 1
            }
          };
        }

        return {
          items: [],
          hasMore: false,
          nextCursor: {
            changedAt: '2026-02-16T02:10:59.000Z',
            changeId: 'desktop-stale'
          },
          lastReconciledWriteIds: {
            desktop: 1
          }
        };
      }
    };

    const client = new VfsBackgroundSyncClient('user-1', 'desktop', transport, {
      onGuardrailViolation: guardrailCollector.onGuardrailViolation
    });

    await expect(client.sync()).rejects.toThrowError(
      /transport returned regressing sync cursor/
    );
    expect(toStageCodeSignatures(guardrailCollector.violations)).toEqual([
      'pull:pullCursorRegression'
    ]);
  });
});
