import type { AdminUsersResponse } from '@tearleads/shared';
import type { Request, Response, Router as RouterType } from 'express';
import { getPool } from '../../../lib/postgres.js';
import { getLatestLastActiveByUserIds } from '../../../lib/sessions.js';
import {
  ensureOrganizationAccess,
  parseOrganizationIdQuery
} from '../../../middleware/adminAccess.js';
import {
  emptyAccounting,
  getUserAccounting,
  mapUserRow,
  type UserRow
} from './shared.js';

/**
 * @openapi
 * /admin/users:
 *   get:
 *     summary: List users
 *     description: Returns all users for admin management.
 *     tags:
 *       - Admin
 *     responses:
 *       200:
 *         description: List of users
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 users:
 *                   type: array
 *                   items:
 *                     type: object
 *       500:
 *         description: Postgres connection error
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Error'
 */
export const getRootHandler = async (req: Request, res: Response) => {
  try {
    const access = req.adminAccess;
    if (!access) {
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }

    const requestedOrganizationId = parseOrganizationIdQuery(req, res);
    if (requestedOrganizationId === undefined) {
      return;
    }
    if (
      requestedOrganizationId &&
      !ensureOrganizationAccess(req, res, requestedOrganizationId)
    ) {
      return;
    }

    const pool = await getPool('read');
    const result =
      access.isRootAdmin && !requestedOrganizationId
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
              requestedOrganizationId
                ? [requestedOrganizationId]
                : access.organizationIds
            ]
          );
    const userIds = result.rows.map((row) => row.id);
    const lastActiveByUserId = await getLatestLastActiveByUserIds(userIds);
    const accountingByUserId = await getUserAccounting(pool, userIds);
    const users = result.rows.map((row) =>
      mapUserRow(row, {
        lastActiveAt: lastActiveByUserId[row.id] ?? null,
        accounting: accountingByUserId[row.id] ?? emptyAccounting
      })
    );
    const response: AdminUsersResponse = { users };
    res.json(response);
  } catch (err) {
    console.error('Users admin error:', err);
    res.status(500).json({
      error: err instanceof Error ? err.message : 'Failed to query users'
    });
  }
};

export function registerGetRootRoute(routeRouter: RouterType): void {
  routeRouter.get('/', getRootHandler);
}
