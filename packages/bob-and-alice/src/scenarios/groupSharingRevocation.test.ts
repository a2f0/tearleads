import { randomUUID } from 'node:crypto';
import { afterEach, describe, expect, it } from 'vitest';
import {
  assertActorFeedReplayHas,
  assertServerHasAclEntry
} from '../harness/assertions.js';
import { ScenarioHarness } from '../harness/scenarioHarness.js';

describe('groupSharingRevocation', () => {
  let harness: ScenarioHarness | null = null;

  afterEach(async () => {
    if (harness) {
      await harness.teardown();
      harness = null;
    }
  });

  it('revokes group access via acl_remove and the entry disappears from snapshot', async () => {
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
    await bob.sync();

    assertServerHasAclEntry({
      server: harness.server,
      itemId,
      principalType: 'group',
      principalId: groupId,
      accessLevel: 'write'
    });

    alice.queueCrdtOp({
      opType: 'acl_remove',
      itemId,
      principalType: 'group',
      principalId: groupId,
      occurredAt: harness.nextTimestamp()
    });

    await alice.flush();
    await bob.sync();

    const serverAcl = harness.server.snapshot().acl;
    const groupEntry = serverAcl.find(
      (e) =>
        e.itemId === itemId &&
        e.principalType === 'group' &&
        e.principalId === groupId
    );
    expect(groupEntry).toBeUndefined();

    assertServerHasAclEntry({
      server: harness.server,
      itemId,
      principalType: 'user',
      principalId: alice.userId,
      accessLevel: 'admin'
    });

    const bobGroupAcl = bob
      .syncSnapshot()
      .acl.find(
        (e) =>
          e.itemId === itemId &&
          e.principalType === 'group' &&
          e.principalId === groupId
      );
    expect(bobGroupAcl).toBeUndefined();
  });

  it('grant-revoke-re-grant cycle restores the group entry', async () => {
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

    alice.queueCrdtOp({
      opType: 'acl_remove',
      itemId,
      principalType: 'group',
      principalId: groupId,
      occurredAt: harness.nextTimestamp()
    });
    await alice.flush();

    const midSnapshot = harness.server.snapshot();
    const midEntry = midSnapshot.acl.find(
      (e) =>
        e.itemId === itemId &&
        e.principalType === 'group' &&
        e.principalId === groupId
    );
    expect(midEntry).toBeUndefined();

    alice.queueCrdtOp({
      opType: 'acl_add',
      itemId,
      principalType: 'group',
      principalId: groupId,
      accessLevel: 'read',
      occurredAt: harness.nextTimestamp()
    });
    await alice.flush();
    await bob.sync();

    assertServerHasAclEntry({
      server: harness.server,
      itemId,
      principalType: 'group',
      principalId: groupId,
      accessLevel: 'read'
    });
    assertActorFeedReplayHas(bob, itemId);
  });

  it('mixed principal types on one item survive independent revocations', async () => {
    const groupId = randomUUID();
    const orgId = `org-${randomUUID()}`;
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
    alice.queueCrdtOp({
      opType: 'acl_add',
      itemId,
      principalType: 'organization',
      principalId: orgId,
      accessLevel: 'read',
      occurredAt: harness.nextTimestamp()
    });
    alice.queueCrdtOp({
      opType: 'acl_add',
      itemId,
      principalType: 'user',
      principalId: bob.userId,
      accessLevel: 'read',
      occurredAt: harness.nextTimestamp()
    });
    await alice.flush();

    alice.queueCrdtOp({
      opType: 'acl_remove',
      itemId,
      principalType: 'group',
      principalId: groupId,
      occurredAt: harness.nextTimestamp()
    });
    await alice.flush();
    await bob.sync();

    const serverAcl = harness.server
      .snapshot()
      .acl.filter((e) => e.itemId === itemId);

    expect(serverAcl).toHaveLength(3);
    expect(
      serverAcl.find(
        (e) => e.principalType === 'group' && e.principalId === groupId
      )
    ).toBeUndefined();

    assertServerHasAclEntry({
      server: harness.server,
      itemId,
      principalType: 'organization',
      principalId: orgId,
      accessLevel: 'read'
    });
    assertServerHasAclEntry({
      server: harness.server,
      itemId,
      principalType: 'user',
      principalId: bob.userId,
      accessLevel: 'read'
    });
  });

  it('rapid grant-revoke oscillation settles to the last operation', async () => {
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

    const levelCycle = (idx: number): 'read' | 'write' | 'admin' => {
      const r = idx % 3;
      if (r === 1) return 'write';
      if (r === 2) return 'admin';
      return 'read';
    };
    for (let i = 0; i < 5; i++) {
      alice.queueCrdtOp({
        opType: 'acl_add',
        itemId,
        principalType: 'group',
        principalId: groupId,
        accessLevel: levelCycle(i),
        occurredAt: harness.nextTimestamp()
      });
      alice.queueCrdtOp({
        opType: 'acl_remove',
        itemId,
        principalType: 'group',
        principalId: groupId,
        occurredAt: harness.nextTimestamp()
      });
    }

    alice.queueCrdtOp({
      opType: 'acl_add',
      itemId,
      principalType: 'group',
      principalId: groupId,
      accessLevel: 'write',
      occurredAt: harness.nextTimestamp()
    });

    await alice.flush();
    await bob.sync();

    assertServerHasAclEntry({
      server: harness.server,
      itemId,
      principalType: 'group',
      principalId: groupId,
      accessLevel: 'write'
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
});
