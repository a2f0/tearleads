import { describe, expect, it } from 'vitest';
import type { VfsCrdtSyncTransport } from './sync-client-test-support.js';
import {
  buildAclAddSyncItem,
  createDeterministicRandom,
  createSeededIsoTimestampFactory,
  InMemoryVfsCrdtSyncServer,
  InMemoryVfsCrdtSyncTransport,
  nextInt,
  pickOne,
  toStageCodeSignatures,
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

  it('keeps duplicate-replay fail->retry signatures deterministic across seeds', async () => {
    const runScenario = async (
      seed: number
    ): Promise<{
      failureCursorSignature: string;
      failureWriteIdSignature: string;
      failureGuardrailSignatures: string[];
      recoveredPullCursorSignatures: string[];
      recoveredPulledOpIds: string[];
      finalCursorSignature: string;
      finalWriteIdSignature: string;
    }> => {
      const random = createDeterministicRandom(seed);
      const desktopBaseWriteId = nextInt(random, 2, 5);
      const principalTypes = ['group', 'organization'] as const;
      const principalType = pickOne(principalTypes, random);
      const principalId = `${principalType}-seeded-dup-${seed}`;
      const at = createSeededIsoTimestampFactory({
        baseIso: '2026-02-14T12:05:00.000Z',
        seed,
        seedStrideMs: 7_000
      });

      const seedServer = new InMemoryVfsCrdtSyncServer();
      await seedServer.pushOperations({
        operations: [
          {
            opId: `remote-seed-dup-signature-${seed}`,
            opType: 'acl_add',
            itemId: `item-seed-dup-signature-${seed}`,
            replicaId: 'remote',
            writeId: 1,
            occurredAt: at(0),
            principalType,
            principalId,
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

      const duplicateOpId = `desktop-seeded-dup-op-${seed}`;
      let failingPullCount = 0;
      const failingGuardrails: Array<{
        code: string;
        stage: string;
      }> = [];
      const failingClient = new VfsBackgroundSyncClient(
        'user-1',
        'desktop',
        {
          pushOperations: async () => ({
            results: []
          }),
          pullOperations: async () => {
            failingPullCount += 1;
            if (failingPullCount === 1) {
              return {
                items: [
                  buildAclAddSyncItem({
                    opId: duplicateOpId,
                    occurredAt: at(1),
                    itemId: `item-seeded-dup-fail-1-${seed}`
                  })
                ],
                hasMore: true,
                nextCursor: {
                  changedAt: at(1),
                  changeId: duplicateOpId
                },
                lastReconciledWriteIds: {
                  desktop: desktopBaseWriteId,
                  remote: 1
                }
              };
            }

            return {
              items: [
                buildAclAddSyncItem({
                  opId: duplicateOpId,
                  occurredAt: at(2),
                  itemId: `item-seeded-dup-fail-2-${seed}`
                })
              ],
              hasMore: false,
              nextCursor: {
                changedAt: at(2),
                changeId: duplicateOpId
              },
              lastReconciledWriteIds: {
                desktop: desktopBaseWriteId + 1,
                remote: 1
              }
            };
          }
        },
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
        new RegExp(`replayed opId ${duplicateOpId} during pull pagination`)
      );
      const failedSnapshot = failingClient.snapshot();
      if (!failedSnapshot.cursor) {
        throw new Error('expected failure cursor in seeded duplicate run');
      }

      const resumedState = failingClient.exportState();
      let recoveredPullCount = 0;
      const recoveredPullCursorSignatures: string[] = [];
      const recoveredPulledOpIds: string[] = [];
      const recoveredClient = new VfsBackgroundSyncClient(
        'user-1',
        'desktop',
        {
          pushOperations: async () => ({
            results: []
          }),
          pullOperations: async (input) => {
            recoveredPullCount += 1;
            recoveredPullCursorSignatures.push(
              input.cursor
                ? `${input.cursor.changedAt}|${input.cursor.changeId}`
                : 'null'
            );

            if (recoveredPullCount === 1) {
              const firstRecoveryOpId = `desktop-seeded-recover-1-${seed}`;
              recoveredPulledOpIds.push(firstRecoveryOpId);
              return {
                items: [
                  buildAclAddSyncItem({
                    opId: firstRecoveryOpId,
                    occurredAt: at(3),
                    itemId: `item-seeded-dup-recover-1-${seed}`
                  })
                ],
                hasMore: true,
                nextCursor: {
                  changedAt: at(3),
                  changeId: firstRecoveryOpId
                },
                lastReconciledWriteIds: {
                  desktop: desktopBaseWriteId + 1,
                  remote: 1
                }
              };
            }

            const secondRecoveryOpId = `desktop-seeded-recover-2-${seed}`;
            recoveredPulledOpIds.push(secondRecoveryOpId);
            return {
              items: [
                buildAclAddSyncItem({
                  opId: secondRecoveryOpId,
                  occurredAt: at(4),
                  itemId: `item-seeded-dup-recover-2-${seed}`
                })
              ],
              hasMore: false,
              nextCursor: {
                changedAt: at(4),
                changeId: secondRecoveryOpId
              },
              lastReconciledWriteIds: {
                desktop: desktopBaseWriteId + 2,
                remote: 1
              }
            };
          },
          reconcileState: async (input) => ({
            cursor: input.cursor,
            lastReconciledWriteIds: {
              desktop: desktopBaseWriteId + 2,
              remote: 1
            }
          })
        },
        {
          pullLimit: 1
        }
      );
      recoveredClient.hydrateState(resumedState);
      await recoveredClient.sync();

      const finalSnapshot = recoveredClient.snapshot();
      if (!finalSnapshot.cursor) {
        throw new Error('expected final cursor in seeded duplicate run');
      }

      const failureCursorSignature = `${failedSnapshot.cursor.changedAt}|${failedSnapshot.cursor.changeId}`;
      const failureWriteIdSignature = JSON.stringify(
        failedSnapshot.lastReconciledWriteIds
      );
      const failureGuardrailSignatures =
        toStageCodeSignatures(failingGuardrails);
      const finalCursorSignature = `${finalSnapshot.cursor.changedAt}|${finalSnapshot.cursor.changeId}`;
      const finalWriteIdSignature = JSON.stringify(
        finalSnapshot.lastReconciledWriteIds
      );

      expect(failureGuardrailSignatures).toEqual([
        'pull:pullDuplicateOpReplay'
      ]);
      expect(recoveredPullCursorSignatures).toEqual([
        failureCursorSignature,
        `${at(3)}|desktop-seeded-recover-1-${seed}`
      ]);
      expect(recoveredPulledOpIds).toEqual([
        `desktop-seeded-recover-1-${seed}`,
        `desktop-seeded-recover-2-${seed}`
      ]);
      expect(finalCursorSignature).toBe(
        `${at(4)}|desktop-seeded-recover-2-${seed}`
      );
      expect(finalWriteIdSignature).toBe(
        JSON.stringify({
          desktop: desktopBaseWriteId + 2,
          remote: 1
        })
      );

      return {
        failureCursorSignature,
        failureWriteIdSignature,
        failureGuardrailSignatures,
        recoveredPullCursorSignatures,
        recoveredPulledOpIds,
        finalCursorSignature,
        finalWriteIdSignature
      };
    };

    const seeds = [1771, 1772, 1773] as const;
    for (const seed of seeds) {
      const firstRun = await runScenario(seed);
      const secondRun = await runScenario(seed);
      expect(secondRun).toEqual(firstRun);
    }
  });

  it('keeps cross-replica duplicate-replay recovery monotonic across seeds', async () => {
    const runScenario = async (
      seed: number
    ): Promise<{
      failureWriteIds: {
        desktop: number;
        mobile: number;
        remote: number;
      };
      finalWriteIds: {
        desktop: number;
        mobile: number;
        remote: number;
      };
      recoveredPullCursorSignatures: string[];
      recoveredPulledOpIds: string[];
    }> => {
      const random = createDeterministicRandom(seed);
      const desktopBase = nextInt(random, 2, 5);
      const mobileBase = nextInt(random, 4, 7);
      const remoteBase = nextInt(random, 3, 6);
      const at = createSeededIsoTimestampFactory({
        baseIso: '2026-02-14T12:06:00.000Z',
        seed,
        seedStrideMs: 9_000
      });

      const seedServer = new InMemoryVfsCrdtSyncServer();
      await seedServer.pushOperations({
        operations: [
          {
            opId: `remote-seed-cross-${seed}`,
            opType: 'acl_add',
            itemId: `item-remote-seed-cross-${seed}`,
            replicaId: 'remote',
            writeId: remoteBase,
            occurredAt: at(0),
            principalType: 'group',
            principalId: `group-remote-cross-${seed}`,
            accessLevel: 'read'
          },
          {
            opId: `mobile-seed-cross-${seed}`,
            opType: 'acl_add',
            itemId: `item-mobile-seed-cross-${seed}`,
            replicaId: 'mobile',
            writeId: mobileBase,
            occurredAt: at(1),
            principalType: 'organization',
            principalId: `org-mobile-cross-${seed}`,
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

      const duplicateOpId = `desktop-cross-dup-${seed}`;
      let failingPullCount = 0;
      const failingClient = new VfsBackgroundSyncClient(
        'user-1',
        'desktop',
        {
          pushOperations: async () => ({
            results: []
          }),
          pullOperations: async () => {
            failingPullCount += 1;
            if (failingPullCount === 1) {
              return {
                items: [
                  buildAclAddSyncItem({
                    opId: duplicateOpId,
                    occurredAt: at(2),
                    itemId: `item-cross-dup-fail-1-${seed}`
                  })
                ],
                hasMore: true,
                nextCursor: {
                  changedAt: at(2),
                  changeId: duplicateOpId
                },
                lastReconciledWriteIds: {
                  desktop: desktopBase,
                  mobile: mobileBase + 1,
                  remote: remoteBase
                }
              };
            }

            return {
              items: [
                buildAclAddSyncItem({
                  opId: duplicateOpId,
                  occurredAt: at(3),
                  itemId: `item-cross-dup-fail-2-${seed}`
                })
              ],
              hasMore: false,
              nextCursor: {
                changedAt: at(3),
                changeId: duplicateOpId
              },
              lastReconciledWriteIds: {
                desktop: desktopBase + 1,
                mobile: mobileBase + 2,
                remote: remoteBase + 1
              }
            };
          }
        },
        {
          pullLimit: 1
        }
      );
      failingClient.hydrateState(persistedState);

      await expect(failingClient.sync()).rejects.toThrow(
        new RegExp(`replayed opId ${duplicateOpId} during pull pagination`)
      );
      const failedSnapshot = failingClient.snapshot();
      expect(failedSnapshot.lastReconciledWriteIds).toEqual({
        desktop: desktopBase,
        mobile: mobileBase + 1,
        remote: remoteBase
      });

      const resumedState = failingClient.exportState();
      let recoveredPullCount = 0;
      const recoveredPullCursorSignatures: string[] = [];
      const recoveredPulledOpIds: string[] = [];
      const recoveredClient = new VfsBackgroundSyncClient(
        'user-1',
        'desktop',
        {
          pushOperations: async () => ({
            results: []
          }),
          pullOperations: async (input) => {
            recoveredPullCursorSignatures.push(
              input.cursor
                ? `${input.cursor.changedAt}|${input.cursor.changeId}`
                : 'null'
            );
            recoveredPullCount += 1;

            if (recoveredPullCount === 1) {
              const firstRecoveryOpId = `desktop-cross-recover-1-${seed}`;
              recoveredPulledOpIds.push(firstRecoveryOpId);
              return {
                items: [
                  buildAclAddSyncItem({
                    opId: firstRecoveryOpId,
                    occurredAt: at(4),
                    itemId: `item-cross-recover-1-${seed}`
                  })
                ],
                hasMore: true,
                nextCursor: {
                  changedAt: at(4),
                  changeId: firstRecoveryOpId
                },
                lastReconciledWriteIds: {
                  desktop: desktopBase + 1,
                  mobile: mobileBase + 2,
                  remote: remoteBase + 1
                }
              };
            }

            const secondRecoveryOpId = `desktop-cross-recover-2-${seed}`;
            recoveredPulledOpIds.push(secondRecoveryOpId);
            return {
              items: [
                buildAclAddSyncItem({
                  opId: secondRecoveryOpId,
                  occurredAt: at(5),
                  itemId: `item-cross-recover-2-${seed}`
                })
              ],
              hasMore: false,
              nextCursor: {
                changedAt: at(5),
                changeId: secondRecoveryOpId
              },
              lastReconciledWriteIds: {
                desktop: desktopBase + 2,
                mobile: mobileBase + 3,
                remote: remoteBase + 2
              }
            };
          },
          reconcileState: async (input) => ({
            cursor: input.cursor,
            lastReconciledWriteIds: {
              desktop: desktopBase + 2,
              mobile: mobileBase + 3,
              remote: remoteBase + 2
            }
          })
        },
        {
          pullLimit: 1
        }
      );
      recoveredClient.hydrateState(resumedState);
      await recoveredClient.sync();

      const finalSnapshot = recoveredClient.snapshot();
      expect(finalSnapshot.lastReconciledWriteIds).toEqual({
        desktop: desktopBase + 2,
        mobile: mobileBase + 3,
        remote: remoteBase + 2
      });
      expect(recoveredPullCursorSignatures).toEqual([
        `${at(2)}|${duplicateOpId}`,
        `${at(4)}|desktop-cross-recover-1-${seed}`
      ]);
      expect(recoveredPulledOpIds).toEqual([
        `desktop-cross-recover-1-${seed}`,
        `desktop-cross-recover-2-${seed}`
      ]);

      return {
        failureWriteIds: {
          desktop: desktopBase,
          mobile: mobileBase + 1,
          remote: remoteBase
        },
        finalWriteIds: {
          desktop: desktopBase + 2,
          mobile: mobileBase + 3,
          remote: remoteBase + 2
        },
        recoveredPullCursorSignatures,
        recoveredPulledOpIds
      };
    };

    const seeds = [1881, 1882, 1883] as const;
    for (const seed of seeds) {
      const firstRun = await runScenario(seed);
      const secondRun = await runScenario(seed);
      expect(secondRun).toEqual(firstRun);
    }
  });
});
