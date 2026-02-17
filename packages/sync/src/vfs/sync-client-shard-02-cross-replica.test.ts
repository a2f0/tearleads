import { describe, expect, it } from 'vitest';
import {
  buildAclAddSyncItem,
  createDeterministicRandom,
  createSeededIsoTimestampFactory,
  InMemoryVfsCrdtSyncServer,
  InMemoryVfsCrdtSyncTransport,
  nextInt,
  VfsBackgroundSyncClient
} from './sync-client-test-support.js';

describe('VfsBackgroundSyncClient', () => {
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
