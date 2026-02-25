import { describe, expect, it } from 'vitest';
import {
  buildAclAddSyncItem,
  VfsBackgroundSyncClient,
  VfsCrdtRematerializationRequiredError
} from './sync-client-test-support.js';
import {
  createGuardrailViolationCollector,
  expectPullRematerializationRequiredViolation,
  toStageCodeSignatures
} from './sync-client-test-support-observers.js';

describe('VfsBackgroundSyncClient rematerialization recovery', () => {
  it('retries sync automatically after rematerialization-required pull failure', async () => {
    const guardrailCollector = createGuardrailViolationCollector();
    const requestedCursor = 'requested-cursor-token';
    const oldestAvailableCursor = 'oldest-cursor-token';
    let pullCalls = 0;

    const client = new VfsBackgroundSyncClient(
      'user-1',
      'desktop',
      {
        pushOperations: async () => ({ results: [] }),
        pullOperations: async () => {
          pullCalls += 1;
          if (pullCalls === 1) {
            throw new VfsCrdtRematerializationRequiredError({
              requestedCursor,
              oldestAvailableCursor
            });
          }

          return {
            items: [
              buildAclAddSyncItem({
                opId: 'op-after-remat',
                occurredAt: '2026-03-01T00:00:00.000Z',
                itemId: 'item-after-remat'
              })
            ],
            hasMore: false,
            nextCursor: null,
            lastReconciledWriteIds: { desktop: 3 }
          };
        }
      },
      {
        onGuardrailViolation: guardrailCollector.onGuardrailViolation
      }
    );

    const result = await client.sync();

    expect(result).toEqual({
      pulledOperations: 1,
      pullPages: 1
    });
    expect(pullCalls).toBe(2);
    expect(toStageCodeSignatures(guardrailCollector.violations)).toContain(
      'pull:pullRematerializationRequired'
    );
    expectPullRematerializationRequiredViolation({
      violations: guardrailCollector.violations,
      requestedCursor,
      oldestAvailableCursor
    });
    expect(client.snapshot().acl).toEqual([
      {
        itemId: 'item-after-remat',
        principalType: 'group',
        principalId: 'group-1',
        accessLevel: 'read'
      }
    ]);
  });

  it('uses rematerialized state provided by callback before retrying', async () => {
    let pullCalls = 0;
    let callbackCalls = 0;

    const client = new VfsBackgroundSyncClient(
      'user-1',
      'desktop',
      {
        pushOperations: async () => ({ results: [] }),
        pullOperations: async () => {
          pullCalls += 1;
          if (pullCalls === 1) {
            throw new VfsCrdtRematerializationRequiredError({
              requestedCursor: 'req-1',
              oldestAvailableCursor: 'old-1'
            });
          }

          return {
            items: [],
            hasMore: false,
            nextCursor: null,
            lastReconciledWriteIds: {}
          };
        }
      },
      {
        onRematerializationRequired: async ({ attempt, error }) => {
          callbackCalls += 1;
          expect(attempt).toBe(1);
          expect(error.code).toBe('crdt_rematerialization_required');
          return {
            replaySnapshot: {
              acl: [
                {
                  itemId: 'canonical-item',
                  principalType: 'group',
                  principalId: 'group-canonical',
                  accessLevel: 'write'
                }
              ],
              links: [],
              cursor: null
            },
            reconcileState: null,
            containerClocks: []
          };
        }
      }
    );

    await client.sync();

    expect(pullCalls).toBe(2);
    expect(callbackCalls).toBe(1);
    expect(client.snapshot().acl).toEqual([
      {
        itemId: 'canonical-item',
        principalType: 'group',
        principalId: 'group-canonical',
        accessLevel: 'write'
      }
    ]);
  });

  it('recovers flush flow after rematerialization-required pull failure', async () => {
    let pullCalls = 0;

    const client = new VfsBackgroundSyncClient('user-1', 'desktop', {
      pushOperations: async ({ operations }) => ({
        results: operations.map((operation) => ({
          opId: operation.opId,
          status: 'applied' as const
        }))
      }),
      pullOperations: async () => {
        pullCalls += 1;
        if (pullCalls === 1) {
          throw new VfsCrdtRematerializationRequiredError({
            requestedCursor: 'req-flush',
            oldestAvailableCursor: 'old-flush'
          });
        }

        return {
          items: [],
          hasMore: false,
          nextCursor: null,
          lastReconciledWriteIds: { desktop: 1 }
        };
      }
    });

    client.queueLocalOperation({
      opType: 'acl_add',
      itemId: 'item-1',
      principalType: 'group',
      principalId: 'group-1',
      accessLevel: 'read',
      occurredAt: '2026-03-01T00:00:00.000Z'
    });

    const result = await client.flush();

    expect(result).toEqual({
      pushedOperations: 0,
      pulledOperations: 0,
      pullPages: 1
    });
    expect(pullCalls).toBe(2);
    expect(client.snapshot().pendingOperations).toBe(0);
  });

  it('respects maxRematerializationAttempts and fails closed when exhausted', async () => {
    let pullCalls = 0;
    const client = new VfsBackgroundSyncClient(
      'user-1',
      'desktop',
      {
        pushOperations: async () => ({ results: [] }),
        pullOperations: async () => {
          pullCalls += 1;
          throw new VfsCrdtRematerializationRequiredError({
            requestedCursor: 'req-fail',
            oldestAvailableCursor: 'old-fail'
          });
        }
      },
      {
        maxRematerializationAttempts: 0
      }
    );

    await expect(client.sync()).rejects.toThrow(/re-materialization required/);
    expect(pullCalls).toBe(1);
  });
});
