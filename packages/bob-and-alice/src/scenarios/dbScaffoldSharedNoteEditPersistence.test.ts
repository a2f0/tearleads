import { randomUUID } from 'node:crypto';
import type {
  VfsCrdtPushOperation,
  VfsCrdtPushResponse,
  VfsCrdtSyncItem,
  VfsCrdtSyncResponse
} from '@tearleads/shared';
import {
  combinePublicKey,
  generateKeyPair,
  serializePublicKey
} from '@tearleads/shared';
import { setupBobNotesShareForAliceDb } from '@tearleads/shared/scaffolding';
import { afterEach, describe, expect, it } from 'vitest';
import { ApiScenarioHarness } from '../harness/apiScenarioHarness.js';
import {
  type BrowserRuntimeActor,
  createBrowserRuntimeActor,
  queryLocalNoteById,
  refreshLocalStateFromApi,
  teardownBrowserRuntimeActors
} from '../harness/browserRuntimeHarness.js';
import { queryLocalItemPermission } from '../harness/browserRuntimePermissions.js';
import { getApiDeps } from '../harness/getApiDeps.js';
import { fetchVfsConnectJson } from '../harness/vfsConnectClient.js';

type ScenarioActor = ReturnType<ApiScenarioHarness['actor']>;

function toBase64(value: string): string {
  return Buffer.from(value, 'utf8').toString('base64');
}

function buildPublicEncryptionKey(): string {
  const keyPair = generateKeyPair();
  return combinePublicKey(
    serializePublicKey({
      x25519PublicKey: keyPair.x25519PublicKey,
      mlKemPublicKey: keyPair.mlKemPublicKey
    })
  );
}

async function seedUserKeys(input: {
  client: {
    query: (text: string, params?: readonly unknown[]) => Promise<unknown>;
  };
  bobUserId: string;
  aliceUserId: string;
}): Promise<void> {
  const bobPublicKey = buildPublicEncryptionKey();
  const alicePublicKey = buildPublicEncryptionKey();

  await input.client.query(
    `INSERT INTO user_keys (
       user_id,
       public_encryption_key,
       public_signing_key,
       encrypted_private_keys,
       argon2_salt,
       created_at
     )
     VALUES ($1, $2, $3, $4, $5, NOW())
     ON CONFLICT (user_id) DO UPDATE SET
       public_encryption_key = EXCLUDED.public_encryption_key`,
    [
      input.bobUserId,
      bobPublicKey,
      'seeded-signing-key-bob',
      'seeded-private-keys-bob',
      'seeded-argon2-salt-bob'
    ]
  );

  await input.client.query(
    `INSERT INTO user_keys (
       user_id,
       public_encryption_key,
       public_signing_key,
       encrypted_private_keys,
       argon2_salt,
       created_at
     )
     VALUES ($1, $2, $3, $4, $5, NOW())
     ON CONFLICT (user_id) DO UPDATE SET
       public_encryption_key = EXCLUDED.public_encryption_key`,
    [
      input.aliceUserId,
      alicePublicKey,
      'seeded-signing-key-alice',
      'seeded-private-keys-alice',
      'seeded-argon2-salt-alice'
    ]
  );
}

async function fetchAllCrdtItems(
  actor: ScenarioActor
): Promise<VfsCrdtSyncItem[]> {
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

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0;
}

describe('DB scaffold shared note edit persistence', () => {
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

  it('keeps Alice note edits after rematerialization and syncs back to Bob', async () => {
    harness = await ApiScenarioHarness.create(
      [{ alias: 'bob' }, { alias: 'alice' }],
      getApiDeps
    );

    const bob = harness.actor('bob');
    const alice = harness.actor('alice');

    const client = await harness.ctx.pool.connect();
    let seededShare: Awaited<ReturnType<typeof setupBobNotesShareForAliceDb>>;
    try {
      await seedUserKeys({
        client,
        bobUserId: bob.user.userId,
        aliceUserId: alice.user.userId
      });

      seededShare = await setupBobNotesShareForAliceDb({
        client,
        bobEmail: bob.user.email,
        aliceEmail: alice.user.email
      });
    } finally {
      client.release();
    }

    const bobRuntime = await createBrowserRuntimeActor('bob-instance-1');
    const aliceRuntime = await createBrowserRuntimeActor('alice-instance-2');
    browserActors = [bobRuntime, aliceRuntime];

    const knownUsers = [
      { id: bob.user.userId, email: bob.user.email },
      { id: alice.user.userId, email: alice.user.email }
    ];

    await refreshLocalStateFromApi({
      actor: bob,
      localDb: bobRuntime.localDb,
      knownUsers
    });
    await refreshLocalStateFromApi({
      actor: alice,
      localDb: aliceRuntime.localDb,
      knownUsers
    });

    const initialAliceNote = await queryLocalNoteById(
      aliceRuntime.localDb,
      seededShare.noteId
    );
    expect(initialAliceNote?.content).toBe('Hello, Alice');

    const alicePermission = await queryLocalItemPermission({
      localDb: aliceRuntime.localDb,
      itemId: seededShare.noteId,
      currentUserId: alice.user.userId
    });
    expect(alicePermission.canRead).toBe(true);
    expect(alicePermission.canEdit).toBe(true);
    expect(alicePermission.permissionLevel).toBe('edit');

    const seededNoteTimelineFloorMs = (await fetchAllCrdtItems(alice))
      .filter(
        (item) =>
          item.itemId === seededShare.noteId &&
          (item.opType === 'item_upsert' || item.opType === 'item_delete')
      )
      .reduce((maxOccurredAtMs, item) => {
        const occurredAtMs = Date.parse(item.occurredAt);
        if (!Number.isFinite(occurredAtMs)) {
          return maxOccurredAtMs;
        }
        return Math.max(maxOccurredAtMs, occurredAtMs);
      }, 0);
    // Keep push timestamps above scaffolded CRDT entries so writes are never
    // interpreted as stale based on wall-clock execution time.
    const baseOccurredAtMs = Math.max(seededNoteTimelineFloorMs, Date.now());

    const aliceFirstEditPlaintext = 'alice-edit-after-db-scaffold';
    const aliceFirstOperation = buildItemUpsertOperation({
      opId: `alice-op-${randomUUID()}`,
      itemId: seededShare.noteId,
      replicaId: 'alice-client',
      writeId: 1,
      occurredAt: new Date(baseOccurredAtMs).toISOString(),
      plaintext: aliceFirstEditPlaintext
    });
    const aliceFirstPayload = aliceFirstOperation.encryptedPayload ?? '';
    const aliceFirstPush = await alice.fetchJson<VfsCrdtPushResponse>(
      '/vfs/crdt/push',
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          clientId: 'alice-client',
          operations: [aliceFirstOperation]
        })
      }
    );
    expect(aliceFirstPush.results[0]?.status).toBe('applied');

    // Simulate close -> reopen by rematerializing local state repeatedly.
    for (let cycle = 0; cycle < 2; cycle += 1) {
      await refreshLocalStateFromApi({
        actor: alice,
        localDb: aliceRuntime.localDb,
        knownUsers
      });
      expect(
        (await queryLocalNoteById(aliceRuntime.localDb, seededShare.noteId))
          ?.content
      ).toBe(aliceFirstEditPlaintext);
    }

    const aliceSecondEditPlaintext = 'alice-edit-after-reopen';
    const aliceSecondOperation = buildItemUpsertOperation({
      opId: `alice-op-${randomUUID()}`,
      itemId: seededShare.noteId,
      replicaId: 'alice-client',
      writeId: 2,
      occurredAt: new Date(baseOccurredAtMs + 1_000).toISOString(),
      plaintext: aliceSecondEditPlaintext
    });
    const aliceSecondPayload = aliceSecondOperation.encryptedPayload ?? '';
    const aliceSecondPush = await alice.fetchJson<VfsCrdtPushResponse>(
      '/vfs/crdt/push',
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          clientId: 'alice-client',
          operations: [aliceSecondOperation]
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
        (await queryLocalNoteById(aliceRuntime.localDb, seededShare.noteId))
          ?.content
      ).toBe(aliceSecondEditPlaintext);
    }

    await refreshLocalStateFromApi({
      actor: bob,
      localDb: bobRuntime.localDb,
      knownUsers
    });
    expect(
      (await queryLocalNoteById(bobRuntime.localDb, seededShare.noteId))
        ?.content
    ).toBe(aliceSecondEditPlaintext);

    const bobCrdtFeed = await fetchAllCrdtItems(bob);
    const firstAliceFeedUpsert = bobCrdtFeed.find(
      (item) =>
        item.itemId === seededShare.noteId &&
        item.opType === 'item_upsert' &&
        item.actorId === alice.user.userId &&
        item.encryptedPayload === aliceFirstPayload
    );
    const secondAliceFeedUpsert = bobCrdtFeed.find(
      (item) =>
        item.itemId === seededShare.noteId &&
        item.opType === 'item_upsert' &&
        item.actorId === alice.user.userId &&
        item.encryptedPayload === aliceSecondPayload
    );
    // Guardrail: feed upserts must keep non-empty envelope metadata.
    expect(firstAliceFeedUpsert).toBeDefined();
    expect(isNonEmptyString(firstAliceFeedUpsert?.encryptionNonce)).toBe(true);
    expect(isNonEmptyString(firstAliceFeedUpsert?.encryptionAad)).toBe(true);
    expect(isNonEmptyString(firstAliceFeedUpsert?.encryptionSignature)).toBe(
      true
    );
    expect(firstAliceFeedUpsert?.keyEpoch).toBe(1);

    expect(secondAliceFeedUpsert).toBeDefined();
    expect(isNonEmptyString(secondAliceFeedUpsert?.encryptionNonce)).toBe(true);
    expect(isNonEmptyString(secondAliceFeedUpsert?.encryptionAad)).toBe(true);
    expect(isNonEmptyString(secondAliceFeedUpsert?.encryptionSignature)).toBe(
      true
    );
    expect(secondAliceFeedUpsert?.keyEpoch).toBe(1);
  });

  it('keeps read-only DB-scaffold shares non-editable and push is rejected', async () => {
    harness = await ApiScenarioHarness.create(
      [{ alias: 'bob' }, { alias: 'alice' }],
      getApiDeps
    );

    const bob = harness.actor('bob');
    const alice = harness.actor('alice');

    const client = await harness.ctx.pool.connect();
    let seededShare: Awaited<ReturnType<typeof setupBobNotesShareForAliceDb>>;
    try {
      await seedUserKeys({
        client,
        bobUserId: bob.user.userId,
        aliceUserId: alice.user.userId
      });

      seededShare = await setupBobNotesShareForAliceDb({
        client,
        bobEmail: bob.user.email,
        aliceEmail: alice.user.email,
        shareAccessLevel: 'read'
      });
    } finally {
      client.release();
    }

    const aliceRuntime = await createBrowserRuntimeActor('alice-readonly');
    browserActors = [aliceRuntime];

    const knownUsers = [
      { id: bob.user.userId, email: bob.user.email },
      { id: alice.user.userId, email: alice.user.email }
    ];

    await refreshLocalStateFromApi({
      actor: alice,
      localDb: aliceRuntime.localDb,
      knownUsers
    });

    const initialPayload =
      (await queryLocalNoteById(aliceRuntime.localDb, seededShare.noteId))
        ?.content ?? '';
    expect(initialPayload.length).toBeGreaterThan(0);

    const alicePermission = await queryLocalItemPermission({
      localDb: aliceRuntime.localDb,
      itemId: seededShare.noteId,
      currentUserId: alice.user.userId
    });
    expect(alicePermission.canRead).toBe(true);
    expect(alicePermission.canEdit).toBe(false);
    expect(alicePermission.permissionLevel).toBe('view');

    const rejectedPush = await alice.fetchJson<VfsCrdtPushResponse>(
      '/vfs/crdt/push',
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          clientId: 'alice-client-readonly',
          operations: [
            buildItemUpsertOperation({
              opId: `alice-op-${randomUUID()}`,
              itemId: seededShare.noteId,
              replicaId: 'alice-client-readonly',
              writeId: 1,
              occurredAt: '2026-03-07T18:00:00.000Z',
              plaintext: 'alice-should-not-be-allowed-to-write'
            })
          ]
        })
      }
    );
    expect(rejectedPush.results[0]?.status).toBe('invalidOp');

    await refreshLocalStateFromApi({
      actor: alice,
      localDb: aliceRuntime.localDb,
      knownUsers
    });
    expect(
      (await queryLocalNoteById(aliceRuntime.localDb, seededShare.noteId))
        ?.content
    ).toBe(initialPayload);
  });
});
