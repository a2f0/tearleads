import type { VfsCrdtSyncTransport } from './sync-client-test-support.js';
import {
  compareVfsSyncCursorOrder,
  createDeterministicJitterTransport,
  createDeterministicRandom,
  InMemoryVfsCrdtSyncServer,
  nextInt,
  pickDifferent,
  pickOne,
  VfsBackgroundSyncClient
} from './sync-client-test-support.js';

interface ClientSnapshotResult {
  clientId: string;
  pendingOperations: number;
  replicaWriteId: number;
  nextLocalWriteId: number;
}

interface Shard04RestartHydrateResult {
  restartHydrateCount: number;
  restartFloorChecks: number;
  snapshots: ClientSnapshotResult[];
}

export async function runShard04RestartHydrateScenario(
  seed = 1221
): Promise<Shard04RestartHydrateResult> {
  const random = createDeterministicRandom(seed);
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

    if (
      previousCursor &&
      cursor &&
      compareVfsSyncCursorOrder(cursor, previousCursor) < 0
    ) {
      throw new Error(`replay cursor regressed for ${clientId}`);
    }

    if (
      restartFloorCursor &&
      cursor &&
      compareVfsSyncCursorOrder(cursor, restartFloorCursor) < 0
    ) {
      throw new Error(
        `replay cursor regressed below restart floor for ${clientId}`
      );
    }

    if (restartFloorCursor && cursor) {
      restartFloorChecks += 1;
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

      if (restartClient.snapshot().pendingOperations === 0) {
        const persistedState = restartClient.exportState();
        const persistedCursor = persistedState.replaySnapshot.cursor;
        if (persistedCursor) {
          const existingFloor = restartCursorFloorByClient.get(restartClientId);
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

  const finalClients = clientIds.map((clientId) => getClient(clientId));
  await Promise.all(finalClients.map((client) => client.flush()));
  for (let index = 0; index < 8; index++) {
    await Promise.all(finalClients.map((client) => client.sync()));
  }

  return {
    restartHydrateCount,
    restartFloorChecks,
    snapshots: clientIds.map((clientId) => {
      const snapshot = getClient(clientId).snapshot();
      const replicaWriteId = snapshot.lastReconciledWriteIds[clientId] ?? 0;
      return {
        clientId,
        pendingOperations: snapshot.pendingOperations,
        replicaWriteId,
        nextLocalWriteId: snapshot.nextLocalWriteId
      };
    })
  };
}
