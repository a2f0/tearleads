import type { VfsCrdtSyncItem, VfsCrdtSyncResponse, VfsSyncItem, VfsSyncResponse } from '@tearleads/shared';
import { setupBobNotesShareForAliceDb } from '@tearleads/shared/scaffolding';
import { afterEach, describe, expect, it } from 'vitest';
import { ApiScenarioHarness } from '../harness/apiScenarioHarness.js';

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
    const params = new URLSearchParams();
    params.set('limit', '500');
    if (cursor) {
      params.set('cursor', cursor);
    }

    const page = await actor.fetchJson<VfsSyncResponse>(
      `/vfs/vfs-sync?${params.toString()}`
    );
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
    const params = new URLSearchParams();
    params.set('limit', '500');
    if (cursor) {
      params.set('cursor', cursor);
    }

    const page = await actor.fetchJson<VfsCrdtSyncResponse>(
      `/vfs/crdt/vfs-sync?${params.toString()}`
    );
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

    const client = await harness.ctx.pool.connect();
    let seeded: Awaited<ReturnType<typeof setupBobNotesShareForAliceDb>>;
    try {
      seeded = await setupBobNotesShareForAliceDb({
        client,
        bobEmail: bob.user.email,
        aliceEmail: alice.user.email
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
