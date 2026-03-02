import { randomUUID } from 'node:crypto';
import { afterEach, describe, expect, it } from 'vitest';
import { ApiScenarioHarness } from '../harness/apiScenarioHarness.js';
import {
  type BrowserRuntimeActor,
  createBrowserRuntimeActor,
  queryLocalSharedByMe,
  queryLocalSharedWithMe,
  refreshLocalStateFromApi,
  teardownBrowserRuntimeActors
} from '../harness/browserRuntimeHarness.js';

interface ActiveShare {
  shareId: string;
  permissionLevel: 'view' | 'edit';
}

function createDeterministicRandom(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (Math.imul(state, 1_664_525) + 1_013_904_223) >>> 0;
    return state / 4_294_967_296;
  };
}

function nextInt(random: () => number, min: number, max: number): number {
  const span = max - min + 1;
  return min + Math.floor(random() * span);
}

function pickOne<T>(values: readonly T[], random: () => number): T {
  const index = nextInt(random, 0, values.length - 1);
  const value = values[index];
  if (value === undefined) {
    throw new Error('cannot pick from empty list');
  }
  return value;
}

function extractShareUuid(shareId: string): string {
  const parts = shareId.split(':');
  const lastPart = parts[parts.length - 1];
  if (!lastPart) {
    throw new Error(`invalid share id: ${shareId}`);
  }
  return lastPart;
}

const getApiDeps = async () => {
  const api = await import('@tearleads/api');
  return { app: api.app, migrations: api.migrations };
};

describe('window lifecycle refresh chaos', () => {
  let harness: ApiScenarioHarness | null = null;
  const runtimeActors: BrowserRuntimeActor[] = [];

  afterEach(async () => {
    await teardownBrowserRuntimeActors(runtimeActors.splice(0, runtimeActors.length));
    if (harness) {
      await harness.teardown();
      harness = null;
    }
  });

  async function openRuntime(alias: string): Promise<BrowserRuntimeActor> {
    const actor = await createBrowserRuntimeActor(alias);
    runtimeActors.push(actor);
    return actor;
  }

  async function closeRuntime(actor: BrowserRuntimeActor): Promise<void> {
    const index = runtimeActors.indexOf(actor);
    if (index >= 0) {
      runtimeActors.splice(index, 1);
    }
    await teardownBrowserRuntimeActors([actor]);
  }

  it('preserves expected shared visibility across repeated open/close refresh cycles', async () => {
    harness = await ApiScenarioHarness.create(
      [{ alias: 'alice' }, { alias: 'bob' }],
      getApiDeps
    );

    const alice = harness.actor('alice');
    const bob = harness.actor('bob');

    const sharedOrgId = `shared-org-chaos-${randomUUID()}`;
    await harness.ctx.pool.query(
      `INSERT INTO organizations (id, name, created_at, updated_at)
       VALUES ($1, 'Shared Org Chaos', NOW(), NOW())`,
      [sharedOrgId]
    );
    await harness.ctx.pool.query(
      `INSERT INTO user_organizations (user_id, organization_id, joined_at)
       VALUES ($1, $2, NOW()), ($3, $2, NOW())`,
      [alice.user.userId, sharedOrgId, bob.user.userId]
    );

    await alice.fetchJson('/vfs/keys', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        publicEncryptionKey: 'alice-chaos-public-enc-key',
        publicSigningKey: 'alice-chaos-public-sign-key',
        encryptedPrivateKeys: 'alice-chaos-encrypted-private-keys',
        argon2Salt: 'alice-chaos-argon2-salt'
      })
    });
    await bob.fetchJson('/vfs/keys', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        publicEncryptionKey: 'bob-chaos-public-enc-key',
        publicSigningKey: 'bob-chaos-public-sign-key',
        encryptedPrivateKeys: 'bob-chaos-encrypted-private-keys',
        argon2Salt: 'bob-chaos-argon2-salt'
      })
    });

    const random = createDeterministicRandom(0x41c3b00c);
    const knownUsers = [
      { id: alice.user.userId, email: alice.user.email },
      { id: bob.user.userId, email: bob.user.email }
    ];
    const allItemIds: string[] = [];
    const activeShares = new Map<string, ActiveShare>();
    let itemCounter = 0;

    async function registerItem(): Promise<string> {
      const itemId = `chaos-folder-${String(itemCounter)}-${randomUUID()}`;
      itemCounter += 1;
      await alice.fetchJson('/vfs/register', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          id: itemId,
          objectType: 'folder',
          encryptedSessionKey: `chaos-session-key-${itemId}`
        })
      });
      allItemIds.push(itemId);
      return itemId;
    }

    async function createShare(
      itemId: string,
      permissionLevel: 'view' | 'edit'
    ): Promise<void> {
      const response = await alice.fetchJson<{
        share: { id: string; itemId: string };
      }>(`/vfs/items/${itemId}/shares`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          itemId,
          shareType: 'user',
          targetId: bob.user.userId,
          permissionLevel,
          wrappedKey: {
            recipientUserId: bob.user.userId,
            recipientPublicKeyId: 'bob-chaos-public-key-id',
            keyEpoch: permissionLevel === 'view' ? 1 : 2,
            encryptedKey: `wrapped-key-${permissionLevel}-${itemId}`,
            senderSignature: `alice-chaos-signature-${itemId}`
          }
        })
      });
      activeShares.set(itemId, {
        shareId: response.share.id,
        permissionLevel
      });
    }

    async function updateShare(itemId: string): Promise<void> {
      const current = activeShares.get(itemId);
      if (!current) {
        throw new Error(`cannot update missing share for item ${itemId}`);
      }
      const nextPermission =
        current.permissionLevel === 'view' ? 'edit' : 'view';
      const shareUuid = extractShareUuid(current.shareId);
      await alice.fetchJson<{ share: { id: string; permissionLevel: string } }>(
        `/vfs/shares/${shareUuid}`,
        {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ permissionLevel: nextPermission })
        }
      );
      activeShares.set(itemId, {
        shareId: current.shareId,
        permissionLevel: nextPermission
      });
    }

    async function revokeShare(itemId: string): Promise<void> {
      const current = activeShares.get(itemId);
      if (!current) {
        throw new Error(`cannot revoke missing share for item ${itemId}`);
      }
      const shareUuid = extractShareUuid(current.shareId);
      await alice.fetch(`/vfs/shares/${shareUuid}`, {
        method: 'DELETE'
      });
      activeShares.delete(itemId);
    }

    async function verifyBobWindow(round: number, reopenPass: number): Promise<void> {
      const runtime = await openRuntime(
        `bob-chaos-${String(round)}-${String(reopenPass)}`
      );
      try {
        await refreshLocalStateFromApi({
          actor: bob,
          localDb: runtime.localDb,
          knownUsers
        });

        const rows = await queryLocalSharedWithMe(runtime.localDb, bob.user.userId);
        const actualItemIds = rows.map((row) => row.id).sort();
        const expectedItemIds = [...activeShares.keys()].sort();
        expect(actualItemIds).toEqual(expectedItemIds);
        for (const row of rows) {
          expect(row.sharedById).toBe(alice.user.userId);
          expect(row.sharedByEmail).toBe(alice.user.email);
        }
      } finally {
        await closeRuntime(runtime);
      }
    }

    async function verifyAliceWindow(round: number): Promise<void> {
      const runtime = await openRuntime(`alice-chaos-${String(round)}`);
      try {
        await refreshLocalStateFromApi({
          actor: alice,
          localDb: runtime.localDb,
          knownUsers
        });

        const rows = await queryLocalSharedByMe(runtime.localDb, alice.user.userId);
        const expectedByItem = new Map(
          [...activeShares.entries()].map(([itemId, share]) => [
            itemId,
            share.permissionLevel
          ])
        );
        expect(rows.map((row) => row.id).sort()).toEqual(
          [...expectedByItem.keys()].sort()
        );
        for (const row of rows) {
          expect(row.targetId).toBe(bob.user.userId);
          expect(row.permissionLevel).toBe(expectedByItem.get(row.id));
        }
      } finally {
        await closeRuntime(runtime);
      }
    }

    const initialItemCount = 3;
    for (let index = 0; index < initialItemCount; index += 1) {
      const itemId = await registerItem();
      await createShare(itemId, index % 2 === 0 ? 'view' : 'edit');
    }

    for (let round = 0; round < 20; round += 1) {
      const operationVariant = nextInt(random, 0, 4);
      const sharedItemIds = [...activeShares.keys()];
      const unsharedItemIds = allItemIds.filter((itemId) => !activeShares.has(itemId));

      if (operationVariant === 0) {
        const itemId = await registerItem();
        await createShare(itemId, pickOne(['view', 'edit'] as const, random));
      } else if (operationVariant === 1 && unsharedItemIds.length > 0) {
        const itemId = pickOne(unsharedItemIds, random);
        await createShare(itemId, pickOne(['view', 'edit'] as const, random));
      } else if (operationVariant === 2 && sharedItemIds.length > 0) {
        await updateShare(pickOne(sharedItemIds, random));
      } else if (operationVariant === 3 && sharedItemIds.length > 0) {
        await revokeShare(pickOne(sharedItemIds, random));
      } else {
        const itemId = await registerItem();
        await createShare(itemId, 'view');
      }

      await verifyBobWindow(round, 1);
      await verifyBobWindow(round, 2);

      if (round % 3 === 0) {
        await verifyAliceWindow(round);
      }
    }

    await verifyBobWindow(10_000, 1);
    await verifyAliceWindow(10_000);
  });
});
