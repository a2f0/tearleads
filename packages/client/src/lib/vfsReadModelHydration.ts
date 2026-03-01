import type {
  VfsAclAccessLevel,
  VfsAclPrincipalType,
  VfsCrdtSyncItem,
  VfsSyncItem
} from '@tearleads/shared';
import { getDatabaseAdapter, isDatabaseInitialized } from '@/db';
import { api } from '@/lib/api';

interface RegistryRow {
  id: string;
  objectType: string;
  ownerId: string | null;
  createdAtMs: number;
}

interface AclRow {
  id: string;
  itemId: string;
  principalType: VfsAclPrincipalType;
  principalId: string;
  accessLevel: VfsAclAccessLevel;
  grantedBy: string | null;
  occurredAtMs: number;
}

function parseTimestampMs(value: string | null | undefined): number {
  if (!value) {
    return Date.now();
  }
  const parsed = Date.parse(value);
  if (!Number.isFinite(parsed)) {
    return Date.now();
  }
  return parsed;
}

async function fetchAllSyncItems(): Promise<VfsSyncItem[]> {
  const all: VfsSyncItem[] = [];
  let cursor: string | undefined;
  while (true) {
    const page = await api.vfs.getSync(cursor, 500);
    all.push(...page.items);
    if (!page.hasMore || !page.nextCursor) {
      break;
    }
    cursor = page.nextCursor;
  }
  return all;
}

async function fetchAllCrdtItems(): Promise<VfsCrdtSyncItem[]> {
  const all: VfsCrdtSyncItem[] = [];
  let cursor: string | undefined;
  while (true) {
    const page = await api.vfs.getCrdtSync(cursor, 500);
    all.push(...page.items);
    if (!page.hasMore || !page.nextCursor) {
      break;
    }
    cursor = page.nextCursor;
  }
  return all;
}

function buildRegistryRows(syncItems: VfsSyncItem[]): {
  upserts: RegistryRow[];
  deletes: string[];
} {
  const rowsById = new Map<string, RegistryRow>();
  const deleteIds = new Set<string>();
  for (const item of syncItems) {
    if (item.changeType === 'delete') {
      deleteIds.add(item.itemId);
      rowsById.delete(item.itemId);
      continue;
    }
    if (!item.objectType) {
      continue;
    }
    deleteIds.delete(item.itemId);
    rowsById.set(item.itemId, {
      id: item.itemId,
      objectType: item.objectType,
      ownerId: item.ownerId,
      createdAtMs: parseTimestampMs(item.createdAt)
    });
  }
  return {
    upserts: Array.from(rowsById.values()),
    deletes: Array.from(deleteIds)
  };
}

function buildAclRows(crdtItems: VfsCrdtSyncItem[]): AclRow[] {
  const rowsByPrincipal = new Map<string, AclRow>();
  for (const item of crdtItems) {
    if (item.opType !== 'acl_add' && item.opType !== 'acl_remove') {
      continue;
    }
    if (!item.principalType || !item.principalId) {
      continue;
    }

    const key = `${item.itemId}::${item.principalType}::${item.principalId}`;
    if (item.opType === 'acl_remove') {
      rowsByPrincipal.delete(key);
      continue;
    }
    if (!item.accessLevel) {
      continue;
    }
    rowsByPrincipal.set(key, {
      id: item.sourceId,
      itemId: item.itemId,
      principalType: item.principalType,
      principalId: item.principalId,
      accessLevel: item.accessLevel,
      grantedBy: item.actorId,
      occurredAtMs: parseTimestampMs(item.occurredAt)
    });
  }
  return Array.from(rowsByPrincipal.values());
}

async function tableExists(tableName: string): Promise<boolean> {
  const adapter = getDatabaseAdapter();
  const result = await adapter.execute(
    `SELECT name FROM sqlite_master WHERE type = 'table' AND name = ?`,
    [tableName]
  );
  return result.rows.length > 0;
}

export async function hydrateLocalReadModelFromRemoteFeeds(): Promise<void> {
  if (!isDatabaseInitialized()) {
    return;
  }

  const [syncItems, crdtItems] = await Promise.all([
    fetchAllSyncItems(),
    fetchAllCrdtItems()
  ]);

  const { upserts: registryUpserts, deletes: registryDeletes } =
    buildRegistryRows(syncItems);
  const aclRows = buildAclRows(crdtItems);

  const hasAclEntriesTable = await tableExists('vfs_acl_entries');
  const adapter = getDatabaseAdapter();

  await adapter.execute('PRAGMA foreign_keys = OFF', []);
  await adapter.execute('BEGIN', []);
  try {
    for (const row of registryUpserts) {
      await adapter.execute(
        `INSERT INTO vfs_registry (
           id,
           object_type,
           owner_id,
           created_at
         ) VALUES (?, ?, ?, ?)
         ON CONFLICT(id) DO UPDATE SET
           object_type = excluded.object_type,
           owner_id = excluded.owner_id,
           created_at = excluded.created_at`,
        [row.id, row.objectType, row.ownerId, row.createdAtMs]
      );
    }

    for (const id of registryDeletes) {
      await adapter.execute(`DELETE FROM vfs_registry WHERE id = ?`, [id]);
    }

    if (hasAclEntriesTable) {
      await adapter.execute(`DELETE FROM vfs_acl_entries`, []);
      for (const row of aclRows) {
        await adapter.execute(
          `INSERT INTO vfs_acl_entries (
             id,
             item_id,
             principal_type,
             principal_id,
             access_level,
             granted_by,
             created_at,
             updated_at,
             revoked_at
           ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, NULL)
           ON CONFLICT(item_id, principal_type, principal_id) DO UPDATE SET
             id = excluded.id,
             access_level = excluded.access_level,
             granted_by = excluded.granted_by,
             created_at = excluded.created_at,
             updated_at = excluded.updated_at,
             revoked_at = NULL`,
          [
            row.id,
            row.itemId,
            row.principalType,
            row.principalId,
            row.accessLevel,
            row.grantedBy,
            row.occurredAtMs,
            row.occurredAtMs
          ]
        );
      }
    }

    await adapter.execute('COMMIT', []);
  } catch (error) {
    await adapter.execute('ROLLBACK', []);
    throw error;
  } finally {
    await adapter.execute('PRAGMA foreign_keys = ON', []);
  }
}
