import { describe, expect, it } from 'vitest';
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
});
