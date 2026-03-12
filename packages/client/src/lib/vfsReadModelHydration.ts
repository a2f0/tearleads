import type {
  VfsAclAccessLevel,
  VfsAclPrincipalType,
  VfsCrdtSyncItem,
  VfsSyncItem
} from '@tearleads/shared';
import { getDatabaseAdapter, isDatabaseInitialized } from '@/db';
import { runLocalWrite } from '@/db/localWrite';
import { api } from '@/lib/api';
import {
  resolveMaterializedNoteContent,
  resolveMaterializedNoteTitle
} from './vfsRematerializationScrub';

interface RegistryRow {
  id: string;
  objectType: string;
  encryptedName: string | null;
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

interface ItemStateRow {
  itemId: string;
  encryptedPayload: string | null;
  updatedAtMs: number;
  deleted: boolean;
}

interface LinkRow {
  id: string;
  parentId: string;
  childId: string;
  createdAtMs: number;
}

interface PaginatedFeedPage<TItem> {
  items: TItem[];
  nextCursor: string | null;
  hasMore: boolean;
}

const FEED_PAGE_SIZE = 500;
const MAX_FEED_PAGES = 100;
const VFS_ROOT_ID = '00000000-0000-0000-0000-000000000000';
const HYDRATION_SAVEPOINT = 'sp_vfs_read_model_hydration';

let hydrationInFlight: Promise<void> | null = null;
let hydrationQueued = false;

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
    if (!page.hasMore) {
      break;
    }
    if (!page.nextCursor) {
      throw new Error(
        `vfs ${feedName} feed reported hasMore without nextCursor`
      );
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
      encryptedName:
        typeof item.encryptedName === 'string' ? item.encryptedName : null,
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

function buildItemStateRows(crdtItems: VfsCrdtSyncItem[]): ItemStateRow[] {
  const rowsById = new Map<string, ItemStateRow>();
  for (const item of crdtItems) {
    const occurredAtMs = parseTimestampMs(item.occurredAt);

    if (item.opType === 'item_upsert') {
      rowsById.set(item.itemId, {
        itemId: item.itemId,
        encryptedPayload: item.encryptedPayload ?? null,
        updatedAtMs: occurredAtMs,
        deleted: false
      });
      continue;
    }

    if (item.opType === 'item_delete') {
      rowsById.set(item.itemId, {
        itemId: item.itemId,
        encryptedPayload: null,
        updatedAtMs: occurredAtMs,
        deleted: true
      });
    }
  }

  return Array.from(rowsById.values());
}

function buildLinkRows(crdtItems: VfsCrdtSyncItem[]): LinkRow[] {
  const rowsByKey = new Map<string, LinkRow>();
  for (const item of crdtItems) {
    if (item.opType !== 'link_add' && item.opType !== 'link_remove') {
      continue;
    }
    if (!item.parentId || !item.childId) {
      continue;
    }

    const key = `${item.parentId}::${item.childId}`;
    if (item.opType === 'link_remove') {
      rowsByKey.delete(key);
      continue;
    }

    rowsByKey.set(key, {
      id: `link:${item.parentId}:${item.childId}`,
      parentId: item.parentId,
      childId: item.childId,
      createdAtMs: parseTimestampMs(item.occurredAt)
    });
  }

  return Array.from(rowsByKey.values());
}

async function tableExists(tableName: string): Promise<boolean> {
  const adapter = getDatabaseAdapter();
  const result = await adapter.execute(
    `SELECT name FROM sqlite_master WHERE type = 'table' AND name = ?`,
    [tableName]
  );
  return result.rows.length > 0;
}

async function hydrateLocalReadModelFromRemoteFeedsOnce(): Promise<void> {
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
  const linkRows = buildLinkRows(crdtItems).filter(
    (row) =>
      registryIds.has(row.childId) &&
      (row.parentId === VFS_ROOT_ID || registryIds.has(row.parentId))
  );
  const itemStateRows = buildItemStateRows(crdtItems).filter((row) =>
    registryIds.has(row.itemId)
  );
  const itemStateById = new Map(itemStateRows.map((row) => [row.itemId, row]));
  const aclRows = buildAclRows(crdtItems).filter((row) =>
    registryIds.has(row.itemId)
  );
  const noteRows = registryUpserts
    .filter((row) => row.objectType === 'note')
    .map((row) => {
      const itemState = itemStateById.get(row.id);
      return {
        id: row.id,
        title: resolveMaterializedNoteTitle(row.encryptedName),
        content: resolveMaterializedNoteContent(itemState?.encryptedPayload),
        createdAtMs: row.createdAtMs,
        updatedAtMs: itemState?.updatedAtMs ?? row.createdAtMs,
        deleted: itemState?.deleted ?? false
      };
    });

  const hasLinksTable = await tableExists('vfs_links');
  const hasAclEntriesTable = await tableExists('vfs_acl_entries');
  const hasNotesTable = await tableExists('notes');
  const adapter = getDatabaseAdapter();

  await runLocalWrite(async () => {
    let foreignKeysDisabled = false;
    let savepointStarted = false;
    try {
      await adapter.execute('PRAGMA foreign_keys = OFF', []);
      foreignKeysDisabled = true;

      await adapter.execute(`SAVEPOINT ${HYDRATION_SAVEPOINT}`, []);
      savepointStarted = true;

      for (const row of registryUpserts) {
        await adapter.execute(
          `INSERT INTO vfs_registry (
           id,
           object_type,
           encrypted_name,
           owner_id,
           created_at
         ) VALUES (?, ?, ?, ?, ?)
         ON CONFLICT(id) DO UPDATE SET
           object_type = excluded.object_type,
           encrypted_name = excluded.encrypted_name,
           owner_id = excluded.owner_id,
           created_at = excluded.created_at`,
          [
            row.id,
            row.objectType,
            row.encryptedName,
            row.ownerId,
            row.createdAtMs
          ]
        );
      }

      for (const id of registryDeletes) {
        await adapter.execute(`DELETE FROM vfs_registry WHERE id = ?`, [id]);
      }

      if (hasLinksTable) {
        await adapter.execute(`DELETE FROM vfs_links`, []);
        for (const row of linkRows) {
          await adapter.execute(
            `INSERT INTO vfs_links (
             id,
             parent_id,
             child_id,
             wrapped_session_key,
             created_at
           ) VALUES (?, ?, ?, ?, ?)
           ON CONFLICT(parent_id, child_id) DO UPDATE SET
             id = excluded.id,
             wrapped_session_key = excluded.wrapped_session_key,
             created_at = excluded.created_at`,
            [row.id, row.parentId, row.childId, '', row.createdAtMs]
          );
        }
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

      if (hasNotesTable) {
        await adapter.execute(
          `DELETE FROM notes
         WHERE id NOT IN (
           SELECT id FROM vfs_registry WHERE object_type = 'note'
         )`,
          []
        );
        for (const row of noteRows) {
          await adapter.execute(
            `INSERT INTO notes (
             id,
             title,
             content,
             created_at,
             updated_at,
             deleted
           ) VALUES (?, ?, ?, ?, ?, ?)
           ON CONFLICT(id) DO UPDATE SET
             title = excluded.title,
             content = excluded.content,
             created_at = excluded.created_at,
             updated_at = excluded.updated_at,
             deleted = excluded.deleted`,
            [
              row.id,
              row.title,
              row.content,
              row.createdAtMs,
              row.updatedAtMs,
              row.deleted ? 1 : 0
            ]
          );
        }
      }

      await adapter.execute(`RELEASE ${HYDRATION_SAVEPOINT}`, []);
      savepointStarted = false;
    } catch (error) {
      if (savepointStarted) {
        await adapter.execute(`ROLLBACK TO ${HYDRATION_SAVEPOINT}`, []);
        await adapter.execute(`RELEASE ${HYDRATION_SAVEPOINT}`, []);
      }
      throw error;
    } finally {
      if (foreignKeysDisabled) {
        await adapter.execute('PRAGMA foreign_keys = ON', []);
      }
    }
  });
}

export async function hydrateLocalReadModelFromRemoteFeeds(): Promise<void> {
  if (hydrationInFlight) {
    hydrationQueued = true;
    return hydrationInFlight;
  }

  hydrationInFlight = (async () => {
    do {
      hydrationQueued = false;
      await hydrateLocalReadModelFromRemoteFeedsOnce();
    } while (hydrationQueued);
  })().finally(() => {
    hydrationInFlight = null;
    hydrationQueued = false;
  });

  return hydrationInFlight;
}
