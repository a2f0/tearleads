import { randomUUID } from 'node:crypto';
import { afterEach, describe, expect, it } from 'vitest';
import {
  assertActorFeedReplayHas,
  assertServerFeedLength,
  assertServerHasAclEntry
} from '../harness/assertions.js';
import { ScenarioHarness } from '../harness/scenarioHarness.js';

describe('conflictResolution', () => {
  let harness: ScenarioHarness;

  afterEach(async () => {
    await harness.teardown();
  });

  it('concurrent ACL grants by both actors merge correctly', async () => {
    harness = await ScenarioHarness.create({
      actors: [{ alias: 'alice' }, { alias: 'bob' }]
    });

    const alice = harness.actor('alice');
    const bob = harness.actor('bob');

    const itemX = randomUUID();
    const groupId = randomUUID();
    const userId3 = randomUUID();

    // Both actors start with a shared item X (Alice creates and flushes)
    alice.queueCrdtOp({
      opType: 'acl_add',
      itemId: itemX,
      principalType: 'user',
      principalId: alice.userId,
      accessLevel: 'admin',
      occurredAt: harness.nextTimestamp()
    });

    alice.queueCrdtOp({
      opType: 'acl_add',
      itemId: itemX,
      principalType: 'user',
      principalId: bob.userId,
      accessLevel: 'write',
      occurredAt: harness.nextTimestamp()
    });

    await alice.flush();

    // Both sync so they have the same baseline
    await alice.sync();
    await bob.sync();

    // Alice grants group-1 write access (concurrently)
    alice.queueCrdtOp({
      opType: 'acl_add',
      itemId: itemX,
      principalType: 'group',
      principalId: groupId,
      accessLevel: 'write',
      occurredAt: harness.nextTimestamp()
    });

    // Bob grants user-3 read access (concurrently)
    bob.queueCrdtOp({
      opType: 'acl_add',
      itemId: itemX,
      principalType: 'user',
      principalId: userId3,
      accessLevel: 'read',
      occurredAt: harness.nextTimestamp()
    });

    // Both flush
    await alice.flush();
    await bob.flush();

    // Both sync to see the merged state
    await alice.sync();
    await bob.sync();

    // Assert server feed has all operations (2 initial + 2 concurrent)
    assertServerFeedLength({
      server: harness.server,
      expected: 4
    });

    // Assert CRDT merge produces both ACL entries
    assertServerHasAclEntry({
      server: harness.server,
      itemId: itemX,
      principalType: 'group',
      principalId: groupId,
      accessLevel: 'write'
    });

    assertServerHasAclEntry({
      server: harness.server,
      itemId: itemX,
      principalType: 'user',
      principalId: userId3,
      accessLevel: 'read'
    });

    // Both actors should see the merged state
    assertActorFeedReplayHas(alice, itemX);
    assertActorFeedReplayHas(bob, itemX);

    // Verify both actors see all 4 ACL entries
    const aliceSnapshot = alice.syncSnapshot();
    const bobSnapshot = bob.syncSnapshot();
    const aliceAclForItem = aliceSnapshot.acl.filter(
      (e) => e.itemId === itemX
    );
    const bobAclForItem = bobSnapshot.acl.filter(
      (e) => e.itemId === itemX
    );
    expect(aliceAclForItem).toHaveLength(4);
    expect(bobAclForItem).toHaveLength(4);
  });
});
