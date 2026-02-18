import { describe, expect, it } from 'vitest';
import {
  buildAclAddSyncItem,
  InMemoryVfsCrdtSyncServer,
  InMemoryVfsCrdtSyncTransport,
  VfsBackgroundSyncClient
} from './sync-client-test-support.js';

describe('VfsBackgroundSyncClient', () => {
  it('recovers across duplicate-pull then reconcile-regression failures in sequential restart cycles', async () => {
    const seedServer = new InMemoryVfsCrdtSyncServer();
    await seedServer.pushOperations({
      operations: [
        {
          opId: 'remote-chain-seed',
          opType: 'acl_add',
          itemId: 'item-remote-chain-seed',
          replicaId: 'remote',
          writeId: 1,
          occurredAt: '2026-02-14T12:07:00.000Z',
          principalType: 'group',
          principalId: 'group-chain-seed',
          accessLevel: 'read'
        },
        {
          opId: 'mobile-chain-seed',
          opType: 'acl_add',
          itemId: 'item-mobile-chain-seed',
          replicaId: 'mobile',
          writeId: 1,
          occurredAt: '2026-02-14T12:07:01.000Z',
          principalType: 'organization',
          principalId: 'org-chain-seed',
          accessLevel: 'write'
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

    const duplicateGuardrails: Array<{ code: string; stage: string }> = [];
    const duplicateClient = new VfsBackgroundSyncClient(
      'user-1',
      'desktop',
      {
        pushOperations: async () => ({
          results: []
        }),
        pullOperations: async (input) => {
          const cursorSignature = input.cursor
            ? `${input.cursor.changedAt}|${input.cursor.changeId}`
            : 'null';
          if (
            cursorSignature === '2026-02-14T12:07:01.000Z|mobile-chain-seed'
          ) {
            return {
              items: [
                buildAclAddSyncItem({
                  opId: 'desktop-chain-dup',
                  occurredAt: '2026-02-14T12:07:02.000Z',
                  itemId: 'item-chain-dup-1'
                })
              ],
              hasMore: true,
              nextCursor: {
                changedAt: '2026-02-14T12:07:02.000Z',
                changeId: 'desktop-chain-dup'
              },
              lastReconciledWriteIds: {
                desktop: 1,
                mobile: 2,
                remote: 1
              }
            };
          }

          return {
            items: [
              buildAclAddSyncItem({
                opId: 'desktop-chain-dup',
                occurredAt: '2026-02-14T12:07:03.000Z',
                itemId: 'item-chain-dup-2'
              })
            ],
            hasMore: false,
            nextCursor: {
              changedAt: '2026-02-14T12:07:03.000Z',
              changeId: 'desktop-chain-dup'
            },
            lastReconciledWriteIds: {
              desktop: 2,
              mobile: 3,
              remote: 2
            }
          };
        }
      },
      {
        pullLimit: 1,
        onGuardrailViolation: (violation) => {
          duplicateGuardrails.push({
            code: violation.code,
            stage: violation.stage
          });
        }
      }
    );
    duplicateClient.hydrateState(persistedState);

    await expect(duplicateClient.sync()).rejects.toThrow(
      /replayed opId desktop-chain-dup during pull pagination/
    );
    const duplicateFailureSnapshot = duplicateClient.snapshot();
    expect(duplicateGuardrails).toEqual([
      {
        code: 'pullDuplicateOpReplay',
        stage: 'pull'
      }
    ]);
    expect(duplicateFailureSnapshot.cursor).toEqual({
      changedAt: '2026-02-14T12:07:02.000Z',
      changeId: 'desktop-chain-dup'
    });
    expect(duplicateFailureSnapshot.lastReconciledWriteIds).toEqual({
      desktop: 1,
      mobile: 2,
      remote: 1
    });

    const reconcileRegressionGuardrails: Array<{
      code: string;
      stage: string;
    }> = [];
    const reconcileRegressionPullCursors: string[] = [];
    let reconcileRegressionReconcileCalls = 0;
    const reconcileRegressionClient = new VfsBackgroundSyncClient(
      'user-1',
      'desktop',
      {
        pushOperations: async () => ({
          results: []
        }),
        pullOperations: async (input) => {
          reconcileRegressionPullCursors.push(
            input.cursor
              ? `${input.cursor.changedAt}|${input.cursor.changeId}`
              : 'null'
          );
          if (reconcileRegressionPullCursors.length === 1) {
            return {
              items: [
                buildAclAddSyncItem({
                  opId: 'desktop-chain-recover-1',
                  occurredAt: '2026-02-14T12:07:04.000Z',
                  itemId: 'item-chain-recover-1'
                })
              ],
              hasMore: true,
              nextCursor: {
                changedAt: '2026-02-14T12:07:04.000Z',
                changeId: 'desktop-chain-recover-1'
              },
              lastReconciledWriteIds: {
                desktop: 2,
                mobile: 3,
                remote: 2
              }
            };
          }

          return {
            items: [
              buildAclAddSyncItem({
                opId: 'desktop-chain-recover-2',
                occurredAt: '2026-02-14T12:07:05.000Z',
                itemId: 'item-chain-recover-2'
              })
            ],
            hasMore: false,
            nextCursor: {
              changedAt: '2026-02-14T12:07:05.000Z',
              changeId: 'desktop-chain-recover-2'
            },
            lastReconciledWriteIds: {
              desktop: 3,
              mobile: 4,
              remote: 3
            }
          };
        },
        reconcileState: async (input) => {
          reconcileRegressionReconcileCalls += 1;
          return {
            cursor: input.cursor,
            lastReconciledWriteIds: {
              desktop: 3,
              mobile: 3,
              remote: 3
            }
          };
        }
      },
      {
        pullLimit: 1,
        onGuardrailViolation: (violation) => {
          reconcileRegressionGuardrails.push({
            code: violation.code,
            stage: violation.stage
          });
        }
      }
    );
    reconcileRegressionClient.hydrateState(duplicateClient.exportState());

    await expect(reconcileRegressionClient.sync()).rejects.toThrow(
      /regressed lastReconciledWriteIds for replica mobile/
    );
    expect(reconcileRegressionReconcileCalls).toBe(1);
    expect(reconcileRegressionGuardrails).toEqual([
      {
        code: 'lastWriteIdRegression',
        stage: 'reconcile'
      }
    ]);
    expect(reconcileRegressionPullCursors).toEqual([
      '2026-02-14T12:07:02.000Z|desktop-chain-dup',
      '2026-02-14T12:07:04.000Z|desktop-chain-recover-1'
    ]);

    const reconcileFailureSnapshot = reconcileRegressionClient.snapshot();
    expect(reconcileFailureSnapshot.cursor).toEqual({
      changedAt: '2026-02-14T12:07:05.000Z',
      changeId: 'desktop-chain-recover-2'
    });
    expect(reconcileFailureSnapshot.lastReconciledWriteIds).toEqual({
      desktop: 3,
      mobile: 4,
      remote: 3
    });

    const finalGuardrails: Array<{ code: string; stage: string }> = [];
    let finalReconcileCalls = 0;
    const finalClient = new VfsBackgroundSyncClient(
      'user-1',
      'desktop',
      {
        pushOperations: async () => ({
          results: []
        }),
        pullOperations: async () => ({
          items: [],
          hasMore: false,
          nextCursor: {
            changedAt: '2026-02-14T12:07:05.000Z',
            changeId: 'desktop-chain-recover-2'
          },
          lastReconciledWriteIds: {
            desktop: 3,
            mobile: 4,
            remote: 3
          }
        }),
        reconcileState: async (input) => {
          finalReconcileCalls += 1;
          return {
            cursor: input.cursor,
            lastReconciledWriteIds: {
              desktop: 4,
              mobile: 5,
              remote: 4
            }
          };
        }
      },
      {
        pullLimit: 1,
        onGuardrailViolation: (violation) => {
          finalGuardrails.push({
            code: violation.code,
            stage: violation.stage
          });
        }
      }
    );
    finalClient.hydrateState(reconcileRegressionClient.exportState());

    const finalResult = await finalClient.sync();
    expect(finalResult).toEqual({
      pulledOperations: 0,
      pullPages: 1
    });
    expect(finalReconcileCalls).toBe(1);
    expect(finalGuardrails).toEqual([]);
    expect(finalClient.snapshot().lastReconciledWriteIds).toEqual({
      desktop: 4,
      mobile: 5,
      remote: 4
    });
  });
});
