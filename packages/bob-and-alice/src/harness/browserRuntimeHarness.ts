import {
  createTestDatabase,
  type Migration,
  type TestDatabaseContext,
  vfsTestMigrations
} from '@tearleads/db-test-utils';
import type {
  VfsAclAccessLevel,
  VfsAclPrincipalType,
  VfsCrdtSyncItem,
  VfsCrdtSyncResponse,
  VfsSyncItem,
  VfsSyncResponse
} from '@tearleads/shared';

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

const vfsExplorerLocalMigrations: Migration[] = [
  ...vfsTestMigrations,
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
    }
  }
];

interface LocalRegistryRow {
  id: string;
  objectType: string;
  ownerId: string | null;
  createdAt: number;
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
    const params = new URLSearchParams();
    params.set('limit', '500');
    if (cursor) params.set('cursor', cursor);
    const page = await actor.fetchJson<VfsSyncResponse>(
      `/vfs/vfs-sync?${params.toString()}`
    );
    all.push(...page.items);
    if (!page.hasMore || !page.nextCursor) break;
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
    const params = new URLSearchParams();
    params.set('limit', '500');
    if (cursor) params.set('cursor', cursor);
    const page = await actor.fetchJson<VfsCrdtSyncResponse>(
      `/vfs/crdt/vfs-sync?${params.toString()}`
    );
    all.push(...page.items);
    if (!page.hasMore || !page.nextCursor) break;
    cursor = page.nextCursor;
  }

  return all;
}

export async function createBrowserRuntimeActor(
  alias: string
): Promise<BrowserRuntimeActor> {
  const localDb = await createTestDatabase({
    instanceId: `runtime-${alias}`,
    migrations: vfsExplorerLocalMigrations
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
  for (const item of syncItems) {
    if (item.changeType === 'delete') {
      registryById.delete(item.itemId);
      continue;
    }
    if (!item.objectType) {
      continue;
    }
    registryById.set(item.itemId, {
      id: item.itemId,
      objectType: item.objectType,
      ownerId: item.ownerId,
      createdAt: parseMillis(item.createdAt)
    });
  }

  const aclByPrincipal = new Map<string, LocalAclRow>();
  for (const item of crdtItems) {
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
      occurredAt: parseMillis(item.occurredAt)
    });
  }

  await input.localDb.adapter.execute('PRAGMA foreign_keys = OFF');
  await input.localDb.adapter.execute('BEGIN');
  try {
    await input.localDb.adapter.execute(`DELETE FROM vfs_acl_entries`);
    await input.localDb.adapter.execute(`DELETE FROM users`);
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
        [item.id, item.objectType, item.ownerId, null, item.createdAt]
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
       substr(a.id, 7) AS share_id,
       COALESCE(a.granted_by, 'unknown') AS shared_by_id,
       COALESCE(u.email, a.granted_by, 'Unknown') AS shared_by_email
     FROM vfs_acl_entries a
     INNER JOIN vfs_registry r ON r.id = a.item_id
     LEFT JOIN users u ON u.id = a.granted_by
     WHERE a.principal_type = 'user'
       AND a.principal_id = ?
       AND a.revoked_at IS NULL
       AND a.id LIKE 'share:%'
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
