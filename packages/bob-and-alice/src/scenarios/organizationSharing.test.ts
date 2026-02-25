import { randomUUID } from 'node:crypto';
import { afterEach, describe, expect, it } from 'vitest';
import {
  assertActorFeedReplayHas,
  assertServerHasAclEntry
} from '../harness/assertions.js';
import { ScenarioHarness } from '../harness/scenarioHarness.js';

describe('organizationSharing', () => {
  let harness: ScenarioHarness | null = null;

  afterEach(async () => {
    if (harness) {
      await harness.teardown();
      harness = null;
    }
  });

  it('shares a folder with Bob using a group principal when users are modeled in one org', async () => {
    const sharedGroupId = randomUUID();
    const folderId = randomUUID();

    harness = await ScenarioHarness.create({
      actors: [{ alias: 'alice' }, { alias: 'bob' }]
    });

    const alice = harness.actor('alice');
    const bob = harness.actor('bob');

    alice.queueCrdtOp({
      opType: 'acl_add',
      itemId: folderId,
      principalType: 'user',
      principalId: alice.userId,
      accessLevel: 'admin',
      occurredAt: harness.nextTimestamp()
    });
    alice.queueCrdtOp({
      opType: 'acl_add',
      itemId: folderId,
      principalType: 'group',
      principalId: sharedGroupId,
      accessLevel: 'write',
      occurredAt: harness.nextTimestamp()
    });

    await alice.flush();
    await bob.sync();

    assertServerHasAclEntry({
      server: harness.server,
      itemId: folderId,
      principalType: 'group',
      principalId: sharedGroupId,
      accessLevel: 'write'
    });
    assertActorFeedReplayHas(bob, folderId);
  });

  it('surfaces cross-org visibility behavior for organization-principal sharing', async () => {
    const aliceOrganizationId = `org-${randomUUID()}`;
    const bobOrganizationId = `org-${randomUUID()}`;
    const folderId = randomUUID();

    harness = await ScenarioHarness.create({
      actors: [{ alias: 'alice' }, { alias: 'bob' }]
    });

    const alice = harness.actor('alice');
    const bob = harness.actor('bob');

    expect(aliceOrganizationId).not.toBe(bobOrganizationId);

    alice.queueCrdtOp({
      opType: 'acl_add',
      itemId: folderId,
      principalType: 'user',
      principalId: alice.userId,
      accessLevel: 'admin',
      occurredAt: harness.nextTimestamp()
    });
    alice.queueCrdtOp({
      opType: 'acl_add',
      itemId: folderId,
      principalType: 'organization',
      principalId: aliceOrganizationId,
      accessLevel: 'read',
      occurredAt: harness.nextTimestamp()
    });

    await alice.flush();
    await bob.sync();

    assertServerHasAclEntry({
      server: harness.server,
      itemId: folderId,
      principalType: 'organization',
      principalId: aliceOrganizationId,
      accessLevel: 'read'
    });
    assertActorFeedReplayHas(bob, folderId);

    const bobAclForFolder = bob
      .syncSnapshot()
      .acl.filter((entry) => entry.itemId === folderId);
    const bobHasDirectGrant = bobAclForFolder.some(
      (entry) =>
        (entry.principalType === 'user' && entry.principalId === bob.userId) ||
        (entry.principalType === 'organization' &&
          entry.principalId === bobOrganizationId)
    );
    expect(bobHasDirectGrant).toBe(false);
    expect(bobAclForFolder).toContainEqual({
      itemId: folderId,
      principalType: 'organization',
      principalId: aliceOrganizationId,
      accessLevel: 'read'
    });
  });
});
