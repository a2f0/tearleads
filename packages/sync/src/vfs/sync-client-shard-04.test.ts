import { describe, expect, it } from 'vitest';
import type { VfsCrdtSyncTransport } from './sync-client-test-support.js';
import {
  compareVfsSyncCursorOrder,
  createDeterministicJitterTransport,
  createDeterministicRandom,
  InMemoryVfsCrdtSyncServer,
  InMemoryVfsCrdtSyncTransport,
  nextInt,
  pickDifferent,
  pickOne,
  VfsBackgroundSyncClient
} from './sync-client-test-support.js';

describe('VfsBackgroundSyncClient', () => {
  it('converges deterministic randomized concurrent io across three clients', async () => {
    /**
     * Guardrail: this seeded stress scenario is intentionally non-trivial so we
     * exercise interleavings of queue/flush/sync across multiple clients, but
     * deterministic so any regression is reproducible by seed.
     */
    const random = createDeterministicRandom(1220);
    const server = new InMemoryVfsCrdtSyncServer();
    const canonicalClock = {
      currentMs: Date.parse('2026-02-14T00:00:00.000Z')
    };
    const clientIds = ['desktop', 'mobile', 'tablet'] as const;
    const clients = clientIds.map(
      (clientId) =>
        new VfsBackgroundSyncClient(
          'user-1',
          clientId,
          createDeterministicJitterTransport({
            server,
            random,
            maxDelayMs: 4,
            canonicalClock
          }),
          {
            pullLimit: nextInt(random, 1, 3)
          }
        )
    );

    const itemIds = ['item-1', 'item-2', 'item-3', 'item-4'] as const;
    const parentIds = ['root', 'folder-1', 'folder-2'] as const;
    const principalTypes = ['group', 'organization', 'user'] as const;
    const principalIds = ['group-1', 'org-1', 'user-2'] as const;
    const accessLevels = ['read', 'write', 'admin'] as const;
    let occurredAtMs = Date.parse('2026-02-14T13:00:00.000Z');
    const nextOccurredAt = (): string => {
      const value = new Date(occurredAtMs).toISOString();
      occurredAtMs += 1000;
      return value;
    };

    for (let round = 0; round < 60; round++) {
      const actor = pickOne(clients, random);
      const peer = pickDifferent(clients, actor, random);
      const itemId = pickOne(itemIds, random);
      const operationVariant = nextInt(random, 0, 3);
      if (operationVariant === 0) {
        actor.queueLocalOperation({
          opType: 'acl_add',
          itemId,
          principalType: pickOne(principalTypes, random),
          principalId: pickOne(principalIds, random),
          accessLevel: pickOne(accessLevels, random),
          occurredAt: nextOccurredAt()
        });
      } else if (operationVariant === 1) {
        actor.queueLocalOperation({
          opType: 'acl_remove',
          itemId,
          principalType: pickOne(principalTypes, random),
          principalId: pickOne(principalIds, random),
          occurredAt: nextOccurredAt()
        });
      } else if (operationVariant === 2) {
        actor.queueLocalOperation({
          opType: 'link_add',
          itemId,
          parentId: pickOne(parentIds, random),
          childId: itemId,
          occurredAt: nextOccurredAt()
        });
      } else {
        actor.queueLocalOperation({
          opType: 'link_remove',
          itemId,
          parentId: pickOne(parentIds, random),
          childId: itemId,
          occurredAt: nextOccurredAt()
        });
      }

      const actionVariant = nextInt(random, 0, 5);
      if (actionVariant === 0) {
        await Promise.all([actor.flush(), peer.sync()]);
      } else if (actionVariant === 1) {
        await Promise.all([actor.sync(), peer.flush()]);
      } else if (actionVariant === 2) {
        await Promise.all([actor.flush(), peer.flush()]);
      } else if (actionVariant === 3) {
        await Promise.all([actor.sync(), peer.sync()]);
      } else if (actionVariant === 4) {
        await actor.flush();
      } else {
        await actor.sync();
      }
    }
    await Promise.all(clients.map((client) => client.flush()));
    for (let index = 0; index < 3; index++) {
      await Promise.all(clients.map((client) => client.sync()));
    }

    const serverSnapshot = server.snapshot();
    const baseClientSnapshot = clients[0].snapshot();

    for (const client of clients) {
      const snapshot = client.snapshot();
      expect(snapshot.pendingOperations).toBe(0);
      expect(snapshot.acl).toEqual(serverSnapshot.acl);
      expect(snapshot.links).toEqual(serverSnapshot.links);
      expect(snapshot.lastReconciledWriteIds).toEqual(
        serverSnapshot.lastReconciledWriteIds
      );
      expect(snapshot.containerClocks).toEqual(
        baseClientSnapshot.containerClocks
      );
    }

    for (let index = 0; index < clientIds.length; index++) {
      const clientId = clientIds[index];
      const client = clients[index];
      if (!client) {
        throw new Error(`missing client for replica ${clientId}`);
      }

      const replicaWriteId =
        serverSnapshot.lastReconciledWriteIds[clientId] ?? 0;
      expect(client.snapshot().nextLocalWriteId).toBeGreaterThanOrEqual(
        replicaWriteId + 1
      );
    }
  });

  it('converges deterministic randomized io with in-loop restart hydration', async () => {
    /**
     * Guardrail stress harness:
     * - deterministic randomized interleavings for reproducibility
     * - process-restart simulation in-loop via exportState/hydrateState
     * - replay cursor monotonicity checks after every step
     */
    const random = createDeterministicRandom(1221);
    const server = new InMemoryVfsCrdtSyncServer();
    const canonicalClock = {
      currentMs: Date.parse('2026-02-14T00:30:00.000Z')
    };
    const clientIds = ['desktop', 'mobile', 'tablet'] as const;

    const pullLimitByClient = new Map<string, number>();
    const transportByClient = new Map<string, VfsCrdtSyncTransport>();
    const clientsByClient = new Map<string, VfsBackgroundSyncClient>();
    for (const clientId of clientIds) {
      pullLimitByClient.set(clientId, nextInt(random, 1, 3));
      transportByClient.set(
        clientId,
        createDeterministicJitterTransport({
          server,
          random,
          maxDelayMs: 4,
          canonicalClock
        })
      );
    }

    const createClient = (clientId: string): VfsBackgroundSyncClient => {
      const transport = transportByClient.get(clientId);
      if (!transport) {
        throw new Error(`missing transport for replica ${clientId}`);
      }
      const pullLimit = pullLimitByClient.get(clientId);
      if (!pullLimit) {
        throw new Error(`missing pull limit for replica ${clientId}`);
      }

      return new VfsBackgroundSyncClient('user-1', clientId, transport, {
        pullLimit
      });
    };

    const getClient = (clientId: string): VfsBackgroundSyncClient => {
      const client = clientsByClient.get(clientId);
      if (!client) {
        throw new Error(`missing client for replica ${clientId}`);
      }

      return client;
    };

    for (const clientId of clientIds) {
      clientsByClient.set(clientId, createClient(clientId));
    }

    const lastReplayCursorByClient = new Map<
      string,
      { changedAt: string; changeId: string }
    >();
    const restartCursorFloorByClient = new Map<
      string,
      { changedAt: string; changeId: string }
    >();
    let restartHydrateCount = 0;
    let restartFloorChecks = 0;
    const assertReplayCursorMonotonic = (clientId: string): void => {
      const cursor = getClient(clientId).exportState().replaySnapshot.cursor;
      const previousCursor = lastReplayCursorByClient.get(clientId);
      const restartFloorCursor = restartCursorFloorByClient.get(clientId);

      if (previousCursor && !cursor) {
        throw new Error(`replay cursor regressed to null for ${clientId}`);
      }

      if (previousCursor && cursor) {
        expect(
          compareVfsSyncCursorOrder(cursor, previousCursor)
        ).toBeGreaterThanOrEqual(0);
      }

      if (restartFloorCursor && cursor) {
        restartFloorChecks += 1;
        expect(
          compareVfsSyncCursorOrder(cursor, restartFloorCursor)
        ).toBeGreaterThanOrEqual(0);
      }

      if (cursor) {
        lastReplayCursorByClient.set(clientId, {
          changedAt: cursor.changedAt,
          changeId: cursor.changeId
        });
      }
    };

    const itemIds = ['item-r1', 'item-r2', 'item-r3', 'item-r4'] as const;
    const parentIds = ['root', 'folder-r1', 'folder-r2'] as const;
    const principalTypes = ['group', 'organization', 'user'] as const;
    const principalIds = ['group-r1', 'org-r1', 'user-r2'] as const;
    const accessLevels = ['read', 'write', 'admin'] as const;
    let occurredAtMs = Date.parse('2026-02-14T13:30:00.000Z');
    const nextOccurredAt = (): string => {
      const value = new Date(occurredAtMs).toISOString();
      occurredAtMs += 1000;
      return value;
    };

    for (let round = 0; round < 55; round++) {
      if (nextInt(random, 0, 7) === 0) {
        const restartClientId = pickOne(clientIds, random);
        const restartClient = getClient(restartClientId);
        /**
         * Guardrail: this scenario targets replay-cursor monotonicity under
         * restart churn, so only restart quiescent replicas to avoid conflating
         * cursor regressions with pending-write transport timing.
         */
        if (restartClient.snapshot().pendingOperations === 0) {
          const persistedState = restartClient.exportState();
          const persistedCursor = persistedState.replaySnapshot.cursor;
          if (persistedCursor) {
            const existingFloor =
              restartCursorFloorByClient.get(restartClientId);
            if (
              !existingFloor ||
              compareVfsSyncCursorOrder(persistedCursor, existingFloor) > 0
            ) {
              restartCursorFloorByClient.set(restartClientId, {
                changedAt: persistedCursor.changedAt,
                changeId: persistedCursor.changeId
              });
            }
          }
          const restartedClient = createClient(restartClientId);
          restartedClient.hydrateState(persistedState);
          clientsByClient.set(restartClientId, restartedClient);
          restartHydrateCount += 1;
          assertReplayCursorMonotonic(restartClientId);
        }
      }

      const activeClients = clientIds.map((clientId) => getClient(clientId));
      const actor = pickOne(activeClients, random);
      const peer = pickDifferent(activeClients, actor, random);
      const itemId = pickOne(itemIds, random);
      const operationVariant = nextInt(random, 0, 3);
      if (operationVariant === 0) {
        actor.queueLocalOperation({
          opType: 'acl_add',
          itemId,
          principalType: pickOne(principalTypes, random),
          principalId: pickOne(principalIds, random),
          accessLevel: pickOne(accessLevels, random),
          occurredAt: nextOccurredAt()
        });
      } else if (operationVariant === 1) {
        actor.queueLocalOperation({
          opType: 'acl_remove',
          itemId,
          principalType: pickOne(principalTypes, random),
          principalId: pickOne(principalIds, random),
          occurredAt: nextOccurredAt()
        });
      } else if (operationVariant === 2) {
        actor.queueLocalOperation({
          opType: 'link_add',
          itemId,
          parentId: pickOne(parentIds, random),
          childId: itemId,
          occurredAt: nextOccurredAt()
        });
      } else {
        actor.queueLocalOperation({
          opType: 'link_remove',
          itemId,
          parentId: pickOne(parentIds, random),
          childId: itemId,
          occurredAt: nextOccurredAt()
        });
      }

      const actionVariant = nextInt(random, 0, 5);
      if (actionVariant === 0) {
        await Promise.all([actor.flush(), peer.sync()]);
      } else if (actionVariant === 1) {
        await Promise.all([actor.sync(), peer.flush()]);
      } else if (actionVariant === 2) {
        await Promise.all([actor.flush(), peer.flush()]);
      } else if (actionVariant === 3) {
        await Promise.all([actor.sync(), peer.sync()]);
      } else if (actionVariant === 4) {
        await actor.flush();
      } else {
        await actor.sync();
      }

      for (const clientId of clientIds) {
        assertReplayCursorMonotonic(clientId);
      }
    }

    if (restartHydrateCount === 0) {
      const forcedRestartClientId = 'desktop';
      const forcedRestartClient = getClient(forcedRestartClientId);
      await forcedRestartClient.flush();
      const persistedState = forcedRestartClient.exportState();
      const persistedCursor = persistedState.replaySnapshot.cursor;
      if (persistedCursor) {
        restartCursorFloorByClient.set(forcedRestartClientId, {
          changedAt: persistedCursor.changedAt,
          changeId: persistedCursor.changeId
        });
      }
      const restartedClient = createClient(forcedRestartClientId);
      restartedClient.hydrateState(persistedState);
      clientsByClient.set(forcedRestartClientId, restartedClient);
      restartHydrateCount += 1;
      assertReplayCursorMonotonic(forcedRestartClientId);
    }

    expect(restartHydrateCount).toBeGreaterThan(0);
    expect(restartFloorChecks).toBeGreaterThan(0);

    const finalClients = clientIds.map((clientId) => getClient(clientId));
    await Promise.all(finalClients.map((client) => client.flush()));
    for (let index = 0; index < 8; index++) {
      await Promise.all(finalClients.map((client) => client.sync()));
    }

    for (const clientId of clientIds) {
      const snapshot = getClient(clientId).snapshot();
      expect(snapshot.pendingOperations).toBe(0);
      const replicaWriteId = snapshot.lastReconciledWriteIds[clientId] ?? 0;
      expect(snapshot.nextLocalWriteId).toBeGreaterThanOrEqual(
        replicaWriteId + 1
      );
    }
  });

  it('restores persisted state and converges after restart with concurrent updates', async () => {
    const server = new InMemoryVfsCrdtSyncServer();
    const desktopTransport = new InMemoryVfsCrdtSyncTransport(server, {
      pushDelayMs: 10,
      pullDelayMs: 4
    });
    const mobileTransport = new InMemoryVfsCrdtSyncTransport(server, {
      pushDelayMs: 2,
      pullDelayMs: 8
    });
    const observerTransport = new InMemoryVfsCrdtSyncTransport(server, {
      pushDelayMs: 1,
      pullDelayMs: 1
    });

    const desktop = new VfsBackgroundSyncClient(
      'user-1',
      'desktop',
      desktopTransport,
      { pullLimit: 2 }
    );
    const mobile = new VfsBackgroundSyncClient(
      'user-1',
      'mobile',
      mobileTransport,
      {
        pullLimit: 1
      }
    );
    const observer = new VfsBackgroundSyncClient(
      'user-1',
      'observer',
      observerTransport,
      { pullLimit: 3 }
    );

    mobile.queueLocalOperation({
      opType: 'acl_add',
      itemId: 'item-1',
      principalType: 'group',
      principalId: 'group-1',
      accessLevel: 'read',
      occurredAt: '2026-02-14T14:00:00.000Z'
    });
    await mobile.flush();
    await desktop.sync();

    desktop.queueLocalOperation({
      opType: 'acl_add',
      itemId: 'item-2',
      principalType: 'organization',
      principalId: 'org-1',
      accessLevel: 'write',
      occurredAt: '2026-02-14T13:00:00.000Z'
    });
    desktop.queueLocalOperation({
      opType: 'link_add',
      itemId: 'item-2',
      parentId: 'root',
      childId: 'item-2',
      occurredAt: '2026-02-14T13:00:01.000Z'
    });

    const persistedDesktopState = desktop.exportState();

    /**
     * Guardrail scenario: simulate process restart by constructing a new client
     * instance and hydrating persisted state before any network activity.
     */
    const resumedDesktop = new VfsBackgroundSyncClient(
      'user-1',
      'desktop',
      desktopTransport,
      { pullLimit: 2 }
    );
    resumedDesktop.hydrateState(persistedDesktopState);

    mobile.queueLocalOperation({
      opType: 'link_add',
      itemId: 'item-1',
      parentId: 'root',
      childId: 'item-1',
      occurredAt: '2026-02-14T14:00:01.000Z'
    });
    mobile.queueLocalOperation({
      opType: 'acl_add',
      itemId: 'item-1',
      principalType: 'group',
      principalId: 'group-1',
      accessLevel: 'admin',
      occurredAt: '2026-02-14T14:00:02.000Z'
    });

    await Promise.all([mobile.flush(), resumedDesktop.flush()]);
    await Promise.all([mobile.sync(), resumedDesktop.sync(), observer.sync()]);

    const serverSnapshot = server.snapshot();
    const resumedSnapshot = resumedDesktop.snapshot();
    const observerSnapshot = observer.snapshot();

    expect(resumedSnapshot.pendingOperations).toBe(0);
    expect(resumedSnapshot.acl).toEqual(serverSnapshot.acl);
    expect(resumedSnapshot.links).toEqual(serverSnapshot.links);
    expect(resumedSnapshot.lastReconciledWriteIds).toEqual(
      serverSnapshot.lastReconciledWriteIds
    );
    expect(observerSnapshot.acl).toEqual(serverSnapshot.acl);
    expect(observerSnapshot.links).toEqual(serverSnapshot.links);
    expect(resumedSnapshot.nextLocalWriteId).toBeGreaterThanOrEqual(
      (serverSnapshot.lastReconciledWriteIds['desktop'] ?? 0) + 1
    );
  });

  it('fails closed when hydrated pending operations reference another replica', () => {
    const guardrailViolations: Array<{
      code: string;
      stage: string;
      message: string;
    }> = [];
    const client = new VfsBackgroundSyncClient(
      'user-1',
      'desktop',
      new InMemoryVfsCrdtSyncTransport(new InMemoryVfsCrdtSyncServer()),
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

    const persisted = client.exportState();
    persisted.pendingOperations = [
      {
        opId: 'mobile-1',
        opType: 'acl_add',
        itemId: 'item-1',
        replicaId: 'mobile',
        writeId: 1,
        occurredAt: '2026-02-14T14:10:00.000Z',
        principalType: 'group',
        principalId: 'group-1',
        accessLevel: 'read'
      }
    ];
    persisted.nextLocalWriteId = 2;

    expect(() => client.hydrateState(persisted)).toThrowError(
      /replicaId that does not match clientId/
    );
    expect(guardrailViolations).toContainEqual({
      code: 'hydrateGuardrailViolation',
      stage: 'hydrate',
      message:
        'state.pendingOperations[0] has replicaId that does not match clientId'
    });
  });

  it('fails closed when hydrated link pending operation has mismatched childId', () => {
    const guardrailViolations: Array<{
      code: string;
      stage: string;
      message: string;
    }> = [];
    const client = new VfsBackgroundSyncClient(
      'user-1',
      'desktop',
      new InMemoryVfsCrdtSyncTransport(new InMemoryVfsCrdtSyncServer()),
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

    const persisted = client.exportState();
    persisted.pendingOperations = [
      {
        opId: 'desktop-link-1',
        opType: 'link_add',
        itemId: 'item-1',
        replicaId: 'desktop',
        writeId: 1,
        occurredAt: '2026-02-14T14:11:00.000Z',
        parentId: 'root',
        childId: 'item-2'
      }
    ];
    persisted.nextLocalWriteId = 2;

    expect(() => client.hydrateState(persisted)).toThrowError(
      /childId that does not match itemId/
    );
    expect(guardrailViolations).toContainEqual({
      code: 'hydrateGuardrailViolation',
      stage: 'hydrate',
      message:
        'state.pendingOperations[0] has link childId that does not match itemId'
    });
  });

  it('fails closed when hydrated replay cursor is malformed and keeps state pristine', () => {
    const guardrailViolations: Array<{
      code: string;
      stage: string;
      message: string;
    }> = [];
    const client = new VfsBackgroundSyncClient(
      'user-1',
      'desktop',
      new InMemoryVfsCrdtSyncTransport(new InMemoryVfsCrdtSyncServer()),
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

    const pristineState = client.exportState();
    const persisted = client.exportState();
    persisted.replaySnapshot.cursor = {
      changedAt: 'not-a-date',
      changeId: 'desktop-1'
    };

    expect(() => client.hydrateState(persisted)).toThrowError(
      /invalid persisted replay cursor/
    );
    expect(guardrailViolations).toContainEqual({
      code: 'hydrateGuardrailViolation',
      stage: 'hydrate',
      message: 'transport returned invalid persisted replay cursor'
    });
    expect(client.exportState()).toEqual(pristineState);
  });

  it('fails closed when hydrated reconcile cursor trails replay cursor and keeps state pristine', () => {
    const guardrailViolations: Array<{
      code: string;
      stage: string;
      message: string;
    }> = [];
    const client = new VfsBackgroundSyncClient(
      'user-1',
      'desktop',
      new InMemoryVfsCrdtSyncTransport(new InMemoryVfsCrdtSyncServer()),
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

    const pristineState = client.exportState();
    const persisted = client.exportState();
    persisted.replaySnapshot.cursor = {
      changedAt: '2026-02-14T14:12:01.000Z',
      changeId: 'desktop-2'
    };
    persisted.reconcileState = {
      cursor: {
        changedAt: '2026-02-14T14:12:00.000Z',
        changeId: 'desktop-1'
      },
      lastReconciledWriteIds: {
        desktop: 1
      }
    };

    expect(() => client.hydrateState(persisted)).toThrowError(
      /persisted reconcile cursor regressed persisted replay cursor/
    );
    expect(guardrailViolations).toContainEqual({
      code: 'hydrateGuardrailViolation',
      stage: 'hydrate',
      message: 'persisted reconcile cursor regressed persisted replay cursor'
    });
    expect(client.exportState()).toEqual(pristineState);
  });

  it('hydrates when replay, reconcile, and container clock cursors share an equal boundary', async () => {
    const server = new InMemoryVfsCrdtSyncServer();
    await server.pushOperations({
      operations: [
        {
          opId: 'remote-1',
          opType: 'acl_add',
          itemId: 'item-hydrate-equal',
          replicaId: 'remote',
          writeId: 1,
          occurredAt: '2026-02-14T14:12:00.000Z',
          principalType: 'group',
          principalId: 'group-1',
          accessLevel: 'read'
        }
      ]
    });

    const sourceClient = new VfsBackgroundSyncClient(
      'user-1',
      'desktop',
      new InMemoryVfsCrdtSyncTransport(server)
    );
    await sourceClient.sync();

    const persisted = sourceClient.exportState();
    const replayCursor = persisted.replaySnapshot.cursor;
    if (!replayCursor) {
      throw new Error('expected replay cursor for equal-boundary hydrate test');
    }
    const boundaryClock = persisted.containerClocks.find(
      (entry) => entry.containerId === 'item-hydrate-equal'
    );
    if (!boundaryClock) {
      throw new Error(
        'expected container clock for equal-boundary hydrate test'
      );
    }
    expect(
      compareVfsSyncCursorOrder(
        {
          changedAt: boundaryClock.changedAt,
          changeId: boundaryClock.changeId
        },
        replayCursor
      )
    ).toBe(0);

    persisted.reconcileState = {
      cursor: {
        changedAt: replayCursor.changedAt,
        changeId: replayCursor.changeId
      },
      lastReconciledWriteIds: {
        desktop: 1
      }
    };

    const guardrailViolations: Array<{
      code: string;
      stage: string;
      message: string;
    }> = [];
    const resumedClient = new VfsBackgroundSyncClient(
      'user-1',
      'desktop',
      new InMemoryVfsCrdtSyncTransport(server),
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
    expect(guardrailViolations).toEqual([]);
    expect(resumedClient.snapshot().cursor).toEqual(replayCursor);
  });

  it('fails closed when hydrated container clock is ahead of persisted sync cursor and keeps state pristine', () => {
    const guardrailViolations: Array<{
      code: string;
      stage: string;
      message: string;
    }> = [];
    const client = new VfsBackgroundSyncClient(
      'user-1',
      'desktop',
      new InMemoryVfsCrdtSyncTransport(new InMemoryVfsCrdtSyncServer()),
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

    const pristineState = client.exportState();
    const persisted = client.exportState();
    persisted.replaySnapshot.cursor = {
      changedAt: '2026-02-14T14:13:00.000Z',
      changeId: 'desktop-1'
    };
    persisted.reconcileState = {
      cursor: {
        changedAt: '2026-02-14T14:13:00.000Z',
        changeId: 'desktop-1'
      },
      lastReconciledWriteIds: {
        desktop: 1
      }
    };
    persisted.containerClocks = [
      {
        containerId: 'item-ahead',
        changedAt: '2026-02-14T14:13:01.000Z',
        changeId: 'desktop-2'
      }
    ];

    expect(() => client.hydrateState(persisted)).toThrowError(
      /state.containerClocks\[0\] is ahead of persisted sync cursor/
    );
    expect(guardrailViolations).toContainEqual({
      code: 'hydrateGuardrailViolation',
      stage: 'hydrate',
      message: 'state.containerClocks[0] is ahead of persisted sync cursor'
    });
    expect(client.exportState()).toEqual(pristineState);
  });

  it('fails closed when hydrated container clocks contain duplicate container ids and keeps state pristine', () => {
    const guardrailViolations: Array<{
      code: string;
      stage: string;
      message: string;
    }> = [];
    const client = new VfsBackgroundSyncClient(
      'user-1',
      'desktop',
      new InMemoryVfsCrdtSyncTransport(new InMemoryVfsCrdtSyncServer()),
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

    const pristineState = client.exportState();
    const persisted = client.exportState();
    persisted.containerClocks = [
      {
        containerId: 'item-dup',
        changedAt: '2026-02-14T14:14:00.000Z',
        changeId: 'desktop-1'
      },
      {
        containerId: 'item-dup',
        changedAt: '2026-02-14T14:14:01.000Z',
        changeId: 'desktop-2'
      }
    ];

    expect(() => client.hydrateState(persisted)).toThrowError(
      /state.containerClocks has duplicate containerId item-dup/
    );
    expect(guardrailViolations).toContainEqual({
      code: 'hydrateGuardrailViolation',
      stage: 'hydrate',
      message: 'state.containerClocks has duplicate containerId item-dup'
    });
    expect(client.exportState()).toEqual(pristineState);
  });

  it('fails closed when hydrated container clocks are present without a persisted cursor and keeps state pristine', () => {
    const guardrailViolations: Array<{
      code: string;
      stage: string;
      message: string;
    }> = [];
    const client = new VfsBackgroundSyncClient(
      'user-1',
      'desktop',
      new InMemoryVfsCrdtSyncTransport(new InMemoryVfsCrdtSyncServer()),
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

    const pristineState = client.exportState();
    const persisted = client.exportState();
    persisted.containerClocks = [
      {
        containerId: 'item-orphan-clock',
        changedAt: '2026-02-14T14:15:00.000Z',
        changeId: 'desktop-1'
      }
    ];
    persisted.replaySnapshot.cursor = null;
    persisted.reconcileState = null;

    expect(() => client.hydrateState(persisted)).toThrowError(
      /state.containerClocks requires persisted replay or reconcile cursor/
    );
    expect(guardrailViolations).toContainEqual({
      code: 'hydrateGuardrailViolation',
      stage: 'hydrate',
      message:
        'state.containerClocks requires persisted replay or reconcile cursor'
    });
    expect(client.exportState()).toEqual(pristineState);
  });
});
