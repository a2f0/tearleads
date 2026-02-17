/**
 * VFS share query builder for listing shared items.
 * Uses SQL JOINs for name resolution and ORDER BY at the database level.
 */

import type { Database } from '@tearleads/db/sqlite';
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
  vfsAclEntries,
  vfsRegistry
} from '@tearleads/db/sqlite';
import {
  isVfsSharedByMeQueryRow,
  isVfsSharedWithMeQueryRow,
  type VfsSharedByMeQueryRow,
  type VfsSharedWithMeQueryRow
} from '@tearleads/shared';
import type { SQL } from 'drizzle-orm';
import { and, asc, desc, eq, inArray, isNull, sql } from 'drizzle-orm';
import type { VfsSortState } from './vfsTypes';

const SHARE_ACL_ID_PREFIX = 'share:';
const SHARE_ACL_ID_LIKE = `${SHARE_ACL_ID_PREFIX}%`;
const SHARE_ACL_ID_SQLITE_SUBSTR_START = SHARE_ACL_ID_PREFIX.length + 1;

function isMissingSqliteTableError(
  error: unknown,
  tableName: 'users'
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

function toDateOrNull(value: unknown): Date | null {
  if (value === null || value === undefined) {
    return null;
  }
  if (value instanceof Date) {
    return value;
  }
  if (typeof value === 'number' || typeof value === 'string') {
    const parsed = new Date(value);
    if (!Number.isNaN(parsed.getTime())) {
      return parsed;
    }
  }
  return null;
}

function toDateOrFallback(value: unknown, fallback: Date): Date {
  return toDateOrNull(value) ?? fallback;
}

function shareIdExpr(): SQL<string> {
  // SQLite substr() uses 1-based indexing.
  return sql<string>`substr(${vfsAclEntries.id}, ${SHARE_ACL_ID_SQLITE_SUBSTR_START})`;
}

function sharePermissionLevelExpr(): SQL<string> {
  /**
   * Guardrail: ACL access levels are richer than explorer share permission
   * labels. We intentionally collapse {write, admin} => "edit" and keep
   * read-only as "view".
   */
  return sql<string>`CASE
    WHEN ${vfsAclEntries.accessLevel} = 'read' THEN 'view'
    ELSE 'edit'
  END`;
}

/**
 * COALESCE expression that resolves display names from type-specific tables.
 * Mirrors the implementation in vfsQuery.ts.
 *
 * Guardrail: shared folder names are canonicalized to `vfs_registry` and must
 * not read from `vfs_folders`.
 */
function nameCoalesce(): SQL<string> {
  return sql<string>`COALESCE(
    NULLIF(${vfsRegistry.encryptedName}, ''),
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
  const canonicalShareIdExpr = shareIdExpr();
  const permissionLevelExpr = sharePermissionLevelExpr();

  // For now, targetName is just the targetId (resolving to actual name would
  // require additional lookups depending on shareType - user/group/org).
  // This can be enhanced later.
  try {
    const fallbackNow = new Date();
    const rows = await db
      .select({
        id: vfsRegistry.id,
        objectType: vfsRegistry.objectType,
        name: sql<string>`${nameExpr} as "name"`,
        createdAt: vfsRegistry.createdAt,
        shareId: sql<string>`${canonicalShareIdExpr} as "shareId"`,
        targetId: vfsAclEntries.principalId,
        targetName: sql<string>`${vfsAclEntries.principalId} as "targetName"`,
        shareType: vfsAclEntries.principalType,
        permissionLevel: sql<string>`${permissionLevelExpr} as "permissionLevel"`,
        sharedAt: sql<Date>`${vfsAclEntries.createdAt} as "sharedAt"`,
        expiresAt: vfsAclEntries.expiresAt
      })
      .from(vfsAclEntries)
      .innerJoin(vfsRegistry, eq(vfsAclEntries.itemId, vfsRegistry.id))
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
          eq(vfsAclEntries.grantedBy, currentUserId),
          isNull(vfsAclEntries.revokedAt),
          sql`${vfsAclEntries.id} LIKE ${SHARE_ACL_ID_LIKE}`
        )
      )
      .orderBy(...orderExprs);
    const normalizedRows: VfsSharedByMeQueryRow[] = rows.map((row) => ({
      ...row,
      createdAt: toDateOrFallback(row.createdAt, fallbackNow),
      sharedAt: toDateOrFallback(row.sharedAt, fallbackNow),
      expiresAt: toDateOrNull(row.expiresAt)
    }));

    if (!normalizedRows.every(isVfsSharedByMeQueryRow)) {
      throw new Error('Database returned invalid rows for SharedByMe query');
    }

    return normalizedRows;
  } catch (error) {
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
  const canonicalShareIdExpr = shareIdExpr();
  const permissionLevelExpr = sharePermissionLevelExpr();

  try {
    const fallbackNow = new Date();
    const rows = await db
      .select({
        id: vfsRegistry.id,
        objectType: vfsRegistry.objectType,
        name: sql<string>`${nameExpr} as "name"`,
        createdAt: vfsRegistry.createdAt,
        shareId: sql<string>`${canonicalShareIdExpr} as "shareId"`,
        sharedById: sql<string>`COALESCE(${vfsAclEntries.grantedBy}, 'unknown') as "sharedById"`,
        sharedByEmail: sql<string>`COALESCE(${users.email}, ${vfsAclEntries.grantedBy}, 'Unknown') as "sharedByEmail"`,
        shareType: vfsAclEntries.principalType,
        permissionLevel: sql<string>`${permissionLevelExpr} as "permissionLevel"`,
        sharedAt: sql<Date>`${vfsAclEntries.createdAt} as "sharedAt"`,
        expiresAt: vfsAclEntries.expiresAt
      })
      .from(vfsAclEntries)
      .innerJoin(vfsRegistry, eq(vfsAclEntries.itemId, vfsRegistry.id))
      .leftJoin(users, eq(vfsAclEntries.grantedBy, users.id))
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
          eq(vfsAclEntries.principalId, currentUserId),
          eq(vfsAclEntries.principalType, 'user'),
          isNull(vfsAclEntries.revokedAt),
          sql`${vfsAclEntries.id} LIKE ${SHARE_ACL_ID_LIKE}`
        )
      )
      .orderBy(...orderExprs);
    const normalizedRows: VfsSharedWithMeQueryRow[] = rows.map((row) => ({
      ...row,
      createdAt: toDateOrFallback(row.createdAt, fallbackNow),
      sharedAt: toDateOrFallback(row.sharedAt, fallbackNow),
      expiresAt: toDateOrNull(row.expiresAt)
    }));

    if (!normalizedRows.every(isVfsSharedWithMeQueryRow)) {
      throw new Error('Database returned invalid rows for SharedWithMe query');
    }

    return normalizedRows;
  } catch (error) {
    if (isMissingSqliteTableError(error, 'users')) {
      console.error(
        'VFS share query skipped: missing required table "users". Run latest client migrations.',
        error
      );
      return [];
    }
    throw error;
  }
}
