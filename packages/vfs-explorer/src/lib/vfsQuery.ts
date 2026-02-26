/**
 * Unified VFS query builder that resolves item names via SQL JOINs
 * and applies ORDER BY at the database level (no in-memory sorting).
 */

import type { Database } from '@tearleads/db/sqlite';
import { vfsItemState, vfsLinks, vfsRegistry } from '@tearleads/db/sqlite';
import type { SQL } from 'drizzle-orm';
import { and, asc, desc, eq, isNotNull, isNull, ne, sql } from 'drizzle-orm';
import { VFS_ROOT_ID } from '../constants';
import type { VfsSortState } from './vfsTypes';

/**
 * COALESCE expression that resolves display names from type-specific tables.
 * Each LEFT JOINed table contributes its name column; only the matching
 * table's column will be non-NULL for a given registry row.
 *
 * Guardrail: folder names must resolve from `vfs_registry.encrypted_name` only.
 * Do not reintroduce `vfs_folders` fallback reads in explorer query paths.
 */
function nameCoalesce(): SQL<string> {
  return sql<string>`COALESCE(
    NULLIF(${vfsRegistry.encryptedName}, ''),
    CASE ${vfsRegistry.objectType}
      WHEN 'folder' THEN 'Unnamed Folder'
      WHEN 'emailFolder' THEN 'Unnamed Folder'
      WHEN 'file' THEN 'Unnamed File'
      WHEN 'blob' THEN 'Unnamed Blob'
      WHEN 'photo' THEN 'Unnamed Photo'
      WHEN 'audio' THEN 'Unnamed Audio'
      WHEN 'video' THEN 'Unnamed Video'
      WHEN 'contact' THEN 'Unnamed Contact'
      WHEN 'note' THEN 'Untitled Note'
      WHEN 'playlist' THEN 'Unnamed Playlist'
      WHEN 'album' THEN 'Unnamed Album'
      WHEN 'contactGroup' THEN 'Unnamed Group'
      WHEN 'tag' THEN 'Unnamed Tag'
      WHEN 'email' THEN '(No Subject)'
      WHEN 'conversation' THEN 'Untitled Conversation'
      ELSE 'Unknown'
    END
  )`;
}

/**
 * Builds ORDER BY expressions based on the current sort state.
 * Default (no sort): folders first, then alphabetical by name.
 */
function buildOrderBy(sort: VfsSortState, nameExpr: SQL<string>): SQL[] {
  // All sort orders include vfsRegistry.id as a final tie-breaker for stable,
  // deterministic ordering when primary sort values are identical.
  if (!sort.column || !sort.direction) {
    return [
      asc(
        sql`CASE WHEN ${vfsRegistry.objectType} = 'folder' THEN 0 ELSE 1 END`
      ),
      asc(sql`${nameExpr} COLLATE NOCASE`),
      asc(vfsRegistry.id)
    ];
  }
  const dirFn = sort.direction === 'desc' ? desc : asc;
  switch (sort.column) {
    case 'name':
      return [dirFn(sql`${nameExpr} COLLATE NOCASE`), asc(vfsRegistry.id)];
    case 'objectType':
      return [
        dirFn(vfsRegistry.objectType),
        asc(sql`${nameExpr} COLLATE NOCASE`),
        asc(vfsRegistry.id)
      ];
    case 'createdAt':
      return [dirFn(vfsRegistry.createdAt), asc(vfsRegistry.id)];
  }
}

/** Result shape for folder contents queries (includes linkId). */
interface VfsFolderQueryRow {
  id: string;
  linkId: string;
  objectType: string;
  name: string;
  createdAt: Date;
}

/** Result shape for unfiled/all-items queries. */
interface VfsQueryRow {
  id: string;
  objectType: string;
  name: string;
  createdAt: Date;
}

/**
 * Query items in a specific folder, sorted at the database level.
 */
export async function queryFolderContents(
  db: Database,
  folderId: string,
  sort: VfsSortState
): Promise<VfsFolderQueryRow[]> {
  const nameExpr = nameCoalesce();
  const orderExprs = buildOrderBy(sort, nameExpr);

  // Explicit SQL aliases are required because the sqlite-proxy adapter's
  // extractSelectColumns() parses column names from the generated SQL.
  // Without aliases, complex expressions (COALESCE) produce unparseable
  // column names, and duplicate bare column names (two "id" columns)
  // collide in the result object.
  const rows = await db
    .select({
      id: vfsRegistry.id,
      linkId: sql<string>`${vfsLinks.id} as "linkId"`,
      objectType: vfsRegistry.objectType,
      name: sql<string>`${nameExpr} as "name"`,
      createdAt: vfsRegistry.createdAt
    })
    .from(vfsLinks)
    .innerJoin(vfsRegistry, eq(vfsLinks.childId, vfsRegistry.id))
    .where(eq(vfsLinks.parentId, folderId))
    .orderBy(...orderExprs);

  return rows as VfsFolderQueryRow[];
}

/**
 * Query items that are not linked to any folder, sorted at the database level.
 */
export async function queryUnfiledItems(
  db: Database,
  sort: VfsSortState
): Promise<VfsQueryRow[]> {
  const nameExpr = nameCoalesce();
  const orderExprs = buildOrderBy(sort, nameExpr);

  // Explicit "name" alias required: see queryFolderContents comment.
  const rows = await db
    .select({
      id: vfsRegistry.id,
      objectType: vfsRegistry.objectType,
      name: sql<string>`${nameExpr} as "name"`,
      createdAt: vfsRegistry.createdAt
    })
    .from(vfsRegistry)
    .leftJoin(vfsLinks, eq(vfsRegistry.id, vfsLinks.childId))
    .where(and(isNull(vfsLinks.childId), ne(vfsRegistry.id, VFS_ROOT_ID)))
    .orderBy(...orderExprs);

  return rows as VfsQueryRow[];
}

/**
 * Query all items in the registry, sorted at the database level.
 */
export async function queryAllItems(
  db: Database,
  sort: VfsSortState
): Promise<VfsQueryRow[]> {
  const nameExpr = nameCoalesce();
  const orderExprs = buildOrderBy(sort, nameExpr);

  // Explicit "name" alias required: see queryFolderContents comment.
  const rows = await db
    .select({
      id: vfsRegistry.id,
      objectType: vfsRegistry.objectType,
      name: sql<string>`${nameExpr} as "name"`,
      createdAt: vfsRegistry.createdAt
    })
    .from(vfsRegistry)
    .where(ne(vfsRegistry.id, VFS_ROOT_ID))
    .orderBy(...orderExprs);

  return rows as VfsQueryRow[];
}

/**
 * Query items marked as deleted in the canonical VFS registry state, sorted at
 * the database level.
 */
export async function queryDeletedItems(
  db: Database,
  sort: VfsSortState
): Promise<VfsQueryRow[]> {
  const nameExpr = nameCoalesce();
  const orderExprs = buildOrderBy(sort, nameExpr);

  // Explicit "name" alias required: see queryFolderContents comment.
  const rows = await db
    .select({
      id: vfsRegistry.id,
      objectType: vfsRegistry.objectType,
      name: sql<string>`${nameExpr} as "name"`,
      createdAt: vfsRegistry.createdAt
    })
    .from(vfsRegistry)
    .innerJoin(vfsItemState, eq(vfsRegistry.id, vfsItemState.itemId))
    .where(
      and(ne(vfsRegistry.id, VFS_ROOT_ID), isNotNull(vfsItemState.deletedAt))
    )
    .orderBy(...orderExprs);

  return rows as VfsQueryRow[];
}
