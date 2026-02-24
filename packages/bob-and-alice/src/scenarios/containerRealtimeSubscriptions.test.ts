import { randomUUID } from 'node:crypto';
import type { VfsSyncCursor } from '@tearleads/vfs-sync/vfs';
import { afterEach, describe, expect, it } from 'vitest';
import { ScenarioHarness } from '../harness/scenarioHarness.js';

function expectedChannelsForContainerIds(containerIds: string[]): string[] {
  return [
    'broadcast',
    ...containerIds
      .map((containerId) => `vfs:container:${containerId}:sync`)
      .sort((left, right) => left.localeCompare(right))
  ];
}

describe('containerRealtimeSubscriptions', () => {
  let harness: ScenarioHarness | null = null;

  afterEach(async () => {
    if (harness) {
      await harness.teardown();
      harness = null;
    }
  });

  it('derives VFS container channels only from containers known to the actor', async () => {
    harness = await ScenarioHarness.create({
      actors: [{ alias: 'alice' }, { alias: 'bob' }]
    });

    const alice = harness.actor('alice');
    const bob = harness.actor('bob');

    const firstItemId = randomUUID();
    const secondItemId = randomUUID();

    alice.queueCrdtOp({
      opType: 'acl_add',
      itemId: firstItemId,
      principalType: 'user',
      principalId: alice.userId,
      accessLevel: 'admin',
      occurredAt: harness.nextTimestamp()
    });
    alice.queueCrdtOp({
      opType: 'acl_add',
      itemId: firstItemId,
      principalType: 'user',
      principalId: bob.userId,
      accessLevel: 'read',
      occurredAt: harness.nextTimestamp()
    });

    await alice.flush();
    expect(bob.vfsContainerSyncChannels()).toEqual(['broadcast']);

    await bob.sync();
    expect(bob.vfsContainerSyncChannels()).toEqual(
      expectedChannelsForContainerIds([firstItemId])
    );

    alice.queueCrdtOp({
      opType: 'acl_add',
      itemId: secondItemId,
      principalType: 'user',
      principalId: alice.userId,
      accessLevel: 'admin',
      occurredAt: harness.nextTimestamp()
    });
    alice.queueCrdtOp({
      opType: 'acl_add',
      itemId: secondItemId,
      principalType: 'user',
      principalId: bob.userId,
      accessLevel: 'read',
      occurredAt: harness.nextTimestamp()
    });

    await alice.flush();
    expect(bob.vfsContainerSyncChannels()).toEqual([
      'broadcast',
      `vfs:container:${firstItemId}:sync`
    ]);

    await bob.sync();
    expect(bob.vfsContainerSyncChannels()).toEqual(
      expectedChannelsForContainerIds([firstItemId, secondItemId])
    );
  });

  it('supports incremental container subscription updates via cursor paging', async () => {
    harness = await ScenarioHarness.create({
      actors: [{ alias: 'alice' }, { alias: 'bob' }]
    });

    const alice = harness.actor('alice');
    const bob = harness.actor('bob');

    const firstItemId = randomUUID();
    const secondItemId = randomUUID();

    alice.queueCrdtOp({
      opType: 'acl_add',
      itemId: firstItemId,
      principalType: 'user',
      principalId: alice.userId,
      accessLevel: 'admin',
      occurredAt: harness.nextTimestamp()
    });
    alice.queueCrdtOp({
      opType: 'acl_add',
      itemId: firstItemId,
      principalType: 'user',
      principalId: bob.userId,
      accessLevel: 'read',
      occurredAt: harness.nextTimestamp()
    });

    await alice.flush();
    await bob.sync();

    const baseline = bob.listChangedContainers(null, 50);
    expect(baseline.items.map((entry) => entry.containerId)).toEqual([
      firstItemId
    ]);

    const baselineCursor: VfsSyncCursor | null = baseline.nextCursor;
    expect(baselineCursor).not.toBeNull();

    alice.queueCrdtOp({
      opType: 'acl_add',
      itemId: secondItemId,
      principalType: 'user',
      principalId: alice.userId,
      accessLevel: 'admin',
      occurredAt: harness.nextTimestamp()
    });
    alice.queueCrdtOp({
      opType: 'acl_add',
      itemId: secondItemId,
      principalType: 'user',
      principalId: bob.userId,
      accessLevel: 'read',
      occurredAt: harness.nextTimestamp()
    });

    await alice.flush();
    await bob.sync();

    const delta = bob.listChangedContainers(baselineCursor, 50);
    expect(delta.items.map((entry) => entry.containerId)).toEqual([
      secondItemId
    ]);
    expect(delta.hasMore).toBe(false);
  });
});
