import { describe, expect, it } from 'vitest';
import type { VfsCrdtSyncTransport } from './sync-client-test-support.js';
import {
  buildAclAddSyncItem,
  createGuardrailViolationCollector,
  VfsBackgroundSyncClient
} from './sync-client-test-support.js';

describe('VfsBackgroundSyncClient', () => {
  it('fails closed when post-restart pull cycle regresses write ids below local reconcile baseline', async () => {
    let pullCount = 0;
    const guardrailViolations: Array<{
      code: string;
      stage: string;
      message: string;
    }> = [];
    const pullRequests: Array<{
      cursor: { changedAt: string; changeId: string } | null;
      limit: number;
    }> = [];
    const transport: VfsCrdtSyncTransport = {
      pushOperations: async () => ({
        results: []
      }),
      pullOperations: async (input) => {
        pullCount += 1;
        pullRequests.push({
          cursor: input.cursor ? { ...input.cursor } : null,
          limit: input.limit
        });

        if (pullCount === 1) {
          return {
            items: [
              buildAclAddSyncItem({
                opId: 'desktop-1',
                occurredAt: '2026-02-14T12:15:00.000Z',
                itemId: 'item-baseline-a'
              })
            ],
            hasMore: true,
            nextCursor: {
              changedAt: '2026-02-14T12:15:00.000Z',
              changeId: 'desktop-1'
            },
            lastReconciledWriteIds: {
              desktop: 5
            }
          };
        }

        if (pullCount === 2) {
          return {
            items: [
              buildAclAddSyncItem({
                opId: 'desktop-2',
                occurredAt: '2026-02-14T12:15:01.000Z',
                itemId: 'item-baseline-b'
              })
            ],
            hasMore: false,
            nextCursor: {
              changedAt: '2026-02-14T12:15:01.000Z',
              changeId: 'desktop-2'
            },
            lastReconciledWriteIds: {
              desktop: 6
            }
          };
        }

        return {
          items: [
            buildAclAddSyncItem({
              opId: 'desktop-3',
              occurredAt: '2026-02-14T12:15:02.000Z',
              itemId: 'item-should-not-apply'
            })
          ],
          hasMore: false,
          nextCursor: {
            changedAt: '2026-02-14T12:15:02.000Z',
            changeId: 'desktop-3'
          },
          lastReconciledWriteIds: {
            desktop: 5
          }
        };
      }
    };

    const seedClient = new VfsBackgroundSyncClient(
      'user-1',
      'desktop',
      transport,
      {
        onGuardrailViolation: (violation) => {
          guardrailViolations.push({
            code: violation.code,
            stage: violation.stage,
            message: violation.message
          });
        }
      }
    );
    await seedClient.sync();
    expect(seedClient.snapshot().lastReconciledWriteIds.desktop).toBe(6);

    const resumedClient = new VfsBackgroundSyncClient(
      'user-1',
      'desktop',
      transport,
      {
        onGuardrailViolation: (violation) => {
          guardrailViolations.push({
            code: violation.code,
            stage: violation.stage,
            message: violation.message
          });
        }
      }
    );
    resumedClient.hydrateState(seedClient.exportState());
    const preFailureState = resumedClient.exportState();

    await expect(resumedClient.sync()).rejects.toThrowError(
      /regressed lastReconciledWriteIds/
    );
    expect(guardrailViolations).toContainEqual({
      code: 'lastWriteIdRegression',
      stage: 'pull',
      message: 'pull response regressed replica write-id state'
    });
    expect(resumedClient.exportState()).toEqual(preFailureState);
    expect(resumedClient.snapshot().acl).not.toContainEqual(
      expect.objectContaining({
        itemId: 'item-should-not-apply'
      })
    );
    expect(pullRequests[0]?.cursor).toBeNull();
    expect(pullRequests[1]?.cursor).toEqual({
      changedAt: '2026-02-14T12:15:00.000Z',
      changeId: 'desktop-1'
    });
    expect(pullRequests[2]?.cursor).toEqual({
      changedAt: '2026-02-14T12:15:01.000Z',
      changeId: 'desktop-2'
    });
  });

  it('fails closed with replica-specific details when one replica regresses during pull', async () => {
    let pullCount = 0;
    const guardrailCollector = createGuardrailViolationCollector();
    const guardrailViolations = guardrailCollector.violations;
    const transport: VfsCrdtSyncTransport = {
      pushOperations: async () => ({
        results: []
      }),
      pullOperations: async () => {
        pullCount += 1;

        if (pullCount === 1) {
          return {
            items: [
              buildAclAddSyncItem({
                opId: 'desktop-1',
                occurredAt: '2026-02-14T12:16:00.000Z',
                itemId: 'item-multi-replica-a'
              })
            ],
            hasMore: false,
            nextCursor: {
              changedAt: '2026-02-14T12:16:00.000Z',
              changeId: 'desktop-1'
            },
            lastReconciledWriteIds: {
              desktop: 8,
              mobile: 7
            }
          };
        }

        return {
          items: [
            buildAclAddSyncItem({
              opId: 'desktop-2',
              occurredAt: '2026-02-14T12:16:01.000Z',
              itemId: 'item-should-not-apply-mobile-regression'
            })
          ],
          hasMore: false,
          nextCursor: {
            changedAt: '2026-02-14T12:16:01.000Z',
            changeId: 'desktop-2'
          },
          lastReconciledWriteIds: {
            desktop: 9,
            mobile: 6
          }
        };
      }
    };

    const seedClient = new VfsBackgroundSyncClient(
      'user-1',
      'desktop',
      transport,
      {
        onGuardrailViolation: guardrailCollector.onGuardrailViolation
      }
    );
    await seedClient.sync();
    expect(seedClient.snapshot().lastReconciledWriteIds).toEqual({
      desktop: 8,
      mobile: 7
    });

    const resumedClient = new VfsBackgroundSyncClient(
      'user-1',
      'desktop',
      transport,
      {
        onGuardrailViolation: guardrailCollector.onGuardrailViolation
      }
    );
    resumedClient.hydrateState(seedClient.exportState());
    const preFailureState = resumedClient.exportState();

    await expect(resumedClient.sync()).rejects.toThrowError(
      /regressed lastReconciledWriteIds for replica mobile/
    );
    expect(guardrailViolations).toContainEqual({
      code: 'lastWriteIdRegression',
      stage: 'pull',
      message: 'pull response regressed replica write-id state',
      details: {
        replicaId: 'mobile',
        previousWriteId: 7,
        incomingWriteId: 6
      }
    });
    expect(resumedClient.exportState()).toEqual(preFailureState);
    expect(resumedClient.snapshot().lastReconciledWriteIds).toEqual({
      desktop: 8,
      mobile: 7
    });
    expect(resumedClient.snapshot().acl).not.toContainEqual(
      expect.objectContaining({
        itemId: 'item-should-not-apply-mobile-regression'
      })
    );
  });
});
