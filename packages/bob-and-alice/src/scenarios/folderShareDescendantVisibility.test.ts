import { randomUUID } from 'node:crypto';
import { afterEach, describe, expect, it } from 'vitest';
import { ApiScenarioHarness } from '../harness/apiScenarioHarness.js';

const getApiDeps = async () => {
  const api = await import('@tearleads/api');
  return { app: api.app, migrations: api.migrations };
};

interface SyncItem {
  itemId: string;
  objectType: string | null;
}

async function listSyncItems(
  actor: ReturnType<ApiScenarioHarness['actor']>
): Promise<SyncItem[]> {
  const response = await actor.fetchJson<{ items: SyncItem[] }>(
    '/vfs/vfs-sync?limit=500'
  );
  return response.items;
}

describe('folder share descendant visibility', () => {
  let harness: ApiScenarioHarness | null = null;

  afterEach(async () => {
    if (harness) {
      await harness.teardown();
      harness = null;
    }
  });

  it('requires explicit share on child note when only direct folder share exists', async () => {
    harness = await ApiScenarioHarness.create(
      [{ alias: 'bob' }, { alias: 'alice' }],
      getApiDeps
    );

    const bob = harness.actor('bob');
    const alice = harness.actor('alice');

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

    const folderId = `folder-${randomUUID()}`;
    const noteId = `note-${randomUUID()}`;

    await bob.fetchJson('/vfs/register', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        id: folderId,
        objectType: 'folder',
        encryptedSessionKey: 'bob-folder-key',
        encryptedName: 'Notes shared with Alice'
      })
    });
    await bob.fetchJson('/vfs/register', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        id: noteId,
        objectType: 'note',
        encryptedSessionKey: 'bob-note-key',
        encryptedName: 'Shared note for Alice'
      })
    });

    // Mirror scaffolding hierarchy links directly in canonical table.
    await harness.ctx.pool.query(
      `INSERT INTO vfs_registry (
         id,
         object_type,
         owner_id,
         encrypted_session_key,
         encrypted_name,
         created_at
       )
       VALUES ('__vfs_root__', 'folder', NULL, NULL, 'VFS Root', NOW())
       ON CONFLICT (id) DO NOTHING`
    );
    await harness.ctx.pool.query(
      `INSERT INTO vfs_links (id, parent_id, child_id, wrapped_session_key, created_at)
       VALUES ($1, '__vfs_root__', $2, 'test-wrap', NOW())
       ON CONFLICT (parent_id, child_id) DO NOTHING`,
      [randomUUID(), folderId]
    );
    await harness.ctx.pool.query(
      `INSERT INTO vfs_links (id, parent_id, child_id, wrapped_session_key, created_at)
       VALUES ($1, $2, $3, 'test-wrap', NOW())
       ON CONFLICT (parent_id, child_id) DO NOTHING`,
      [randomUUID(), folderId, noteId]
    );

    await bob.fetchJson(`/vfs/items/${encodeURIComponent(folderId)}/shares`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        itemId: folderId,
        shareType: 'user',
        targetId: alice.user.userId,
        permissionLevel: 'view'
      })
    });

    const aliceSyncAfterFolderShare = await listSyncItems(alice);
    expect(aliceSyncAfterFolderShare.some((item) => item.itemId === folderId)).toBe(
      true
    );
    expect(aliceSyncAfterFolderShare.some((item) => item.itemId === noteId)).toBe(
      false
    );

    await bob.fetchJson(`/vfs/items/${encodeURIComponent(noteId)}/shares`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        itemId: noteId,
        shareType: 'user',
        targetId: alice.user.userId,
        permissionLevel: 'view'
      })
    });

    const aliceSyncAfterNoteShare = await listSyncItems(alice);
    expect(aliceSyncAfterNoteShare.some((item) => item.itemId === noteId)).toBe(
      true
    );
  });
});
