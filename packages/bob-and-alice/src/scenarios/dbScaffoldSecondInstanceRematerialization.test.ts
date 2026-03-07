import {
  combinePublicKey,
  generateKeyPair,
  serializePublicKey
} from '@tearleads/shared';
import {
  setupBobNotesShareForAliceDb,
  setupBobPhotoAlbumShareForAliceDb
} from '@tearleads/shared/scaffolding';
import { afterEach, describe, expect, it } from 'vitest';
import { ApiScenarioHarness } from '../harness/apiScenarioHarness.js';
import { getApiDeps } from '../harness/getApiDeps.js';
import {
  type BrowserRuntimeActor,
  createBrowserRuntimeActor,
  queryLocalSharedWithMe,
  refreshLocalStateFromApi,
  teardownBrowserRuntimeActors
} from '../harness/browserRuntimeHarness.js';

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

async function readRegistryNames(
  actor: BrowserRuntimeActor,
  ids: readonly string[]
): Promise<Map<string, string | null>> {
  if (ids.length === 0) {
    return new Map();
  }

  const placeholders = ids.map(() => '?').join(', ');
  const result = await actor.localDb.adapter.execute(
    `SELECT id, encrypted_name
     FROM vfs_registry
     WHERE id IN (${placeholders})`,
    [...ids]
  );

  return new Map(
    result.rows.map((row) => [
      String(row['id']),
      row['encrypted_name'] === null ? null : String(row['encrypted_name'])
    ])
  );
}

async function readLocalNote(
  actor: BrowserRuntimeActor,
  noteId: string
): Promise<{ id: string; title: string; deleted: number } | null> {
  const result = await actor.localDb.adapter.execute(
    `SELECT id, title, deleted FROM notes WHERE id = ?`,
    [noteId]
  );

  const row = result.rows[0];
  if (!row) {
    return null;
  }

  return {
    id: String(row['id']),
    title: String(row['title']),
    deleted: Number(row['deleted'])
  };
}

describe('DB scaffolding second-instance rematerialization', () => {
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

  it('keeps shared names and note visible for Alice after Bob uses a different instance first', async () => {
    harness = await ApiScenarioHarness.create(
      [{ alias: 'bob' }, { alias: 'alice' }],
      getApiDeps
    );

    const bob = harness.actor('bob');
    const alice = harness.actor('alice');

    const folderName = 'Notes shared with Alice';
    const noteName = 'Note for Alice - From Bob';
    const albumName = 'Photos shared with Alice';
    const photoName = 'Tearleads logo.svg';

    const client = await harness.ctx.pool.connect();
    let seededNotes: Awaited<ReturnType<typeof setupBobNotesShareForAliceDb>>;
    let seededPhotos: Awaited<
      ReturnType<typeof setupBobPhotoAlbumShareForAliceDb>
    >;
    try {
      await seedUserKeys({
        client,
        bobUserId: bob.user.userId,
        aliceUserId: alice.user.userId
      });

      seededNotes = await setupBobNotesShareForAliceDb({
        client,
        bobEmail: bob.user.email,
        aliceEmail: alice.user.email,
        folderName,
        noteName
      });

      seededPhotos = await setupBobPhotoAlbumShareForAliceDb({
        client,
        bobEmail: bob.user.email,
        aliceEmail: alice.user.email,
        albumName,
        photoName
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

    // Simulate first browser instance login as Bob.
    await refreshLocalStateFromApi({
      actor: bob,
      localDb: bobRuntime.localDb,
      knownUsers
    });

    // Simulate opening a new instance and logging in as Alice.
    await refreshLocalStateFromApi({
      actor: alice,
      localDb: aliceRuntime.localDb,
      knownUsers
    });

    const aliceSharedWithMe = await queryLocalSharedWithMe(
      aliceRuntime.localDb,
      alice.user.userId
    );
    const sharedIds = new Set(aliceSharedWithMe.map((item) => item.id));

    expect(sharedIds.has(seededNotes.folderId)).toBe(true);
    expect(sharedIds.has(seededNotes.noteId)).toBe(true);
    expect(sharedIds.has(seededPhotos.albumId)).toBe(true);
    expect(sharedIds.has(seededPhotos.photoId)).toBe(true);

    const namesById = await readRegistryNames(aliceRuntime, [
      seededNotes.folderId,
      seededNotes.noteId,
      seededPhotos.albumId,
      seededPhotos.photoId
    ]);

    expect(namesById.get(seededNotes.folderId)).toBe(folderName);
    expect(namesById.get(seededNotes.noteId)).toBe(noteName);
    expect(namesById.get(seededPhotos.albumId)).toBe(albumName);
    expect(namesById.get(seededPhotos.photoId)).toBe(photoName);

    const localNote = await readLocalNote(aliceRuntime, seededNotes.noteId);
    expect(localNote).toEqual({
      id: seededNotes.noteId,
      title: noteName,
      deleted: 0
    });
  });
});
