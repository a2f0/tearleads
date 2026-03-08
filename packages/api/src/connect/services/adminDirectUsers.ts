import { Code, ConnectError } from '@connectrpc/connect';
import type {
  AdminUserResponse,
  AdminUsersResponse,
  AdminUserUpdatePayload
} from '@tearleads/shared';
import { getPool } from '../../lib/postgres.js';
import {
  deleteAllSessionsForUser,
  getLatestLastActiveByUserIds
} from '../../lib/sessions.js';
import {
  requireScopedAdminAccess,
  type ScopedAdminAccess
} from './adminDirectAuth.js';
import type { OptionalWithUndefined } from './adminDirectTypes.js';
import {
  emptyAccounting,
  getUserAccounting,
  mapUserRow,
  parseUserUpdatePayload,
  type UserRow
} from './adminDirectUsersShared.js';

type IdRequest = { id: string };
type UpdateUserInput = {
  id: string;
} & OptionalWithUndefined<AdminUserUpdatePayload>;
type ListUsersRequest = { organizationId: string };

function encoded(value: string): string {
  return encodeURIComponent(value);
}

function canAccessOrganization(
  authorization: ScopedAdminAccess,
  organizationId: string
): boolean {
  return (
    authorization.adminAccess.isRootAdmin ||
    authorization.adminAccess.organizationIds.includes(organizationId)
  );
}

function normalizeOptionalOrganizationId(
  organizationId: string
): string | null {
  const trimmed = organizationId.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function ensureRootAdmin(authorization: ScopedAdminAccess): void {
  if (!authorization.adminAccess.isRootAdmin) {
    throw new ConnectError('Forbidden', Code.PermissionDenied);
  }
}

function normalizeUpdateUserPayload(
  input: OptionalWithUndefined<AdminUserUpdatePayload>
): AdminUserUpdatePayload | null {
  const normalized = Object.fromEntries(
    Object.entries(input).filter(([, value]) => value !== undefined)
  );
  return parseUserUpdatePayload(normalized);
}

export async function listUsersDirect(
  request: ListUsersRequest,
  context: { requestHeader: Headers }
): Promise<{ json: string }> {
  const authorization = await requireScopedAdminAccess(
    '/admin/users',
    context.requestHeader
  );
  const requestedOrganizationId = normalizeOptionalOrganizationId(
    request.organizationId
  );
  if (
    requestedOrganizationId !== null &&
    !canAccessOrganization(authorization, requestedOrganizationId)
  ) {
    throw new ConnectError('Forbidden', Code.PermissionDenied);
  }

  try {
    const pool = await getPool('read');
    const result =
      authorization.adminAccess.isRootAdmin && requestedOrganizationId === null
        ? await pool.query<UserRow>(
            `SELECT
               u.id,
               u.email,
               u.email_confirmed,
               u.admin,
               u.disabled,
               u.disabled_at,
               u.disabled_by,
               u.marked_for_deletion_at,
               u.marked_for_deletion_by,
               MIN(uc.created_at) AS created_at,
               COALESCE(
                 ARRAY_AGG(uo.organization_id) FILTER (WHERE uo.organization_id IS NOT NULL),
                 '{}'
               ) AS organization_ids
             FROM users u
             LEFT JOIN user_organizations uo ON uo.user_id = u.id
             LEFT JOIN user_credentials uc ON uc.user_id = u.id
             GROUP BY u.id
             ORDER BY u.email`
          )
        : await pool.query<UserRow>(
            `SELECT
               u.id,
               u.email,
               u.email_confirmed,
               u.admin,
               u.disabled,
               u.disabled_at,
               u.disabled_by,
               u.marked_for_deletion_at,
               u.marked_for_deletion_by,
               MIN(uc.created_at) AS created_at,
               COALESCE(
                 ARRAY_AGG(uo.organization_id) FILTER (
                   WHERE uo.organization_id = ANY($1::text[])
                 ),
                 '{}'
               ) AS organization_ids
             FROM users u
             LEFT JOIN user_organizations uo ON uo.user_id = u.id
             LEFT JOIN user_credentials uc ON uc.user_id = u.id
             WHERE EXISTS (
               SELECT 1
               FROM user_organizations uof
               WHERE uof.user_id = u.id
                 AND uof.organization_id = ANY($1::text[])
             )
             GROUP BY u.id
             ORDER BY u.email`,
            [
              requestedOrganizationId !== null
                ? [requestedOrganizationId]
                : authorization.adminAccess.organizationIds
            ]
          );

    const userIds = result.rows.map((row) => row.id);
    const lastActiveByUserId = await getLatestLastActiveByUserIds(userIds);
    const accountingByUserId = await getUserAccounting(pool, userIds);

    const response: AdminUsersResponse = {
      users: result.rows.map((row) =>
        mapUserRow(row, {
          lastActiveAt: lastActiveByUserId[row.id] ?? null,
          accounting: accountingByUserId[row.id] ?? emptyAccounting
        })
      )
    };

    return { json: JSON.stringify(response) };
  } catch (error) {
    if (error instanceof ConnectError) {
      throw error;
    }
    console.error('Users admin error:', error);
    throw new ConnectError('Failed to query users', Code.Internal);
  }
}

export async function getUserDirect(
  request: IdRequest,
  context: { requestHeader: Headers }
): Promise<{ json: string }> {
  const authorization = await requireScopedAdminAccess(
    `/admin/users/${encoded(request.id)}`,
    context.requestHeader
  );

  try {
    const pool = await getPool('read');
    const result = authorization.adminAccess.isRootAdmin
      ? await pool.query<UserRow>(
          `SELECT
               u.id,
               u.email,
               u.email_confirmed,
               u.admin,
               u.disabled,
               u.disabled_at,
               u.disabled_by,
               u.marked_for_deletion_at,
               u.marked_for_deletion_by,
               MIN(uc.created_at) AS created_at,
               COALESCE(
                 ARRAY_AGG(uo.organization_id) FILTER (WHERE uo.organization_id IS NOT NULL),
                 '{}'
               ) AS organization_ids
             FROM users u
             LEFT JOIN user_organizations uo ON uo.user_id = u.id
             LEFT JOIN user_credentials uc ON uc.user_id = u.id
             WHERE u.id = $1
             GROUP BY u.id`,
          [request.id]
        )
      : await pool.query<UserRow>(
          `SELECT
               u.id,
               u.email,
               u.email_confirmed,
               u.admin,
               u.disabled,
               u.disabled_at,
               u.disabled_by,
               u.marked_for_deletion_at,
               u.marked_for_deletion_by,
               MIN(uc.created_at) AS created_at,
               COALESCE(
                 ARRAY_AGG(uo.organization_id) FILTER (
                   WHERE uo.organization_id = ANY($2::text[])
                 ),
                 '{}'
               ) AS organization_ids
             FROM users u
             LEFT JOIN user_organizations uo ON uo.user_id = u.id
             LEFT JOIN user_credentials uc ON uc.user_id = u.id
             WHERE u.id = $1
               AND EXISTS (
                 SELECT 1
                 FROM user_organizations uof
                 WHERE uof.user_id = u.id
                   AND uof.organization_id = ANY($2::text[])
               )
             GROUP BY u.id`,
          [request.id, authorization.adminAccess.organizationIds]
        );

    const user = result.rows[0];
    if (!user) {
      throw new ConnectError('User not found', Code.NotFound);
    }

    const lastActiveAt =
      (await getLatestLastActiveByUserIds([user.id]))[user.id] ?? null;
    const accountingByUserId = await getUserAccounting(pool, [user.id]);

    const response: AdminUserResponse = {
      user: mapUserRow(user, {
        lastActiveAt,
        accounting: accountingByUserId[user.id] ?? emptyAccounting
      })
    };
    return { json: JSON.stringify(response) };
  } catch (error) {
    if (error instanceof ConnectError) {
      throw error;
    }
    console.error('Users admin error:', error);
    throw new ConnectError('Failed to query user', Code.Internal);
  }
}

export async function updateUserDirect(
  request: UpdateUserInput,
  context: { requestHeader: Headers }
): Promise<{ json: string }> {
  const { id, ...payload } = request;
  const authorization = await requireScopedAdminAccess(
    `/admin/users/${encoded(id)}`,
    context.requestHeader
  );
  ensureRootAdmin(authorization);

  const updates = normalizeUpdateUserPayload(payload);
  if (!updates) {
    throw new ConnectError('Invalid user update payload', Code.InvalidArgument);
  }

  const setClauses: string[] = [];
  const values: Array<string | boolean> = [];
  let index = 1;

  if (updates.email !== undefined) {
    setClauses.push(`"email" = $${index}`);
    values.push(updates.email);
    index += 1;
  }

  if (updates.emailConfirmed !== undefined) {
    setClauses.push(`"email_confirmed" = $${index}`);
    values.push(updates.emailConfirmed);
    index += 1;
  }

  if (updates.admin !== undefined) {
    setClauses.push(`"admin" = $${index}`);
    values.push(updates.admin);
    index += 1;
  }

  const adminUserId = authorization.sub;

  if (updates.disabled !== undefined) {
    setClauses.push(`"disabled" = $${index}`);
    values.push(updates.disabled);
    index += 1;

    if (updates.disabled) {
      setClauses.push('"disabled_at" = NOW()');
      setClauses.push(`"disabled_by" = $${index}`);
      values.push(adminUserId);
      index += 1;
    } else {
      setClauses.push('"disabled_at" = NULL');
      setClauses.push('"disabled_by" = NULL');
    }
  }

  if (updates.markedForDeletion !== undefined) {
    if (updates.markedForDeletion) {
      setClauses.push('"marked_for_deletion_at" = NOW()');
      setClauses.push(`"marked_for_deletion_by" = $${index}`);
      values.push(adminUserId);
      index += 1;
    } else {
      setClauses.push('"marked_for_deletion_at" = NULL');
      setClauses.push('"marked_for_deletion_by" = NULL');
    }
  }

  const pool = await getPool('write');
  let transactionStarted = false;

  try {
    const userId = id;
    await pool.query('BEGIN');
    transactionStarted = true;

    let updatedUser: UserRow | undefined;

    if (setClauses.length > 0) {
      const result = await pool.query<UserRow>(
        `UPDATE users
         SET ${setClauses.join(', ')}
         WHERE id = $${index}
         RETURNING id, email, email_confirmed, admin, disabled, disabled_at, disabled_by, marked_for_deletion_at, marked_for_deletion_by`,
        [...values, userId]
      );
      updatedUser = result.rows[0];

      if (updates.disabled === true && updatedUser) {
        await deleteAllSessionsForUser(updatedUser.id);
      }
    } else {
      const result = await pool.query<UserRow>(
        'SELECT id, email, email_confirmed, admin, disabled, disabled_at, disabled_by, marked_for_deletion_at, marked_for_deletion_by FROM users WHERE id = $1',
        [userId]
      );
      updatedUser = result.rows[0];
    }

    if (!updatedUser) {
      await pool.query('ROLLBACK');
      transactionStarted = false;
      throw new ConnectError('User not found', Code.NotFound);
    }

    if (updates.organizationIds !== undefined) {
      const personalOrgResult = await pool.query<{
        personal_organization_id: string | null;
      }>('SELECT personal_organization_id FROM users WHERE id = $1', [userId]);
      const personalOrganizationId =
        personalOrgResult.rows[0]?.personal_organization_id ?? null;

      if (!personalOrganizationId) {
        await pool.query('ROLLBACK');
        transactionStarted = false;
        throw new ConnectError(
          'User personal organization is missing',
          Code.Internal
        );
      }

      const organizationIds = Array.from(
        new Set([...updates.organizationIds, personalOrganizationId])
      );

      if (organizationIds.length > 0) {
        const orgResult = await pool.query<{ id: string }>(
          'SELECT id FROM organizations WHERE id = ANY($1::text[])',
          [organizationIds]
        );
        if (orgResult.rows.length !== organizationIds.length) {
          await pool.query('ROLLBACK');
          transactionStarted = false;
          throw new ConnectError('Organization not found', Code.NotFound);
        }
      }

      await pool.query('DELETE FROM user_organizations WHERE user_id = $1', [
        userId
      ]);

      if (organizationIds.length > 0) {
        await pool.query(
          `INSERT INTO user_organizations (user_id, organization_id, joined_at, is_admin)
           SELECT $1, organization_id, NOW(), organization_id = $3
           FROM unnest($2::text[]) AS organization_id`,
          [userId, organizationIds, personalOrganizationId]
        );
      }
    }

    const orgResult = await pool.query<{ organization_id: string }>(
      'SELECT organization_id FROM user_organizations WHERE user_id = $1 ORDER BY organization_id',
      [updatedUser.id]
    );

    const createdAtResult = await pool.query<{ created_at: Date | null }>(
      'SELECT MIN(created_at) AS created_at FROM user_credentials WHERE user_id = $1',
      [updatedUser.id]
    );
    const createdAt = createdAtResult.rows[0]?.created_at ?? null;

    await pool.query('COMMIT');
    transactionStarted = false;

    const lastActiveAt =
      (await getLatestLastActiveByUserIds([updatedUser.id]))[updatedUser.id] ??
      null;
    const accountingByUserId = await getUserAccounting(pool, [updatedUser.id]);

    const response: AdminUserResponse = {
      user: mapUserRow(
        {
          ...updatedUser,
          organization_ids: orgResult.rows.map((row) => row.organization_id),
          created_at: createdAt
        },
        {
          lastActiveAt,
          accounting: accountingByUserId[updatedUser.id] ?? emptyAccounting
        }
      )
    };

    return { json: JSON.stringify(response) };
  } catch (error) {
    console.error('Users admin error:', error);
    if (transactionStarted) {
      try {
        await pool.query('ROLLBACK');
      } catch (rollbackError) {
        console.error('Failed to rollback user update:', rollbackError);
      }
    }
    if (error instanceof ConnectError) {
      throw error;
    }
    throw new ConnectError('Failed to update user', Code.Internal);
  }
}
