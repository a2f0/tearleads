import { randomUUID } from 'node:crypto';
import type {
  VfsCrdtPushOperation,
  VfsCrdtPushResponse,
  VfsCrdtSyncItem,
  VfsCrdtSyncResponse
} from '@tearleads/shared';
import { afterEach, describe, expect, it } from 'vitest';
import { ApiScenarioHarness } from '../harness/apiScenarioHarness.js';
import {
  type BrowserRuntimeActor,
  createBrowserRuntimeActor,
  queryLocalNoteById,
  refreshLocalStateFromApi,
  teardownBrowserRuntimeActors
} from '../harness/browserRuntimeHarness.js';
import { fetchVfsConnectJson } from '../harness/vfsConnectClient.js';

const getApiDeps = async () => {
  const api = await import('@tearleads/api');
  return { app: api.app, migrations: api.migrations };
};

type ScenarioActor = ReturnType<ApiScenarioHarness['actor']>;

function toBase64(value: string): string {
  return Buffer.from(value, 'utf8').toString('base64');
}

async function seedVfsKeys(
  actor: ScenarioActor,
  alias: string
): Promise<void> {
  const response = await actor.fetch('/vfs/keys', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      publicEncryptionKey: `${alias}-public-enc-key`,
      publicSigningKey: `${alias}-public-sign-key`,
      encryptedPrivateKeys: `${alias}-encrypted-private-keys`,
      argon2Salt: `${alias}-argon2-salt`
    })
  });
  expect(response.status).toBe(201);
}

async function fetchAllCrdtItems(actor: ScenarioActor): Promise<VfsCrdtSyncItem[]> {
  const items: VfsCrdtSyncItem[] = [];
  let cursor: string | undefined;

  while (true) {
    const page = await fetchVfsConnectJson<VfsCrdtSyncResponse>({
      actor,
      methodName: 'GetCrdtSync',
      requestBody: {
        limit: 200,
        ...(cursor ? { cursor } : {})
      }
    });
    items.push(...page.items);

    if (!page.hasMore) {
      break;
    }

    if (!page.nextCursor) {
      throw new Error('crdt feed reported hasMore=true without nextCursor');
    }
    cursor = page.nextCursor;
  }

  return items;
}

function buildItemUpsertOperation(input: {
  opId: string;
  itemId: string;
  replicaId: string;
  writeId: number;
  occurredAt: string;
  plaintext: string;
}): VfsCrdtPushOperation {
  return {
    opId: input.opId,
    opType: 'item_upsert',
    itemId: input.itemId,
    replicaId: input.replicaId,
    writeId: input.writeId,
    occurredAt: input.occurredAt,
    encryptedPayload: toBase64(input.plaintext),
    keyEpoch: 1,
    encryptionNonce: toBase64(`nonce-${input.opId}`),
    encryptionAad: toBase64(`aad-${input.opId}`),
    encryptionSignature: toBase64(`sig-${input.opId}`)
  };
}

describe('shared note edit sync', () => {
  let harness: ApiScenarioHarness | null = null;
  let browserActors: BrowserRuntimeActor[] = [];

  afterEach(async () => {
    await teardownBrowserRuntimeActors(browserActors);
    browserActors = [];
    if (harness) {
      await harness.teardown();
      harness = null;
    }
  });

  it('allows Alice to push an edit to Bob-owned note shared with edit access', async () => {
    harness = await ApiScenarioHarness.create(
      [{ alias: 'bob' }, { alias: 'alice' }],
      getApiDeps
    );

    const bob = harness.actor('bob');
    const alice = harness.actor('alice');
    const bobRuntime = await createBrowserRuntimeActor('bob');
    const aliceRuntime = await createBrowserRuntimeActor('alice');
    browserActors = [bobRuntime, aliceRuntime];

    const sharedOrgId = `shared-org-${randomUUID()}`;
    await harness.ctx.pool.query(
      `INSERT INTO organizations (id, name, created_at, updated_at)
       VALUES ($1, 'Shared Org', NOW(), NOW())`,
      [sharedOrgId]
    );
    await harness.ctx.pool.query(
      `INSERT INTO user_organizations (user_id, organization_id, joined_at)
       VALUES ($1, $2, NOW()), ($3, $2, NOW())`,
      [bob.user.userId, sharedOrgId, alice.user.userId]
    );

    await seedVfsKeys(bob, 'bob');
    await seedVfsKeys(alice, 'alice');
    const knownUsers = [
      { id: bob.user.userId, email: bob.user.email },
      { id: alice.user.userId, email: alice.user.email }
    ];

    const noteId = `note-${randomUUID()}`;
    await bob.fetchJson('/vfs/register', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        id: noteId,
        objectType: 'note',
        encryptedSessionKey: 'bob-note-session-key',
        encryptedName: 'Shared note from Bob'
      })
    });

    await bob.fetchJson(`/vfs/items/${encodeURIComponent(noteId)}/shares`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        itemId: noteId,
        shareType: 'user',
        targetId: alice.user.userId,
        permissionLevel: 'edit',
        wrappedKey: {
          recipientUserId: alice.user.userId,
          recipientPublicKeyId: 'alice-public-key-id',
          keyEpoch: 1,
          encryptedKey: 'wrapped-key-for-alice',
          senderSignature: 'bob-share-signature'
        }
      })
    });

    const baseOccurredAtMs = Date.parse('2026-03-07T15:00:00.000Z');
    const bobPushOperation = buildItemUpsertOperation({
      opId: `bob-op-${randomUUID()}`,
      itemId: noteId,
      replicaId: 'bob-client',
      writeId: 1,
      occurredAt: new Date(baseOccurredAtMs).toISOString(),
      plaintext: 'bob-seed'
    });
    const bobSeedPayload = bobPushOperation.encryptedPayload ?? '';
    const bobPush = await bob.fetchJson<VfsCrdtPushResponse>('/vfs/crdt/push', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        clientId: 'bob-client',
        operations: [bobPushOperation]
      })
    });
    expect(bobPush.results[0]?.status).toBe('applied');

    await refreshLocalStateFromApi({
      actor: alice,
      localDb: aliceRuntime.localDb,
      knownUsers
    });
    expect((await queryLocalNoteById(aliceRuntime.localDb, noteId))?.content).toBe(
      bobSeedPayload
    );

    const aliceEditPlaintext = 'alice-edit-v2';
    const alicePushOperation = buildItemUpsertOperation({
      opId: `alice-op-${randomUUID()}`,
      itemId: noteId,
      replicaId: 'alice-client',
      writeId: 1,
      occurredAt: new Date(baseOccurredAtMs + 1_000).toISOString(),
      plaintext: aliceEditPlaintext
    });
    const aliceEditPayload = alicePushOperation.encryptedPayload ?? '';
    const alicePush = await alice.fetchJson<VfsCrdtPushResponse>(
      '/vfs/crdt/push',
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          clientId: 'alice-client',
          operations: [alicePushOperation]
        })
      }
    );
    expect(alicePush.results[0]?.status).toBe('applied');

    await refreshLocalStateFromApi({
      actor: alice,
      localDb: aliceRuntime.localDb,
      knownUsers
    });
    expect((await queryLocalNoteById(aliceRuntime.localDb, noteId))?.content).toBe(
      aliceEditPayload
    );

    // Simulate close -> reopen cycles by repeatedly re-materializing local state.
    for (let cycle = 0; cycle < 2; cycle += 1) {
      await refreshLocalStateFromApi({
        actor: alice,
        localDb: aliceRuntime.localDb,
        knownUsers
      });
      expect(
        (await queryLocalNoteById(aliceRuntime.localDb, noteId))?.content
      ).toBe(aliceEditPayload);
    }

    // Alice edits again after reopening and should keep the latest value.
    const aliceSecondEditPlaintext = 'alice-edit-v3-after-reopen';
    const aliceSecondPushOperation = buildItemUpsertOperation({
      opId: `alice-op-${randomUUID()}`,
      itemId: noteId,
      replicaId: 'alice-client',
      writeId: 2,
      occurredAt: new Date(baseOccurredAtMs + 2_000).toISOString(),
      plaintext: aliceSecondEditPlaintext
    });
    const aliceSecondEditPayload =
      aliceSecondPushOperation.encryptedPayload ?? '';
    const aliceSecondPush = await alice.fetchJson<VfsCrdtPushResponse>(
      '/vfs/crdt/push',
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          clientId: 'alice-client',
          operations: [aliceSecondPushOperation]
        })
      }
    );
    expect(aliceSecondPush.results[0]?.status).toBe('applied');

    for (let cycle = 0; cycle < 2; cycle += 1) {
      await refreshLocalStateFromApi({
        actor: alice,
        localDb: aliceRuntime.localDb,
        knownUsers
      });
      expect(
        (await queryLocalNoteById(aliceRuntime.localDb, noteId))?.content
      ).toBe(aliceSecondEditPayload);
    }

    await refreshLocalStateFromApi({
      actor: bob,
      localDb: bobRuntime.localDb,
      knownUsers
    });
    expect((await queryLocalNoteById(bobRuntime.localDb, noteId))?.content).toBe(
      aliceSecondEditPayload
    );

    const bobFeed = await fetchAllCrdtItems(bob);
    expect(
      bobFeed.some(
        (item) =>
          item.itemId === noteId &&
          item.opType === 'item_upsert' &&
          item.actorId === alice.user.userId &&
          item.encryptedPayload === aliceEditPayload
      )
    ).toBe(true);
    expect(
      bobFeed.some(
        (item) =>
          item.itemId === noteId &&
          item.opType === 'item_upsert' &&
          item.actorId === alice.user.userId &&
          item.encryptedPayload === aliceSecondEditPayload
      )
    ).toBe(true);
  });
});
