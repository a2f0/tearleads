import { describe, expect, it } from 'vitest';
import {
  createDeterministicJitterTransport,
  createDeterministicRandom,
  InMemoryVfsCrdtSyncServer,
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
});
