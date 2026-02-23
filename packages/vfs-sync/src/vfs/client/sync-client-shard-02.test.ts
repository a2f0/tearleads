import { describe, expect, it } from 'vitest';
import type { VfsCrdtSyncTransport } from './sync-client-test-support.js';
import {
  buildAclAddSyncItem,
  InMemoryVfsCrdtSyncServer,
  InMemoryVfsCrdtSyncTransport,
  VfsBackgroundSyncClient
} from './sync-client-test-support.js';

describe('VfsBackgroundSyncClient', () => {
  it('preserves reconcile baseline after duplicate replay failure and converges on corrected restart retry', async () => {
    const seedServer = new InMemoryVfsCrdtSyncServer();
    await seedServer.pushOperations({
      operations: [
        {
          opId: 'remote-seed-dup-recovery',
          opType: 'acl_add',
          itemId: 'item-seed-dup-recovery',
          replicaId: 'remote',
          writeId: 1,
          occurredAt: '2026-02-14T12:04:30.000Z',
          principalType: 'group',
          principalId: 'group-seed',
          accessLevel: 'read'
        }
      ]
    });
    const sourceClient = new VfsBackgroundSyncClient(
      'user-1',
      'desktop',
      new InMemoryVfsCrdtSyncTransport(seedServer),
      {
        pullLimit: 1
      }
    );
    await sourceClient.sync();
    const persistedState = sourceClient.exportState();

    let failingPullCount = 0;
    let failingReconcileCalls = 0;
    const failingGuardrails: Array<{
      code: string;
      stage: string;
    }> = [];
    const failingTransport: VfsCrdtSyncTransport = {
      pushOperations: async () => ({
        results: []
      }),
      pullOperations: async () => {
        failingPullCount += 1;
        if (failingPullCount === 1) {
          return {
            items: [
              buildAclAddSyncItem({
                opId: 'desktop-dup-recovery-1',
                occurredAt: '2026-02-14T12:04:31.000Z',
                itemId: 'item-dup-recovery-1'
              })
            ],
            hasMore: true,
            nextCursor: {
              changedAt: '2026-02-14T12:04:31.000Z',
              changeId: 'desktop-dup-recovery-1'
            },
            lastReconciledWriteIds: {
              desktop: 1,
              remote: 1
            }
          };
        }

        return {
          items: [
            buildAclAddSyncItem({
              opId: 'desktop-dup-recovery-1',
              occurredAt: '2026-02-14T12:04:32.000Z',
              itemId: 'item-dup-recovery-2'
            })
          ],
          hasMore: false,
          nextCursor: {
            changedAt: '2026-02-14T12:04:32.000Z',
            changeId: 'desktop-dup-recovery-1'
          },
          lastReconciledWriteIds: {
            desktop: 2,
            remote: 1
          }
        };
      },
      reconcileState: async () => {
        failingReconcileCalls += 1;
        return {
          cursor: {
            changedAt: '2026-02-14T12:04:32.000Z',
            changeId: 'desktop-dup-recovery-1'
          },
          lastReconciledWriteIds: {
            desktop: 2,
            remote: 1
          }
        };
      }
    };
    const failingClient = new VfsBackgroundSyncClient(
      'user-1',
      'desktop',
      failingTransport,
      {
        pullLimit: 1,
        onGuardrailViolation: (violation) => {
          failingGuardrails.push({
            code: violation.code,
            stage: violation.stage
          });
        }
      }
    );
    failingClient.hydrateState(persistedState);

    await expect(failingClient.sync()).rejects.toThrow(
      /replayed opId desktop-dup-recovery-1 during pull pagination/
    );
    expect(failingPullCount).toBe(2);
    expect(failingReconcileCalls).toBe(0);
    expect(failingGuardrails).toEqual([
      {
        code: 'pullDuplicateOpReplay',
        stage: 'pull'
      }
    ]);

    const failedSnapshot = failingClient.snapshot();
    expect(failedSnapshot.cursor).toEqual({
      changedAt: '2026-02-14T12:04:31.000Z',
      changeId: 'desktop-dup-recovery-1'
    });
    expect(failedSnapshot.lastReconciledWriteIds).toEqual({
      desktop: 1,
      remote: 1
    });

    const resumedState = failingClient.exportState();
    let recoveredPullCount = 0;
    const recoveredPullCursors: string[] = [];
    const recoveredPulledOpIds: string[] = [];
    let recoveredReconcileCalls = 0;
    const recoveredTransport: VfsCrdtSyncTransport = {
      pushOperations: async () => ({
        results: []
      }),
      pullOperations: async (input) => {
        recoveredPullCursors.push(
          input.cursor
            ? `${input.cursor.changedAt}|${input.cursor.changeId}`
            : 'null'
        );
        recoveredPullCount += 1;

        if (recoveredPullCount === 1) {
          const pageItem = buildAclAddSyncItem({
            opId: 'desktop-dup-recovery-2',
            occurredAt: '2026-02-14T12:04:33.000Z',
            itemId: 'item-dup-recovery-3'
          });
          recoveredPulledOpIds.push(pageItem.opId);
          return {
            items: [pageItem],
            hasMore: true,
            nextCursor: {
              changedAt: '2026-02-14T12:04:33.000Z',
              changeId: 'desktop-dup-recovery-2'
            },
            lastReconciledWriteIds: {
              desktop: 2,
              remote: 1
            }
          };
        }

        const pageItem = buildAclAddSyncItem({
          opId: 'desktop-dup-recovery-3',
          occurredAt: '2026-02-14T12:04:34.000Z',
          itemId: 'item-dup-recovery-4'
        });
        recoveredPulledOpIds.push(pageItem.opId);
        return {
          items: [pageItem],
          hasMore: false,
          nextCursor: {
            changedAt: '2026-02-14T12:04:34.000Z',
            changeId: 'desktop-dup-recovery-3'
          },
          lastReconciledWriteIds: {
            desktop: 3,
            remote: 1
          }
        };
      },
      reconcileState: async (input) => {
        recoveredReconcileCalls += 1;
        return {
          cursor: input.cursor,
          lastReconciledWriteIds: {
            desktop: 3,
            remote: 1
          }
        };
      }
    };
    const recoveredGuardrails: Array<{
      code: string;
      stage: string;
    }> = [];
    const recoveredClient = new VfsBackgroundSyncClient(
      'user-1',
      'desktop',
      recoveredTransport,
      {
        pullLimit: 1,
        onGuardrailViolation: (violation) => {
          recoveredGuardrails.push({
            code: violation.code,
            stage: violation.stage
          });
        }
      }
    );
    recoveredClient.hydrateState(resumedState);

    const recoveryResult = await recoveredClient.sync();
    expect(recoveryResult).toEqual({
      pulledOperations: 2,
      pullPages: 2
    });
    expect(recoveredPullCount).toBe(2);
    expect(recoveredReconcileCalls).toBe(1);
    expect(recoveredPullCursors).toEqual([
      '2026-02-14T12:04:31.000Z|desktop-dup-recovery-1',
      '2026-02-14T12:04:33.000Z|desktop-dup-recovery-2'
    ]);
    expect(recoveredPulledOpIds).toEqual([
      'desktop-dup-recovery-2',
      'desktop-dup-recovery-3'
    ]);
    expect(recoveredGuardrails).toEqual([]);
    expect(recoveredClient.snapshot().cursor).toEqual({
      changedAt: '2026-02-14T12:04:34.000Z',
      changeId: 'desktop-dup-recovery-3'
    });
    expect(recoveredClient.snapshot().lastReconciledWriteIds).toEqual({
      desktop: 3,
      remote: 1
    });
  });
});
