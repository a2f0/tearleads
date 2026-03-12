import { VFS_OBJECT_TYPES, type VfsObjectType } from '@tearleads/shared';
import { getDatabase, getDatabaseAdapter } from '@/db';
import { runLocalWrite } from '@/db/localWrite';
import {
  albums,
  files,
  playlists,
  vfsItemState,
  vfsRegistry
} from '@/db/schema';
import {
  buildMaterializedCollectionRows,
  buildMaterializedFileRows
} from './vfsRematerializationEntityRows';
import { materializeFilePayloadsToStorage } from './vfsRematerializationFilePayloads';

const INSERT_BATCH_SIZE = 200;
const MATERIALIZED_FILE_OBJECT_TYPES = new Set<VfsObjectType>([
  'file',
  'photo',
  'audio',
  'video'
]);
const VFS_OBJECT_TYPE_SET = new Set<string>(VFS_OBJECT_TYPES);

interface RegistryRowForBackfill {
  id: string;
  objectType: VfsObjectType;
  encryptedName: string | null;
  ownerId: string | null;
  createdAt: Date;
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

function isVfsObjectType(value: string): value is VfsObjectType {
  return VFS_OBJECT_TYPE_SET.has(value);
}

function normalizeCreatedAt(value: Date | string | number | null): Date {
  const parsedDate =
    value instanceof Date
      ? new Date(value.getTime())
      : new Date(value ?? Date.now());
  return Number.isNaN(parsedDate.getTime()) ? new Date(0) : parsedDate;
}

async function tableExists(tableName: string): Promise<boolean> {
  const adapter = getDatabaseAdapter();
  const result = await adapter.execute(
    `SELECT name FROM sqlite_master WHERE type = 'table' AND name = ?`,
    [tableName]
  );
  return result.rows.length > 0;
}

function collectExpectedMaterializedIds(
  registryRows: ReadonlyArray<{ id: string; objectType: VfsObjectType }>
): {
  albumIds: Set<string>;
  playlistIds: Set<string>;
  fileIds: Set<string>;
} {
  const albumIds = new Set<string>();
  const playlistIds = new Set<string>();
  const fileIds = new Set<string>();

  for (const row of registryRows) {
    if (row.objectType === 'album') {
      albumIds.add(row.id);
      continue;
    }
    if (row.objectType === 'playlist') {
      playlistIds.add(row.id);
      continue;
    }
    if (MATERIALIZED_FILE_OBJECT_TYPES.has(row.objectType)) {
      fileIds.add(row.id);
    }
  }

  return {
    albumIds,
    playlistIds,
    fileIds
  };
}

async function readExistingMaterializedIds(input: {
  hasAlbumsTable: boolean;
  hasPlaylistsTable: boolean;
  hasFilesTable: boolean;
}): Promise<{
  albumIds: Set<string>;
  playlistIds: Set<string>;
  fileIds: Set<string>;
}> {
  const db = getDatabase();
  const [albumRows, playlistRows, fileRows] = await Promise.all([
    input.hasAlbumsTable
      ? db.select({ id: albums.id }).from(albums)
      : Promise.resolve([]),
    input.hasPlaylistsTable
      ? db.select({ id: playlists.id }).from(playlists)
      : Promise.resolve([]),
    input.hasFilesTable
      ? db.select({ id: files.id }).from(files)
      : Promise.resolve([])
  ]);
  return {
    albumIds: new Set(albumRows.map((entry) => entry.id)),
    playlistIds: new Set(playlistRows.map((entry) => entry.id)),
    fileIds: new Set(fileRows.map((entry) => entry.id))
  };
}

function hasSameIds(
  expectedIds: ReadonlySet<string>,
  existingIds: ReadonlySet<string>
): boolean {
  if (expectedIds.size !== existingIds.size) {
    return false;
  }
  for (const id of expectedIds) {
    if (!existingIds.has(id)) {
      return false;
    }
  }
  return true;
}

export async function backfillMaterializedMediaFromLocalStateIfNeeded(): Promise<void> {
  const [hasAlbumsTable, hasPlaylistsTable, hasFilesTable, hasItemStateTable] =
    await Promise.all([
      tableExists('albums'),
      tableExists('playlists'),
      tableExists('files'),
      tableExists('vfs_item_state')
    ]);

  if (!hasAlbumsTable && !hasPlaylistsTable && !hasFilesTable) {
    return;
  }

  const db = getDatabase();
  const registryRows = await db
    .select({
      id: vfsRegistry.id,
      objectType: vfsRegistry.objectType,
      encryptedName: vfsRegistry.encryptedName,
      ownerId: vfsRegistry.ownerId,
      createdAt: vfsRegistry.createdAt
    })
    .from(vfsRegistry);
  const normalizedRegistryRows: RegistryRowForBackfill[] = [];
  for (const entry of registryRows) {
    if (!isVfsObjectType(entry.objectType)) {
      continue;
    }
    normalizedRegistryRows.push({
      id: entry.id,
      objectType: entry.objectType,
      encryptedName: entry.encryptedName,
      ownerId: entry.ownerId,
      createdAt: normalizeCreatedAt(entry.createdAt)
    });
  }
  if (normalizedRegistryRows.length === 0) {
    return;
  }

  const expectedIds = collectExpectedMaterializedIds(normalizedRegistryRows);
  if (
    expectedIds.albumIds.size === 0 &&
    expectedIds.playlistIds.size === 0 &&
    expectedIds.fileIds.size === 0
  ) {
    return;
  }

  const existingIds = await readExistingMaterializedIds({
    hasAlbumsTable,
    hasPlaylistsTable,
    hasFilesTable
  });
  const albumBackfillNeeded =
    hasAlbumsTable && !hasSameIds(expectedIds.albumIds, existingIds.albumIds);
  const playlistBackfillNeeded =
    hasPlaylistsTable &&
    !hasSameIds(expectedIds.playlistIds, existingIds.playlistIds);
  const fileBackfillNeeded =
    hasFilesTable && !hasSameIds(expectedIds.fileIds, existingIds.fileIds);
  if (!albumBackfillNeeded && !playlistBackfillNeeded && !fileBackfillNeeded) {
    return;
  }

  const itemStateRows = hasItemStateTable
    ? await db
        .select({
          itemId: vfsItemState.itemId,
          encryptedPayload: vfsItemState.encryptedPayload,
          updatedAt: vfsItemState.updatedAt,
          deletedAt: vfsItemState.deletedAt
        })
        .from(vfsItemState)
    : [];

  const itemStateByItemId = new Map(
    itemStateRows.map((entry) => [
      entry.itemId,
      {
        encryptedPayload: entry.encryptedPayload,
        updatedAtMs: parseTimestampMs(
          entry.updatedAt?.toISOString?.() ?? null,
          Date.now()
        ),
        deleted: entry.deletedAt !== null
      }
    ])
  );
  const { albumRows, playlistRows } = buildMaterializedCollectionRows(
    normalizedRegistryRows
  );
  const fileRows = buildMaterializedFileRows(
    normalizedRegistryRows,
    itemStateByItemId
  );
  await materializeFilePayloadsToStorage(fileRows, itemStateByItemId);

  await runLocalWrite(async () => {
    await db.transaction(async (tx) => {
      if (albumBackfillNeeded) {
        await tx.delete(albums);
        for (const chunk of chunkArray(albumRows, INSERT_BATCH_SIZE)) {
          if (chunk.length > 0) {
            await tx.insert(albums).values(chunk);
          }
        }
      }

      if (playlistBackfillNeeded) {
        await tx.delete(playlists);
        for (const chunk of chunkArray(playlistRows, INSERT_BATCH_SIZE)) {
          if (chunk.length > 0) {
            await tx.insert(playlists).values(chunk);
          }
        }
      }

      if (fileBackfillNeeded) {
        await tx.delete(files);
        for (const chunk of chunkArray(fileRows, INSERT_BATCH_SIZE)) {
          if (chunk.length > 0) {
            await tx.insert(files).values(chunk);
          }
        }
      }
    });
  });
}
