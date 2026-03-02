import { afterEach, describe, expect, it } from 'vitest';
import { ActorHarness } from '../harness/actorHarness.js';
import { ServerHarness } from '../harness/serverHarness.js';

type ActorAlias = 'alice' | 'bob' | 'carol';

interface ManagedActor {
  alias: ActorAlias;
  userId: string;
  clientId: string;
}

interface DeterministicNowFactory {
  next(): Date;
}

function createDeterministicNowFactory(
  baseMs: number,
  strideMs: number
): DeterministicNowFactory {
  let counter = 0;
  return {
    next() {
      const value = new Date(baseMs + counter * strideMs);
      counter += 1;
      return value;
    }
  };
}

function createDeterministicRandom(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (Math.imul(state, 1_664_525) + 1_013_904_223) >>> 0;
    return state / 4_294_967_296;
  };
}

function nextInt(random: () => number, min: number, max: number): number {
  const span = max - min + 1;
  return min + Math.floor(random() * span);
}

function pickOne<T>(values: readonly T[], random: () => number): T {
  const index = nextInt(random, 0, values.length - 1);
  const picked = values[index];
  if (picked === undefined) {
    throw new Error('cannot pick from empty set');
  }
  return picked;
}

describe('CRDT protocol chaos monkey', () => {
  let server: ServerHarness | null = null;
  const actorDefinitions: ManagedActor[] = [
    {
      alias: 'alice',
      userId: 'user-chaos',
      clientId: 'desktop-chaos-alice'
    },
    {
      alias: 'bob',
      userId: 'user-chaos',
      clientId: 'mobile-chaos-bob'
    },
    {
      alias: 'carol',
      userId: 'user-chaos',
      clientId: 'tablet-chaos-carol'
    }
  ];
  const actors = new Map<ActorAlias, ActorHarness>();

  afterEach(async () => {
    await Promise.all([...actors.values()].map((actor) => actor.close()));
    actors.clear();
    server = null;
  });

  async function createManagedActor(input: {
    actor: ManagedActor;
    nowFactory: DeterministicNowFactory;
  }): Promise<ActorHarness> {
    if (!server) {
      throw new Error('server not initialized');
    }
    const { actor, nowFactory } = input;
    return ActorHarness.create({
      alias: actor.alias,
      userId: actor.userId,
      clientId: actor.clientId,
      server,
      now: () => nowFactory.next(),
      databaseOptions: {
        instanceId: `crdt-chaos-${actor.alias}`
      }
    });
  }

  it('converges after randomized queue/flush/sync interleavings', async () => {
    const random = createDeterministicRandom(0xdecafbad);
    const nowFactory = createDeterministicNowFactory(
      Date.parse('2026-01-01T00:00:00.000Z'),
      1_000
    );

    server = new ServerHarness();

    for (const definition of actorDefinitions) {
      const actor = await createManagedActor({ actor: definition, nowFactory });
      actors.set(definition.alias, actor);
    }

    const aliases = actorDefinitions.map((definition) => definition.alias);
    const itemIds = [
      'chaos-item-1',
      'chaos-item-2',
      'chaos-item-3',
      'chaos-item-4',
      'chaos-item-5',
      'chaos-item-6'
    ] as const;
    const parentIds = ['chaos-root', 'chaos-folder-a', 'chaos-folder-b'] as const;
    const principals = [
      { principalType: 'user', principalId: 'user-chaos' },
      { principalType: 'user', principalId: 'user-chaos-peer' },
      { principalType: 'group', principalId: 'chaos-group-1' },
      { principalType: 'organization', principalId: 'chaos-org-1' }
    ] as const;
    const accessLevels = ['read', 'write', 'admin'] as const;

    for (let round = 0; round < 140; round += 1) {
      const alias = pickOne(aliases, random);
      const actor = actors.get(alias);
      if (!actor) {
        throw new Error(`missing actor for alias ${alias}`);
      }
      const peerAlias = pickOne(
        aliases.filter((candidate) => candidate !== alias),
        random
      );
      const peer = actors.get(peerAlias);
      if (!peer) {
        throw new Error(`missing peer actor for alias ${peerAlias}`);
      }
      const itemId = pickOne(itemIds, random);
      const opVariant = nextInt(random, 0, 3);
      const occurredAt = nowFactory.next().toISOString();

      if (opVariant === 0) {
        const principal = pickOne(principals, random);
        actor.queueCrdtOp({
          opType: 'acl_add',
          itemId,
          principalType: principal.principalType,
          principalId: principal.principalId,
          accessLevel: pickOne(accessLevels, random),
          occurredAt
        });
      } else if (opVariant === 1) {
        const principal = pickOne(principals, random);
        actor.queueCrdtOp({
          opType: 'acl_remove',
          itemId,
          principalType: principal.principalType,
          principalId: principal.principalId,
          occurredAt
        });
      } else if (opVariant === 2) {
        actor.queueCrdtOp({
          opType: 'link_add',
          itemId,
          parentId: pickOne(parentIds, random),
          childId: itemId,
          occurredAt
        });
      } else {
        actor.queueCrdtOp({
          opType: 'link_remove',
          itemId,
          parentId: pickOne(parentIds, random),
          childId: itemId,
          occurredAt
        });
      }

      const ioVariant = nextInt(random, 0, 5);
      if (ioVariant === 0) {
        await actor.flush();
        await peer.sync();
      } else if (ioVariant === 1) {
        await peer.sync();
        await actor.flush();
      } else if (ioVariant === 2) {
        await actor.flush();
        await actor.sync();
      } else if (ioVariant === 3) {
        await peer.flush();
        await actor.flush();
        await actor.sync();
      } else if (ioVariant === 4) {
        await actor.flush();
        for (const candidate of actors.values()) {
          await candidate.flush();
        }
      } else if (ioVariant === 5) {
        await actor.flush();
        for (const candidate of actors.values()) {
          await candidate.sync();
        }
      } else {
        await actor.flush();
        await actor.sync();
      }
    }

    for (let settleRound = 0; settleRound < 12; settleRound += 1) {
      for (const actor of actors.values()) {
        await actor.flush();
      }
      for (const actor of actors.values()) {
        await actor.sync();
      }
    }

    if (!server) {
      throw new Error('server missing at assertion time');
    }
    const serverSnapshot = server.snapshot();
    expect(serverSnapshot.feed.length).toBeGreaterThan(0);

    const firstAlias = aliases[0];
    if (!firstAlias) {
      throw new Error('missing first alias');
    }
    const baselineActor = actors.get(firstAlias);
    if (!baselineActor) {
      throw new Error('missing baseline actor');
    }
    const baselineSnapshot = baselineActor.syncSnapshot();

    for (const alias of aliases) {
      const actor = actors.get(alias);
      if (!actor) {
        throw new Error(`missing actor during assertions: ${alias}`);
      }
      const snapshot = actor.syncSnapshot();
      expect(snapshot.pendingOperations).toBe(0);
      expect(snapshot.acl).toEqual(baselineSnapshot.acl);
      expect(snapshot.links).toEqual(baselineSnapshot.links);
      expect(snapshot.lastReconciledWriteIds).toEqual(
        baselineSnapshot.lastReconciledWriteIds
      );
      expect(snapshot.containerClocks).toEqual(baselineSnapshot.containerClocks);
      expect(snapshot.lastReconciledWriteIds).toEqual(
        serverSnapshot.lastReconciledWriteIds
      );

      const replicaWriteId =
        serverSnapshot.lastReconciledWriteIds[actor.clientId] ?? 0;
      expect(snapshot.nextLocalWriteId).toBeGreaterThanOrEqual(replicaWriteId + 1);
    }
  });
});
