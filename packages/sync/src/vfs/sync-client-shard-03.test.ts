import { describe, expect, it } from 'vitest';
import type { VfsCrdtSyncTransport } from './sync-client-test-support.js';
import {
  buildAclAddSyncItem,
  createDeterministicRandom,
  createSeededIsoTimestampFactory,
  InMemoryVfsCrdtSyncServer,
  InMemoryVfsCrdtSyncTransport,
  nextInt,
  readForwardContainerSignatures,
  toStageCodeSignatures,
  VfsBackgroundSyncClient,
  VfsCrdtSyncPushRejectedError
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

  it('keeps mixed duplicate/reconcile failure-chain signatures deterministic across seeds', async () => {
    const runScenario = async (
      seed: number
    ): Promise<{
      phaseOneGuardrails: string[];
      phaseTwoGuardrails: string[];
      phaseTwoPullCursorSignatures: string[];
      phaseThreeGuardrails: string[];
      finalWriteIds: string;
      forwardContainerSignatures: string[];
    }> => {
      const random = createDeterministicRandom(seed);
      const desktopBase = nextInt(random, 1, 4);
      const mobileBase = nextInt(random, 2, 6);
      const remoteBase = nextInt(random, 2, 6);
      const at = createSeededIsoTimestampFactory({
        baseIso: '2026-02-14T12:08:00.000Z',
        seed,
        seedStrideMs: 11_000
      });

      const seedServer = new InMemoryVfsCrdtSyncServer();
      await seedServer.pushOperations({
        operations: [
          {
            opId: `remote-seeded-chain-${seed}`,
            opType: 'acl_add',
            itemId: `item-remote-seeded-chain-${seed}`,
            replicaId: 'remote',
            writeId: remoteBase,
            occurredAt: at(0),
            principalType: 'group',
            principalId: `group-seeded-chain-${seed}`,
            accessLevel: 'read'
          },
          {
            opId: `mobile-seeded-chain-${seed}`,
            opType: 'acl_add',
            itemId: `item-mobile-seeded-chain-${seed}`,
            replicaId: 'mobile',
            writeId: mobileBase,
            occurredAt: at(1),
            principalType: 'organization',
            principalId: `org-seeded-chain-${seed}`,
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
      const seedCursor = sourceClient.snapshot().cursor;
      if (!seedCursor) {
        throw new Error('expected seed cursor in mixed seeded chain run');
      }

      const duplicateOpId = `desktop-seeded-chain-dup-${seed}`;
      const phaseOneGuardrailEvents: Array<{ stage: string; code: string }> =
        [];
      const phaseOneClient = new VfsBackgroundSyncClient(
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
            if (cursorSignature === `${at(1)}|mobile-seeded-chain-${seed}`) {
              return {
                items: [
                  buildAclAddSyncItem({
                    opId: duplicateOpId,
                    occurredAt: at(2),
                    itemId: `item-seeded-chain-dup-1-${seed}`
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
                  itemId: `item-seeded-chain-dup-2-${seed}`
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
          pullLimit: 1,
          onGuardrailViolation: (violation) => {
            phaseOneGuardrailEvents.push({
              stage: violation.stage,
              code: violation.code
            });
          }
        }
      );
      phaseOneClient.hydrateState(sourceClient.exportState());
      await expect(phaseOneClient.sync()).rejects.toThrow(
        new RegExp(`replayed opId ${duplicateOpId} during pull pagination`)
      );

      const phaseTwoGuardrailEvents: Array<{ stage: string; code: string }> =
        [];
      const phaseTwoPullCursorSignatures: string[] = [];
      const phaseTwoClient = new VfsBackgroundSyncClient(
        'user-1',
        'desktop',
        {
          pushOperations: async () => ({
            results: []
          }),
          pullOperations: async (input) => {
            phaseTwoPullCursorSignatures.push(
              input.cursor
                ? `${input.cursor.changedAt}|${input.cursor.changeId}`
                : 'null'
            );

            if (phaseTwoPullCursorSignatures.length === 1) {
              return {
                items: [
                  buildAclAddSyncItem({
                    opId: `desktop-seeded-chain-recover-1-${seed}`,
                    occurredAt: at(4),
                    itemId: `item-seeded-chain-recover-1-${seed}`
                  })
                ],
                hasMore: true,
                nextCursor: {
                  changedAt: at(4),
                  changeId: `desktop-seeded-chain-recover-1-${seed}`
                },
                lastReconciledWriteIds: {
                  desktop: desktopBase + 1,
                  mobile: mobileBase + 2,
                  remote: remoteBase + 1
                }
              };
            }

            return {
              items: [
                buildAclAddSyncItem({
                  opId: `desktop-seeded-chain-recover-2-${seed}`,
                  occurredAt: at(5),
                  itemId: `item-seeded-chain-recover-2-${seed}`
                })
              ],
              hasMore: false,
              nextCursor: {
                changedAt: at(5),
                changeId: `desktop-seeded-chain-recover-2-${seed}`
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
              mobile: mobileBase + 2,
              remote: remoteBase + 2
            }
          })
        },
        {
          pullLimit: 1,
          onGuardrailViolation: (violation) => {
            phaseTwoGuardrailEvents.push({
              stage: violation.stage,
              code: violation.code
            });
          }
        }
      );
      phaseTwoClient.hydrateState(phaseOneClient.exportState());
      await expect(phaseTwoClient.sync()).rejects.toThrow(
        /regressed lastReconciledWriteIds for replica mobile/
      );

      const phaseThreeGuardrailEvents: Array<{ stage: string; code: string }> =
        [];
      const phaseThreeClient = new VfsBackgroundSyncClient(
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
              changedAt: at(5),
              changeId: `desktop-seeded-chain-recover-2-${seed}`
            },
            lastReconciledWriteIds: {
              desktop: desktopBase + 2,
              mobile: mobileBase + 3,
              remote: remoteBase + 2
            }
          }),
          reconcileState: async (input) => ({
            cursor: input.cursor,
            lastReconciledWriteIds: {
              desktop: desktopBase + 3,
              mobile: mobileBase + 4,
              remote: remoteBase + 3
            }
          })
        },
        {
          pullLimit: 1,
          onGuardrailViolation: (violation) => {
            phaseThreeGuardrailEvents.push({
              stage: violation.stage,
              code: violation.code
            });
          }
        }
      );
      phaseThreeClient.hydrateState(phaseTwoClient.exportState());
      await phaseThreeClient.sync();

      const phaseOneGuardrails = toStageCodeSignatures(phaseOneGuardrailEvents);
      const phaseTwoGuardrails = toStageCodeSignatures(phaseTwoGuardrailEvents);
      const phaseThreeGuardrails = toStageCodeSignatures(
        phaseThreeGuardrailEvents
      );

      expect(phaseOneGuardrails).toEqual(['pull:pullDuplicateOpReplay']);
      expect(phaseTwoGuardrails).toEqual(['reconcile:lastWriteIdRegression']);
      expect(phaseThreeGuardrails).toEqual([]);
      expect(phaseTwoPullCursorSignatures).toEqual([
        `${at(2)}|${duplicateOpId}`,
        `${at(4)}|desktop-seeded-chain-recover-1-${seed}`
      ]);

      const forwardContainerSignatures = readForwardContainerSignatures({
        client: phaseThreeClient,
        seedCursor,
        pageLimit: 1
      });

      expect(forwardContainerSignatures).toEqual([
        `item-seeded-chain-dup-1-${seed}|${duplicateOpId}`,
        `item-seeded-chain-recover-1-${seed}|desktop-seeded-chain-recover-1-${seed}`,
        `item-seeded-chain-recover-2-${seed}|desktop-seeded-chain-recover-2-${seed}`
      ]);

      const finalWriteIds = JSON.stringify(
        phaseThreeClient.snapshot().lastReconciledWriteIds
      );
      expect(finalWriteIds).toBe(
        JSON.stringify({
          desktop: desktopBase + 3,
          mobile: mobileBase + 4,
          remote: remoteBase + 3
        })
      );

      return {
        phaseOneGuardrails,
        phaseTwoGuardrails,
        phaseTwoPullCursorSignatures,
        phaseThreeGuardrails,
        finalWriteIds,
        forwardContainerSignatures
      };
    };

    const seeds = [1991, 1992, 1993] as const;
    for (const seed of seeds) {
      const firstRun = await runScenario(seed);
      const secondRun = await runScenario(seed);
      expect(secondRun).toEqual(firstRun);
    }
  });

  it('reconciles stale write ids by rebasing local pending writes', async () => {
    const server = new InMemoryVfsCrdtSyncServer();
    await server.pushOperations({
      operations: [
        {
          opId: 'server-desktop-1',
          opType: 'acl_add',
          itemId: 'item-1',
          replicaId: 'desktop',
          writeId: 1,
          occurredAt: '2026-02-14T12:10:00.000Z',
          principalType: 'group',
          principalId: 'group-1',
          accessLevel: 'read'
        }
      ]
    });

    const client = new VfsBackgroundSyncClient(
      'user-1',
      'desktop',
      new InMemoryVfsCrdtSyncTransport(server)
    );
    client.queueLocalOperation({
      opType: 'acl_add',
      itemId: 'item-1',
      principalType: 'group',
      principalId: 'group-1',
      accessLevel: 'write',
      occurredAt: '2026-02-14T12:10:01.000Z'
    });

    const flushResult = await client.flush();
    expect(flushResult.pushedOperations).toBe(1);
    expect(flushResult.pullPages).toBe(1);

    const clientSnapshot = client.snapshot();
    const serverSnapshot = server.snapshot();
    expect(clientSnapshot.pendingOperations).toBe(0);
    expect(clientSnapshot.acl).toEqual(serverSnapshot.acl);
    expect(clientSnapshot.lastReconciledWriteIds).toEqual(
      serverSnapshot.lastReconciledWriteIds
    );
    expect(clientSnapshot.lastReconciledWriteIds).toEqual({
      desktop: 2
    });
    expect(clientSnapshot.nextLocalWriteId).toBe(3);
  });

  it('rebases pending occurredAt ahead of cursor before push', async () => {
    const server = new InMemoryVfsCrdtSyncServer();
    await server.pushOperations({
      operations: [
        {
          opId: 'server-mobile-1',
          opType: 'acl_add',
          itemId: 'item-1',
          replicaId: 'mobile',
          writeId: 1,
          occurredAt: '2026-02-14T12:30:00.000Z',
          principalType: 'group',
          principalId: 'group-1',
          accessLevel: 'read'
        }
      ]
    });

    const desktop = new VfsBackgroundSyncClient(
      'user-1',
      'desktop',
      new InMemoryVfsCrdtSyncTransport(server)
    );
    const observer = new VfsBackgroundSyncClient(
      'user-1',
      'observer',
      new InMemoryVfsCrdtSyncTransport(server)
    );

    await desktop.sync();
    const cursorBeforeQueue = desktop.snapshot().cursor;
    expect(cursorBeforeQueue?.changedAt).toBe('2026-02-14T12:30:00.000Z');

    const queued = desktop.queueLocalOperation({
      opType: 'acl_add',
      itemId: 'item-1',
      principalType: 'group',
      principalId: 'group-2',
      accessLevel: 'write',
      occurredAt: '2026-02-14T12:20:00.000Z'
    });
    await desktop.flush();
    await observer.sync();

    const pushedFeedItem = server
      .snapshot()
      .feed.find((item) => item.opId === queued.opId);
    expect(pushedFeedItem).toBeDefined();
    if (!pushedFeedItem) {
      throw new Error(`missing pushed feed item ${queued.opId}`);
    }

    /**
     * Guardrail assertion: normalized timestamps must stay strictly ahead of the
     * previously reconciled cursor to prevent canonical-feed backfill gaps.
     */
    const pushedOccurredAtMs = Date.parse(pushedFeedItem.occurredAt);
    const cursorMs = Date.parse(cursorBeforeQueue?.changedAt ?? '');
    expect(Number.isFinite(pushedOccurredAtMs)).toBe(true);
    expect(Number.isFinite(cursorMs)).toBe(true);
    expect(pushedOccurredAtMs).toBeGreaterThan(cursorMs);
    expect(observer.snapshot().acl).toEqual(server.snapshot().acl);
  });

  it('fails closed when stale write ids cannot be recovered', async () => {
    let pushAttempts = 0;
    let pullAttempts = 0;
    const guardrailViolations: Array<{
      code: string;
      stage: string;
      message: string;
    }> = [];
    const transport: VfsCrdtSyncTransport = {
      pushOperations: async (input) => {
        pushAttempts += 1;
        return {
          results: input.operations.map((operation) => ({
            opId: operation.opId,
            status: 'staleWriteId'
          }))
        };
      },
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
      onGuardrailViolation: (violation) => {
        guardrailViolations.push({
          code: violation.code,
          stage: violation.stage,
          message: violation.message
        });
      }
    });
    client.queueLocalOperation({
      opType: 'acl_add',
      itemId: 'item-1',
      principalType: 'group',
      principalId: 'group-1',
      accessLevel: 'read',
      occurredAt: '2026-02-14T12:10:01.000Z'
    });

    await expect(client.flush()).rejects.toBeInstanceOf(
      VfsCrdtSyncPushRejectedError
    );
    expect(client.snapshot().pendingOperations).toBe(1);
    expect(pushAttempts).toBe(3);
    expect(pullAttempts).toBe(2);
    expect(guardrailViolations).toContainEqual({
      code: 'staleWriteRecoveryExhausted',
      stage: 'flush',
      message:
        'stale write-id recovery exceeded max retry attempts without forward progress'
    });
  });

  it('converges concurrent clients when one client requires stale-write recovery', async () => {
    const server = new InMemoryVfsCrdtSyncServer();
    await server.pushOperations({
      operations: [
        {
          opId: 'server-desktop-1',
          opType: 'acl_add',
          itemId: 'item-1',
          replicaId: 'desktop',
          writeId: 1,
          occurredAt: '2026-02-14T12:15:00.000Z',
          principalType: 'group',
          principalId: 'group-1',
          accessLevel: 'read'
        }
      ]
    });

    const desktop = new VfsBackgroundSyncClient(
      'user-1',
      'desktop',
      new InMemoryVfsCrdtSyncTransport(server, {
        pushDelayMs: 10,
        pullDelayMs: 2
      })
    );
    const mobile = new VfsBackgroundSyncClient(
      'user-1',
      'mobile',
      new InMemoryVfsCrdtSyncTransport(server, {
        pushDelayMs: 1,
        pullDelayMs: 8
      })
    );

    desktop.queueLocalOperation({
      opType: 'acl_add',
      itemId: 'item-1',
      principalType: 'group',
      principalId: 'group-1',
      accessLevel: 'write',
      occurredAt: '2026-02-14T12:15:01.000Z'
    });
    mobile.queueLocalOperation({
      opType: 'link_add',
      itemId: 'item-1',
      parentId: 'root',
      childId: 'item-1',
      occurredAt: '2026-02-14T12:15:02.000Z'
    });

    await Promise.all([desktop.flush(), mobile.flush()]);
    await Promise.all([desktop.sync(), mobile.sync()]);

    const serverSnapshot = server.snapshot();
    const desktopSnapshot = desktop.snapshot();
    const mobileSnapshot = mobile.snapshot();
    expect(desktopSnapshot.pendingOperations).toBe(0);
    expect(mobileSnapshot.pendingOperations).toBe(0);
    expect(desktopSnapshot.acl).toEqual(serverSnapshot.acl);
    expect(mobileSnapshot.acl).toEqual(serverSnapshot.acl);
    expect(desktopSnapshot.links).toEqual(serverSnapshot.links);
    expect(mobileSnapshot.links).toEqual(serverSnapshot.links);
    expect(desktopSnapshot.lastReconciledWriteIds).toEqual(
      serverSnapshot.lastReconciledWriteIds
    );
    expect(mobileSnapshot.lastReconciledWriteIds).toEqual(
      serverSnapshot.lastReconciledWriteIds
    );
    expect(serverSnapshot.lastReconciledWriteIds).toEqual({
      desktop: 2,
      mobile: 1
    });
  });
});
