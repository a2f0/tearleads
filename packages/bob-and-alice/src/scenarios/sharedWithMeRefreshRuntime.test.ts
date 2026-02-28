import { randomUUID } from 'node:crypto';
import { afterEach, describe, expect, it } from 'vitest';
import { ApiScenarioHarness } from '../harness/apiScenarioHarness.js';
import {
  type BrowserRuntimeActor,
  createBrowserRuntimeActor,
  queryLocalSharedWithMe,
  refreshLocalStateFromApi,
  teardownBrowserRuntimeActors
} from '../harness/browserRuntimeHarness.js';
import {
  assertPgHasActiveUserShare,
  assertPgHasVfsRegistryItem,
  assertPgUserOrganizationMembership
} from '../harness/postgresAssertions.js';

const getApiDeps = async () => {
  const api = await import('@tearleads/api');
  return { app: api.app, migrations: api.migrations };
};

describe('sharedWithMe refresh runtime', () => {
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

  it('shows Alice folder share in Bob Shared With Me after Bob refreshes', async () => {
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

    await assertPgUserOrganizationMembership({
      pool: harness.ctx.pool,
      userId: alice.user.userId,
      organizationId: sharedOrgId
    });
    await assertPgUserOrganizationMembership({
      pool: harness.ctx.pool,
      userId: bob.user.userId,
      organizationId: sharedOrgId
    });

    await alice.fetch('/vfs/keys', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        publicEncryptionKey: 'alice-public-enc-key',
        publicSigningKey: 'alice-public-sign-key',
        encryptedPrivateKeys: 'alice-encrypted-private-keys',
        argon2Salt: 'alice-argon2-salt'
      })
    });
    await bob.fetch('/vfs/keys', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        publicEncryptionKey: 'bob-public-enc-key',
        publicSigningKey: 'bob-public-sign-key',
        encryptedPrivateKeys: 'bob-encrypted-private-keys',
        argon2Salt: 'bob-argon2-salt'
      })
    });

    const aliceBrowser = await createBrowserRuntimeActor('alice');
    const bobBrowser = await createBrowserRuntimeActor('bob');
    browserActors = [aliceBrowser, bobBrowser];

    await refreshLocalStateFromApi({
      actor: bob,
      localDb: bobBrowser.localDb,
      knownUsers: [
        { id: alice.user.userId, email: alice.user.email },
        { id: bob.user.userId, email: bob.user.email }
      ]
    });
    expect(
      await queryLocalSharedWithMe(bobBrowser.localDb, bob.user.userId)
    ).toHaveLength(0);

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

    const shareResponse = await alice.fetchJson<{
      share: { id: string; targetId: string };
    }>(`/vfs/items/${folderId}/shares`, {
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
    });
    expect(shareResponse.share.targetId).toBe(bob.user.userId);

    await assertPgHasVfsRegistryItem({
      pool: harness.ctx.pool,
      itemId: folderId,
      objectType: 'folder'
    });
    await assertPgHasActiveUserShare({
      pool: harness.ctx.pool,
      itemId: folderId,
      targetUserId: bob.user.userId,
      grantedByUserId: alice.user.userId
    });

    await refreshLocalStateFromApi({
      actor: bob,
      localDb: bobBrowser.localDb,
      knownUsers: [
        { id: alice.user.userId, email: alice.user.email },
        { id: bob.user.userId, email: bob.user.email }
      ]
    });

    const bobSharedWithMe = await queryLocalSharedWithMe(
      bobBrowser.localDb,
      bob.user.userId
    );
    expect(bobSharedWithMe).toHaveLength(1);
    expect(bobSharedWithMe[0]?.id).toBe(folderId);
    expect(bobSharedWithMe[0]?.sharedById).toBe(alice.user.userId);
    expect(bobSharedWithMe[0]?.sharedByEmail).toBe(alice.user.email);
  });
});
