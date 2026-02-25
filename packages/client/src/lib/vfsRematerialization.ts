import type {
  VfsAclAccessLevel,
  VfsAclPrincipalType,
  VfsCrdtSyncItem,
  VfsObjectType,
  VfsSyncItem
} from '@tearleads/shared';
import { sql } from 'drizzle-orm';
import { getDatabase, getDatabaseAdapter, isDatabaseInitialized } from '@/db';
import { runLocalWrite } from '@/db/localWrite';
import {
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
  updatedAtMs: number;
}

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

async function fetchAllSyncItems(): Promise<VfsSyncItem[]> {
  const items: VfsSyncItem[] = [];
  let cursor: string | undefined;

  while (true) {
    const page = await api.vfs.getSync(cursor, SYNC_PAGE_LIMIT);
    items.push(...page.items);

    if (!page.hasMore || !page.nextCursor) {
      break;
    }
    cursor = page.nextCursor;
  }

  return items;
}

async function fetchAllCrdtItems(): Promise<VfsCrdtSyncItem[]> {
  const items: VfsCrdtSyncItem[] = [];
  let cursor: string | undefined;

  while (true) {
    const page = await api.vfs.getCrdtSync(cursor, SYNC_PAGE_LIMIT);
    items.push(...page.items);

    if (!page.hasMore || !page.nextCursor) {
      break;
    }
    cursor = page.nextCursor;
  }

  return items;
}

function buildRegistryState(
  syncItems: readonly VfsSyncItem[]
): Map<string, RegistryRowState> {
  const registryById = new Map<string, RegistryRowState>();
  for (const item of syncItems) {
    if (item.changeType === 'delete') {
      registryById.delete(item.itemId);
      continue;
    }
    if (!item.objectType) {
      continue;
    }

    const createdAtMs = parseTimestampMs(
      item.createdAt,
      parseTimestampMs(item.changedAt, Date.now())
    );
    registryById.set(item.itemId, {
      id: item.itemId,
      objectType: item.objectType,
      ownerId: item.ownerId,
      createdAtMs
    });
  }
  return registryById;
}

function buildCrdtDerivedState(
  crdtItems: readonly VfsCrdtSyncItem[],
  registryIds: ReadonlySet<string>
): {
  itemStateById: Map<string, ItemStateRowState>;
  linksByKey: Map<string, LinkRowState>;
  aclByKey: Map<string, AclRowState>;
} {
  const itemStateById = new Map<string, ItemStateRowState>();
  const linksByKey = new Map<string, LinkRowState>();
  const aclByKey = new Map<string, AclRowState>();

  for (const item of crdtItems) {
    const occurredAtMs = parseTimestampMs(item.occurredAt, Date.now());
    if (item.opType === 'item_upsert') {
      if (!registryIds.has(item.itemId)) {
        continue;
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
      continue;
    }

    if (item.opType === 'item_delete') {
      if (!registryIds.has(item.itemId)) {
        continue;
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
      continue;
    }

    if (item.opType === 'link_add' || item.opType === 'link_remove') {
      if (!item.parentId || !item.childId) {
        continue;
      }
      if (!registryIds.has(item.parentId) || !registryIds.has(item.childId)) {
        continue;
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
      continue;
    }

    if (item.opType === 'acl_add' || item.opType === 'acl_remove') {
      if (!item.principalType || !item.principalId) {
        continue;
      }
      if (!registryIds.has(item.itemId)) {
        continue;
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
          updatedAtMs: occurredAtMs
        });
      }
    }
  }

  return {
    itemStateById,
    linksByKey,
    aclByKey
  };
}

async function isLocalRegistryEmpty(): Promise<boolean> {
  if (!isDatabaseInitialized()) {
    return false;
  }

  const db = getDatabase();
  const rows = await db
    .select({ count: sql<number>`count(*)` })
    .from(vfsRegistry)
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

  const [syncItems, crdtItems] = await Promise.all([
    fetchAllSyncItems(),
    fetchAllCrdtItems()
  ]);

  const registryById = buildRegistryState(syncItems);
  const registryIds = new Set(registryById.keys());
  const { itemStateById, linksByKey, aclByKey } = buildCrdtDerivedState(
    crdtItems,
    registryIds
  );

  const registryRows = Array.from(registryById.values()).map((entry) => ({
    id: entry.id,
    objectType: entry.objectType,
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
    id: `acl:${entry.itemId}:${entry.principalType}:${entry.principalId}`,
    itemId: entry.itemId,
    principalType: entry.principalType,
    principalId: entry.principalId,
    accessLevel: entry.accessLevel,
    wrappedSessionKey: null,
    wrappedHierarchicalKey: null,
    keyEpoch: entry.keyEpoch,
    grantedBy: null,
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

  const db = getDatabase();
  const hasItemStateTable = await tableExists('vfs_item_state');
  const hasAclEntriesTable = await tableExists('vfs_acl_entries');
  await runLocalWrite(async () => {
    await db.transaction(async (tx) => {
      await tx.delete(vfsLinks);
      if (hasAclEntriesTable) {
        await tx.delete(vfsAclEntries);
      }
      if (hasItemStateTable) {
        await tx.delete(vfsItemState);
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
      for (const chunk of chunkArray(linkRows, INSERT_BATCH_SIZE)) {
        if (chunk.length > 0) {
          await tx.insert(vfsLinks).values(chunk);
        }
      }
    });
  });

  return true;
}
