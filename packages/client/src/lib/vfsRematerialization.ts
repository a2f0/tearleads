import type {
  VfsAclAccessLevel,
  VfsAclPrincipalType,
  VfsCrdtSyncItem,
  VfsSyncItem
} from '@tearleads/shared';
import { ne, sql } from 'drizzle-orm';
import { getDatabase, getDatabaseAdapter, isDatabaseInitialized } from '@/db';
import { runLocalWrite } from '@/db/localWrite';
import {
  albums,
  files,
  notes,
  playlists,
  vfsAclEntries,
  vfsItemState,
  vfsLinks,
  vfsRegistry
} from '@/db/schema';
import { api } from './api';
import { ensureGrantorUsersExist } from './vfsRematerializationAclGrantors';
import { backfillMaterializedMediaFromLocalStateIfNeeded } from './vfsRematerializationBackfill';
import {
  buildMaterializedCollectionRows,
  buildMaterializedFileRows
} from './vfsRematerializationEntityRows';
import { VFS_REMATERIALIZATION_COMPLETE_EVENT } from './vfsRematerializationEvents';
import { materializeFilePayloadsToStorage } from './vfsRematerializationFilePayloads';
import {
  applySyncItemToRegistryState,
  type RegistryRowState
} from './vfsRematerializationRegistryState';
import {
  resolveMaterializedNoteContent,
  resolveMaterializedNoteTitle
} from './vfsRematerializationScrub';
import {
  chunkArray,
  parseTimestampMs,
  VFS_ROOT_ID
} from './vfsRematerializationUtils';

const SYNC_PAGE_LIMIT = 500;
const INSERT_BATCH_SIZE = 200;

interface ItemStateRowState {
  itemId: string;
  encryptedPayload: string | null;
  keyEpoch: number | null;
  encryptionNonce: string | null;
  encryptionAad: string | null;
  encryptionSignature: string | null;
  updatedAtMs: number;
  deletedAtMs: number | null;
}

interface LinkRowState {
  parentId: string;
  childId: string;
}

interface AclRowState {
  itemId: string;
  principalType: VfsAclPrincipalType;
  principalId: string;
  accessLevel: VfsAclAccessLevel;
  keyEpoch: number | null;
  sourceId: string;
  actorId: string | null;
  updatedAtMs: number;
}

interface NoteRowState {
  id: string;
  title: string;
  content: string;
  createdAtMs: number;
  updatedAtMs: number;
  deleted: boolean;
}

async function forEachSyncItem(
  onItem: (item: VfsSyncItem) => void | Promise<void>
): Promise<void> {
  let cursor: string | undefined;

  while (true) {
    const page = await api.vfs.getSync(cursor, SYNC_PAGE_LIMIT);
    for (const item of page.items) {
      await onItem(item);
    }

    if (!page.hasMore || !page.nextCursor) {
      break;
    }
    cursor = page.nextCursor;
  }
}

async function forEachCrdtItem(
  onItem: (item: VfsCrdtSyncItem) => void | Promise<void>
): Promise<void> {
  let cursor: string | undefined;

  while (true) {
    const page = await api.vfs.getCrdtSync(cursor, SYNC_PAGE_LIMIT);
    for (const item of page.items) {
      await onItem(item);
    }

    if (!page.hasMore || !page.nextCursor) {
      break;
    }
    cursor = page.nextCursor;
  }
}

function applyCrdtItemToDerivedState(
  item: VfsCrdtSyncItem,
  registryIds: ReadonlySet<string>,
  itemStateById: Map<string, ItemStateRowState>,
  linksByKey: Map<string, LinkRowState>,
  aclByKey: Map<string, AclRowState>
): void {
  const occurredAtMs = parseTimestampMs(item.occurredAt, Date.now());
  if (item.opType === 'item_upsert') {
    if (!registryIds.has(item.itemId)) {
      return;
    }
    itemStateById.set(item.itemId, {
      itemId: item.itemId,
      encryptedPayload: item.encryptedPayload ?? null,
      keyEpoch: item.keyEpoch ?? null,
      encryptionNonce: item.encryptionNonce ?? null,
      encryptionAad: item.encryptionAad ?? null,
      encryptionSignature: item.encryptionSignature ?? null,
      updatedAtMs: occurredAtMs,
      deletedAtMs: null
    });
    return;
  }

  if (item.opType === 'item_delete') {
    if (!registryIds.has(item.itemId)) {
      return;
    }
    itemStateById.set(item.itemId, {
      itemId: item.itemId,
      encryptedPayload: null,
      keyEpoch: null,
      encryptionNonce: null,
      encryptionAad: null,
      encryptionSignature: null,
      updatedAtMs: occurredAtMs,
      deletedAtMs: occurredAtMs
    });
    return;
  }

  if (
    item.opType === 'link_add' ||
    item.opType === 'link_remove' ||
    item.opType === 'link_reassign'
  ) {
    if (!item.parentId || !item.childId) {
      return;
    }
    if (!registryIds.has(item.childId)) {
      return;
    }
    const isKnownParent =
      item.parentId === VFS_ROOT_ID || registryIds.has(item.parentId);
    if (!isKnownParent) {
      return;
    }

    if (item.opType === 'link_reassign') {
      for (const [existingKey, link] of linksByKey) {
        if (link.childId === item.childId) {
          linksByKey.delete(existingKey);
        }
      }
      linksByKey.set(`${item.parentId}::${item.childId}`, {
        parentId: item.parentId,
        childId: item.childId
      });
    } else {
      const key = `${item.parentId}::${item.childId}`;
      if (item.opType === 'link_remove') {
        linksByKey.delete(key);
      } else {
        linksByKey.set(key, {
          parentId: item.parentId,
          childId: item.childId
        });
      }
    }
    return;
  }

  if (item.opType === 'acl_add' || item.opType === 'acl_remove') {
    if (!item.principalType || !item.principalId) {
      return;
    }
    if (!registryIds.has(item.itemId)) {
      return;
    }

    const key = `${item.itemId}::${item.principalType}::${item.principalId}`;
    if (item.opType === 'acl_remove') {
      aclByKey.delete(key);
    } else if (item.accessLevel) {
      aclByKey.set(key, {
        itemId: item.itemId,
        principalType: item.principalType,
        principalId: item.principalId,
        accessLevel: item.accessLevel,
        keyEpoch: item.keyEpoch ?? null,
        sourceId: item.sourceId,
        actorId: item.actorId,
        updatedAtMs: occurredAtMs
      });
    }
  }
}

async function isLocalRegistryEmpty(): Promise<boolean> {
  if (!isDatabaseInitialized()) {
    // If local DB is unavailable we skip rematerialization and let normal init flow run.
    return false;
  }

  const db = getDatabase();
  const rows = await db
    .select({ count: sql<number>`count(*)` })
    .from(vfsRegistry)
    .where(ne(vfsRegistry.id, VFS_ROOT_ID))
    .limit(1);
  return (rows[0]?.count ?? 0) === 0;
}

async function tableExists(tableName: string): Promise<boolean> {
  const adapter = getDatabaseAdapter();
  const result = await adapter.execute(
    `SELECT name FROM sqlite_master WHERE type = 'table' AND name = ?`,
    [tableName]
  );
  return result.rows.length > 0;
}

export async function rematerializeRemoteVfsStateIfNeeded(): Promise<boolean> {
  if (!isDatabaseInitialized()) {
    return false;
  }

  const shouldRematerialize = await isLocalRegistryEmpty();
  if (!shouldRematerialize) {
    await backfillMaterializedMediaFromLocalStateIfNeeded();
    return false;
  }

  const registryById = new Map<string, RegistryRowState>();
  await forEachSyncItem((item) => {
    applySyncItemToRegistryState(registryById, item);
  });
  const registryIds = new Set(registryById.keys());
  const itemStateById = new Map<string, ItemStateRowState>();
  const linksByKey = new Map<string, LinkRowState>();
  const aclByKey = new Map<string, AclRowState>();
  await forEachCrdtItem((item) => {
    applyCrdtItemToDerivedState(
      item,
      registryIds,
      itemStateById,
      linksByKey,
      aclByKey
    );
  });

  const registryRows = Array.from(registryById.values()).map((entry) => ({
    id: entry.id,
    objectType: entry.objectType,
    encryptedName: entry.encryptedName,
    ownerId: entry.ownerId,
    createdAt: new Date(entry.createdAtMs)
  }));
  const linkRows = Array.from(linksByKey.values()).map((entry) => ({
    id: `link:${entry.parentId}:${entry.childId}`,
    parentId: entry.parentId,
    childId: entry.childId,
    // Sync feeds do not currently include wrapped link keys, and this column is non-null.
    wrappedSessionKey: '',
    wrappedHierarchicalKey: null,
    visibleChildren: null,
    position: null,
    createdAt: new Date(0)
  }));
  const hasRootLink = linkRows.some(
    (entry) => entry.parentId === VFS_ROOT_ID || entry.childId === VFS_ROOT_ID
  );
  if (hasRootLink && !registryRows.some((entry) => entry.id === VFS_ROOT_ID)) {
    registryRows.unshift({
      id: VFS_ROOT_ID,
      objectType: 'folder',
      encryptedName: 'VFS Root',
      ownerId: null,
      createdAt: new Date(0)
    });
  }
  const rawAclRows = Array.from(aclByKey.values()).map((entry) => ({
    id: entry.sourceId,
    itemId: entry.itemId,
    principalType: entry.principalType,
    principalId: entry.principalId,
    accessLevel: entry.accessLevel,
    wrappedSessionKey: null,
    wrappedHierarchicalKey: null,
    keyEpoch: entry.keyEpoch,
    grantedBy: entry.actorId,
    createdAt: new Date(entry.updatedAtMs),
    updatedAt: new Date(entry.updatedAtMs),
    expiresAt: null,
    revokedAt: null
  }));
  const aclGrantorCandidates = rawAclRows
    .map((entry) => entry.grantedBy)
    .filter(
      (value): value is string => typeof value === 'string' && value.length > 0
    );
  const itemStateRows = Array.from(itemStateById.values()).map((entry) => ({
    itemId: entry.itemId,
    encryptedPayload: entry.encryptedPayload,
    keyEpoch: entry.keyEpoch,
    encryptionNonce: entry.encryptionNonce,
    encryptionAad: entry.encryptionAad,
    encryptionSignature: entry.encryptionSignature,
    updatedAt: new Date(entry.updatedAtMs),
    deletedAt: entry.deletedAtMs === null ? null : new Date(entry.deletedAtMs)
  }));
  const itemStateByItemId = new Map(
    itemStateRows.map((entry) => [
      entry.itemId,
      {
        encryptedPayload: entry.encryptedPayload,
        updatedAtMs: entry.updatedAt.getTime(),
        deleted: entry.deletedAt !== null
      }
    ])
  );
  const noteRows = registryRows
    .filter((entry) => entry.objectType === 'note')
    .map((entry): NoteRowState => {
      const itemState = itemStateByItemId.get(entry.id);
      return {
        id: entry.id,
        title: resolveMaterializedNoteTitle(entry.encryptedName),
        content: resolveMaterializedNoteContent(itemState?.encryptedPayload),
        createdAtMs: entry.createdAt.getTime(),
        updatedAtMs: itemState?.updatedAtMs ?? entry.createdAt.getTime(),
        deleted: itemState?.deleted ?? false
      };
    });
  const { albumRows, playlistRows } =
    buildMaterializedCollectionRows(registryRows);
  const fileRows = buildMaterializedFileRows(registryRows, itemStateByItemId);
  await materializeFilePayloadsToStorage(fileRows, itemStateByItemId);

  const db = getDatabase();
  const hasItemStateTable = await tableExists('vfs_item_state');
  const hasAclEntriesTable = await tableExists('vfs_acl_entries');
  const hasNotesTable = await tableExists('notes');
  const hasAlbumsTable = await tableExists('albums');
  const hasPlaylistsTable = await tableExists('playlists');
  const hasFilesTable = await tableExists('files');
  if (hasAclEntriesTable) {
    await ensureGrantorUsersExist(aclGrantorCandidates, INSERT_BATCH_SIZE);
  }
  await runLocalWrite(async () => {
    await db.transaction(async (tx) => {
      await tx.delete(vfsLinks);
      if (hasAlbumsTable) {
        await tx.delete(albums);
      }
      if (hasPlaylistsTable) {
        await tx.delete(playlists);
      }
      if (hasFilesTable) {
        await tx.delete(files);
      }
      if (hasAclEntriesTable) {
        await tx.delete(vfsAclEntries);
      }
      if (hasItemStateTable) {
        await tx.delete(vfsItemState);
      }
      if (hasNotesTable) {
        await tx.delete(notes);
      }
      await tx.delete(vfsRegistry);

      for (const chunk of chunkArray(registryRows, INSERT_BATCH_SIZE)) {
        if (chunk.length > 0) {
          await tx.insert(vfsRegistry).values(chunk);
        }
      }
      if (hasAlbumsTable) {
        for (const chunk of chunkArray(albumRows, INSERT_BATCH_SIZE)) {
          if (chunk.length > 0) {
            await tx.insert(albums).values(chunk);
          }
        }
      }
      if (hasPlaylistsTable) {
        for (const chunk of chunkArray(playlistRows, INSERT_BATCH_SIZE)) {
          if (chunk.length > 0) {
            await tx.insert(playlists).values(chunk);
          }
        }
      }
      if (hasFilesTable) {
        for (const chunk of chunkArray(fileRows, INSERT_BATCH_SIZE)) {
          if (chunk.length > 0) {
            await tx.insert(files).values(chunk);
          }
        }
      }
      if (hasItemStateTable) {
        for (const chunk of chunkArray(itemStateRows, INSERT_BATCH_SIZE)) {
          if (chunk.length > 0) {
            await tx.insert(vfsItemState).values(chunk);
          }
        }
      }
      if (hasAclEntriesTable) {
        for (const chunk of chunkArray(rawAclRows, INSERT_BATCH_SIZE)) {
          if (chunk.length > 0) {
            await tx.insert(vfsAclEntries).values(chunk);
          }
        }
      }
      if (hasNotesTable) {
        for (const chunk of chunkArray(noteRows, INSERT_BATCH_SIZE)) {
          if (chunk.length > 0) {
            await tx.insert(notes).values(
              chunk.map((entry) => ({
                id: entry.id,
                title: entry.title,
                content: entry.content,
                createdAt: new Date(entry.createdAtMs),
                updatedAt: new Date(entry.updatedAtMs),
                deleted: entry.deleted
              }))
            );
          }
        }
      }
      for (const chunk of chunkArray(linkRows, INSERT_BATCH_SIZE)) {
        if (chunk.length > 0) {
          await tx.insert(vfsLinks).values(chunk);
        }
      }
    });
  });

  window.dispatchEvent(new Event(VFS_REMATERIALIZATION_COMPLETE_EVENT));
  return true;
}
