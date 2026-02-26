import { randomUUID } from 'node:crypto';
import { afterEach, describe, expect, it } from 'vitest';
import {
  assertActorFeedReplayHas,
  assertServerHasAclEntry
} from '../harness/assertions.js';
import { ScenarioHarness } from '../harness/scenarioHarness.js';

describe('groupSharingEdgeCases', () => {
  let harness: ScenarioHarness | null = null;

  afterEach(async () => {
    if (harness) {
      await harness.teardown();
      harness = null;
    }
  });

  it('many groups on one item all appear in snapshot', async () => {
    const itemId = randomUUID();
    const groupCount = 20;
    const groupIds = Array.from({ length: groupCount }, () => randomUUID());

    harness = await ScenarioHarness.create({
      actors: [{ alias: 'alice' }, { alias: 'bob' }]
    });

    const alice = harness.actor('alice');
    const bob = harness.actor('bob');

    alice.queueCrdtOp({
      opType: 'acl_add',
      itemId,
      principalType: 'user',
      principalId: alice.userId,
      accessLevel: 'admin',
      occurredAt: harness.nextTimestamp()
    });

    const levelCycle = (idx: number): 'read' | 'write' | 'admin' => {
      const r = idx % 3;
      if (r === 1) return 'write';
      if (r === 2) return 'admin';
      return 'read';
    };

    for (const [i, gid] of groupIds.entries()) {
      alice.queueCrdtOp({
        opType: 'acl_add',
        itemId,
        principalType: 'group',
        principalId: gid,
        accessLevel: levelCycle(i),
        occurredAt: harness.nextTimestamp()
      });
    }

    await alice.flush();
    await bob.sync();

    const serverGroupAcl = harness.server
      .snapshot()
      .acl.filter((e) => e.itemId === itemId && e.principalType === 'group');
    expect(serverGroupAcl).toHaveLength(groupCount);

    for (const [i, gid] of groupIds.entries()) {
      assertServerHasAclEntry({
        server: harness.server,
        itemId,
        principalType: 'group',
        principalId: gid,
        accessLevel: levelCycle(i)
      });
    }

    const bobGroupAcl = bob
      .syncSnapshot()
      .acl.filter((e) => e.itemId === itemId && e.principalType === 'group');
    expect(bobGroupAcl).toHaveLength(groupCount);
  });

  it('same group shared across multiple items maintains independent ACLs', async () => {
    const groupId = randomUUID();
    const item1 = randomUUID();
    const item2 = randomUUID();
    const item3 = randomUUID();

    harness = await ScenarioHarness.create({
      actors: [{ alias: 'alice' }, { alias: 'bob' }]
    });

    const alice = harness.actor('alice');
    const bob = harness.actor('bob');

    for (const itemId of [item1, item2, item3]) {
      alice.queueCrdtOp({
        opType: 'acl_add',
        itemId,
        principalType: 'user',
        principalId: alice.userId,
        accessLevel: 'admin',
        occurredAt: harness.nextTimestamp()
      });
    }

    alice.queueCrdtOp({
      opType: 'acl_add',
      itemId: item1,
      principalType: 'group',
      principalId: groupId,
      accessLevel: 'read',
      occurredAt: harness.nextTimestamp()
    });
    alice.queueCrdtOp({
      opType: 'acl_add',
      itemId: item2,
      principalType: 'group',
      principalId: groupId,
      accessLevel: 'write',
      occurredAt: harness.nextTimestamp()
    });
    alice.queueCrdtOp({
      opType: 'acl_add',
      itemId: item3,
      principalType: 'group',
      principalId: groupId,
      accessLevel: 'admin',
      occurredAt: harness.nextTimestamp()
    });

    await alice.flush();

    // Revoke group from item2 only
    alice.queueCrdtOp({
      opType: 'acl_remove',
      itemId: item2,
      principalType: 'group',
      principalId: groupId,
      occurredAt: harness.nextTimestamp()
    });

    await alice.flush();
    await bob.sync();

    assertServerHasAclEntry({
      server: harness.server,
      itemId: item1,
      principalType: 'group',
      principalId: groupId,
      accessLevel: 'read'
    });

    const item2GroupAcl = harness.server
      .snapshot()
      .acl.find(
        (e) =>
          e.itemId === item2 &&
          e.principalType === 'group' &&
          e.principalId === groupId
      );
    expect(item2GroupAcl).toBeUndefined();

    assertServerHasAclEntry({
      server: harness.server,
      itemId: item3,
      principalType: 'group',
      principalId: groupId,
      accessLevel: 'admin'
    });
  });

  it('idempotent flush does not duplicate group ACL entries', async () => {
    const groupId = randomUUID();
    const itemId = randomUUID();

    harness = await ScenarioHarness.create({
      actors: [{ alias: 'alice' }, { alias: 'bob' }]
    });

    const alice = harness.actor('alice');
    const bob = harness.actor('bob');

    alice.queueCrdtOp({
      opType: 'acl_add',
      itemId,
      principalType: 'user',
      principalId: alice.userId,
      accessLevel: 'admin',
      occurredAt: harness.nextTimestamp()
    });
    alice.queueCrdtOp({
      opType: 'acl_add',
      itemId,
      principalType: 'group',
      principalId: groupId,
      accessLevel: 'write',
      occurredAt: harness.nextTimestamp()
    });

    await alice.flush();
    await alice.flush();

    const serverSnapshot = harness.server.snapshot();
    const groupEntries = serverSnapshot.acl.filter(
      (e) =>
        e.itemId === itemId &&
        e.principalType === 'group' &&
        e.principalId === groupId
    );
    expect(groupEntries).toHaveLength(1);

    await bob.sync();
    assertActorFeedReplayHas(bob, itemId);
  });
});
