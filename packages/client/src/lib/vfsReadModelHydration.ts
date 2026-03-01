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

interface PaginatedFeedPage<TItem> {
  items: TItem[];
  nextCursor: string | null;
  hasMore: boolean;
}

const FEED_PAGE_SIZE = 500;
const MAX_FEED_PAGES = 100;

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

async function fetchAllPages<TItem>(
  fetchPage: (
    cursor: string | undefined,
    limit: number
  ) => Promise<PaginatedFeedPage<TItem>>,
  feedName: 'sync' | 'crdt'
): Promise<TItem[]> {
  const all: TItem[] = [];
  let cursor: string | undefined;
  let pagesFetched = 0;
  const seenCursors = new Set<string>();

  while (true) {
    pagesFetched += 1;
    if (pagesFetched > MAX_FEED_PAGES) {
      throw new Error(
        `vfs ${feedName} feed exceeded ${MAX_FEED_PAGES} pages during hydration`
      );
    }

    const page = await fetchPage(cursor, FEED_PAGE_SIZE);
    all.push(...page.items);
    if (!page.hasMore || !page.nextCursor) {
      break;
    }

    if (page.nextCursor === cursor || seenCursors.has(page.nextCursor)) {
      throw new Error(
        `vfs ${feedName} feed returned a non-advancing cursor: ${page.nextCursor}`
      );
    }

    seenCursors.add(page.nextCursor);
    cursor = page.nextCursor;
  }

  return all;
}

async function fetchAllSyncItems(): Promise<VfsSyncItem[]> {
  return fetchAllPages<VfsSyncItem>(api.vfs.getSync, 'sync');
}

async function fetchAllCrdtItems(): Promise<VfsCrdtSyncItem[]> {
  return fetchAllPages<VfsCrdtSyncItem>(api.vfs.getCrdtSync, 'crdt');
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
  const registryIds = new Set(registryUpserts.map((row) => row.id));
  const aclRows = buildAclRows(crdtItems).filter((row) =>
    registryIds.has(row.itemId)
  );

  const hasAclEntriesTable = await tableExists('vfs_acl_entries');
  const adapter = getDatabaseAdapter();

  let foreignKeysDisabled = false;
  let transactionStarted = false;
  try {
    await adapter.execute('PRAGMA foreign_keys = OFF', []);
    foreignKeysDisabled = true;

    await adapter.execute('BEGIN', []);
    transactionStarted = true;

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
    transactionStarted = false;
  } catch (error) {
    if (transactionStarted) {
      await adapter.execute('ROLLBACK', []);
    }
    throw error;
  } finally {
    if (foreignKeysDisabled) {
      await adapter.execute('PRAGMA foreign_keys = ON', []);
    }
  }
}
