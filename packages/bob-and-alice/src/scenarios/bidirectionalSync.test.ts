import { randomUUID } from 'node:crypto';
import { afterEach, describe, expect, it } from 'vitest';
import {
  assertActorFeedReplayHas,
  assertServerFeedLength,
  assertServerHasAclEntry
} from '../harness/assertions.js';
import { ScenarioHarness } from '../harness/scenarioHarness.js';

describe('bidirectionalSync', () => {
  let harness: ScenarioHarness | null = null;

  afterEach(async () => {
    if (harness) {
      await harness.teardown();
      harness = null;
    }
  });

  it('Alice and Bob each create items, flush, sync, and converge', async () => {
    harness = await ScenarioHarness.create({
      actors: [{ alias: 'alice' }, { alias: 'bob' }]
    });

    const alice = harness.actor('alice');
    const bob = harness.actor('bob');

    const itemA = randomUUID();
    const itemB = randomUUID();

    // Alice creates item A
    alice.queueCrdtOp({
      opType: 'acl_add',
      itemId: itemA,
      principalType: 'user',
      principalId: alice.userId,
      accessLevel: 'admin',
      occurredAt: harness.nextTimestamp()
    });

    // Alice flushes
    const aliceFlush = await alice.flush();
    expect(aliceFlush.pushedOperations).toBe(1);

    // Bob creates item B
    bob.queueCrdtOp({
      opType: 'acl_add',
      itemId: itemB,
      principalType: 'user',
      principalId: bob.userId,
      accessLevel: 'admin',
      occurredAt: harness.nextTimestamp()
    });

    // Bob flushes
    const bobFlush = await bob.flush();
    expect(bobFlush.pushedOperations).toBe(1);

    // Assert server feed has all operations
    assertServerFeedLength({
      server: harness.server,
      expected: 2
    });

    // Both sync — each should see the other's item
    await alice.sync();
    await bob.sync();

    // Assert both actors' feed replays converge
    assertActorFeedReplayHas(alice, itemA);
    assertActorFeedReplayHas(alice, itemB);
    assertActorFeedReplayHas(bob, itemA);
    assertActorFeedReplayHas(bob, itemB);

    // Assert server has both ACL entries
    assertServerHasAclEntry({
      server: harness.server,
      itemId: itemA,
      principalType: 'user',
      principalId: alice.userId,
      accessLevel: 'admin'
    });
    assertServerHasAclEntry({
      server: harness.server,
      itemId: itemB,
      principalType: 'user',
      principalId: bob.userId,
      accessLevel: 'admin'
    });
  });
});
