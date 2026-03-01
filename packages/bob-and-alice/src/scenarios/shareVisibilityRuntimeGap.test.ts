import { randomUUID } from 'node:crypto';
import { afterEach, describe, expect, it } from 'vitest';
import { ApiScenarioHarness } from '../harness/apiScenarioHarness.js';
import {
  type BrowserRuntimeActor,
  createBrowserRuntimeActor,
  pullRemoteFeedsWithoutLocalHydration,
  queryLocalSharedByMe,
  queryLocalSharedWithMe,
  refreshLocalStateFromApi,
  teardownBrowserRuntimeActors
} from '../harness/browserRuntimeHarness.js';

const getApiDeps = async () => {
  const api = await import('@tearleads/api');
  return { app: api.app, migrations: api.migrations };
};

async function seedKeys(input: {
  alice: ReturnType<ApiScenarioHarness['actor']>;
  bob: ReturnType<ApiScenarioHarness['actor']>;
}): Promise<void> {
  await input.alice.fetch('/vfs/keys', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      publicEncryptionKey: 'alice-public-enc-key',
      publicSigningKey: 'alice-public-sign-key',
      encryptedPrivateKeys: 'alice-encrypted-private-keys',
      argon2Salt: 'alice-argon2-salt'
    })
  });
  await input.bob.fetch('/vfs/keys', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      publicEncryptionKey: 'bob-public-enc-key',
      publicSigningKey: 'bob-public-sign-key',
      encryptedPrivateKeys: 'bob-encrypted-private-keys',
      argon2Salt: 'bob-argon2-salt'
    })
  });
}

describe('share visibility runtime gap', () => {
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

  it('requires local hydration for Shared With Me and My Shared Items to populate', async () => {
    harness = await ApiScenarioHarness.create(
      [{ alias: 'alice' }, { alias: 'bob' }],
      getApiDeps
    );

    const alice = harness.actor('alice');
    const bob = harness.actor('bob');

    const sharedOrgId = `shared-org-${randomUUID()}`;
    await harness.ctx.pool.query(
      `INSERT INTO organizations (id, name, created_at, updated_at)
       VALUES ($1, 'Shared Org', NOW(), NOW())`,
      [sharedOrgId]
    );
    await harness.ctx.pool.query(
      `INSERT INTO user_organizations (user_id, organization_id, joined_at)
       VALUES ($1, $2, NOW()), ($3, $2, NOW())`,
      [alice.user.userId, sharedOrgId, bob.user.userId]
    );

    await seedKeys({ alice, bob });

    const aliceBrowser = await createBrowserRuntimeActor('alice');
    const bobBrowser = await createBrowserRuntimeActor('bob');
    browserActors = [aliceBrowser, bobBrowser];

    const folderId = `folder-${randomUUID()}`;
    await alice.fetchJson('/vfs/register', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        id: folderId,
        objectType: 'folder',
        encryptedSessionKey: 'alice-folder-session-key'
      })
    });

    await alice.fetchJson<{ share: { targetId: string } }>(
      `/vfs/items/${folderId}/shares`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          itemId: folderId,
          shareType: 'user',
          targetId: bob.user.userId,
          permissionLevel: 'view',
          wrappedKey: {
            recipientUserId: bob.user.userId,
            recipientPublicKeyId: 'bob-public-key-id',
            keyEpoch: 1,
            encryptedKey: 'wrapped-key-for-bob',
            senderSignature: 'alice-signature'
          }
        })
      }
    );

    const alicePull = await pullRemoteFeedsWithoutLocalHydration({
      actor: alice
    });
    const bobPull = await pullRemoteFeedsWithoutLocalHydration({ actor: bob });
    expect(alicePull.syncItems).toBeGreaterThan(0);
    expect(alicePull.crdtItems).toBeGreaterThan(0);
    expect(bobPull.syncItems).toBeGreaterThan(0);
    expect(bobPull.crdtItems).toBeGreaterThan(0);

    expect(
      await queryLocalSharedByMe(aliceBrowser.localDb, alice.user.userId)
    ).toHaveLength(0);
    expect(
      await queryLocalSharedWithMe(bobBrowser.localDb, bob.user.userId)
    ).toHaveLength(0);

    const knownUsers = [
      { id: alice.user.userId, email: alice.user.email },
      { id: bob.user.userId, email: bob.user.email }
    ];
    await refreshLocalStateFromApi({
      actor: alice,
      localDb: aliceBrowser.localDb,
      knownUsers
    });
    await refreshLocalStateFromApi({
      actor: bob,
      localDb: bobBrowser.localDb,
      knownUsers
    });

    const aliceSharedByMe = await queryLocalSharedByMe(
      aliceBrowser.localDb,
      alice.user.userId
    );
    expect(aliceSharedByMe).toHaveLength(1);
    expect(aliceSharedByMe[0]?.id).toBe(folderId);
    expect(aliceSharedByMe[0]?.targetId).toBe(bob.user.userId);

    const bobSharedWithMe = await queryLocalSharedWithMe(
      bobBrowser.localDb,
      bob.user.userId
    );
    expect(bobSharedWithMe).toHaveLength(1);
    expect(bobSharedWithMe[0]?.id).toBe(folderId);
    expect(bobSharedWithMe[0]?.sharedById).toBe(alice.user.userId);
  });
});
