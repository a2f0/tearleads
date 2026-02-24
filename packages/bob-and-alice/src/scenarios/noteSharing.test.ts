import { randomUUID } from 'node:crypto';
import { afterEach, describe, expect, it } from 'vitest';
import {
  assertActorFeedReplayHas,
  assertServerFeedLength,
  assertServerHasAclEntry,
  assertServerHasLink
} from '../harness/assertions.js';
import { ScenarioHarness } from '../harness/scenarioHarness.js';

describe('noteSharing', () => {
  let harness: ScenarioHarness;

  afterEach(async () => {
    await harness.teardown();
  });

  it('Alice creates a note and shares it with Bob via CRDT sync', async () => {
    harness = await ScenarioHarness.create({
      actors: [{ alias: 'alice' }, { alias: 'bob' }]
    });

    const alice = harness.actor('alice');
    const bob = harness.actor('bob');

    const noteId = randomUUID();
    const folderId = randomUUID();

    // Alice queues CRDT ops: item_upsert + acl_add for Bob + link_add
    alice.queueCrdtOp({
      opType: 'acl_add',
      itemId: noteId,
      principalType: 'user',
      principalId: alice.userId,
      accessLevel: 'admin',
      occurredAt: harness.nextTimestamp()
    });

    alice.queueCrdtOp({
      opType: 'acl_add',
      itemId: noteId,
      principalType: 'user',
      principalId: bob.userId,
      accessLevel: 'read',
      occurredAt: harness.nextTimestamp()
    });

    alice.queueCrdtOp({
      opType: 'link_add',
      itemId: noteId,
      parentId: folderId,
      childId: noteId,
      occurredAt: harness.nextTimestamp()
    });

    // Alice flushes to server
    const flushResult = await alice.flush();
    expect(flushResult.pushedOperations).toBe(3);

    // Assert server snapshot has ACL entry, link, and feed ops
    assertServerHasAclEntry({
      server: harness.server,
      itemId: noteId,
      principalType: 'user',
      principalId: alice.userId,
      accessLevel: 'admin'
    });

    assertServerHasAclEntry({
      server: harness.server,
      itemId: noteId,
      principalType: 'user',
      principalId: bob.userId,
      accessLevel: 'read'
    });

    assertServerHasLink({
      server: harness.server,
      parentId: folderId,
      childId: noteId
    });

    assertServerFeedLength({
      server: harness.server,
      expected: 3
    });

    // Bob syncs (pulls from server)
    await bob.sync();

    // Assert Bob's sync client has the shared item
    assertActorFeedReplayHas(bob, noteId);
  });
});
