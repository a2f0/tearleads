import type { Migration, TestDatabaseContext } from '@tearleads/db-test-utils';
import type {
  VfsAclAccessLevel,
  VfsAclPrincipalType,
  VfsCrdtSyncItem,
  VfsCrdtSyncResponse,
  VfsSyncItem,
  VfsSyncResponse
} from '@tearleads/shared';
import { getDbTestUtils } from './getDbTestUtils.js';
import { fetchVfsConnectJson } from './vfsConnectClient.js';

export interface RuntimeApiActor {
  fetchJson<T = unknown>(path: string, init?: RequestInit): Promise<T>;
}

interface KnownUser {
  id: string;
  email: string;
}

export interface BrowserRuntimeActor {
  alias: string;
  localDb: TestDatabaseContext;
}

export interface LocalSharedWithMeRow {
  id: string;
  shareId: string;
  sharedById: string;
  sharedByEmail: string;
}

export interface LocalSharedByMeRow {
  id: string;
  shareId: string;
  targetId: string;
  permissionLevel: 'view' | 'edit';
}

interface LocalNoteRow {
  id: string;
  title: string;
  content: string;
  deleted: number;
}

function createVfsExplorerLocalMigrations(
  baseMigrations: Migration[]
): Migration[] {
  return [
    ...baseMigrations,
    {
      version: 2,
      up: async (adapter) => {
        await adapter.execute(`
          CREATE TABLE IF NOT EXISTS users (
            id TEXT PRIMARY KEY,
            email TEXT NOT NULL
          )
        `);
        await adapter.execute(`
          CREATE TABLE IF NOT EXISTS vfs_acl_entries (
            id TEXT PRIMARY KEY,
            item_id TEXT NOT NULL REFERENCES vfs_registry(id) ON DELETE CASCADE,
            principal_type TEXT NOT NULL,
            principal_id TEXT NOT NULL,
            access_level TEXT NOT NULL,
            wrapped_session_key TEXT,
            wrapped_hierarchical_key TEXT,
            granted_by TEXT REFERENCES users(id) ON DELETE RESTRICT,
            created_at INTEGER NOT NULL,
            updated_at INTEGER NOT NULL,
            expires_at INTEGER,
            revoked_at INTEGER
          )
        `);
        await adapter.execute(
          `CREATE INDEX IF NOT EXISTS vfs_acl_entries_item_idx ON vfs_acl_entries (item_id)`
        );
        await adapter.execute(
          `CREATE INDEX IF NOT EXISTS vfs_acl_entries_principal_idx ON vfs_acl_entries (principal_type, principal_id)`
        );
        // Base migrations create a minimal notes table. Add content so
        // runtime refresh can assert note payload convergence across reopen flows.
        try {
          await adapter.execute(
            `ALTER TABLE notes ADD COLUMN content TEXT NOT NULL DEFAULT ''`
          );
        } catch {
          // Column already exists in this runtime schema variant.
        }
      }
    }
  ];
}

interface LocalRegistryRow {
  id: string;
  objectType: string;
  encryptedName: string | null;
  ownerId: string | null;
  createdAt: number;
}

interface LocalItemStateRow {
  itemId: string;
  encryptedPayload: string | null;
  updatedAt: number;
  deletedAt: number | null;
}

interface LocalAclRow {
  id: string;
  itemId: string;
  principalType: VfsAclPrincipalType;
  principalId: string;
  accessLevel: VfsAclAccessLevel;
  grantedBy: string | null;
  occurredAt: number;
}

function parseMillis(value: string | null): number {
  if (!value) return Date.now();
  const parsed = Date.parse(value);
  if (!Number.isFinite(parsed)) return Date.now();
  return parsed;
}

async function fetchAllSyncItems(
  actor: RuntimeApiActor
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
    if (!page.hasMore) break;
    if (!page.nextCursor) {
      throw new Error('vfs sync feed reported hasMore without nextCursor');
    }
    cursor = page.nextCursor;
  }

  return all;
}

async function fetchAllCrdtItems(
  actor: RuntimeApiActor
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
    if (!page.hasMore) break;
    if (!page.nextCursor) {
      throw new Error('vfs crdt feed reported hasMore without nextCursor');
    }
    cursor = page.nextCursor;
  }

  return all;
}

export async function pullRemoteFeedsWithoutLocalHydration(input: {
  actor: RuntimeApiActor;
}): Promise<{ syncItems: number; crdtItems: number }> {
  const [syncItems, crdtItems] = await Promise.all([
    fetchAllSyncItems(input.actor),
    fetchAllCrdtItems(input.actor)
  ]);
  return { syncItems: syncItems.length, crdtItems: crdtItems.length };
}

export async function createBrowserRuntimeActor(
  alias: string
): Promise<BrowserRuntimeActor> {
  const { createTestDatabase, vfsTestMigrations } = await getDbTestUtils();
  const localDb = await createTestDatabase({
    instanceId: `runtime-${alias}`,
    migrations: createVfsExplorerLocalMigrations(vfsTestMigrations)
  });

  return { alias, localDb };
}

export async function teardownBrowserRuntimeActors(
  actors: BrowserRuntimeActor[]
): Promise<void> {
  await Promise.all(actors.map((actor) => actor.localDb.adapter.close()));
}

export async function refreshLocalStateFromApi(input: {
  actor: RuntimeApiActor;
  localDb: TestDatabaseContext;
  knownUsers: KnownUser[];
}): Promise<void> {
  const syncItems = await fetchAllSyncItems(input.actor);
  const crdtItems = await fetchAllCrdtItems(input.actor);

  const registryById = new Map<string, LocalRegistryRow>();
  const itemStateById = new Map<string, LocalItemStateRow>();
  for (const item of syncItems) {
    if (item.changeType === 'delete') {
      registryById.delete(item.itemId);
      itemStateById.delete(item.itemId);
      continue;
    }
    if (!item.objectType) {
      continue;
    }
    registryById.set(item.itemId, {
      id: item.itemId,
      objectType: item.objectType,
      encryptedName:
        typeof item.encryptedName === 'string' ? item.encryptedName : null,
      ownerId: item.ownerId,
      createdAt: parseMillis(item.createdAt)
    });
  }

  const aclByPrincipal = new Map<string, LocalAclRow>();
  for (const item of crdtItems) {
    const occurredAt = parseMillis(item.occurredAt);
    if (item.opType === 'item_upsert') {
      if (!registryById.has(item.itemId)) {
        continue;
      }
      itemStateById.set(item.itemId, {
        itemId: item.itemId,
        encryptedPayload: item.encryptedPayload ?? null,
        updatedAt: occurredAt,
        deletedAt: null
      });
      continue;
    }
    if (item.opType === 'item_delete') {
      if (!registryById.has(item.itemId)) {
        continue;
      }
      itemStateById.set(item.itemId, {
        itemId: item.itemId,
        encryptedPayload: null,
        updatedAt: occurredAt,
        deletedAt: occurredAt
      });
      continue;
    }
    if (item.opType !== 'acl_add' && item.opType !== 'acl_remove') {
      continue;
    }
    if (!item.principalType || !item.principalId) {
      continue;
    }
    const key = `${item.itemId}::${item.principalType}::${item.principalId}`;
    if (item.opType === 'acl_remove') {
      aclByPrincipal.delete(key);
      continue;
    }
    if (!item.accessLevel) {
      continue;
    }
    aclByPrincipal.set(key, {
      id: item.sourceId,
      itemId: item.itemId,
      principalType: item.principalType,
      principalId: item.principalId,
      accessLevel: item.accessLevel,
      grantedBy: item.actorId,
      occurredAt
    });
  }

  const noteRows = Array.from(registryById.values())
    .filter((entry) => entry.objectType === 'note')
    .map((entry) => {
      const itemState = itemStateById.get(entry.id);
      const title =
        entry.encryptedName !== null && entry.encryptedName.trim().length > 0
          ? entry.encryptedName
          : 'Untitled Note';
      return {
        id: entry.id,
        title,
        content: itemState?.encryptedPayload ?? '',
        deleted: itemState ? (itemState.deletedAt === null ? 0 : 1) : 0
      };
    });

  await input.localDb.adapter.execute('PRAGMA foreign_keys = OFF');
  await input.localDb.adapter.execute('BEGIN');
  try {
    await input.localDb.adapter.execute(`DELETE FROM vfs_acl_entries`);
    await input.localDb.adapter.execute(`DELETE FROM users`);
    await input.localDb.adapter.execute(`DELETE FROM notes`);
    await input.localDb.adapter.execute(`DELETE FROM vfs_registry`);

    for (const user of input.knownUsers) {
      await input.localDb.adapter.execute(
        `INSERT INTO users (id, email) VALUES (?, ?)`,
        [user.id, user.email]
      );
    }

    for (const item of registryById.values()) {
      await input.localDb.adapter.execute(
        `INSERT INTO vfs_registry (id, object_type, owner_id, encrypted_name, created_at)
         VALUES (?, ?, ?, ?, ?)`,
        [
          item.id,
          item.objectType,
          item.ownerId,
          item.encryptedName,
          item.createdAt
        ]
      );
    }

    for (const note of noteRows) {
      await input.localDb.adapter.execute(
        `INSERT INTO notes (id, title, content, deleted) VALUES (?, ?, ?, ?)`,
        [note.id, note.title, note.content, note.deleted]
      );
    }

    for (const item of aclByPrincipal.values()) {
      await input.localDb.adapter.execute(
        `INSERT INTO vfs_acl_entries (
           id, item_id, principal_type, principal_id, access_level, granted_by, created_at, updated_at, revoked_at
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, NULL)`,
        [
          item.id,
          item.itemId,
          item.principalType,
          item.principalId,
          item.accessLevel,
          item.grantedBy,
          item.occurredAt,
          item.occurredAt
        ]
      );
    }

    await input.localDb.adapter.execute('COMMIT');
  } catch (error) {
    await input.localDb.adapter.execute('ROLLBACK');
    throw error;
  } finally {
    await input.localDb.adapter.execute('PRAGMA foreign_keys = ON');
  }
}

export async function queryLocalSharedWithMe(
  localDb: TestDatabaseContext,
  currentUserId: string
): Promise<LocalSharedWithMeRow[]> {
  const result = await localDb.adapter.execute(
    `SELECT
       r.id AS id,
       CASE
         WHEN a.id LIKE 'share:%' THEN substr(a.id, 7)
         ELSE a.id
       END AS share_id,
       COALESCE(a.granted_by, r.owner_id, 'unknown') AS shared_by_id,
       COALESCE(
         u.email,
         (
           SELECT owner_user.email
           FROM users owner_user
           WHERE owner_user.id = r.owner_id
           LIMIT 1
         ),
         a.granted_by,
         r.owner_id,
         'Unknown'
       ) AS shared_by_email
     FROM vfs_acl_entries a
     INNER JOIN vfs_registry r ON r.id = a.item_id
     LEFT JOIN users u ON u.id = a.granted_by
     WHERE a.principal_type = 'user'
       AND a.principal_id = ?
       AND a.revoked_at IS NULL
       AND (a.id LIKE 'share:%' OR a.id LIKE 'policy-compiled:%')
     ORDER BY COALESCE(r.encrypted_name, '') COLLATE NOCASE, r.id`,
    [currentUserId]
  );

  return result.rows.map((row) => ({
    id: String(row['id']),
    shareId: String(row['share_id']),
    sharedById: String(row['shared_by_id']),
    sharedByEmail: String(row['shared_by_email'])
  }));
}

export async function queryLocalSharedByMe(
  localDb: TestDatabaseContext,
  currentUserId: string
): Promise<LocalSharedByMeRow[]> {
  const result = await localDb.adapter.execute(
    `SELECT
       r.id AS id,
       CASE
         WHEN a.id LIKE 'share:%' THEN substr(a.id, 7)
         ELSE a.id
       END AS share_id,
       a.principal_id AS target_id,
       CASE
         WHEN a.access_level = 'read' THEN 'view'
         ELSE 'edit'
       END AS permission_level
     FROM vfs_acl_entries a
     INNER JOIN vfs_registry r ON r.id = a.item_id
     WHERE (
         (a.id LIKE 'share:%' AND a.granted_by = ?)
         OR (a.id LIKE 'policy-compiled:%' AND r.owner_id = ?)
       )
       AND NOT (a.principal_type = 'user' AND a.principal_id = ?)
       AND a.revoked_at IS NULL
       AND (a.id LIKE 'share:%' OR a.id LIKE 'policy-compiled:%')
     ORDER BY COALESCE(r.encrypted_name, '') COLLATE NOCASE, r.id`,
    [currentUserId, currentUserId, currentUserId]
  );

  return result.rows.map((row) => ({
    id: String(row['id']),
    shareId: String(row['share_id']),
    targetId: String(row['target_id']),
    permissionLevel:
      String(row['permission_level']) === 'view' ? 'view' : 'edit'
  }));
}

export async function queryLocalNoteById(
  localDb: TestDatabaseContext,
  noteId: string
): Promise<LocalNoteRow | null> {
  const result = await localDb.adapter.execute(
    `SELECT id, title, content, deleted
     FROM notes
     WHERE id = ?
     LIMIT 1`,
    [noteId]
  );

  const row = result.rows[0];
  if (!row) {
    return null;
  }

  return {
    id: String(row['id']),
    title: String(row['title'] ?? ''),
    content: String(row['content'] ?? ''),
    deleted: Number(row['deleted'] ?? 0)
  };
}
