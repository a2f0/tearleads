import { describe, expect, it } from 'vitest';
import {
  buildAclAddSyncItem,
  createDeterministicRandom,
  createSeededIsoTimestampFactory,
  InMemoryVfsCrdtSyncServer,
  InMemoryVfsCrdtSyncTransport,
  nextInt,
  readForwardContainerSignatures,
  toStageCodeSignatures,
  VfsBackgroundSyncClient
} from './sync-client-test-support.js';

describe('VfsBackgroundSyncClient', () => {
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
});
