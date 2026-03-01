/**
 * VFS share query builder for listing shared items.
 * Uses SQL JOINs for name resolution and ORDER BY at the database level.
 */

import type { Database } from '@tearleads/db/sqlite';
import { users, vfsAclEntries, vfsRegistry } from '@tearleads/db/sqlite';
import {
  isVfsSharedByMeQueryRow,
  isVfsSharedWithMeQueryRow,
  type VfsSharedByMeQueryRow,
  type VfsSharedWithMeQueryRow
} from '@tearleads/shared';
import type { SQL } from 'drizzle-orm';
import { and, asc, desc, eq, isNull, sql } from 'drizzle-orm';
import { alias } from 'drizzle-orm/sqlite-core';
import type { VfsSortState } from './vfsTypes';

const SHARE_ACL_ID_PREFIX = 'share:';
const SHARE_ACL_ID_LIKE = `${SHARE_ACL_ID_PREFIX}%`;
const SHARE_ACL_ID_SQLITE_SUBSTR_START = SHARE_ACL_ID_PREFIX.length + 1;
const POLICY_COMPILED_ACL_ID_PREFIX = 'policy-compiled:';
const POLICY_COMPILED_ACL_ID_LIKE = `${POLICY_COMPILED_ACL_ID_PREFIX}%`;
const sharingUsers = alias(users, 'sharing_users');

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
  return sql<string>`CASE
    WHEN ${vfsAclEntries.id} LIKE ${SHARE_ACL_ID_LIKE}
      THEN substr(${vfsAclEntries.id}, ${SHARE_ACL_ID_SQLITE_SUBSTR_START})
    ELSE ${vfsAclEntries.id}
  END`;
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
    CASE ${vfsRegistry.objectType}
      WHEN 'folder' THEN 'Unnamed Folder'
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
    .where(
      and(
        isNull(vfsAclEntries.revokedAt),
        sql<boolean>`(
          (
            ${vfsAclEntries.id} LIKE ${SHARE_ACL_ID_LIKE}
            AND ${vfsAclEntries.grantedBy} = ${currentUserId}
          )
          OR (
            ${vfsAclEntries.id} LIKE ${POLICY_COMPILED_ACL_ID_LIKE}
            AND ${vfsRegistry.ownerId} = ${currentUserId}
          )
        )`,
        sql<boolean>`NOT (
          ${vfsAclEntries.principalType} = 'user'
          AND ${vfsAclEntries.principalId} = ${currentUserId}
        )`
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
}

/**
 * Query items that have been shared with the current user.
 * Supports direct shares plus policy-derived ACL rows targeting this user.
 * Group and organization resolution still requires membership joins.
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
        sharedById: sql<string>`COALESCE(${vfsAclEntries.grantedBy}, ${vfsRegistry.ownerId}, 'unknown') as "sharedById"`,
        sharedByEmail: sql<string>`COALESCE(
          ${sharingUsers.email},
          ${vfsAclEntries.grantedBy},
          ${vfsRegistry.ownerId},
          'Unknown'
        ) as "sharedByEmail"`,
        shareType: vfsAclEntries.principalType,
        permissionLevel: sql<string>`${permissionLevelExpr} as "permissionLevel"`,
        sharedAt: sql<Date>`${vfsAclEntries.createdAt} as "sharedAt"`,
        expiresAt: vfsAclEntries.expiresAt
      })
      .from(vfsAclEntries)
      .innerJoin(vfsRegistry, eq(vfsAclEntries.itemId, vfsRegistry.id))
      .leftJoin(
        sharingUsers,
        sql`${sharingUsers.id} = COALESCE(${vfsAclEntries.grantedBy}, ${vfsRegistry.ownerId})`
      )
      .where(
        and(
          eq(vfsAclEntries.principalId, currentUserId),
          eq(vfsAclEntries.principalType, 'user'),
          isNull(vfsAclEntries.revokedAt),
          sql<boolean>`(
            ${vfsAclEntries.id} LIKE ${SHARE_ACL_ID_LIKE}
            OR ${vfsAclEntries.id} LIKE ${POLICY_COMPILED_ACL_ID_LIKE}
          )`
        )
      )
      .orderBy(...orderExprs);
    const normalizedRows: VfsSharedWithMeQueryRow[] = rows.map((row) => ({
      ...row,
      createdAt: toDateOrFallback(row.createdAt, fallbackNow),
      sharedAt: toDateOrFallback(row.sharedAt, fallbackNow),
      expiresAt: toDateOrNull(row.expiresAt)
    }));

    const invalidRow = normalizedRows.find(
      (row) => !isVfsSharedWithMeQueryRow(row)
    );
    if (invalidRow) {
      throw new Error(
        'Database returned invalid rows for SharedWithMe query'
      );
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
