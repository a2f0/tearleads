/**
 * VFS share query builder for listing shared items.
 * Uses SQL JOINs for name resolution and ORDER BY at the database level.
 */

import type { Database } from '@rapid/db/sqlite';
import {
  albums,
  contactGroups,
  contacts,
  emailFolders,
  emails,
  files,
  notes,
  playlists,
  tags,
  users,
  vfsFolders,
  vfsRegistry,
  vfsShares
} from '@rapid/db/sqlite';
import type { SQL } from 'drizzle-orm';
import { and, asc, desc, eq, inArray, sql } from 'drizzle-orm';
import type { VfsSortState } from './vfsTypes';

function isMissingSqliteTableError(
  error: unknown,
  tableName: 'vfs_shares' | 'users'
): boolean {
  const noSuchTableText = `no such table: ${tableName}`;
  const visited = new Set<unknown>();
  let current: unknown = error;

  while (current !== null && current !== undefined && !visited.has(current)) {
    visited.add(current);

    const message = (
      current instanceof Error ? current.message : String(current)
    ).toLowerCase();
    if (
      message.includes(noSuchTableText) ||
      (message.includes('no such table') && message.includes(tableName))
    ) {
      return true;
    }

    if (
      typeof current === 'object' &&
      current !== null &&
      'cause' in current &&
      current.cause !== undefined
    ) {
      current = current.cause;
      continue;
    }

    break;
  }

  return false;
}

/**
 * COALESCE expression that resolves display names from type-specific tables.
 * Mirrors the implementation in vfsQuery.ts.
 */
function nameCoalesce(): SQL<string> {
  return sql<string>`COALESCE(
    NULLIF(${vfsFolders.encryptedName}, ''),
    CASE WHEN ${vfsRegistry.objectType} = 'folder' THEN 'Unnamed Folder' END,
    NULLIF(${files.name}, ''),
    CASE WHEN ${contacts.id} IS NOT NULL THEN
      CASE WHEN ${contacts.lastName} IS NOT NULL AND ${contacts.lastName} != ''
        THEN ${contacts.firstName} || ' ' || ${contacts.lastName}
        ELSE ${contacts.firstName}
      END
    END,
    NULLIF(${notes.title}, ''),
    NULLIF(${playlists.encryptedName}, ''),
    CASE WHEN ${vfsRegistry.objectType} = 'playlist' THEN 'Unnamed Playlist' END,
    NULLIF(${albums.encryptedName}, ''),
    CASE WHEN ${vfsRegistry.objectType} = 'album' THEN 'Unnamed Album' END,
    NULLIF(${contactGroups.encryptedName}, ''),
    CASE WHEN ${vfsRegistry.objectType} = 'contactGroup' THEN 'Unnamed Group' END,
    NULLIF(${emailFolders.encryptedName}, ''),
    CASE WHEN ${vfsRegistry.objectType} = 'emailFolder' THEN 'Unnamed Folder' END,
    NULLIF(${tags.encryptedName}, ''),
    CASE WHEN ${vfsRegistry.objectType} = 'tag' THEN 'Unnamed Tag' END,
    NULLIF(${emails.encryptedSubject}, ''),
    CASE WHEN ${vfsRegistry.objectType} = 'email' THEN '(No Subject)' END,
    'Unknown'
  )`;
}

/**
 * Builds ORDER BY expressions based on the current sort state.
 * Default: alphabetical by name.
 */
function buildOrderBy(sort: VfsSortState, nameExpr: SQL<string>): SQL[] {
  if (!sort.column || !sort.direction) {
    return [asc(sql`${nameExpr} COLLATE NOCASE`), asc(vfsRegistry.id)];
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

/** Result shape for items shared by the current user. */
export interface VfsSharedByMeQueryRow {
  id: string;
  objectType: string;
  name: string;
  createdAt: Date;
  shareId: string;
  targetId: string;
  targetName: string;
  shareType: string;
  permissionLevel: string;
  sharedAt: Date;
  expiresAt: Date | null;
}

/** Result shape for items shared with the current user. */
export interface VfsSharedWithMeQueryRow {
  id: string;
  objectType: string;
  name: string;
  createdAt: Date;
  shareId: string;
  sharedById: string;
  sharedByEmail: string;
  shareType: string;
  permissionLevel: string;
  sharedAt: Date;
  expiresAt: Date | null;
}

/**
 * Query items that the current user has shared with others.
 */
export async function querySharedByMe(
  db: Database,
  currentUserId: string,
  sort: VfsSortState
): Promise<VfsSharedByMeQueryRow[]> {
  const nameExpr = nameCoalesce();
  const orderExprs = buildOrderBy(sort, nameExpr);

  try {
    // For now, targetName is just the targetId (resolving to actual name would
    // require additional lookups depending on shareType - user/group/org).
    // This can be enhanced later.
    const rows = await db
      .select({
        id: vfsRegistry.id,
        objectType: vfsRegistry.objectType,
        name: sql<string>`${nameExpr} as "name"`,
        createdAt: vfsRegistry.createdAt,
        shareId: sql<string>`${vfsShares.id} as "shareId"`,
        targetId: vfsShares.targetId,
        targetName: sql<string>`${vfsShares.targetId} as "targetName"`,
        shareType: vfsShares.shareType,
        permissionLevel: vfsShares.permissionLevel,
        sharedAt: sql<Date>`${vfsShares.createdAt} as "sharedAt"`,
        expiresAt: vfsShares.expiresAt
      })
      .from(vfsShares)
      .innerJoin(vfsRegistry, eq(vfsShares.itemId, vfsRegistry.id))
      .leftJoin(
        vfsFolders,
        and(
          eq(vfsRegistry.id, vfsFolders.id),
          eq(vfsRegistry.objectType, 'folder')
        )
      )
      .leftJoin(
        files,
        and(
          eq(vfsRegistry.id, files.id),
          inArray(vfsRegistry.objectType, ['file', 'photo', 'audio', 'video'])
        )
      )
      .leftJoin(
        contacts,
        and(
          eq(vfsRegistry.id, contacts.id),
          eq(vfsRegistry.objectType, 'contact')
        )
      )
      .leftJoin(
        notes,
        and(eq(vfsRegistry.id, notes.id), eq(vfsRegistry.objectType, 'note'))
      )
      .leftJoin(
        playlists,
        and(
          eq(vfsRegistry.id, playlists.id),
          eq(vfsRegistry.objectType, 'playlist')
        )
      )
      .leftJoin(
        albums,
        and(eq(vfsRegistry.id, albums.id), eq(vfsRegistry.objectType, 'album'))
      )
      .leftJoin(
        contactGroups,
        and(
          eq(vfsRegistry.id, contactGroups.id),
          eq(vfsRegistry.objectType, 'contactGroup')
        )
      )
      .leftJoin(
        emailFolders,
        and(
          eq(vfsRegistry.id, emailFolders.id),
          eq(vfsRegistry.objectType, 'emailFolder')
        )
      )
      .leftJoin(
        tags,
        and(eq(vfsRegistry.id, tags.id), eq(vfsRegistry.objectType, 'tag'))
      )
      .leftJoin(
        emails,
        and(eq(vfsRegistry.id, emails.id), eq(vfsRegistry.objectType, 'email'))
      )
      .where(eq(vfsShares.createdBy, currentUserId))
      .orderBy(...orderExprs);

    return rows as VfsSharedByMeQueryRow[];
  } catch (error) {
    if (isMissingSqliteTableError(error, 'vfs_shares')) {
      console.error(
        'VFS share query skipped: missing required table "vfs_shares". Run latest client migrations.',
        error
      );
      return [];
    }
    throw error;
  }
}

/**
 * Query items that have been shared with the current user.
 * Currently only supports direct user shares (shareType = 'user').
 * Group and organization shares would require additional joins.
 */
export async function querySharedWithMe(
  db: Database,
  currentUserId: string,
  sort: VfsSortState
): Promise<VfsSharedWithMeQueryRow[]> {
  const nameExpr = nameCoalesce();
  const orderExprs = buildOrderBy(sort, nameExpr);

  try {
    const rows = await db
      .select({
        id: vfsRegistry.id,
        objectType: vfsRegistry.objectType,
        name: sql<string>`${nameExpr} as "name"`,
        createdAt: vfsRegistry.createdAt,
        shareId: sql<string>`${vfsShares.id} as "shareId"`,
        sharedById: vfsShares.createdBy,
        sharedByEmail: sql<string>`${users.email} as "sharedByEmail"`,
        shareType: vfsShares.shareType,
        permissionLevel: vfsShares.permissionLevel,
        sharedAt: sql<Date>`${vfsShares.createdAt} as "sharedAt"`,
        expiresAt: vfsShares.expiresAt
      })
      .from(vfsShares)
      .innerJoin(vfsRegistry, eq(vfsShares.itemId, vfsRegistry.id))
      .innerJoin(users, eq(vfsShares.createdBy, users.id))
      .leftJoin(
        vfsFolders,
        and(
          eq(vfsRegistry.id, vfsFolders.id),
          eq(vfsRegistry.objectType, 'folder')
        )
      )
      .leftJoin(
        files,
        and(
          eq(vfsRegistry.id, files.id),
          inArray(vfsRegistry.objectType, ['file', 'photo', 'audio', 'video'])
        )
      )
      .leftJoin(
        contacts,
        and(
          eq(vfsRegistry.id, contacts.id),
          eq(vfsRegistry.objectType, 'contact')
        )
      )
      .leftJoin(
        notes,
        and(eq(vfsRegistry.id, notes.id), eq(vfsRegistry.objectType, 'note'))
      )
      .leftJoin(
        playlists,
        and(
          eq(vfsRegistry.id, playlists.id),
          eq(vfsRegistry.objectType, 'playlist')
        )
      )
      .leftJoin(
        albums,
        and(eq(vfsRegistry.id, albums.id), eq(vfsRegistry.objectType, 'album'))
      )
      .leftJoin(
        contactGroups,
        and(
          eq(vfsRegistry.id, contactGroups.id),
          eq(vfsRegistry.objectType, 'contactGroup')
        )
      )
      .leftJoin(
        emailFolders,
        and(
          eq(vfsRegistry.id, emailFolders.id),
          eq(vfsRegistry.objectType, 'emailFolder')
        )
      )
      .leftJoin(
        tags,
        and(eq(vfsRegistry.id, tags.id), eq(vfsRegistry.objectType, 'tag'))
      )
      .leftJoin(
        emails,
        and(eq(vfsRegistry.id, emails.id), eq(vfsRegistry.objectType, 'email'))
      )
      .where(
        and(
          eq(vfsShares.targetId, currentUserId),
          eq(vfsShares.shareType, 'user')
        )
      )
      .orderBy(...orderExprs);

    return rows as VfsSharedWithMeQueryRow[];
  } catch (error) {
    if (
      isMissingSqliteTableError(error, 'vfs_shares') ||
      isMissingSqliteTableError(error, 'users')
    ) {
      console.error(
        'VFS share query skipped: missing required table ("vfs_shares" or "users"). Run latest client migrations.',
        error
      );
      return [];
    }
    throw error;
  }
}
