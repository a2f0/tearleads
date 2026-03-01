import type {
  VfsAclAccessLevel,
  VfsAclPrincipalType,
  VfsCrdtSyncItem,
  VfsObjectType,
  VfsSyncItem
} from '@tearleads/shared';
import { ne, sql } from 'drizzle-orm';
import { getDatabase, getDatabaseAdapter, isDatabaseInitialized } from '@/db';
import { runLocalWrite } from '@/db/localWrite';
import {
  notes,
  vfsAclEntries,
  vfsItemState,
  vfsLinks,
  vfsRegistry
} from '@/db/schema';
import { api } from './api';

const SYNC_PAGE_LIMIT = 500;
const INSERT_BATCH_SIZE = 200;

interface RegistryRowState {
  id: string;
  objectType: VfsObjectType;
  encryptedName: string | null;
  ownerId: string | null;
  createdAtMs: number;
}

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

const DEFAULT_MATERIALIZED_NOTE_TITLE = 'Untitled Note';
const VFS_ROOT_ID = '__vfs_root__';

function chunkArray<T>(values: readonly T[], size: number): T[][] {
  const chunks: T[][] = [];
  for (let index = 0; index < values.length; index += size) {
    chunks.push(values.slice(index, index + size));
  }
  return chunks;
}

function parseTimestampMs(
  value: string | null | undefined,
  fallback: number
): number {
  if (!value) {
    return fallback;
  }
  const parsed = Date.parse(value);
  if (!Number.isFinite(parsed)) {
    return fallback;
  }
  return parsed;
}

function resolveMaterializedNoteTitle(
  encryptedName: string | null | undefined
): string {
  if (typeof encryptedName !== 'string') {
    return DEFAULT_MATERIALIZED_NOTE_TITLE;
  }
  const trimmed = encryptedName.trim();
  return trimmed.length > 0 ? trimmed : DEFAULT_MATERIALIZED_NOTE_TITLE;
}

function decodeBase64Utf8(value: string): string | null {
  const trimmed = value.trim();
  if (trimmed.length === 0) {
    return null;
  }

  const normalized = trimmed.replace(/-/g, '+').replace(/_/g, '/');
  const missingPadding = normalized.length % 4;
  const padded =
    missingPadding === 0
      ? normalized
      : `${normalized}${'='.repeat(4 - missingPadding)}`;

  if (typeof globalThis.atob !== 'function') {
    return null;
  }

  try {
    const binary = globalThis.atob(padded);
    const bytes = Uint8Array.from(binary, (char) => char.charCodeAt(0));
    return new TextDecoder().decode(bytes);
  } catch {
    return null;
  }
}

function resolveMaterializedNoteContent(
  encryptedPayload: string | null | undefined
): string {
  if (typeof encryptedPayload !== 'string') {
    return '';
  }

  const decoded = decodeBase64Utf8(encryptedPayload);
  if (decoded === null) {
    return '';
  }

  return decoded;
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

function applySyncItemToRegistryState(
  registryById: Map<string, RegistryRowState>,
  item: VfsSyncItem
): void {
  if (item.changeType === 'delete') {
    registryById.delete(item.itemId);
    return;
  }
  if (!item.objectType) {
    return;
  }

  const createdAtMs = parseTimestampMs(
    item.createdAt,
    parseTimestampMs(item.changedAt, Date.now())
  );
  registryById.set(item.itemId, {
    id: item.itemId,
    objectType: item.objectType,
    encryptedName:
      typeof item.encryptedName === 'string' ? item.encryptedName : null,
    ownerId: item.ownerId,
    createdAtMs
  });
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

  if (item.opType === 'link_add' || item.opType === 'link_remove') {
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

    const key = `${item.parentId}::${item.childId}`;
    if (item.opType === 'link_remove') {
      linksByKey.delete(key);
    } else {
      linksByKey.set(key, {
        parentId: item.parentId,
        childId: item.childId
      });
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
  const aclRows = Array.from(aclByKey.values()).map((entry) => ({
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

  const db = getDatabase();
  const adapter = getDatabaseAdapter();
  const hasItemStateTable = await tableExists('vfs_item_state');
  const hasAclEntriesTable = await tableExists('vfs_acl_entries');
  const hasNotesTable = await tableExists('notes');
  // Disable FK checks during bulk rebuild — grantedBy may reference users not
  // yet present locally. The server guarantees referential integrity.
  await adapter.execute('PRAGMA foreign_keys = OFF', []);
  try {
    await runLocalWrite(async () => {
      await db.transaction(async (tx) => {
        await tx.delete(vfsLinks);
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
        if (hasItemStateTable) {
          for (const chunk of chunkArray(itemStateRows, INSERT_BATCH_SIZE)) {
            if (chunk.length > 0) {
              await tx.insert(vfsItemState).values(chunk);
            }
          }
        }
        if (hasAclEntriesTable) {
          for (const chunk of chunkArray(aclRows, INSERT_BATCH_SIZE)) {
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
  } finally {
    await adapter.execute('PRAGMA foreign_keys = ON', []);
  }

  return true;
}
