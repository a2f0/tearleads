import { describe, expect, it } from 'vitest';
import type { VfsCrdtSyncTransport } from './sync-client-test-support.js';
import {
  compareVfsSyncCursorOrder,
  createDeterministicRandom,
  InMemoryVfsCrdtSyncServer,
  InMemoryVfsCrdtSyncTransport,
  nextInt,
  pickOne,
  VfsBackgroundSyncClient
} from './sync-client-test-support.js';

describe('VfsBackgroundSyncClient', () => {
  it('hydrates when reconcile write-id lags pending queue without rolling back local write-id progression', async () => {
    const server = new InMemoryVfsCrdtSyncServer();
    await server.pushOperations({
      operations: [
        {
          opId: 'remote-1',
          opType: 'acl_add',
          itemId: 'item-writeid-lag',
          replicaId: 'remote',
          writeId: 1,
          occurredAt: '2026-02-14T14:25:00.000Z',
          principalType: 'group',
          principalId: 'group-1',
          accessLevel: 'read'
        }
      ]
    });
    const baseTransport = new InMemoryVfsCrdtSyncTransport(server);
    const sourceClient = new VfsBackgroundSyncClient(
      'user-1',
      'desktop',
      baseTransport
    );
    await sourceClient.sync();

    const persisted = sourceClient.exportState();
    persisted.reconcileState = {
      cursor: {
        changedAt: '2026-02-14T14:25:02.000Z',
        changeId: 'remote-2'
      },
      lastReconciledWriteIds: {
        desktop: 5
      }
    };
    persisted.pendingOperations = [
      {
        opId: 'desktop-10',
        opType: 'acl_add',
        itemId: 'item-writeid-lag',
        replicaId: 'desktop',
        writeId: 10,
        occurredAt: '2026-02-14T14:24:59.000Z',
        principalType: 'group',
        principalId: 'group-1',
        accessLevel: 'write'
      },
      {
        opId: 'desktop-11',
        opType: 'link_add',
        itemId: 'item-writeid-lag',
        replicaId: 'desktop',
        writeId: 11,
        occurredAt: '2026-02-14T14:24:58.000Z',
        parentId: 'root',
        childId: 'item-writeid-lag'
      }
    ];
    persisted.nextLocalWriteId = 2;

    const guardrailViolations: Array<{
      code: string;
      stage: string;
      message: string;
    }> = [];
    const pushedWriteIds: number[] = [];
    const transport: VfsCrdtSyncTransport = {
      pushOperations: async (input) => {
        pushedWriteIds.push(
          ...input.operations.map((operation) => operation.writeId)
        );
        return baseTransport.pushOperations(input);
      },
      pullOperations: (input) => baseTransport.pullOperations(input)
    };
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

    expect(() => resumedClient.hydrateState(persisted)).not.toThrow();
    expect(resumedClient.snapshot().nextLocalWriteId).toBe(12);
    await resumedClient.flush();

    expect(guardrailViolations).toEqual([]);
    expect(pushedWriteIds).toEqual([10, 11]);
    expect(resumedClient.snapshot().nextLocalWriteId).toBe(12);
    expect(resumedClient.snapshot().lastReconciledWriteIds.desktop).toBe(11);
  });

  it('preserves cursor and write-id monotonicity across two hydrate+flush cycles with reconcile-ahead lineage', async () => {
    const server = new InMemoryVfsCrdtSyncServer();
    await server.pushOperations({
      operations: [
        {
          opId: 'remote-1',
          opType: 'acl_add',
          itemId: 'item-two-cycle',
          replicaId: 'remote',
          writeId: 1,
          occurredAt: '2026-02-14T14:26:00.000Z',
          principalType: 'group',
          principalId: 'group-1',
          accessLevel: 'read'
        }
      ]
    });
    const baseTransport = new InMemoryVfsCrdtSyncTransport(server);
    const sourceClient = new VfsBackgroundSyncClient(
      'user-1',
      'desktop',
      baseTransport
    );
    await sourceClient.sync();

    const cycleOnePersisted = sourceClient.exportState();
    cycleOnePersisted.reconcileState = {
      cursor: {
        changedAt: '2026-02-14T14:26:02.000Z',
        changeId: 'remote-2'
      },
      lastReconciledWriteIds: {
        desktop: 5
      }
    };
    cycleOnePersisted.pendingOperations = [
      {
        opId: 'desktop-10',
        opType: 'acl_add',
        itemId: 'item-two-cycle',
        replicaId: 'desktop',
        writeId: 10,
        occurredAt: '2026-02-14T14:25:59.000Z',
        principalType: 'group',
        principalId: 'group-1',
        accessLevel: 'write'
      },
      {
        opId: 'desktop-11',
        opType: 'link_add',
        itemId: 'item-two-cycle',
        replicaId: 'desktop',
        writeId: 11,
        occurredAt: '2026-02-14T14:25:58.000Z',
        parentId: 'root',
        childId: 'item-two-cycle'
      }
    ];
    cycleOnePersisted.nextLocalWriteId = 1;

    const guardrailViolations: Array<{
      code: string;
      stage: string;
      message: string;
    }> = [];
    const cycleOnePushWriteIds: number[] = [];
    const cycleOneTransport: VfsCrdtSyncTransport = {
      pushOperations: async (input) => {
        cycleOnePushWriteIds.push(
          ...input.operations.map((operation) => operation.writeId)
        );
        return baseTransport.pushOperations(input);
      },
      pullOperations: (input) => baseTransport.pullOperations(input)
    };
    const cycleOneClient = new VfsBackgroundSyncClient(
      'user-1',
      'desktop',
      cycleOneTransport,
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
    cycleOneClient.hydrateState(cycleOnePersisted);
    await cycleOneClient.flush();
    expect(cycleOnePushWriteIds).toEqual([10, 11]);
    expect(cycleOneClient.snapshot().nextLocalWriteId).toBe(12);
    const cycleOneCursor = cycleOneClient.snapshot().cursor;
    if (!cycleOneCursor) {
      throw new Error('expected cycle one cursor');
    }

    const cycleTwoPersisted = cycleOneClient.exportState();
    cycleTwoPersisted.reconcileState = {
      cursor: {
        changedAt: '2026-02-14T14:26:06.000Z',
        changeId: 'remote-3'
      },
      lastReconciledWriteIds: {
        desktop: 15
      }
    };
    cycleTwoPersisted.pendingOperations = [
      {
        opId: 'desktop-16',
        opType: 'acl_remove',
        itemId: 'item-two-cycle',
        replicaId: 'desktop',
        writeId: 16,
        occurredAt: '2026-02-14T14:26:01.000Z',
        principalType: 'group',
        principalId: 'group-1'
      },
      {
        opId: 'desktop-17',
        opType: 'link_remove',
        itemId: 'item-two-cycle',
        replicaId: 'desktop',
        writeId: 17,
        occurredAt: '2026-02-14T14:26:00.000Z',
        parentId: 'root',
        childId: 'item-two-cycle'
      }
    ];
    cycleTwoPersisted.nextLocalWriteId = 3;

    const cycleTwoPushWriteIds: number[] = [];
    const cycleTwoTransport: VfsCrdtSyncTransport = {
      pushOperations: async (input) => {
        cycleTwoPushWriteIds.push(
          ...input.operations.map((operation) => operation.writeId)
        );
        return baseTransport.pushOperations(input);
      },
      pullOperations: (input) => baseTransport.pullOperations(input)
    };
    const cycleTwoClient = new VfsBackgroundSyncClient(
      'user-1',
      'desktop',
      cycleTwoTransport,
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
    cycleTwoClient.hydrateState(cycleTwoPersisted);
    await cycleTwoClient.flush();

    expect(guardrailViolations).toEqual([]);
    expect(cycleTwoPushWriteIds).toEqual([16, 17]);
    expect(cycleTwoClient.snapshot().nextLocalWriteId).toBe(18);
    const cycleTwoCursor = cycleTwoClient.snapshot().cursor;
    if (!cycleTwoCursor) {
      throw new Error('expected cycle two cursor');
    }

    expect(
      compareVfsSyncCursorOrder(cycleTwoCursor, cycleOneCursor)
    ).toBeGreaterThan(0);
    expect(cycleTwoClient.snapshot().lastReconciledWriteIds.desktop).toBe(17);
  });

  it('keeps cursor and write-id monotonicity across three deterministic restart cycles with alternating reconcile lineage', async () => {
    const server = new InMemoryVfsCrdtSyncServer();
    await server.pushOperations({
      operations: [
        {
          opId: 'remote-1',
          opType: 'acl_add',
          itemId: 'item-three-cycle-seed',
          replicaId: 'remote',
          writeId: 1,
          occurredAt: '2026-02-14T14:27:00.000Z',
          principalType: 'group',
          principalId: 'group-seed',
          accessLevel: 'read'
        }
      ]
    });
    const baseTransport = new InMemoryVfsCrdtSyncTransport(server);
    const seedClient = new VfsBackgroundSyncClient(
      'user-1',
      'desktop',
      baseTransport
    );
    await seedClient.sync();

    const random = createDeterministicRandom(1222);
    const parentIds = ['root', 'archive'] as const;
    const aclPrincipalTypes = ['group', 'organization'] as const;
    const aclAccessLevels = ['read', 'write', 'admin'] as const;
    const cycleWriteIdStarts = [10, 16, 23] as const;
    const reconcileModes = ['ahead', 'equal', 'ahead'] as const;
    const cyclePushWriteIds: number[][] = [];
    const guardrailViolations: Array<{
      code: string;
      stage: string;
      message: string;
    }> = [];

    let activeClient = seedClient;
    let previousCursor = seedClient.snapshot().cursor;

    for (const [index, cycleStartWriteId] of cycleWriteIdStarts.entries()) {
      const persisted = activeClient.exportState();
      const replayCursor = persisted.replaySnapshot.cursor;
      if (!replayCursor) {
        throw new Error(`expected replay cursor before cycle ${index + 1}`);
      }

      const reconcileMode = reconcileModes[index];
      if (reconcileMode === 'ahead') {
        const replayCursorMs = Date.parse(replayCursor.changedAt);
        const aheadCursorMs = Number.isFinite(replayCursorMs)
          ? replayCursorMs + 2_000
          : Date.parse('2026-02-14T14:27:10.000Z') + index;
        persisted.reconcileState = {
          cursor: {
            changedAt: new Date(aheadCursorMs).toISOString(),
            changeId: `remote-cycle-${index + 2}`
          },
          lastReconciledWriteIds: {
            desktop: Math.max(0, cycleStartWriteId - 3)
          }
        };
      } else {
        persisted.reconcileState = {
          cursor: replayCursor,
          lastReconciledWriteIds: {
            desktop: Math.max(0, cycleStartWriteId - 3)
          }
        };
      }

      const opVariant = nextInt(random, 0, 1);
      const itemId = `item-three-cycle-${index + 1}`;
      const firstOccurredAt = new Date(
        Date.parse('2026-02-14T14:26:40.000Z') - index * 1_000
      ).toISOString();
      const secondOccurredAt = new Date(
        Date.parse('2026-02-14T14:26:39.000Z') - index * 1_000
      ).toISOString();
      const aclPrincipalType = pickOne(aclPrincipalTypes, random);
      const aclPrincipalId = `${aclPrincipalType}-${index + 1}`;
      const aclAccessLevel = pickOne(aclAccessLevels, random);
      const parentId = pickOne(parentIds, random);

      persisted.pendingOperations =
        opVariant === 0
          ? [
              {
                opId: `desktop-${cycleStartWriteId}`,
                opType: 'acl_add',
                itemId,
                replicaId: 'desktop',
                writeId: cycleStartWriteId,
                occurredAt: firstOccurredAt,
                principalType: aclPrincipalType,
                principalId: aclPrincipalId,
                accessLevel: aclAccessLevel
              },
              {
                opId: `desktop-${cycleStartWriteId + 1}`,
                opType: 'link_add',
                itemId,
                replicaId: 'desktop',
                writeId: cycleStartWriteId + 1,
                occurredAt: secondOccurredAt,
                parentId,
                childId: itemId
              }
            ]
          : [
              {
                opId: `desktop-${cycleStartWriteId}`,
                opType: 'link_remove',
                itemId,
                replicaId: 'desktop',
                writeId: cycleStartWriteId,
                occurredAt: firstOccurredAt,
                parentId,
                childId: itemId
              },
              {
                opId: `desktop-${cycleStartWriteId + 1}`,
                opType: 'acl_remove',
                itemId,
                replicaId: 'desktop',
                writeId: cycleStartWriteId + 1,
                occurredAt: secondOccurredAt,
                principalType: aclPrincipalType,
                principalId: aclPrincipalId
              }
            ];
      persisted.nextLocalWriteId = 1;

      const pushedWriteIds: number[] = [];
      const pushedOccurredAtMs: number[] = [];
      const transport: VfsCrdtSyncTransport = {
        pushOperations: async (input) => {
          for (const operation of input.operations) {
            pushedWriteIds.push(operation.writeId);
            pushedOccurredAtMs.push(Date.parse(operation.occurredAt));
          }
          return baseTransport.pushOperations(input);
        },
        pullOperations: (input) => baseTransport.pullOperations(input)
      };
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

      resumedClient.hydrateState(persisted);
      await resumedClient.flush();
      cyclePushWriteIds.push(pushedWriteIds);

      expect(pushedWriteIds).toEqual([
        cycleStartWriteId,
        cycleStartWriteId + 1
      ]);
      expect(resumedClient.snapshot().nextLocalWriteId).toBe(
        cycleStartWriteId + 2
      );

      const persistedCursor = persisted.reconcileState?.cursor ?? replayCursor;
      const persistedCursorMs = Date.parse(persistedCursor.changedAt);
      const firstPushedOccurredAtMs = pushedOccurredAtMs[0];
      const secondPushedOccurredAtMs = pushedOccurredAtMs[1];
      if (
        firstPushedOccurredAtMs === undefined ||
        secondPushedOccurredAtMs === undefined
      ) {
        throw new Error(`expected pushed timestamps for cycle ${index + 1}`);
      }
      expect(firstPushedOccurredAtMs).toBeGreaterThan(persistedCursorMs);
      expect(secondPushedOccurredAtMs).toBeGreaterThan(firstPushedOccurredAtMs);

      const cycleCursor = resumedClient.snapshot().cursor;
      if (!cycleCursor) {
        throw new Error(`expected cycle cursor for cycle ${index + 1}`);
      }
      if (previousCursor) {
        expect(
          compareVfsSyncCursorOrder(cycleCursor, previousCursor)
        ).toBeGreaterThan(0);
      }

      expect(resumedClient.snapshot().lastReconciledWriteIds.desktop).toBe(
        cycleStartWriteId + 1
      );

      previousCursor = cycleCursor;
      activeClient = resumedClient;
    }

    expect(cyclePushWriteIds).toEqual([
      [10, 11],
      [16, 17],
      [23, 24]
    ]);
    expect(guardrailViolations).toEqual([]);
  });

  it('normalizes repeated reconcile write-id lag under replay-aligned restart cycles without guardrail noise', async () => {
    const server = new InMemoryVfsCrdtSyncServer();
    await server.pushOperations({
      operations: [
        {
          opId: 'remote-1',
          opType: 'acl_add',
          itemId: 'item-lag-cycle-seed',
          replicaId: 'remote',
          writeId: 1,
          occurredAt: '2026-02-14T14:29:00.000Z',
          principalType: 'group',
          principalId: 'group-seed',
          accessLevel: 'read'
        }
      ]
    });
    const baseTransport = new InMemoryVfsCrdtSyncTransport(server);
    const seedClient = new VfsBackgroundSyncClient(
      'user-1',
      'desktop',
      baseTransport
    );
    await seedClient.sync();

    const random = createDeterministicRandom(1223);
    const parentIds = ['root', 'archive'] as const;
    const principalTypes = ['group', 'organization'] as const;
    const accessLevels = ['read', 'write', 'admin'] as const;
    const cycleWriteIdStarts = [12, 20, 29] as const;
    const cyclePushWriteIds: number[][] = [];
    const guardrailViolations: Array<{
      code: string;
      stage: string;
      message: string;
    }> = [];

    let activeClient = seedClient;
    let previousCycleCursor = seedClient.snapshot().cursor;

    for (const [index, cycleStartWriteId] of cycleWriteIdStarts.entries()) {
      const persisted = activeClient.exportState();
      const replayCursor = persisted.replaySnapshot.cursor;
      if (!replayCursor) {
        throw new Error(`expected replay cursor before cycle ${index + 1}`);
      }

      persisted.reconcileState = {
        cursor: replayCursor,
        lastReconciledWriteIds: {
          desktop: Math.max(0, cycleStartWriteId - 7)
        }
      };

      const itemId = `item-lag-cycle-${index + 1}`;
      const principalType = pickOne(principalTypes, random);
      const principalId = `${principalType}-lag-${index + 1}`;
      const accessLevel = pickOne(accessLevels, random);
      const parentId = pickOne(parentIds, random);
      const firstOccurredAt = new Date(
        Date.parse('2026-02-14T14:28:40.000Z') - index * 1_000
      ).toISOString();
      const secondOccurredAt = new Date(
        Date.parse('2026-02-14T14:28:39.000Z') - index * 1_000
      ).toISOString();
      persisted.pendingOperations = [
        {
          opId: `desktop-${cycleStartWriteId}`,
          opType: 'acl_add',
          itemId,
          replicaId: 'desktop',
          writeId: cycleStartWriteId,
          occurredAt: firstOccurredAt,
          principalType,
          principalId,
          accessLevel
        },
        {
          opId: `desktop-${cycleStartWriteId + 1}`,
          opType: 'link_add',
          itemId,
          replicaId: 'desktop',
          writeId: cycleStartWriteId + 1,
          occurredAt: secondOccurredAt,
          parentId,
          childId: itemId
        }
      ];
      persisted.nextLocalWriteId = 1;

      const pushedWriteIds: number[] = [];
      const pushedOccurredAtMs: number[] = [];
      const transport: VfsCrdtSyncTransport = {
        pushOperations: async (input) => {
          for (const operation of input.operations) {
            pushedWriteIds.push(operation.writeId);
            pushedOccurredAtMs.push(Date.parse(operation.occurredAt));
          }
          return baseTransport.pushOperations(input);
        },
        pullOperations: (input) => baseTransport.pullOperations(input)
      };
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

      expect(() => resumedClient.hydrateState(persisted)).not.toThrow();
      await resumedClient.flush();
      cyclePushWriteIds.push(pushedWriteIds);

      expect(pushedWriteIds).toEqual([
        cycleStartWriteId,
        cycleStartWriteId + 1
      ]);
      expect(resumedClient.snapshot().nextLocalWriteId).toBe(
        cycleStartWriteId + 2
      );
      expect(resumedClient.snapshot().lastReconciledWriteIds.desktop).toBe(
        cycleStartWriteId + 1
      );

      const firstPushedOccurredAtMs = pushedOccurredAtMs[0];
      const secondPushedOccurredAtMs = pushedOccurredAtMs[1];
      if (
        firstPushedOccurredAtMs === undefined ||
        secondPushedOccurredAtMs === undefined
      ) {
        throw new Error(`expected pushed timestamps for cycle ${index + 1}`);
      }

      const replayCursorMs = Date.parse(replayCursor.changedAt);
      expect(firstPushedOccurredAtMs).toBeGreaterThan(replayCursorMs);
      expect(secondPushedOccurredAtMs).toBeGreaterThan(firstPushedOccurredAtMs);

      const resumedState = resumedClient.exportState();
      expect(resumedState.replaySnapshot.cursor).not.toBeNull();
      expect(resumedState.reconcileState?.cursor).toEqual(
        resumedState.replaySnapshot.cursor
      );

      const cycleCursor = resumedClient.snapshot().cursor;
      if (!cycleCursor) {
        throw new Error(`expected cycle cursor for cycle ${index + 1}`);
      }
      if (previousCycleCursor) {
        expect(
          compareVfsSyncCursorOrder(cycleCursor, previousCycleCursor)
        ).toBeGreaterThan(0);
      }

      previousCycleCursor = cycleCursor;
      activeClient = resumedClient;
    }

    expect(cyclePushWriteIds).toEqual([
      [12, 13],
      [20, 21],
      [29, 30]
    ]);
    expect(guardrailViolations).toEqual([]);
  });

  it('fails closed on boundary opId collision during later replay-aligned restart cycle and keeps state pristine', async () => {
    const server = new InMemoryVfsCrdtSyncServer();
    await server.pushOperations({
      operations: [
        {
          opId: 'remote-1',
          opType: 'acl_add',
          itemId: 'item-boundary-collision',
          replicaId: 'remote',
          writeId: 1,
          occurredAt: '2026-02-14T14:30:00.000Z',
          principalType: 'group',
          principalId: 'group-1',
          accessLevel: 'read'
        }
      ]
    });
    const baseTransport = new InMemoryVfsCrdtSyncTransport(server);
    const sourceClient = new VfsBackgroundSyncClient(
      'user-1',
      'desktop',
      baseTransport
    );
    await sourceClient.sync();

    const cycleOnePersisted = sourceClient.exportState();
    const cycleOneReplayCursor = cycleOnePersisted.replaySnapshot.cursor;
    if (!cycleOneReplayCursor) {
      throw new Error('expected cycle-one replay cursor');
    }
    cycleOnePersisted.reconcileState = {
      cursor: cycleOneReplayCursor,
      lastReconciledWriteIds: {
        desktop: 6
      }
    };
    cycleOnePersisted.pendingOperations = [
      {
        opId: 'desktop-10',
        opType: 'acl_add',
        itemId: 'item-boundary-collision',
        replicaId: 'desktop',
        writeId: 10,
        occurredAt: '2026-02-14T14:29:59.000Z',
        principalType: 'group',
        principalId: 'group-1',
        accessLevel: 'write'
      },
      {
        opId: 'desktop-11',
        opType: 'link_add',
        itemId: 'item-boundary-collision',
        replicaId: 'desktop',
        writeId: 11,
        occurredAt: '2026-02-14T14:29:58.000Z',
        parentId: 'root',
        childId: 'item-boundary-collision'
      }
    ];
    cycleOnePersisted.nextLocalWriteId = 1;

    const cycleOneClient = new VfsBackgroundSyncClient(
      'user-1',
      'desktop',
      baseTransport
    );
    cycleOneClient.hydrateState(cycleOnePersisted);
    await cycleOneClient.flush();

    const preCollisionServerSnapshot = server.snapshot();
    const cycleTwoPersisted = cycleOneClient.exportState();
    const cycleTwoReplayCursor = cycleTwoPersisted.replaySnapshot.cursor;
    if (!cycleTwoReplayCursor) {
      throw new Error('expected cycle-two replay cursor');
    }
    cycleTwoPersisted.reconcileState = {
      cursor: cycleTwoReplayCursor,
      lastReconciledWriteIds: {
        desktop: 9
      }
    };

    const collidingOpId = cycleTwoReplayCursor.changeId;
    cycleTwoPersisted.pendingOperations = [
      {
        opId: collidingOpId,
        opType: 'acl_remove',
        itemId: 'item-boundary-collision',
        replicaId: 'desktop',
        writeId: 16,
        occurredAt: '2026-02-14T14:29:57.000Z',
        principalType: 'group',
        principalId: 'group-1'
      },
      {
        opId: 'desktop-17',
        opType: 'link_remove',
        itemId: 'item-boundary-collision',
        replicaId: 'desktop',
        writeId: 17,
        occurredAt: '2026-02-14T14:29:56.000Z',
        parentId: 'root',
        childId: 'item-boundary-collision'
      }
    ];
    cycleTwoPersisted.nextLocalWriteId = 1;

    let pushedOperationCount = 0;
    const guardrailViolations: Array<{
      code: string;
      stage: string;
      message: string;
    }> = [];
    const trackingTransport: VfsCrdtSyncTransport = {
      pushOperations: async (input) => {
        pushedOperationCount += input.operations.length;
        return baseTransport.pushOperations(input);
      },
      pullOperations: (input) => baseTransport.pullOperations(input)
    };
    const cycleTwoClient = new VfsBackgroundSyncClient(
      'user-1',
      'desktop',
      trackingTransport,
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
    const pristineState = cycleTwoClient.exportState();
    const expectedMessage = `state.pendingOperations contains opId ${collidingOpId} that collides with persisted cursor boundary`;

    expect(() => cycleTwoClient.hydrateState(cycleTwoPersisted)).toThrow(
      expectedMessage
    );
    expect(guardrailViolations).toEqual([
      {
        code: 'hydrateGuardrailViolation',
        stage: 'hydrate',
        message: expectedMessage
      }
    ]);
    expect(cycleTwoClient.exportState()).toEqual(pristineState);
    expect(pushedOperationCount).toBe(0);
    expect(server.snapshot()).toEqual(preCollisionServerSnapshot);
  });
});
