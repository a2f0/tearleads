import { randomUUID } from 'node:crypto';
import { afterEach, describe, expect, it } from 'vitest';
import {
  assertActorFeedReplayHas,
  assertServerHasAclEntry
} from '../harness/assertions.js';
import { ScenarioHarness } from '../harness/scenarioHarness.js';

describe('groupSharingBasics', () => {
  let harness: ScenarioHarness | null = null;

  afterEach(async () => {
    if (harness) {
      await harness.teardown();
      harness = null;
    }
  });

  it('shares an item with a single group and both actors converge', async () => {
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

  it('shares an item with multiple groups at different access levels', async () => {
    const readersGroup = randomUUID();
    const writersGroup = randomUUID();
    const adminsGroup = randomUUID();
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
      principalId: readersGroup,
      accessLevel: 'read',
      occurredAt: harness.nextTimestamp()
    });
    alice.queueCrdtOp({
      opType: 'acl_add',
      itemId,
      principalType: 'group',
      principalId: writersGroup,
      accessLevel: 'write',
      occurredAt: harness.nextTimestamp()
    });
    alice.queueCrdtOp({
      opType: 'acl_add',
      itemId,
      principalType: 'group',
      principalId: adminsGroup,
      accessLevel: 'admin',
      occurredAt: harness.nextTimestamp()
    });

    await alice.flush();
    await bob.sync();

    assertServerHasAclEntry({
      server: harness.server,
      itemId,
      principalType: 'group',
      principalId: readersGroup,
      accessLevel: 'read'
    });
    assertServerHasAclEntry({
      server: harness.server,
      itemId,
      principalType: 'group',
      principalId: writersGroup,
      accessLevel: 'write'
    });
    assertServerHasAclEntry({
      server: harness.server,
      itemId,
      principalType: 'group',
      principalId: adminsGroup,
      accessLevel: 'admin'
    });

    const bobAcl = bob
      .syncSnapshot()
      .acl.filter((e) => e.itemId === itemId && e.principalType === 'group');
    expect(bobAcl).toHaveLength(3);
  });

  it('upgrades group access level in-place (read -> admin)', async () => {
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
      accessLevel: 'read',
      occurredAt: harness.nextTimestamp()
    });

    await alice.flush();

    alice.queueCrdtOp({
      opType: 'acl_add',
      itemId,
      principalType: 'group',
      principalId: groupId,
      accessLevel: 'admin',
      occurredAt: harness.nextTimestamp()
    });

    await alice.flush();
    await bob.sync();

    assertServerHasAclEntry({
      server: harness.server,
      itemId,
      principalType: 'group',
      principalId: groupId,
      accessLevel: 'admin'
    });

    const serverGroupAcl = harness.server
      .snapshot()
      .acl.filter(
        (e) =>
          e.itemId === itemId &&
          e.principalType === 'group' &&
          e.principalId === groupId
      );
    expect(serverGroupAcl).toHaveLength(1);
  });

  it('overlapping user and group grants coexist on the same item', async () => {
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
      accessLevel: 'read',
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

    const aclForItem = harness.server
      .snapshot()
      .acl.filter((e) => e.itemId === itemId);
    expect(aclForItem).toHaveLength(3);

    assertServerHasAclEntry({
      server: harness.server,
      itemId,
      principalType: 'user',
      principalId: bob.userId,
      accessLevel: 'read'
    });
    assertServerHasAclEntry({
      server: harness.server,
      itemId,
      principalType: 'group',
      principalId: groupId,
      accessLevel: 'write'
    });
  });

  it('group ACL coexists with links on the same item', async () => {
    const groupId = randomUUID();
    const itemId = randomUUID();
    const parentFolderId = randomUUID();

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
      opType: 'link_add',
      itemId,
      parentId: parentFolderId,
      childId: itemId,
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

    const serverLinks = harness.server.snapshot().links;
    expect(
      serverLinks.find(
        (l) => l.parentId === parentFolderId && l.childId === itemId
      )
    ).toBeDefined();

    alice.queueCrdtOp({
      opType: 'acl_remove',
      itemId,
      principalType: 'group',
      principalId: groupId,
      occurredAt: harness.nextTimestamp()
    });
    await alice.flush();

    const postRevokeSnapshot = harness.server.snapshot();
    expect(
      postRevokeSnapshot.acl.find(
        (e) =>
          e.itemId === itemId &&
          e.principalType === 'group' &&
          e.principalId === groupId
      )
    ).toBeUndefined();
    expect(
      postRevokeSnapshot.links.find(
        (l) => l.parentId === parentFolderId && l.childId === itemId
      )
    ).toBeDefined();
  });
});
