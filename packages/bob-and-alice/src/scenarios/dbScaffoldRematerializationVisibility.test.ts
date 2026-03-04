import type {
  VfsCrdtSyncItem,
  VfsCrdtSyncResponse,
  VfsSyncItem,
  VfsSyncResponse
} from '@tearleads/shared';
import {
  combinePublicKey,
  generateKeyPair,
  serializePublicKey
} from '@tearleads/shared';
import { setupBobNotesShareForAliceDb } from '@tearleads/shared/scaffolding';
import { afterEach, describe, expect, it } from 'vitest';
import { ApiScenarioHarness } from '../harness/apiScenarioHarness.js';
import { fetchVfsConnectJson } from '../harness/vfsConnectClient.js';

const getApiDeps = async () => {
  const api = await import('@tearleads/api');
  return { app: api.app, migrations: api.migrations };
};

async function fetchAllSyncItems(
  actor: ReturnType<ApiScenarioHarness['actor']>
): Promise<VfsSyncItem[]> {
  const all: VfsSyncItem[] = [];
  let cursor: string | undefined;

  while (true) {
    const page = await fetchVfsConnectJson<VfsSyncResponse>({
      actor,
      methodName: 'GetSync',
      requestBody: {
        limit: 500,
        cursor
      }
    });
    all.push(...page.items);

    if (!page.hasMore) {
      break;
    }
    if (!page.nextCursor) {
      throw new Error('vfs-sync returned hasMore=true without nextCursor');
    }
    cursor = page.nextCursor;
  }

  return all;
}

async function fetchAllCrdtItems(
  actor: ReturnType<ApiScenarioHarness['actor']>
): Promise<VfsCrdtSyncItem[]> {
  const all: VfsCrdtSyncItem[] = [];
  let cursor: string | undefined;

  while (true) {
    const page = await fetchVfsConnectJson<VfsCrdtSyncResponse>({
      actor,
      methodName: 'GetCrdtSync',
      requestBody: {
        limit: 500,
        cursor
      }
    });
    all.push(...page.items);

    if (!page.hasMore) {
      break;
    }
    if (!page.nextCursor) {
      throw new Error('crdt/vfs-sync returned hasMore=true without nextCursor');
    }
    cursor = page.nextCursor;
  }

  return all;
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

function readUpsertName(
  items: VfsSyncItem[],
  itemId: string
): string | undefined {
  const row = items.find(
    (item) => item.itemId === itemId && item.changeType === 'upsert'
  );
  return typeof row?.encryptedName === 'string' ? row.encryptedName : undefined;
}

describe('DB scaffolding rematerialization visibility', () => {
  let harness: ApiScenarioHarness | null = null;

  afterEach(async () => {
    if (harness) {
      await harness.teardown();
      harness = null;
    }
  });

  it('keeps Bob seeded note visible in sync feeds after DB-only scaffolding', async () => {
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
      const bobPublicKey = buildPublicEncryptionKey();
      await client.query(
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
          bob.user.userId,
          bobPublicKey,
          'seeded-signing-key',
          'seeded-private-keys',
          'seeded-argon2-salt'
        ]
      );

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

    const [bobSyncItems, bobCrdtItems, aliceSyncItems, aliceCrdtItems] =
      await Promise.all([
        fetchAllSyncItems(bob),
        fetchAllCrdtItems(bob),
        fetchAllSyncItems(alice),
        fetchAllCrdtItems(alice)
      ]);

    expect(
      bobSyncItems.some(
        (item) =>
          item.itemId === seeded.folderId &&
          item.changeType === 'upsert' &&
          item.objectType === 'folder'
      )
    ).toBe(true);
    expect(
      bobSyncItems.some(
        (item) =>
          item.itemId === seeded.noteId &&
          item.changeType === 'upsert' &&
          item.objectType === 'note'
      )
    ).toBe(true);
    expect(readUpsertName(bobSyncItems, seeded.folderId)).toBe(folderName);
    expect(readUpsertName(bobSyncItems, seeded.noteId)).toBe(noteName);
    expect(
      bobCrdtItems.some(
        (item) => item.itemId === seeded.noteId && item.opType === 'item_upsert'
      )
    ).toBe(true);

    expect(
      aliceSyncItems.some(
        (item) =>
          item.itemId === seeded.folderId &&
          item.changeType === 'upsert' &&
          item.objectType === 'folder'
      )
    ).toBe(true);
    expect(
      aliceSyncItems.some(
        (item) =>
          item.itemId === seeded.noteId &&
          item.changeType === 'upsert' &&
          item.objectType === 'note'
      )
    ).toBe(true);
    expect(readUpsertName(aliceSyncItems, seeded.folderId)).toBe(folderName);
    expect(readUpsertName(aliceSyncItems, seeded.noteId)).toBe(noteName);
    expect(
      aliceCrdtItems.some(
        (item) =>
          item.itemId === seeded.folderId &&
          item.opType === 'acl_add' &&
          item.principalType === 'user' &&
          item.principalId === alice.user.userId
      )
    ).toBe(true);
  });
});
