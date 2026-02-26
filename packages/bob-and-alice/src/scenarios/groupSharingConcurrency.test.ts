import { randomUUID } from 'node:crypto';
import { afterEach, describe, expect, it } from 'vitest';
import { assertServerHasAclEntry } from '../harness/assertions.js';
import { ScenarioHarness } from '../harness/scenarioHarness.js';

describe('groupSharingConcurrency', () => {
  let harness: ScenarioHarness | null = null;

  afterEach(async () => {
    if (harness) {
      await harness.teardown();
      harness = null;
    }
  });

  it('concurrent group grant and group revoke resolve by last-writer-wins', async () => {
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
      principalType: 'user',
      principalId: bob.userId,
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
    await alice.sync();
    await bob.sync();

    // Alice revokes (earlier timestamp)
    alice.queueCrdtOp({
      opType: 'acl_remove',
      itemId,
      principalType: 'group',
      principalId: groupId,
      occurredAt: harness.nextTimestamp()
    });

    // Bob re-grants (later timestamp — wins)
    bob.queueCrdtOp({
      opType: 'acl_add',
      itemId,
      principalType: 'group',
      principalId: groupId,
      accessLevel: 'read',
      occurredAt: harness.nextTimestamp()
    });

    await alice.flush();
    await bob.flush();
    await alice.sync();
    await bob.sync();

    assertServerHasAclEntry({
      server: harness.server,
      itemId,
      principalType: 'group',
      principalId: groupId,
      accessLevel: 'read'
    });
  });

  it('concurrent revoke (later) beats grant (earlier) by timestamp', async () => {
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
      principalType: 'user',
      principalId: bob.userId,
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
    await alice.sync();
    await bob.sync();

    // Alice re-grants (earlier timestamp)
    alice.queueCrdtOp({
      opType: 'acl_add',
      itemId,
      principalType: 'group',
      principalId: groupId,
      accessLevel: 'admin',
      occurredAt: harness.nextTimestamp()
    });

    // Bob revokes (later timestamp — wins)
    bob.queueCrdtOp({
      opType: 'acl_remove',
      itemId,
      principalType: 'group',
      principalId: groupId,
      occurredAt: harness.nextTimestamp()
    });

    await alice.flush();
    await bob.flush();
    await alice.sync();
    await bob.sync();

    const serverAcl = harness.server.snapshot().acl;
    const groupEntry = serverAcl.find(
      (e) =>
        e.itemId === itemId &&
        e.principalType === 'group' &&
        e.principalId === groupId
    );
    expect(groupEntry).toBeUndefined();
  });

  it('three actors concurrently modify group ACLs on the same item', async () => {
    const groupA = randomUUID();
    const groupB = randomUUID();
    const groupC = randomUUID();
    const itemId = randomUUID();

    harness = await ScenarioHarness.create({
      actors: [{ alias: 'alice' }, { alias: 'bob' }, { alias: 'carol' }]
    });

    const alice = harness.actor('alice');
    const bob = harness.actor('bob');
    const carol = harness.actor('carol');

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
      principalType: 'user',
      principalId: bob.userId,
      accessLevel: 'admin',
      occurredAt: harness.nextTimestamp()
    });
    alice.queueCrdtOp({
      opType: 'acl_add',
      itemId,
      principalType: 'user',
      principalId: carol.userId,
      accessLevel: 'admin',
      occurredAt: harness.nextTimestamp()
    });
    await alice.flush();
    await alice.sync();
    await bob.sync();
    await carol.sync();

    alice.queueCrdtOp({
      opType: 'acl_add',
      itemId,
      principalType: 'group',
      principalId: groupA,
      accessLevel: 'read',
      occurredAt: harness.nextTimestamp()
    });
    bob.queueCrdtOp({
      opType: 'acl_add',
      itemId,
      principalType: 'group',
      principalId: groupB,
      accessLevel: 'write',
      occurredAt: harness.nextTimestamp()
    });
    carol.queueCrdtOp({
      opType: 'acl_add',
      itemId,
      principalType: 'group',
      principalId: groupC,
      accessLevel: 'admin',
      occurredAt: harness.nextTimestamp()
    });

    await Promise.all([alice.flush(), bob.flush(), carol.flush()]);
    await Promise.all([alice.sync(), bob.sync(), carol.sync()]);

    assertServerHasAclEntry({
      server: harness.server,
      itemId,
      principalType: 'group',
      principalId: groupA,
      accessLevel: 'read'
    });
    assertServerHasAclEntry({
      server: harness.server,
      itemId,
      principalType: 'group',
      principalId: groupB,
      accessLevel: 'write'
    });
    assertServerHasAclEntry({
      server: harness.server,
      itemId,
      principalType: 'group',
      principalId: groupC,
      accessLevel: 'admin'
    });

    const aliceAcl = alice
      .syncSnapshot()
      .acl.filter((e) => e.itemId === itemId);
    const bobAcl = bob.syncSnapshot().acl.filter((e) => e.itemId === itemId);
    const carolAcl = carol
      .syncSnapshot()
      .acl.filter((e) => e.itemId === itemId);

    expect(aliceAcl).toHaveLength(6);
    expect(bobAcl).toHaveLength(6);
    expect(carolAcl).toHaveLength(6);
  });

  it('concurrent access level upgrades on the same group settle to last timestamp', async () => {
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
      principalType: 'user',
      principalId: bob.userId,
      accessLevel: 'admin',
      occurredAt: harness.nextTimestamp()
    });
    alice.queueCrdtOp({
      opType: 'acl_add',
      itemId,
      principalType: 'group',
      principalId: groupId,
      accessLevel: 'read',
      occurredAt: harness.nextTimestamp()
    });
    await alice.flush();
    await alice.sync();
    await bob.sync();

    // Alice sets write (earlier timestamp)
    alice.queueCrdtOp({
      opType: 'acl_add',
      itemId,
      principalType: 'group',
      principalId: groupId,
      accessLevel: 'write',
      occurredAt: harness.nextTimestamp()
    });

    // Bob sets admin (later timestamp — wins)
    bob.queueCrdtOp({
      opType: 'acl_add',
      itemId,
      principalType: 'group',
      principalId: groupId,
      accessLevel: 'admin',
      occurredAt: harness.nextTimestamp()
    });

    await alice.flush();
    await bob.flush();
    await alice.sync();
    await bob.sync();

    assertServerHasAclEntry({
      server: harness.server,
      itemId,
      principalType: 'group',
      principalId: groupId,
      accessLevel: 'admin'
    });

    const groupEntries = harness.server
      .snapshot()
      .acl.filter(
        (e) =>
          e.itemId === itemId &&
          e.principalType === 'group' &&
          e.principalId === groupId
      );
    expect(groupEntries).toHaveLength(1);
  });

  it('flush ordering does not affect convergence when timestamps are deterministic', async () => {
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
      principalType: 'user',
      principalId: bob.userId,
      accessLevel: 'admin',
      occurredAt: harness.nextTimestamp()
    });
    await alice.flush();
    await alice.sync();
    await bob.sync();

    // Alice grants read (T1)
    alice.queueCrdtOp({
      opType: 'acl_add',
      itemId,
      principalType: 'group',
      principalId: groupId,
      accessLevel: 'read',
      occurredAt: harness.nextTimestamp()
    });

    // Bob grants admin (T2, later)
    bob.queueCrdtOp({
      opType: 'acl_add',
      itemId,
      principalType: 'group',
      principalId: groupId,
      accessLevel: 'admin',
      occurredAt: harness.nextTimestamp()
    });

    // Bob flushes FIRST despite later timestamp
    await bob.flush();
    await alice.flush();

    await alice.sync();
    await bob.sync();

    // Timestamp wins, not flush order
    assertServerHasAclEntry({
      server: harness.server,
      itemId,
      principalType: 'group',
      principalId: groupId,
      accessLevel: 'admin'
    });
  });
});
