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
  pullRemoteFeedsWithoutLocalHydration,
  queryLocalNoteById,
  queryLocalSharedWithMe,
  refreshLocalStateFromApi,
  teardownBrowserRuntimeActors
} from '../harness/browserRuntimeHarness.js';
import { getApiDeps } from '../harness/getApiDeps.js';

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

async function clearLocalRuntimeCache(
  actor: BrowserRuntimeActor
): Promise<void> {
  await actor.localDb.adapter.execute('PRAGMA foreign_keys = OFF');
  await actor.localDb.adapter.execute('BEGIN');
  try {
    await actor.localDb.adapter.execute(`DELETE FROM vfs_acl_entries`);
    await actor.localDb.adapter.execute(`DELETE FROM users`);
    await actor.localDb.adapter.execute(`DELETE FROM notes`);
    await actor.localDb.adapter.execute(`DELETE FROM vfs_registry`);
    await actor.localDb.adapter.execute('COMMIT');
  } catch (error) {
    await actor.localDb.adapter.execute('ROLLBACK');
    throw error;
  } finally {
    await actor.localDb.adapter.execute('PRAGMA foreign_keys = ON');
  }
}

describe('DB scaffold fresh-login cache-reset rematerialization', () => {
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

  it('re-hydrates Bob shared note for Alice after cache reset and fresh login pull', async () => {
    harness = await ApiScenarioHarness.create(
      [{ alias: 'bob' }, { alias: 'alice' }],
      getApiDeps
    );

    const bob = harness.actor('bob');
    const alice = harness.actor('alice');
    const folderName = 'Notes shared with Alice';
    const noteName = 'Note for Alice - From Bob';

    const client = await harness.ctx.pool.connect();
    let seeded: Awaited<ReturnType<typeof setupBobNotesShareForAliceDb>>;
    try {
      await seedUserKeys({
        client,
        bobUserId: bob.user.userId,
        aliceUserId: alice.user.userId
      });

      seeded = await setupBobNotesShareForAliceDb({
        client,
        bobEmail: bob.user.email,
        aliceEmail: alice.user.email,
        folderName,
        noteName
      });
    } finally {
      client.release();
    }

    const aliceRuntime = await createBrowserRuntimeActor('alice-fresh-login');
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

    const firstHydrationSharedWithMe = await queryLocalSharedWithMe(
      aliceRuntime.localDb,
      alice.user.userId
    );
    const firstHydrationIds = new Set(
      firstHydrationSharedWithMe.map((item) => item.id)
    );
    expect(firstHydrationIds.has(seeded.folderId)).toBe(true);
    expect(firstHydrationIds.has(seeded.noteId)).toBe(true);
    expect(
      await queryLocalNoteById(aliceRuntime.localDb, seeded.noteId)
    ).toEqual({
      id: seeded.noteId,
      title: noteName,
      content: 'Hello, Alice',
      deleted: 0
    });

    // Simulate local cache reset before a fresh login rematerialization pull.
    await clearLocalRuntimeCache(aliceRuntime);
    expect(
      await queryLocalSharedWithMe(aliceRuntime.localDb, alice.user.userId)
    ).toHaveLength(0);
    expect(await queryLocalNoteById(aliceRuntime.localDb, seeded.noteId)).toBe(
      null
    );

    const feedCounts = await pullRemoteFeedsWithoutLocalHydration({
      actor: alice
    });
    expect(feedCounts.syncItems).toBeGreaterThan(0);
    expect(feedCounts.crdtItems).toBeGreaterThan(0);

    for (let cycle = 0; cycle < 2; cycle += 1) {
      await refreshLocalStateFromApi({
        actor: alice,
        localDb: aliceRuntime.localDb,
        knownUsers
      });

      const sharedWithMeAfterReset = await queryLocalSharedWithMe(
        aliceRuntime.localDb,
        alice.user.userId
      );
      const sharedWithMeIds = new Set(
        sharedWithMeAfterReset.map((item) => item.id)
      );

      expect(sharedWithMeIds.has(seeded.folderId)).toBe(true);
      expect(sharedWithMeIds.has(seeded.noteId)).toBe(true);
      expect(
        await queryLocalNoteById(aliceRuntime.localDb, seeded.noteId)
      ).toEqual({
        id: seeded.noteId,
        title: noteName,
        content: 'Hello, Alice',
        deleted: 0
      });
    }
  });
});
